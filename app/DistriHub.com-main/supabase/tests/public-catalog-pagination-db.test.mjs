import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const [owner, other, center, neighborhood, inactive, foreign] = Array.from({ length: 6 }, () => randomUUID());
const query = (sql, args = []) => db.query(sql, args);
const page = async (args = {}) => (await query(
  'SELECT public.read_public_catalog_page($1,$2,$3,$4,$5,$6) AS data',
  [args.slug ?? 'loja', args.branchSlug ?? null, args.branchId ?? null, args.search ?? '', args.offset ?? 0, args.limit ?? 100],
)).rows[0].data;

before(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated;
    CREATE TABLE public.store_settings_v2(id uuid DEFAULT gen_random_uuid(),user_id uuid,catalog_slug text,catalog_enabled boolean,
      logo_url text,banner_url text,primary_color text,nav_color text,business_hours text,personalization jsonb DEFAULT '{}');
    CREATE TABLE public.partner_profiles(id uuid,business_name text,account_name text);
    CREATE TABLE public.partner_branches(id uuid,user_id uuid,name text,address text,is_active boolean);
    CREATE TABLE public.partner_products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,branch_id uuid,name text,
      sale_price numeric,image_url text,stock integer,category text,sku text,is_service boolean,created_at timestamptz DEFAULT now(),cost_price numeric);
  `);
  const dir = new URL('../migrations/', import.meta.url);
  const migration = (await readdir(dir)).find(name => name.endsWith('_paginate_public_catalog.sql'));
  assert.ok(migration, 'catalog pagination migration exists');
  await db.exec(await readFile(new URL(migration, dir), 'utf8'));
  const visibility = (await readdir(dir)).find(name => name.endsWith('_enforce_public_catalog_visibility.sql'));
  assert.ok(visibility);
  await db.exec(await readFile(new URL(visibility, dir), 'utf8'));
  await db.exec(await readFile(new URL('20261108195815_hide_public_catalog_stock_quantities.sql', dir), 'utf8'));
  const legacySource = await readFile(new URL('20261012195624_fix_audited_operations.sql', dir), 'utf8');
  const legacyWrapper = legacySource.match(/CREATE FUNCTION public\.read_public_catalog_v2[\s\S]*?GRANT EXECUTE ON FUNCTION public\.read_public_catalog_v2\(text,text\) TO anon,authenticated;/);
  assert.ok(legacyWrapper);
  await db.exec(legacyWrapper[0]);
  await query("INSERT INTO public.store_settings_v2(user_id,catalog_slug,catalog_enabled) VALUES($1,'loja',true),($2,'desativada',false)", [owner, other]);
  await query("INSERT INTO public.partner_profiles VALUES($1,'Loja','Loja'),($2,'Outra','Outra')", [owner, other]);
  await query("INSERT INTO public.partner_branches VALUES($1,$5,'Centro','Rua A',true),($2,$5,'Bairro','Rua B',true),($3,$5,'Inativa','Rua C',false),($4,$6,'Outra','Rua D',true)", [center, neighborhood, inactive, foreign, owner, other]);
  await query("INSERT INTO public.partner_products(user_id,branch_id,name,sale_price,stock,sku,is_service,cost_price) SELECT $1,$2,'Produto '||i,10,5,'SKU-'||i,false,3 FROM generate_series(1,1005) AS i", [owner, center]);
  await query("INSERT INTO public.partner_products(user_id,branch_id,name,sale_price,stock,sku,is_service,created_at) VALUES($1,$2,'Raro',12,3,'R-1',false,'2000-01-01'),($1,$3,'Não publicar',12,3,'INATIVO',false,now()),($4,$5,'Outro lojista',12,3,'OUTRO',false,now()),($1,$6,'Sem saldo',12,0,'ZERO',false,now()),($1,$6,'Serviço',12,3,'SERV',true,now())", [owner, neighborhood, inactive, other, foreign, center]);
  await db.exec('SET ROLE anon');
});
after(() => db.close());

test('inventory is always private and SKU visibility is respected from every public catalog projection for anonymous and authenticated callers', async () => {
  try {
    for (const role of ['anon', 'authenticated']) for (const [showStock, showSku] of [[false, false], [true, false], [false, true], [true, true]]) {
      await db.exec('RESET ROLE');
      await query('UPDATE public.store_settings_v2 SET personalization=$1::jsonb WHERE user_id=$2', [JSON.stringify({ catalog: { show_stock: showStock, show_sku: showSku } }), owner]);
      await db.exec(`SET ROLE ${role}`);
      await query("SELECT set_config('request.jwt.claim.sub',$1,false)", [role === 'authenticated' ? owner : '']);
      const result = await page({ branchId: neighborhood });
      const legacy = (await query("SELECT public.read_public_store_catalog('loja','Bairro') AS data")).rows[0].data;
      const v2 = (await query("SELECT public.read_public_catalog_v2('loja','Bairro') AS data")).rows[0].data;
      for (const response of [result, legacy, v2]) {
        assert.equal(response.products.length, 1);
        const product = response.products[0];
        assert.equal(Object.hasOwn(product, 'stock'), false);
        assert.equal(Object.hasOwn(product, 'sku'), showSku);
        assert.equal(product.available, true);
        if (showSku) assert.equal(product.sku, 'R-1');
      }
      assert.equal((await page({ branchId: neighborhood, search: 'R-1' })).total, showSku ? 1 : 0);
      assert.equal((await page({ branchId: neighborhood, search: 'Raro' })).total, 1);
    }
  } finally {
    await db.exec('RESET ROLE');
    await query("SELECT set_config('request.jwt.claim.sub','',false)");
    await query("UPDATE public.store_settings_v2 SET personalization='{}' WHERE user_id=$1", [owner]);
    await db.exec('SET ROLE anon');
  }
});

test('all 1006 products are reachable in deterministic non-overlapping pages', async () => {
  const ids = [];
  let offset = 0;
  do {
    const result = await page({ branchId: center, offset });
    assert.equal(result.total, 1006);
    assert.ok(result.products.length <= 100);
    ids.push(...result.products.map(product => product.id));
    offset = result.next_offset;
  } while (offset !== null);
  assert.equal(ids.length, 1006);
  assert.equal(new Set(ids).size, 1006);
  const repeat = await page({ branchId: center });
  assert.deepEqual(repeat.products.map(product => product.id), ids.slice(0, 100));
  const last = await page({ branchId: center, offset: 1000 });
  assert.equal(last.products.length, 6);
  assert.equal(last.next_offset, null);
});

test('branch and literal case-insensitive search apply before pagination', async () => {
  const rare = await page({ branchId: neighborhood });
  assert.equal(rare.total, 1);
  assert.equal(rare.products[0].name, 'Raro');
  const fixed = await page({ branchSlug: 'Bairro', branchId: center });
  assert.equal(fixed.selected_branch_id, neighborhood);
  assert.equal(fixed.branch.id, neighborhood);
  assert.equal(fixed.total, 1);
  const result = await page({ branchId: center, search: 'sku-1005' });
  assert.equal(result.total, 1);
  assert.equal(result.products[0].sku, 'SKU-1005');
  assert.equal((await page({ branchId: center, search: '%' })).total, 0);
  const unavailable = await page({ branchId: center, search: 'Sem saldo' });
  assert.equal(unavailable.total, 1);
  assert.equal(unavailable.products[0].available, false);
  assert.equal(Object.hasOwn(unavailable.products[0], 'stock'), false);
  assert.equal((await page({ branchId: center, search: 'Serviço' })).total, 0);
});

test('disabled stores, foreign and inactive branches do not expose products or private fields', async () => {
  assert.equal(await page({ slug: 'desativada' }), null);
  assert.equal(await page({ slug: 'inexistente' }), null);
  for (const args of [{ branchId: foreign }, { branchId: inactive }, { branchSlug: 'Inexistente' }]) {
    const result = await page(args);
    assert.equal(result.total, 0);
    assert.equal(result.selected_branch_id, null);
    assert.equal(result.products.length, 0);
  }
  const result = await page({ branchId: center, offset: -1, limit: 10000 });
  assert.equal(result.products.length, 100);
  assert.equal(result.next_offset, 100);
  assert.ok(result.branches.every(branch => branch.id !== inactive && branch.id !== foreign));
  for (const key of ['user_id', 'cost_price']) assert.ok(!JSON.stringify(result).includes(key));
  await assert.rejects(query('SELECT * FROM public.partner_products'), /permission denied/);
});

test('all public APIs represent zero, negative and unknown stock as unavailable without leaking counts', async () => {
  try {
    await db.exec('RESET ROLE');
    await query("INSERT INTO public.partner_products(user_id,branch_id,name,sale_price,stock,is_service) VALUES($1,$2,'Negative stock',10,-2,false),($1,$2,'Unknown stock',10,NULL,false)",[owner,neighborhood]);
    await db.exec('SET ROLE anon');
    for (const sql of [
      "SELECT public.read_public_catalog_page('loja','Bairro') AS data",
      "SELECT public.read_public_store_catalog('loja','Bairro') AS data",
      "SELECT public.read_public_catalog_v2('loja','Bairro') AS data"
    ]) {
      const products=(await query(sql)).rows[0].data.products;
      assert.equal(products.length,3);
      for(const product of products) {
        assert.equal(product.available,product.name==='Raro');
        assert.equal(Object.hasOwn(product,'stock'),false);
      }
    }
  } finally {
    await db.exec('RESET ROLE');
    await query("DELETE FROM public.partner_products WHERE name IN ('Negative stock','Unknown stock')");
    await db.exec('SET ROLE anon');
  }
});
