import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
const db = new PGlite();
const [owner, other, staff, staffAuth, branch, foreignBranch, secondBranch, customer, sale] = Array.from({ length: 9 }, randomUUID);
const query = (sql, args = []) => db.query(sql, args);
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
async function identity(id, role = 'authenticated') {
  await db.exec('RESET ROLE'); await query("SELECT set_config('test.uid',$1,false)", [id ?? '']); await db.exec(`SET ROLE ${role}`);
}
const prepare = async () => (await query('SELECT public.prepare_order_quote_email($1) AS result', [sale])).rows[0].result;
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA partner_subscription_private; CREATE SCHEMA partner_access_private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE TABLE partner_profiles(id uuid PRIMARY KEY,account_name text,business_name text);
    CREATE TABLE partner_branches(id uuid PRIMARY KEY,user_id uuid,name text,is_active boolean);
    CREATE TABLE partner_salespeople(id uuid PRIMARY KEY,user_id uuid,auth_user_id uuid,branch_id uuid,role text,active boolean,pin_hash text,can_access_all_branches boolean DEFAULT false);
    CREATE TABLE partner_customers(id uuid PRIMARY KEY,user_id uuid,branch_id uuid,name text,email text,is_active boolean);
    CREATE TABLE partner_sales(id uuid PRIMARY KEY,user_id uuid,branch_id uuid,customer_id uuid,status text,sale_number bigint,created_at timestamptz,items jsonb,total numeric,freight_fee numeric,customer_name text);
    CREATE FUNCTION public.verify_partner_salesperson_pin(text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    -- Test doubles model the subscription boundary only; authorization resolver below is the real migration code.
    CREATE FUNCTION partner_subscription_private.require_actor(text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      IF current_setting('test.subscription',true)='denied' THEN RAISE EXCEPTION 'Subscription denied'; END IF; END; $$;
    CREATE FUNCTION partner_subscription_private.require_operator_module(text,uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      IF current_setting('test.module',true)='denied' THEN RAISE EXCEPTION 'Module denied'; END IF; END; $$;
  `);
  const source = await read('../migrations/20261029204344_optional_operator_all_branches.sql');
  for (const name of ['partner_access_private.has_branch', 'public.resolve_partner_operator', 'public.resolve_partner_pdv_operator']) {
    const start = source.indexOf(`CREATE ${name.startsWith('public.') ? 'OR REPLACE ' : ''}FUNCTION ${name}(`);
    assert.ok(start >= 0);
    const end = source.indexOf('$$;', source.indexOf('AS $$', start));
    await db.exec(source.slice(start, end + 3));
  }
  await db.exec(await read('../migrations/20261108201103_order_quote_email_delivery.sql'));
  await query("INSERT INTO partner_profiles VALUES($1,'A','A'),($2,'B','B')", [owner, other]);
  await query("INSERT INTO partner_branches VALUES($1,$4,'Centro',true),($2,$5,'Outra empresa',true),($3,$4,'Outra filial',true)", [branch, foreignBranch, secondBranch, owner, other]);
  await query("INSERT INTO partner_salespeople(id,user_id,auth_user_id,branch_id,role,active) VALUES($1,$2,$3,$4,'vendedor',true)", [staff, owner, staffAuth, branch]);
  await query("INSERT INTO partner_customers VALUES($1,$2,NULL,'Cliente','cliente@example.com',true)", [customer, owner]);
  await query("INSERT INTO partner_sales VALUES($1,$2,$3,$4,'pre_venda',1,now(),'[{\"name\":\"Produto\",\"quantity\":1,\"unit_price\":10}]',10,0,'Cliente')", [sale, owner, branch, customer]);
});
after(() => db.close());
test('owner, linked operator and shared customer work; simultaneous reservations claim exactly once', async () => {
  await identity(owner);
  const jobs = await Promise.all([prepare(), prepare()]);
  assert.equal(jobs.filter(job => job.claimed).length, 1);
  assert.equal(jobs[0].id, jobs[1].id);
  assert.equal(jobs.find(job => job.claimed).payload.customer.email, 'cliente@example.com');
  await identity(staffAuth); assert.equal((await prepare()).claimed, false);
  await identity(owner); await assert.rejects(query('SELECT * FROM order_quote_emails'), /permission denied/);
  await assert.rejects(query("SELECT finish_order_quote_email($1,'accepted','forged')", [jobs[0].id]), /permission denied/);
  await identity(null, 'service_role');
  await query("SELECT finish_order_quote_email($1,'accepted','provider-synthetic')", [jobs[0].id]);
  await assert.rejects(query("SELECT finish_order_quote_email($1,'failed',NULL)", [jobs[0].id]), /pending|pendente/);
});
test('foreign company, anonymous identity, module and subscription denials cannot reserve', async () => {
  await identity(other); await assert.rejects(prepare(), /filial|indispon/);
  await identity(null, 'anon'); await assert.rejects(prepare(), /permission denied/);
  await identity(null); await assert.rejects(prepare(), /autenticado/);
  for (const setting of ['test.module', 'test.subscription']) {
    await identity(owner); await query('SELECT set_config($1,$2,false)', [setting, 'denied']);
    await assert.rejects(prepare(), /denied/);
    await query('SELECT set_config($1,$2,false)', [setting, '']);
  }
});
test('operator cannot access another branch; mismatched customer branch or company is rejected', async () => {
  await identity(null, 'postgres');
  await query('UPDATE partner_sales SET branch_id=$1 WHERE id=$2', [secondBranch, sale]);
  await identity(staffAuth); await assert.rejects(prepare(), /filial/);
  await identity(null, 'postgres');
  await query('UPDATE partner_sales SET branch_id=$1 WHERE id=$2', [branch, sale]);
  for (const [company, customerBranch] of [[owner, secondBranch], [other, branch]]) {
    await query('UPDATE partner_customers SET user_id=$1,branch_id=$2 WHERE id=$3', [company, customerBranch, customer]);
    await identity(owner); await assert.rejects(prepare(), /e-mail/); await identity(null, 'postgres');
  }
  await query('UPDATE partner_customers SET user_id=$1,branch_id=$2 WHERE id=$3', [owner, branch, customer]);
  await identity(owner); assert.equal((await prepare()).claimed, false);
});
test('EXECUTE ACLs and RLS deny public access and frontend completion', async () => {
  await identity(null, 'postgres');
  const rows = (await query(`SELECT role,
    has_function_privilege(role,'prepare_order_quote_email(uuid)','EXECUTE') AS prepare,
    has_function_privilege(role,'finish_order_quote_email(uuid,text,text)','EXECUTE') AS finish
    FROM unnest(ARRAY['anon','authenticated','service_role']) role`)).rows;
  assert.deepEqual(rows, [
    { role: 'anon', prepare: false, finish: false },
    { role: 'authenticated', prepare: true, finish: false },
    { role: 'service_role', prepare: false, finish: true },
  ]);
  assert.equal((await query("SELECT relrowsecurity FROM pg_class WHERE oid='order_quote_emails'::regclass")).rows[0].relrowsecurity, true);
  assert.equal((await query("SELECT has_function_privilege('authenticated','prepare_order_quote_email(uuid)','EXECUTE WITH GRANT OPTION') AS allowed")).rows[0].allowed, false);
});

test('closed orders, inactive customers and invalid addresses are rejected before any reservation', async () => {
  await identity(null, 'postgres');
  await query("UPDATE partner_sales SET status='concluida' WHERE id=$1", [sale]);
  await identity(owner); await assert.rejects(prepare(), /aberto/);
  await identity(null, 'postgres');
  await query("UPDATE partner_sales SET status='pre_venda' WHERE id=$1", [sale]);
  for (const [active, email] of [[false, 'cliente@example.com'], [true, 'invalid'], [true, 'a@example.com,b@example.com']]) {
    await query('UPDATE partner_customers SET is_active=$1,email=$2 WHERE id=$3', [active, email, customer]);
    await identity(owner); await assert.rejects(prepare(), /e-mail/); await identity(null, 'postgres');
  }
  await query("UPDATE partner_customers SET is_active=true,email='cliente@example.com' WHERE id=$1", [customer]);
});

test('new snapshot reservation rolls back completely and the hourly limit cannot be bypassed', async () => {
  await identity(null, 'postgres');
  await query('UPDATE partner_sales SET total=11 WHERE id=$1', [sale]);
  const count = async () => (await query('SELECT count(*)::integer AS n FROM order_quote_emails')).rows[0].n;
  const before = await count();
  await db.exec('BEGIN');
  await query("SELECT set_config('test.uid',$1,true)", [owner]);
  await db.exec('SET LOCAL ROLE authenticated');
  assert.equal((await prepare()).claimed, true);
  await db.exec('ROLLBACK');
  assert.equal(await count(), before);
  await query("INSERT INTO order_quote_emails(user_id,sale_id,fingerprint) SELECT $1,$2,'synthetic-'||i FROM generate_series(1,59) i", [owner, sale]);
  await identity(owner); await assert.rejects(prepare(), /Limite/);
  await identity(null, 'postgres');
  await query("DELETE FROM order_quote_emails WHERE fingerprint LIKE 'synthetic-%'");
});
