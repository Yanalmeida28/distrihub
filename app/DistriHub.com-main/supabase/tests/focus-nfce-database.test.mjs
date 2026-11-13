import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const company = '00000000-0000-0000-0000-000000000001', branch = '00000000-0000-0000-0000-000000000002';
const sale = '00000000-0000-0000-0000-000000000003', product = '00000000-0000-0000-0000-000000000004';
const other = '00000000-0000-0000-0000-000000000005', foreignBranch = '00000000-0000-0000-0000-000000000006';
const sql = (query, values = []) => db.query(query, values);
const login = id => sql("SELECT set_config('test.auth_uid',$1,false)", [id ?? '']);
const payload = { cnpj_emitente: '11222333000181', valor_total: '20.02' };
const claim = (data = payload, retry = false) => sql('SELECT public.claim_focus_nfce($1,$2,$3,$4::jsonb,$5) AS job', [company, branch, sale, JSON.stringify(data), retry]).then(r => r.rows[0].job);
const finish = (job, state, data = {}) => sql('SELECT public.finish_focus_nfce($1,$2,$3,$4::jsonb) AS saved', [job.id, job.lease_id, state, JSON.stringify({ environment: 'homologacao', ...data })]).then(r => r.rows[0].saved);

before(async () => {
  await db.exec(await readFile(new URL('./fixtures/pdv_schema.sql', import.meta.url), 'utf8'));
  await db.exec(`ALTER TABLE partner_profiles ADD COLUMN document text;
    ALTER TABLE partner_products ADD COLUMN ncm text, ADD COLUMN cfop text, ADD COLUMN cst_csosn text,
      ADD COLUMN icms_rate numeric, ADD COLUMN pis_rate numeric, ADD COLUMN cofins_rate numeric;
    CREATE SCHEMA partner_subscription_private;
    CREATE FUNCTION partner_subscription_private.require_actor(text) RETURNS void LANGUAGE plpgsql AS $$
      BEGIN IF auth.uid() IS NULL OR current_setting('test.module_denied',true)='true' THEN RAISE EXCEPTION 'Módulo bloqueado'; END IF; END $$;
    CREATE FUNCTION public.resolve_partner_pdv_operator(uuid,text,uuid) RETURNS TABLE(company_id uuid,role text) LANGUAGE sql AS $$
      SELECT auth.uid(), coalesce(nullif(current_setting('test.role',true),''),'administrador') $$;
    CREATE TABLE fiscal_documents(id uuid PRIMARY KEY,user_id uuid,branch_id uuid,provider text,document_type text,status text,provider_document_id text,
      provider_response jsonb,number text,series text,access_key text,xml_url text,pdf_url text,rejection_reason text,updated_at timestamptz);
    INSERT INTO partner_profiles VALUES ('${company}','Responsável','Empresa','11222333000181'),('${other}','Outro','Outra empresa','00000000000000');
    INSERT INTO partner_branches VALUES ('${branch}','${company}'),('${foreignBranch}','${other}');
    INSERT INTO partner_products(id,user_id,branch_id,name,stock,ncm,cfop,cst_csosn,icms_rate,pis_rate,cofins_rate)
      VALUES ('${product}','${company}','${branch}','Produto sintético',10,'84713012','5102','102',0,0,0);
    INSERT INTO partner_sales(id,user_id,branch_id,items,total,status,customer_type,delivery_type,payment_method)
      VALUES ('${sale}','${company}','${branch}','[{"product_id":"${product}","quantity":2,"unit_price":10.01}]',20.02,'concluida','varejo','balcao','dinheiro');`);
  await db.exec(await readFile(new URL('../migrations/20261112195816_focus_nfce_homologation.sql', import.meta.url), 'utf8'));
});
after(async () => { await db.close(); });

test('Focus SQL: snapshot canônico exige sessão, módulo, cargo, empresa e filial corretos', async () => {
  const prepare = selectedBranch => sql('SELECT public.prepare_focus_nfce($1,$2) AS snapshot', [sale, selectedBranch]);
  await assert.rejects(prepare(branch));
  await login(other); await assert.rejects(prepare(branch), /Filial/);
  await login(company); await assert.rejects(prepare(foreignBranch), /Filial/);
  await db.exec("SELECT set_config('test.module_denied','true',false)"); await assert.rejects(prepare(branch), /bloqueado/);
  await db.exec("SELECT set_config('test.module_denied','false',false),set_config('test.role','vendedor',false)");
  await assert.rejects(prepare(branch), /permissão/);
  await db.exec("SELECT set_config('test.role','caixa',false)");
  const snapshot = (await prepare(branch)).rows[0].snapshot;
  assert.equal(snapshot.company_id, company); assert.equal(snapshot.sale.total, 20.02); assert.equal(snapshot.products[0].id, product);
  await sql("UPDATE partner_sales SET status='cancelada' WHERE id=$1", [sale]);
  await assert.rejects(prepare(branch), /concluída/);
  await sql("UPDATE partner_sales SET status='concluida' WHERE id=$1", [sale]);
});

test('Focus SQL: cliente não reserva, não confirma nem acessa tentativas privadas', async () => {
  await db.exec('SET ROLE authenticated');
  await assert.rejects(claim(), /permission denied/);
  await assert.rejects(sql('SELECT * FROM focus_nfce_private.attempts'), /permission denied/);
  await assert.rejects(sql("SELECT public.finish_focus_nfce($1,$1,'authorized','{}')", [company]), /permission denied/);
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(sql('SELECT public.prepare_focus_nfce($1,$2)', [sale, branch]), /permission denied/);
  await db.exec('RESET ROLE');
});

test('Focus SQL: exclusão mútua, referência estável e dados congelados após resultado incerto', async () => {
  await db.exec('SET ROLE service_role');
  const first = await claim(); assert.equal(first.claimed, true);
  const concurrent = await claim({ ...payload, valor_total: '1.00' }); assert.equal(concurrent.claimed, false); assert.equal(concurrent.state, 'processing');
  assert.equal(await finish(first, 'unknown'), true);
  const recovered = await claim({ ...payload, valor_total: '1.00' });
  assert.equal(recovered.reference, first.reference); assert.equal(recovered.payload.valor_total, '20.02');
  assert.equal(await finish(first, 'authorized'), false);
  assert.equal(await finish(recovered, 'rejected', { mensagem_sefaz: 'Classificação inválida' }), true);
  const blocked = await claim(); assert.equal(blocked.claimed, false); assert.equal(blocked.state, 'rejected');
  const corrected = await claim({ ...payload, natureza_operacao: 'CORRIGIDA' }, true);
  assert.equal(corrected.reference, first.reference); assert.equal(corrected.payload.natureza_operacao, 'CORRIGIDA');
  assert.equal(await finish(corrected, 'authorized', { chave_nfe: 'chave-sintetica', numero: '1', serie: '1' }), true);
  const final = await claim(); assert.equal(final.claimed, false); assert.equal(final.state, 'authorized');
  assert.equal(await finish(corrected, 'unknown'), false);
  await db.exec('RESET ROLE');
  const stored = (await sql('SELECT * FROM fiscal_documents WHERE id=$1', [first.id])).rows[0];
  assert.equal(stored.status, 'authorized'); assert.equal(stored.provider, 'focus_homologacao'); assert.equal(stored.provider_response.environment, 'homologacao');
  assert.equal(stored.document_type, 'nfce'); assert.equal(stored.model, '65'); assert.equal(stored.environment, 'homologation');
  assert.equal((await sql('SELECT count(*)::int AS total FROM fiscal_documents')).rows[0].total, 1);
});

test('Focus SQL: expiração permite recuperação com novo lease e mantém o emitente original', async () => {
  await db.exec('TRUNCATE focus_nfce_private.attempts,fiscal_documents');
  const first = await claim();
  await sql("UPDATE focus_nfce_private.attempts SET lease_until=now()-interval '1 second' WHERE id=$1", [first.id]);
  const recovered = await claim(); assert.notEqual(recovered.lease_id, first.lease_id); assert.equal(recovered.reference, first.reference);
  await assert.rejects(claim({ cnpj_emitente: '00000000000000' }), /emitente/);
  assert.equal(await finish(first, 'authorized'), false);
  assert.equal(await finish(recovered, 'unknown'), true);
  await assert.rejects(sql("SELECT finish_focus_nfce($1,$2,'pending','{}')", [recovered.id, recovered.lease_id]), /inválida/);
});
