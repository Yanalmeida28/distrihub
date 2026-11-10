import assert from 'node:assert/strict';
import { before, beforeEach, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import ts from '../../node_modules/typescript/lib/typescript.js';

const db = new PGlite();
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const sql = (text, args = []) => db.query(text, args);
let owner, other, branch, foreignBranch, employee, employeeAuth, manager, product, fiscalDefaultsBefore;
const login = id => sql("SELECT set_config('test.auth_uid',$1,false)", [id]);
async function mutate(action, amount, extra = {}) {
  const request = { branch, session: null, kind: null, reason: '', supervisor: null, pin: null, request: randomUUID(), ...extra };
  const { rows } = await sql('SELECT mutate_partner_cash_register($1,$2,NULL,NULL,$3,$4,$5,$6,$7,$8,$9) AS id',
    [action, request.branch, request.session, amount, request.kind, request.reason, request.supervisor, request.pin, request.request]);
  return rows[0].id;
}
async function sale(extra = {}) {
  const r = { id: randomUUID(), method: 'dinheiro', status: 'concluida', ...extra };
  await sql('SELECT execute_partner_sale_mutation(NULL,NULL,$1,NULL,$2,$3::jsonb,100,NULL,NULL,$4,$5,$6,$7,$8,$9,NULL)',
    [r.id,'Cliente',JSON.stringify([{product_id:product,name:'Produto',quantity:1,unit_price:100}]),r.method,branch,r.status,'pdv','varejo','balcao']);
  return r;
}
before(async () => {
  await db.exec(await read('./fixtures/pdv_schema.sql'));
  await db.exec(await read('./fixtures/pdv_production.sql'));
  await db.exec('GRANT SELECT ON public.partner_profiles TO authenticated');
  await db.exec('CREATE TABLE auth.users(id uuid PRIMARY KEY)');
  await db.exec('ALTER TABLE partner_profiles ADD COLUMN document text, ADD COLUMN whatsapp text, ADD COLUMN segment text, ADD COLUMN subscription_plan text NOT NULL DEFAULT \'basico\', ADD COLUMN subscription_status text NOT NULL DEFAULT \'trial\', ADD COLUMN next_billing_date date, ADD COLUMN payment_method text');
  await db.exec('ALTER TABLE partner_branches ADD COLUMN name text, ADD COLUMN address text, ADD COLUMN is_active boolean NOT NULL DEFAULT true, ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN updated_at timestamptz');
  await db.exec('CREATE TABLE public.b2b_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,total numeric,created_at timestamptz DEFAULT now())');
  await db.exec('CREATE VIEW public.admin_financial_months AS SELECT 1 AS financial_total');
  await db.exec('GRANT SELECT ON public.admin_financial_months TO anon, authenticated');
  await db.exec(await read('../migrations/20260928044542_fix_pdv_sales_reconciliation.sql'));
  await db.exec(await read('../migrations/20261028130000_enforce_owner_only_cross_branch_access.sql'));
  await db.exec(await read('../migrations/20260928195329_enforce_pdv_authoritative_pricing.sql'));
  await db.exec(await read('../migrations/20260826110000_add_fiscal_documents_foundation.sql'));
  await db.exec(await read('../migrations/20260826150000_add_fiscal_rules_and_inutilizations.sql'));
  await db.exec("CREATE FUNCTION public.verify_super_admin(input_password text) RETURNS boolean LANGUAGE sql AS $$ SELECT input_password='admin-secret' $$");
  await db.exec("CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IS NOT NULL AND auth.uid()::text=current_setting('test.super_admin_uid',true) $$");
  await db.exec(await read('../migrations/20260826140000_add_super_admin_financial_overview.sql'));
  await db.exec("CREATE FUNCTION public.record_fiscal_document(p_document_id uuid DEFAULT NULL, p_document_type text DEFAULT 'nfe', p_status text DEFAULT 'pending', p_document_number text DEFAULT NULL, p_access_key text DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$");
  fiscalDefaultsBefore = (await sql("SELECT pg_get_function_arguments('public.record_fiscal_document(uuid,text,text,text,text,jsonb)'::regprocedure) AS args")).rows[0].args;
  await db.exec('ALTER TABLE partner_salespeople ADD COLUMN name text');
  await db.exec("ALTER TABLE partner_salespeople ADD COLUMN blocked_modules text[] NOT NULL DEFAULT '{}'");
  await db.exec(await read('../migrations/20261003182612_partner_cash_register.sql'));
  await db.exec(await read('../migrations/20261003190000_secure_financial_subscription_fiscal_and_branch_flows.sql'));
  await db.exec(await read('../migrations/20261003193000_add_post_close_cash_refunds.sql'));
  await db.exec(await read('../migrations/20261005211357_allow_owner_manager_sale_prices.sql'));
  await db.exec('ALTER TABLE partner_customers ADD COLUMN name text');
  await db.exec(await read('../migrations/20261007211956_change_open_order_customer.sql'));
  await db.exec(await read('../migrations/20261009184720_add_third_party_freight.sql'));
  // Subscription authorization is isolated from these cash tests; branch/PIN/role guards remain real.
  await db.exec(`CREATE SCHEMA partner_subscription_private;
    CREATE FUNCTION partner_subscription_private.require_operator_module(text,uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION partner_subscription_private.require_actor(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;`);
  await db.exec(JSON.parse(await read('./fixtures/split_payment_baseline.json')));
  await db.exec(await read('../migrations/20261009211459_add_split_sale_payments.sql'));
  await db.exec(await read('../migrations/20261014224645_fix_cash_supervision_recovery_and_balance.sql'));
  await db.exec(await read('../migrations/20261014230708_fix_open_order_authorization.sql'));
  await db.exec(`CREATE TABLE rma_requests_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,sale_id uuid,sale_item_index integer,quantity integer);
    CREATE VIEW public.partner_stock_movements AS SELECT * FROM stock_movements;
    CREATE FUNCTION partner_subscription_private.require_access(uuid,text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE SCHEMA partner_operations_private;
    CREATE FUNCTION partner_operations_private.authorize_branch(uuid,text) RETURNS uuid LANGUAGE sql AS $$ SELECT user_id FROM public.partner_branches WHERE id=$1 $$;`);
  await db.exec('CREATE SCHEMA partner_rma_private');
  await db.exec(await read('../migrations/20261013202052_readable_sale_numbers.sql'));
  await db.exec(await read('../migrations/20261015013718_fix_sales_history_cancellation_and_completion.sql'));
  await db.exec(await read('../migrations/20261017172437_shared_branch_checkout_operator_history.sql'));
  await db.exec(await read('../migrations/20261029164610_separate_checkout_cash_permissions.sql'));
  await db.exec(await read('../migrations/20261107145447_restrict_cash_overview_visibility.sql'));
  await db.exec(await read('../migrations/20261110164331_operator_sale_price_permission.sql'));
});
after(() => db.close());

test('overview is owner/admin only; manager keeps operational permission without overview',async()=>{
 const readCash=async(id=null,pin=null)=>(await sql('select public.read_partner_cash_register($1,$2,$3) result',[branch,id,pin])).rows[0].result;
 assert.equal((await readCash()).can_view_overview,true);
 assert.equal((await readCash(employee,'1234')).can_view_overview,false);
 const managed=await readCash(manager,'9876');assert.equal(managed.can_manage,true);assert.equal(managed.can_view_overview,false);
 await sql("update partner_salespeople set role='administrador' where id=$1",[manager]);
 assert.equal((await readCash(manager,'9876')).can_view_overview,true);
 await sql("update partner_salespeople set role='vendedor' where id=$1",[manager]);
 assert.equal((await readCash(manager,'9876')).can_view_overview,false);
 await assert.rejects(readCash(manager,'wrong'));
 await login(other);await assert.rejects(readCash(manager,'9876'));
 await login(null);await assert.rejects(readCash());
 assert.equal((await sql("select has_function_privilege('anon','public.read_partner_cash_register(uuid,uuid,text)','execute') allowed")).rows[0].allowed,false);
});

async function splitSale(extra = {}) {
  const r = {id:randomUUID(),method:'misto',status:'concluida',fee:15,
    parts:[{method:'dinheiro',amount:50},{method:'pix',amount:65}],...extra};
  await sql('SELECT execute_partner_sale_mutation(NULL,NULL,$1,NULL,$2,$3::jsonb,100,NULL,NULL,$4,$5,$6,$7,$8,$9,NULL,$10,$11::jsonb)',
    [r.id,'Cliente',JSON.stringify([{product_id:product,name:'Produto',quantity:1,unit_price:100}]),r.method,branch,r.status,'pdv','varejo','entrega',r.fee,JSON.stringify(r.parts)]);
  return r;
}

test('PDV-only collaborator can inspect an open destination and complete a sale while Caixa remains blocked', async () => {
 const closed=await mutate('abrir',0);await mutate('fechar',0,{session:closed});
 const open=await mutate('abrir',25);
 await login(other);await mutate('abrir',90,{branch:foreignBranch});await login(owner);
 // Enforce the production shared-operator guard and the linked-account module
 // restriction. Subscription/device admission remains isolated by this fixture.
 const operatorGuard=await read('../migrations/20261008173749_enforce_shared_operator_module_permissions.sql');
 await db.exec(operatorGuard.slice(0,operatorGuard.indexOf('REVOKE ALL')).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'));
 await db.exec(`CREATE OR REPLACE FUNCTION partner_subscription_private.require_actor(feature text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
 IF EXISTS(SELECT 1 FROM public.partner_salespeople WHERE auth_user_id=auth.uid() AND active=true AND feature=ANY(blocked_modules))
 THEN RAISE EXCEPTION 'Módulo bloqueado'; END IF; END $$;`);
 try {
  await sql("UPDATE partner_salespeople SET blocked_modules=ARRAY['caixa'] WHERE id=$1",[employee]);
  await login(employeeAuth);
  await assert.rejects(sql('SELECT read_partner_cash_register($1)',[branch]),/bloqueado/);
  const snapshot=(await sql("SELECT read_partner_checkout_cash($1,NULL,NULL,'pdv') AS data",[branch])).rows[0].data;
  assert.equal(snapshot.actor_key,employee);assert.equal(snapshot.can_manage,false);
  assert.deepEqual(Object.keys(snapshot).sort(),['actor_key','can_manage','sessions']);
  assert.equal(snapshot.sessions.length,1);assert.equal(snapshot.sessions[0].id,open);
  assert.deepEqual(Object.keys(snapshot.sessions[0]).sort(),['actor_key','branch_id','closed_at','id','opened_at','operator_id','operator_name']);
  const sold=await sale();
  const movement=(await sql("SELECT session_id,performed_by FROM partner_cash_movements WHERE sale_id=$1 AND kind='venda'",[sold.id])).rows[0];
  assert.equal(movement.session_id,open);assert.equal(movement.performed_by,employee);
  assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,9);
  await assert.rejects(sql("SELECT read_partner_checkout_cash($1,NULL,NULL,'caixa')",[branch]),/bloqueado/);
  await assert.rejects(sql("SELECT read_partner_checkout_cash($1,NULL,NULL,'financeiro')",[branch]),/inválido/);
  await assert.rejects(sql('SELECT read_partner_checkout_cash($1,NULL,NULL,NULL)',[branch]),/inválido/);
  await assert.rejects(sql('SELECT read_partner_checkout_cash($1)',[foreignBranch]),/filial/i);
  await sql("UPDATE partner_salespeople SET blocked_modules=ARRAY['caixa','pdv'] WHERE id=$1",[employee]);
  await assert.rejects(sql('SELECT read_partner_checkout_cash($1)',[branch]),/bloqueado/);
  await login(owner);
  await assert.rejects(sql('SELECT read_partner_checkout_cash($1,$2,$3)',[branch,employee,'1234']),/bloqueado/);
  await sql("UPDATE partner_salespeople SET blocked_modules=ARRAY['caixa'] WHERE id=$1",[employee]);
  await assert.rejects(sql('SELECT read_partner_checkout_cash($1,$2,$3)',[branch,employee,'wrong-pin']),/PIN|incorreto|invalido|inválido/i);
  assert.equal((await sql('SELECT read_partner_checkout_cash($1,$2,$3) AS data',[branch,employee,'1234'])).rows[0].data.sessions[0].id,open);
  await sql('UPDATE partner_salespeople SET active=false WHERE id=$1',[employee]);
  await assert.rejects(sql('SELECT read_partner_checkout_cash($1,$2,$3)',[branch,employee,'1234']),/inativo|invalido|inválido/i);
  assert.equal((await sql("SELECT has_function_privilege('anon','public.read_partner_checkout_cash(uuid,uuid,text,text)','EXECUTE') AS allowed")).rows[0].allowed,false);
 } finally {
  await db.exec(`CREATE OR REPLACE FUNCTION partner_subscription_private.require_operator_module(p_feature text,p_operator uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
   CREATE OR REPLACE FUNCTION partner_subscription_private.require_actor(feature text) RETURNS void LANGUAGE sql AS $$ SELECT $$;`);
 }
});

test('split payment charges cash and PIX once, includes freight and cancels each part with stock restored once',async()=>{
  const session=await mutate('abrir',20);
  const r=await splitSale();
  await splitSale({...r,parts:[...r.parts].reverse()});
  assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,9);
  const saved=(await sql('SELECT total,freight_fee,payment_splits FROM partner_sales WHERE id=$1',[r.id])).rows[0];
  assert.equal(Number(saved.total),100); assert.equal(Number(saved.freight_fee),15);
  assert.deepEqual(saved.payment_splits,r.parts);
  assert.deepEqual((await sql('SELECT partner_cash_private.totals($1) AS totals',[session])).rows[0].totals,{dinheiro:50,pix:65,cartao:0,faturado:0});
  await assert.rejects(splitSale({...r,parts:[{method:'dinheiro',amount:40},{method:'pix',amount:75}]}),/dados diferentes/);
  await splitSale({...r,status:'cancelada',parts:[]});
  assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,10);
  assert.equal((await sql("SELECT count(*)::int AS n FROM partner_cash_movements WHERE sale_id=$1 AND kind='estorno'",[r.id])).rows[0].n,2);
  assert.deepEqual((await sql('SELECT partner_cash_private.totals($1) AS totals',[session])).rows[0].totals,{dinheiro:0,pix:0,cartao:0,faturado:0});
});

test('invalid split payments reject atomically, without stock, sale, invoice or cash writes',async()=>{
  await mutate('abrir',0);
  for(const parts of [[],[{method:'dinheiro',amount:115}],
    [{method:'dinheiro',amount:50},{method:'pix',amount:64.99}],
    [{method:'pix',amount:50},{method:'pix',amount:65}],
    [{method:'faturado',amount:50},{method:'dinheiro',amount:65}],
    [{method:'dinheiro',amount:-1},{method:'pix',amount:116}],
    [{method:'dinheiro',amount:50.001},{method:'pix',amount:64.999}],
    [{method:'dinheiro',amount:'50'},{method:'pix',amount:65}]]) await assert.rejects(splitSale({parts}));
  assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,10);
  assert.equal((await sql('SELECT count(*)::int AS n FROM partner_sales')).rows[0].n,0);
  assert.equal((await sql('SELECT count(*)::int AS n FROM partner_cash_movements')).rows[0].n,0);
  assert.equal((await sql('SELECT count(*)::int AS n FROM partner_invoices')).rows[0].n,0);
});

test('pre-sale finalizes with split payments, closure counts only cash and closed retries preserve snapshots',async()=>{
  const r=await splitSale({status:'pre_venda',method:'pix',parts:[]});
  const session=await mutate('abrir',20);
  const paid={...r,status:'concluida',method:'misto',parts:[{method:'dinheiro',amount:50},{method:'pix',amount:45},{method:'cartao',amount:20}]};
  await splitSale(paid);
  await mutate('fechar',70,{session});
  await splitSale(paid);
  const closing=(await sql('SELECT expected_amount,closing_totals FROM partner_cash_sessions WHERE id=$1',[session])).rows[0];
  assert.equal(Number(closing.expected_amount),70);
  assert.deepEqual(closing.closing_totals,{dinheiro:50,pix:45,cartao:20,faturado:0});
  await assert.rejects(splitSale({...paid,status:'cancelada'}),/fechado/);
  assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,9);
  assert.equal((await sql("SELECT count(*)::int AS n FROM partner_cash_movements WHERE kind='venda'")).rows[0].n,3);
});

test('split refund requires a method, caps each part separately and keeps closed cash immutable',async()=>{
  const original=await mutate('abrir',0);
  const sale=await splitSale();
  await mutate('fechar',50,{session:original});
  const current=await mutate('abrir',50);
  const refund=(method,amount,id=randomUUID())=>sql('SELECT record_partner_cash_refund($1,NULL,NULL,$2,$3,$4,$5,NULL,NULL,$6,$7)',[branch,current,sale.id,amount,'Devolução',id,method]);
  await assert.rejects(refund(null,10),/Selecione a forma/);
  await assert.rejects(refund('dinheiro',51),/excede o saldo/);
  await assert.rejects(refund('cartao',10),/eleg/);
  const request=randomUUID();
  await refund('dinheiro',30,request); await refund('dinheiro',30,request);
  await assert.rejects(refund('pix',30,request),/dados diferentes/);
  await assert.rejects(refund('dinheiro',21),/excede o saldo/);
  await refund('pix',65);
  await refund('dinheiro',20);
  await assert.rejects(refund('pix',0.01),/excede o saldo/);
  assert.deepEqual((await sql('SELECT partner_cash_private.totals($1) AS totals',[current])).rows[0].totals,{dinheiro:-50,pix:-65,cartao:0,faturado:0});
  assert.deepEqual((await sql('SELECT closing_totals FROM partner_cash_sessions WHERE id=$1',[original])).rows[0].closing_totals,{dinheiro:50,pix:65,cartao:0,faturado:0});
});

async function freightSale(extra = {}) {
  const r = { id: randomUUID(), fee: 15, method: 'dinheiro', status: 'concluida', customer: null, ...extra };
  await sql('SELECT execute_partner_sale_mutation(NULL,NULL,$1,$2,$3,$4::jsonb,100,NULL,NULL,$5,$6,$7,$8,$9,$10,NULL,$11)',
    [r.id,r.customer,'Cliente',JSON.stringify([{product_id:product,name:'Produto',quantity:1,unit_price:100}]),r.method,branch,r.status,'pdv','varejo','entrega',r.fee]);
  return r;
}

test('third-party freight enters cash once while merchandise revenue remains separate; cancellation reverses full charge', async () => {
  const session = await mutate('abrir', 0);
  const r = await freightSale();
  await freightSale(r);
  const saved = (await sql('SELECT total,freight_fee FROM partner_sales WHERE id=$1',[r.id])).rows[0];
  assert.equal(Number(saved.total),100);
  assert.equal(Number(saved.freight_fee),15);
  const movements = (await sql("SELECT amount FROM partner_cash_movements WHERE sale_id=$1 AND kind='venda'",[r.id])).rows;
  assert.equal(movements.length,1);
  assert.equal(Number(movements[0].amount),115);
  await assert.rejects(freightSale({...r,fee:16}), /dados diferentes/);
  await freightSale({...r,status:'cancelada'});
  assert.equal((await sql('SELECT partner_cash_private.totals($1) AS totals',[session])).rows[0].totals.dinheiro,0);
});

test('billed freight consumes customer credit and the invoice includes the full charge', async () => {
  await mutate('abrir',0);
  const customer=randomUUID();
  await sql("INSERT INTO partner_customers(id,user_id,branch_id,allow_credit,credit_limit) VALUES($1,$2,$3,true,110)",[customer,owner,branch]);
  await assert.rejects(freightSale({customer,method:'faturado'}), /Credito insuficiente/);
  assert.equal((await sql('SELECT count(*)::int AS n FROM partner_sales')).rows[0].n,0);
  await sql('UPDATE partner_customers SET credit_limit=115 WHERE id=$1',[customer]);
  const r=await freightSale({customer,method:'faturado'});
  assert.equal(Number((await sql('SELECT amount FROM partner_invoices WHERE sale_id=$1',[r.id])).rows[0].amount),115);
  assert.equal(Number((await sql('SELECT total FROM partner_sales WHERE id=$1',[r.id])).rows[0].total),100);
});

test('pre-sale preserves freight when finalized by a legacy caller; freight cannot change at checkout', async () => {
  const r=await freightSale({status:'pre_venda'});
  assert.equal((await sql('SELECT count(*)::int AS n FROM partner_cash_movements')).rows[0].n,0);
  await mutate('abrir',0);
  await assert.rejects(freightSale({...r,status:'concluida',fee:20}), /alterar o frete/);
  await freightSale({...r,status:'concluida',fee:null});
  assert.equal(Number((await sql('SELECT amount FROM partner_cash_movements WHERE sale_id=$1',[r.id])).rows[0].amount),115);
});

test('invalid freight is rejected atomically without stock or cash writes', async () => {
  await mutate('abrir',0);
  for (const fee of [-1, 0.001, 'NaN', 100000000]) await assert.rejects(freightSale({fee}), /Frete invalido/);
  assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,10);
  assert.equal((await sql('SELECT count(*)::int AS n FROM partner_cash_movements')).rows[0].n,0);
});
beforeEach(async () => {
  await db.exec('RESET ROLE; TRUNCATE rma_requests_v2');
  await db.exec('RESET ROLE; TRUNCATE partner_plan_change_requests,fiscal_documents,fiscal_tax_rules,fiscal_inutilizations,partner_cash_movements,partner_cash_sessions,partner_audit_logs,stock_movements,partner_invoices,partner_sales,partner_products,partner_customers,partner_salespeople,partner_branches,partner_profiles CASCADE; TRUNCATE auth.users CASCADE');
  [owner,other,branch,foreignBranch,employee,employeeAuth,manager,product]=Array.from({length:8},()=>randomUUID());
  await sql('INSERT INTO auth.users(id) VALUES($1),($2)',[owner,other]);
  await sql("SELECT set_config('test.super_admin_uid',$1,false)",[owner]);
  await sql("INSERT INTO partner_profiles(id,account_name,business_name,document,whatsapp,subscription_plan) VALUES($1,'Owner','Test',NULL,NULL,'basico'),($2,'Other','Test',NULL,NULL,'basico')",[owner,other]);
  await sql('INSERT INTO partner_branches(id,user_id,name) VALUES($1,$3,\'Main\'),($2,$4,\'Foreign\')',[branch,foreignBranch,owner,other]);
  await sql("INSERT INTO partner_salespeople(id,user_id,auth_user_id,branch_id,role,active,pin_hash,name) VALUES($1,$4,$2,$5,'caixa',true,md5('1234'),'Caixa'),($3,$4,NULL,$5,'gerente',true,md5('9876'),'Gerente')",[employee,employeeAuth,manager,owner,branch]);
  await sql("INSERT INTO partner_products(id,user_id,branch_id,name,stock,is_service) VALUES($1,$2,$3,'Produto',10,false)",[product,owner,branch]);
  await login(owner);
});

async function negotiatedSale(price, extra = {}) {
  const r = { id: randomUUID(), status: 'pre_venda', method: null, operator: null, pin: null, total: price, ...extra };
  await sql('SELECT execute_partner_sale_mutation($1,$2,$3,NULL,$4,$5::jsonb,$6,NULL,NULL,$7,$8,$9,$10,$11,$12,NULL)',
    [r.operator,r.pin,r.id,'Cliente',JSON.stringify([{product_id:product,name:'Produto',quantity:1,unit_price:price}]),r.total,r.method,branch,r.status,'pdv','varejo','balcao']);
  return r;
}

test('changing an open order customer preserves negotiated prices and checkout uses the new customer', async () => {
  const customer = randomUUID();
  await sql("INSERT INTO partner_customers(id,user_id,name) VALUES($1,$2,'Novo cliente')",[customer,owner]);
  const pre = await negotiatedSale(75.5);
  await login(employeeAuth);
  assert.equal((await sql('SELECT execute_partner_open_order_customer_mutation(NULL,NULL,$1,$2) AS ok',[pre.id,customer])).rows[0].ok,true);
  const updated = (await sql('SELECT * FROM partner_sales WHERE id=$1',[pre.id])).rows[0];
  assert.equal(updated.customer_id,customer);
  assert.equal(updated.customer_name,'Novo cliente');
  assert.equal(Number(updated.total),75.5);
  assert.equal(updated.items[0].unit_price,75.5);
  assert.equal(updated.status,'pre_venda');
  assert.equal((await sql('SELECT customer_id FROM partner_pdv_price_snapshots WHERE sale_id=$1',[pre.id])).rows[0].customer_id,customer);
  await login(owner);
  await mutate('abrir',0);
  await sql('SELECT execute_partner_sale_mutation(NULL,NULL,$1,$2,$3,$4::jsonb,$5,NULL,NULL,$6,$7,$8,$9,$10,$11,NULL)',
    [pre.id,customer,'Novo cliente',JSON.stringify(updated.items),75.5,'pix',branch,'concluida','pdv','varejo','balcao']);
  await assert.rejects(sql('SELECT execute_partner_open_order_customer_mutation(NULL,NULL,$1,$2)',[pre.id,customer]),/Somente pedidos abertos/);
});

test('customer change rejects foreign customers, branch access, payments and anonymous callers', async () => {
  const pre = await sale({status:'pre_venda',method:null});
  const customer=randomUUID();
  await sql("INSERT INTO partner_customers(id,user_id,branch_id,name) VALUES($1,$2,$3,'Cliente externo')",[customer,other,foreignBranch]);
  await assert.rejects(sql('SELECT execute_partner_open_order_customer_mutation(NULL,NULL,$1,$2)',[pre.id,customer]),/Cliente inválido/);
  await sql('UPDATE partner_customers SET user_id=$1,branch_id=NULL WHERE id=$2',[owner,customer]);
  await sql("UPDATE partner_salespeople SET branch_id=$1 WHERE id=$2",[foreignBranch,employee]);
  await login(employeeAuth);
  await assert.rejects(sql('SELECT execute_partner_open_order_customer_mutation(NULL,NULL,$1,$2)',[pre.id,customer]),/outra filial/);
  await login(owner);
  await sql("UPDATE partner_sales SET online_payment=true WHERE id=$1",[pre.id]);
  await assert.rejects(sql('SELECT execute_partner_open_order_customer_mutation(NULL,NULL,$1,$2)',[pre.id,customer]),/pagamento/);
  await login(null);
  await assert.rejects(sql('SELECT execute_partner_open_order_customer_mutation(NULL,NULL,$1,$2)',[pre.id,customer]),/Não autenticado/);
  await db.exec('SET ROLE anon');
  await assert.rejects(sql('SELECT execute_partner_open_order_customer_mutation(NULL,NULL,$1,$2)',[pre.id,customer]),/permission denied/);
});

test('online open orders can change customer without changing totals or creating stock and cash movements', async () => {
  const id=randomUUID(), customer=randomUUID();
  await sql("INSERT INTO partner_customers(id,user_id,name) VALUES($1,$2,'Cliente online')",[customer,owner]);
  await sql("INSERT INTO partner_sales(id,user_id,branch_id,status,payment_status,origin,online_payment,total,items) VALUES($1,$2,$3,'aberta','pendente','catalogo',false,150,'[]')",[id,owner,branch]);
  await sql('SELECT execute_partner_open_order_customer_mutation(NULL,NULL,$1,$2)',[id,customer]);
  const order=(await sql('SELECT status,total,customer_id FROM partner_sales WHERE id=$1',[id])).rows[0];
  assert.equal(order.status,'aberta');
  assert.equal(Number(order.total),150);
  assert.equal(order.customer_id,customer);
  assert.equal((await sql('SELECT count(*)::int AS n FROM stock_movements')).rows[0].n,0);
  assert.equal((await sql('SELECT count(*)::int AS n FROM partner_cash_movements')).rows[0].n,0);
});

test('pre-sale saves a planned payment without requiring open cash, charging or issuing an invoice', async () => {
  const pre=await sale({status:'pre_venda',method:'faturado'});
  const saved=(await sql('SELECT status,payment_method,payment_status FROM partner_sales WHERE id=$1',[pre.id])).rows[0];
  assert.deepEqual(saved,{status:'pre_venda',payment_method:'faturado',payment_status:'pendente'});
  assert.equal((await sql('SELECT count(*)::int AS n FROM partner_invoices')).rows[0].n,0);
  assert.equal((await sql('SELECT count(*)::int AS n FROM partner_cash_movements')).rows[0].n,0);
  assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,10);
});

test('negotiated prices: owner and authenticated manager save prices without editing the catalog', async () => {
  await negotiatedSale(75.5);
  await negotiatedSale(120,{operator:manager,pin:'9876'});
  assert.equal(Number((await sql('SELECT sale_price FROM partner_products WHERE id=$1',[product])).rows[0].sale_price),100);
  assert.deepEqual((await sql('SELECT total FROM partner_sales ORDER BY total')).rows.map(row=>Number(row.total)),[75.5,120]);
  assert.equal((await sql('SELECT count(*)::int AS n FROM partner_pdv_price_snapshots')).rows[0].n,2);
  assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,10);
});

test('individual PDV price permission defaults off, owner/admin grant and revoke; manager and employee cannot grant',async()=>{
 const allow=async(value,operator=null,pin=null)=>(await sql('select public.set_partner_salesperson_price_permission($1,$2,$3,$4) allowed',[employee,value,operator,pin])).rows[0].allowed;
 assert.equal((await sql('select can_edit_sale_price from partner_salespeople where id=$1',[employee])).rows[0].can_edit_sale_price,false);
 await assert.rejects(negotiatedSale(70,{operator:employee,pin:'1234'}));
 assert.equal(await allow(true),true);
 await mutate('abrir',0);await negotiatedSale(70,{operator:employee,pin:'1234'});
 await login(employeeAuth);await mutate('abrir',0);
 const completed=await negotiatedSale(65,{status:'concluida',method:'dinheiro'});
 const confirmed=(await sql('select status,total from partner_sales where id=$1',[completed.id])).rows[0];assert.equal(confirmed.status,'concluida');assert.equal(Number(confirmed.total),65);
 assert.equal(Number((await sql('select stock from partner_products where id=$1',[product])).rows[0].stock),9);
 await login(owner);
 assert.equal(Number((await sql('select sale_price from partner_products where id=$1',[product])).rows[0].sale_price),100);
 assert.equal(await allow(false),false);await assert.rejects(negotiatedSale(70,{operator:employee,pin:'1234'}));
 await assert.rejects(allow(true,manager,'9876'));
 await assert.rejects(allow(true,employee,'1234'));
 await sql("update partner_salespeople set role='administrador' where id=$1",[manager]);assert.equal(await allow(true,manager,'9876'),true);
 await assert.rejects(allow(false,manager,'wrong'));
 await login(employeeAuth);await assert.rejects(allow(true));
 await login(other);await assert.rejects(allow(false));
 await login(null);await assert.rejects(allow(false));
 await login(owner);
 assert.equal((await sql("select has_function_privilege('anon','public.set_partner_salesperson_price_permission(uuid,boolean,uuid,text)','execute') allowed")).rows[0].allowed,false);
 await db.exec('grant update(can_edit_sale_price) on public.partner_salespeople to authenticated;grant select on public.partner_salespeople to authenticated;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;set role authenticated');
 await assert.rejects(sql('update public.partner_salespeople set can_edit_sale_price=false where id=$1',[employee]));await db.exec('reset role');
});

test('negotiated prices: cashier, seller and employee administrator cannot override prices', async () => {
  await login(employeeAuth);
  for (const role of ['caixa','vendedor','administrador']) {
    await sql('UPDATE partner_salespeople SET role=$1 WHERE id=$2',[role,employee]);
    await assert.rejects(negotiatedSale(70),/Somente o gerente ou o dono/);
  }
  await sql("UPDATE partner_salespeople SET role='gerente' WHERE id=$1",[employee]);
  await negotiatedSale(70);
  await sql("UPDATE partner_salespeople SET active=false WHERE id=$1",[employee]);
  await assert.rejects(negotiatedSale(70));
});

test('negotiated prices: selected seller and invalid supervisor PIN do not inherit owner permission', async () => {
  await assert.rejects(negotiatedSale(70,{operator:employee,pin:'1234'}),/Somente o gerente ou o dono/);
  await assert.rejects(negotiatedSale(70,{operator:manager,pin:'wrong'}));
  assert.equal((await sql('SELECT count(*)::int AS n FROM partner_sales')).rows[0].n,0);
});

test('negotiated prices: cashier finalizes the saved manager quote and cash uses its actual amount', async () => {
  const pre=await negotiatedSale(75.5,{operator:manager,pin:'9876'});
  await login(employeeAuth);
  const session=await mutate('abrir',0);
  await assert.rejects(negotiatedSale(74,{id:pre.id,status:'concluida',method:'dinheiro'}),/Finalizacao nao pode alterar/);
  await negotiatedSale(75.5,{id:pre.id,status:'concluida',method:'dinheiro'});
  await negotiatedSale(75.5,{id:pre.id,status:'concluida',method:'dinheiro'});
  assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,9);
  const movements=(await sql("SELECT amount FROM partner_cash_movements WHERE session_id=$1 AND kind='venda'",[session])).rows;
  assert.equal(movements.length,1);assert.equal(Number(movements[0].amount),75.5);
});

test('negotiated prices: invalid amounts, totals, direct helper and direct quote writes remain blocked', async () => {
  for (const price of [-1,1.001,100000000]) await assert.rejects(negotiatedSale(price));
  await assert.rejects(negotiatedSale(75,{total:74}),/Total diverge/);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(sql('SELECT partner_cash_private.validate_partner_pdv_negotiated_prices($1,$2,NULL,$3,$4::jsonb,75,true)',[owner,branch,'varejo',JSON.stringify([{product_id:product,name:'Produto',quantity:1,unit_price:75}])]),/permission denied/);
  await assert.rejects(sql('UPDATE partner_pdv_price_snapshots SET total=75'),/permission denied/);
});

test('requires open cash for checkout; pre-sale is excluded; rolls stock back on refusal', async () => {
  await assert.rejects(sale(), /Abra o caixa/);
  assert.equal((await sql('SELECT stock FROM partner_products')).rows[0].stock,10);
  const draft=await sale({status:'pre_venda',method:null});
  assert.equal((await sql('SELECT count(*)::int AS n FROM partner_cash_movements')).rows[0].n,0);
  const session=await mutate('abrir',100);
  await sale({...draft,status:'concluida',method:'dinheiro'});
  const rows=(await sql('SELECT * FROM partner_cash_movements')).rows;
  assert.equal(rows.length,1); assert.equal(rows[0].session_id,session);
});

test('opening retry is idempotent, rejects second open and mismatching payload', async () => {
  const request=randomUUID(); const id=await mutate('abrir',100,{request});
  assert.equal(await mutate('abrir',100,{request}),id);
  await assert.rejects(mutate('abrir',100),/já possui/);
  await assert.rejects(mutate('abrir',101,{request}),/dados diferentes/);
});

test('uses shared branch cash without impersonation and prefers own cash when one is open', async () => {
  const ownerCash=await mutate('abrir',100);
  await login(employeeAuth);
  const sharedSale = await sale();
  const shared = (await sql('SELECT * FROM partner_cash_movements WHERE sale_id=$1', [sharedSale.id])).rows[0];
  assert.equal(shared.session_id,ownerCash);
  assert.equal(shared.performed_by,employee);
  assert.equal(shared.performed_by_name,'Caixa');
  await assert.rejects(mutate('fechar',100,{session:ownerCash}), /caixa|operador|permiss|autoriza/i);
  const employeeCash=await mutate('abrir',20);
  const ownSale = await sale();
  assert.equal((await sql('SELECT session_id FROM partner_cash_movements WHERE sale_id=$1',[ownSale.id])).rows[0].session_id,employeeCash);
  assert.notEqual(ownerCash,employeeCash);
});

test('shared checkout records the finalizer separately from the commercial salesperson and preserves retries', async () => {
  const quote = await negotiatedSale(75.5,{operator:manager,pin:'9876'});
  const session = await mutate('abrir',0);
  await login(employeeAuth);
  await negotiatedSale(75.5,{id:quote.id,status:'concluida',method:'dinheiro'});
  await negotiatedSale(75.5,{id:quote.id,status:'concluida',method:'dinheiro'});
  const saved=(await sql('SELECT salesperson_id FROM partner_sales WHERE id=$1',[quote.id])).rows[0];
  assert.equal(saved.salesperson_id,manager);
  const entries=(await sql("SELECT * FROM partner_cash_movements WHERE sale_id=$1 AND kind='venda'",[quote.id])).rows;
  assert.equal(entries.length,1);
  assert.equal(entries[0].session_id,session);
  assert.equal(entries[0].performed_by,employee);
  assert.equal(entries[0].performed_by_name,'Caixa');
  assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,9);
  await sql("UPDATE partner_salespeople SET name='Nome novo' WHERE id=$1",[employee]);
  assert.equal((await sql('SELECT performed_by_name FROM partner_cash_movements WHERE sale_id=$1',[quote.id])).rows[0].performed_by_name,'Caixa');
});

test('shared split payments keep one finalizer on every part and preserve own history after closing', async () => {
  const session = await mutate('abrir',0);
  const ownerSale = await sale();
  await login(employeeAuth);
  const sold = await splitSale();
  const snapshot=(await sql('SELECT read_partner_cash_register($1) AS data',[branch])).rows[0].data;
  assert.equal(snapshot.sessions[0].id,session);
  assert.equal(snapshot.sessions[0].history_complete,false);
  assert.equal(snapshot.movements.length,2);
  assert.ok(snapshot.movements.every(row=>row.performed_by===employee));
  assert.equal(snapshot.sales.length,1);
  assert.equal(snapshot.sales[0].id,sold.id);
  assert.ok(!snapshot.sales.some(row=>row.id===ownerSale.id));
  await login(owner);
  const full=(await sql('SELECT read_partner_cash_register($1) AS data',[branch])).rows[0].data;
  assert.equal(full.movements.length,3);
  assert.equal(full.sessions[0].history_complete,true);
  await mutate('fechar',150,{session});
  await login(employeeAuth);
  const history=(await sql('SELECT read_partner_cash_register($1) AS data',[branch])).rows[0].data;
  assert.equal(history.sales[0].id,sold.id);
  await assert.rejects(sale(),/Abra o caixa/);
});

test('shared checkout chooses the most recent branch cash and rejects foreign branches and inactive staff', async () => {
  const older = await mutate('abrir',0);
  const newer = (await sql("SELECT mutate_partner_cash_register('abrir',$1,$2,'9876',NULL,0,NULL,'',NULL,NULL,$3) id",[branch,manager,randomUUID()])).rows[0].id;
  await sql("UPDATE partner_cash_sessions SET opened_at=now()-interval '1 hour' WHERE id=$1",[older]);
  await login(employeeAuth);
  const sold=await sale();
  assert.equal((await sql('SELECT session_id FROM partner_cash_movements WHERE sale_id=$1',[sold.id])).rows[0].session_id,newer);
  await sql('UPDATE partner_salespeople SET active=false WHERE id=$1',[employee]);
  await assert.rejects(sale(),/inativo|inválido|nao vinculado|não vinculado/i);
});

test('cash expected amount includes opening, cash sales, supplies and withdrawals only', async () => {
  const session=await mutate('abrir',100);
  await sale(); await sale({method:'pix'}); await sale({method:'cartao'});
  await mutate('movimentar',50,{session,kind:'suprimento',reason:'Troco'});
  await mutate('movimentar',20,{session,kind:'sangria',reason:'Retirada'});
  await mutate('fechar',230,{session});
  const s=(await sql('SELECT * FROM partner_cash_sessions')).rows[0];
  assert.equal(Number(s.expected_amount),230); assert.equal(Number(s.difference),0);
  assert.deepEqual(s.closing_totals,{dinheiro:130,pix:100,cartao:100,faturado:0});
  await assert.rejects(sale(),/Abra o caixa/);
});

test('post-close partial refunds are linked, authorized, bounded and recorded in a new session', async () => {
  const closedSession = await mutate('abrir', 0);
  const originalSale = await sale();
  await mutate('fechar', 100, { session: closedSession });
  const closing = (await sql('SELECT closing_totals FROM partner_cash_sessions WHERE id=$1', [closedSession])).rows[0];
  assert.deepEqual(closing.closing_totals, { dinheiro: 100, pix: 0, cartao: 0, faturado: 0 });

  await login(employeeAuth);
  const refundSession = await mutate('abrir', 100);
  const firstRequest = randomUUID();
  const refund = (request, amount, supervisor = null, pin = null) => sql(
    'SELECT record_partner_cash_refund($1,NULL,NULL,$2,$3,$4,$5,$6,$7,$8) AS id',
    [branch, refundSession, originalSale.id, amount, 'Devolução parcial', supervisor, pin, request],
  );
  await assert.rejects(refund(firstRequest, 25), /Responsável inválido/);
  await assert.rejects(refund(firstRequest, 25, manager, 'bad-pin'), /PIN incorreto/);
  await refund(firstRequest, 25, manager, '9876');
  await refund(firstRequest, 25, manager, '9876');
  const fullRefundRequest = randomUUID();
  await refund(fullRefundRequest, 75, manager, '9876');
  await assert.rejects(refund(randomUUID(), 1, manager, '9876'), /excede o saldo disponível/);
  await assert.rejects(
    sql("UPDATE public.partner_sales SET status='cancelada' WHERE id=$1", [originalSale.id]),
    /Venda com devolução financeira não pode ser cancelada/,
  );
  assert.equal((await sql('SELECT status FROM public.partner_sales WHERE id=$1', [originalSale.id])).rows[0].status, 'concluida');
  await mutate('fechar', 0, { session: refundSession });
  await refund(fullRefundRequest, 75, manager, '9876');
  await assert.rejects(refund(fullRefundRequest, 74, manager, '9876'), /Operação repetida com dados diferentes/);

  const movements = (await sql(
    "SELECT kind,amount,session_id,sale_id FROM partner_cash_movements WHERE kind='devolucao' ORDER BY amount",
  )).rows;
  assert.equal(movements.length, 2);
  assert.deepEqual(movements.map(row => Number(row.amount)), [25, 75]);
  assert.ok(movements.every(row => row.session_id === refundSession && row.sale_id === originalSale.id));
  assert.deepEqual((await sql('SELECT partner_cash_private.totals($1) AS totals', [refundSession])).rows[0].totals,
    { dinheiro: -100, pix: 0, cartao: 0, faturado: 0 });
  assert.deepEqual((await sql('SELECT closing_totals FROM partner_cash_sessions WHERE id=$1', [closedSession])).rows[0].closing_totals, closing.closing_totals);
});

test('cash refunds cannot precede closing the original sale session', async () => {
  const originalSession = await mutate('abrir', 0);
  const originalSale = await sale();
  await login(employeeAuth);
  const refundSession = await mutate('abrir', 0);
  await assert.rejects(
    sql(
      'SELECT record_partner_cash_refund($1,NULL,NULL,$2,$3,10,$4,$5,$6,$7)',
      [branch, refundSession, originalSale.id, 'Teste antes do fechamento', manager, '9876', randomUUID()],
    ),
    /somente após o fechamento da sessão original/,
  );
  await login(owner);
  await mutate('fechar', 100, { session: originalSession });
});

test('administrative financial view is not readable by anonymous or authenticated clients', async () => {
  await db.exec('SET ROLE anon');
  await assert.rejects(sql('SELECT * FROM public.admin_financial_months'), /permission denied/);
  await db.exec('RESET ROLE; SET ROLE authenticated');
  await assert.rejects(sql('SELECT * FROM public.admin_financial_months'), /permission denied/);
  await db.exec('RESET ROLE');
  assert.equal((await sql("SELECT has_function_privilege('anon','public.get_super_admin_financial_overview(text)','EXECUTE') AS allowed")).rows[0].allowed, true);
  assert.equal((await sql("SELECT count(*)::int AS n FROM public.get_super_admin_financial_overview('wrong-password')")).rows[0].n, 0);
});

test('subscription values cannot be chosen at signup or changed by an owner', async () => {
  await db.exec('SET ROLE authenticated');
  for (const column of ['subscription_plan', 'subscription_status', 'next_billing_date', 'payment_method']) {
    assert.equal(
      (await sql("SELECT has_column_privilege('authenticated','public.partner_profiles',$1,'UPDATE') AS allowed", [column])).rows[0].allowed,
      false,
    );
    assert.equal(
      (await sql("SELECT has_column_privilege('authenticated','public.partner_profiles',$1,'INSERT') AS allowed", [column])).rows[0].allowed,
      false,
    );
  }
  await assert.rejects(
    sql("UPDATE public.partner_profiles SET subscription_plan='enterprise',subscription_status='ativa' WHERE id=$1", [owner]),
    /permission denied/,
  );
  const newUser = randomUUID();
  await db.exec('RESET ROLE');
  await sql('INSERT INTO auth.users(id) VALUES($1)', [newUser]);
  await login(newUser);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(
    sql("INSERT INTO public.partner_profiles(id,business_name,subscription_plan,subscription_status,next_billing_date) VALUES($1,'New','enterprise','ativa',CURRENT_DATE)", [newUser]),
    /permission denied/,
  );
  await sql("INSERT INTO public.partner_profiles(id,business_name,whatsapp,segment) VALUES($1,'New','555','assistencia')", [newUser]);
  const created = (await sql('SELECT subscription_plan,subscription_status,next_billing_date,payment_method FROM public.partner_profiles WHERE id=$1', [newUser])).rows[0];
  assert.deepEqual(created, { subscription_plan: 'basico', subscription_status: 'trial', next_billing_date: null, payment_method: null });
  await assert.rejects(sql('DELETE FROM public.partner_profiles WHERE id=$1', [newUser]), /permission denied/);
  await db.exec('RESET ROLE');
  await login(owner);
  await db.exec('SET ROLE authenticated');
  const { rows } = await sql("SELECT public.request_partner_plan_change('profissional') AS request_id");
  const requestId = rows[0].request_id;
  assert.equal((await sql("SELECT public.request_partner_plan_change('profissional') AS request_id")).rows[0].request_id, requestId);
  await assert.rejects(
    sql("SELECT public.request_partner_plan_change('enterprise')"),
    /Já existe uma solicitação de mudança de plano pendente/,
  );
  const profile = (await sql('SELECT subscription_plan FROM public.partner_profiles WHERE id=$1', [owner])).rows[0];
  const request = (await sql('SELECT requested_plan,status FROM public.partner_plan_change_requests WHERE id=$1', [requestId])).rows[0];
  assert.equal(profile.subscription_plan, 'basico');
  assert.deepEqual(request, { requested_plan: 'profissional', status: 'pending' });
  assert.deepEqual(
    (await sql('SELECT company_name,current_plan,requested_plan,status FROM public.get_partner_plan_change_requests()')).rows,
    [{ company_name: 'Test', current_plan: 'basico', requested_plan: 'profissional', status: 'pending' }],
  );
  await db.exec('RESET ROLE');
  await login(other);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(
    sql('SELECT public.get_partner_plan_change_requests()'),
    /Operador não autorizado/,
  );
  await assert.rejects(
    sql('SELECT public.resolve_partner_plan_change($1,true)', [requestId]),
    /Operador não autorizado/,
  );
  await db.exec('RESET ROLE');
  await login(owner);
  await db.exec('SET ROLE authenticated');
  await sql('SELECT public.resolve_partner_plan_change($1,true)', [requestId]);
  const approved = (await sql('SELECT subscription_plan,subscription_status,next_billing_date FROM public.partner_profiles WHERE id=$1', [owner])).rows[0];
  assert.equal(approved.subscription_plan, 'profissional');
  assert.equal(approved.subscription_status, 'trial');
  assert.equal(approved.next_billing_date, null);
  assert.equal((await sql('SELECT status FROM public.partner_plan_change_requests WHERE id=$1', [requestId])).rows[0].status, 'approved');
  await assert.rejects(
    sql('SELECT public.resolve_partner_plan_change($1,true)', [requestId]),
    /Solicitação pendente não encontrada/,
  );
  const rejectionId = (await sql("SELECT public.request_partner_plan_change('basico') AS request_id")).rows[0].request_id;
  await sql('SELECT public.resolve_partner_plan_change($1,false)', [rejectionId]);
  assert.equal((await sql('SELECT subscription_plan FROM public.partner_profiles WHERE id=$1', [owner])).rows[0].subscription_plan, 'profissional');
  assert.equal((await sql('SELECT status FROM public.partner_plan_change_requests WHERE id=$1', [rejectionId])).rows[0].status, 'rejected');
});

test('Fiscal RPC replacement preserves the deployed signature default arguments', async () => {
  const after = (await sql("SELECT pg_get_function_arguments('public.record_fiscal_document(uuid,text,text,text,text,jsonb)'::regprocedure) AS args")).rows[0].args;
  assert.equal(after, fiscalDefaultsBefore);
  await assert.rejects(
    sql('SELECT public.record_fiscal_document()'),
    /Selecione uma filial/,
  );
});

test('branch creation enforces one, three and unlimited plan quotas server-side', async () => {
  await assert.rejects(
    sql("SELECT public.create_partner_branch('Second branch',NULL)"),
    /permite até 1 filial/,
  );
  await sql("UPDATE public.partner_profiles SET subscription_plan='profissional' WHERE id=$1", [owner]);
  await sql("SELECT public.create_partner_branch('Second branch',NULL)");
  await sql("SELECT public.create_partner_branch('Third branch',NULL)");
  await assert.rejects(
    sql("SELECT public.create_partner_branch('Fourth branch',NULL)"),
    /permite até 3 filial/,
  );
  await sql("UPDATE public.partner_profiles SET subscription_plan='enterprise' WHERE id=$1", [owner]);
  await sql("SELECT public.create_partner_branch('Fourth branch',NULL)");
  await sql("SELECT public.create_partner_branch('Fifth branch',NULL)");
  assert.equal((await sql('SELECT count(*)::int AS total FROM public.partner_branches WHERE user_id=$1', [owner])).rows[0].total, 5);
});

test('fiscal RPCs persist branch-scoped pending requests and reject cross-branch writes', async () => {
  await mutate('abrir', 0);
  const completedSale = await sale();
  const payload = {
    branch_id: branch,
    sale_id: completedSale.id,
    series: '001',
    items: [],
    totals: { total: 100 },
  };
  const documentId = (await sql(
    "SELECT public.record_fiscal_document(NULL,'nfe','pending','123',NULL,$1::jsonb) AS id",
    [JSON.stringify(payload)],
  )).rows[0].id;
  const document = (await sql('SELECT user_id,branch_id,status,number FROM public.fiscal_documents WHERE id=$1', [documentId])).rows[0];
  assert.deepEqual(document, { user_id: owner, branch_id: branch, status: 'pending', number: '123' });
  await assert.rejects(
    sql("SELECT public.record_fiscal_document(NULL,'nfe','pending',NULL,NULL,$1::jsonb)", [
      JSON.stringify({ ...payload, branch_id: foreignBranch }),
    ]),
    /Filial inválida/,
  );

  const inutilizationId = (await sql(
    "SELECT public.create_fiscal_inutilization($1::jsonb) AS id",
    [JSON.stringify({
      branch_id: branch, document_type: 'nfce', series: '001',
      number_start: 10, number_end: 11,
      justification: 'Falha de sequência no sistema',
    })],
  )).rows[0].id;
  assert.equal((await sql('SELECT branch_id,status FROM public.fiscal_inutilizations WHERE id=$1', [inutilizationId])).rows[0].branch_id, branch);

  const ruleId = (await sql(
    "SELECT public.save_fiscal_branch_settings($1::jsonb) AS id",
    [JSON.stringify({
      branch_id: branch, name: 'Regra padrão', cfop: '5102', cst_csosn: '102',
      ncm: '12345678', icms_rate: 0, pis_rate: 0, cofins_rate: 0, active: true,
    })],
  )).rows[0].id;
  assert.equal((await sql('SELECT branch_id FROM public.fiscal_tax_rules WHERE id=$1', [ruleId])).rows[0].branch_id, branch);
});

test('cashier cannot withdraw or close a difference without manager PIN and justification', async () => {
  await login(employeeAuth); const session=await mutate('abrir',100);
  await assert.rejects(mutate('movimentar',10,{session,kind:'sangria',reason:'Retirada'}),/autorização/);
  await assert.rejects(mutate('movimentar',10,{session,kind:'sangria',reason:'Retirada',supervisor:manager,pin:'bad'}),/PIN incorreto/);
  await mutate('movimentar',10,{session,kind:'sangria',reason:'Retirada',supervisor:manager,pin:'9876'});
  await assert.rejects(mutate('fechar',80,{session,reason:'Falta'}),/autorização/);
  await assert.rejects(mutate('fechar',80,{session,supervisor:manager,pin:'9876'}),/Justifique/);
  await mutate('fechar',80,{session,reason:'Falta na conferência',supervisor:manager,pin:'9876'});
  assert.equal(Number((await sql('SELECT difference FROM partner_cash_sessions')).rows[0].difference),-10);
});

test('movement and close retries do not duplicate data or modify closed snapshots', async () => {
  const session=await mutate('abrir',100); const request=randomUUID();
  await mutate('movimentar',10,{session,kind:'suprimento',reason:'Troco',request});
  await mutate('movimentar',10,{session,kind:'suprimento',reason:'Troco',request});
  assert.equal((await sql('SELECT count(*)::int AS n FROM partner_cash_movements')).rows[0].n,1);
  const close=randomUUID(); await mutate('fechar',110,{session,request:close});
  await mutate('movimentar',10,{session,kind:'suprimento',reason:'Troco',request});
  await mutate('fechar',110,{session,request:close});
  await assert.rejects(mutate('fechar',111,{session,request:close}),/fechado/);
  await assert.rejects(mutate('movimentar',10,{session,kind:'suprimento',reason:'Troco'}),/fechado/);
});

test('retry checkout after closing is allowed, without a second cash or stock entry', async () => {
  const session=await mutate('abrir',0); const request=await sale();
  await mutate('fechar',100,{session}); await sale(request);
  assert.equal((await sql('SELECT count(*)::int AS n FROM partner_cash_movements')).rows[0].n,1);
  assert.equal((await sql('SELECT stock FROM partner_products')).rows[0].stock,9);
});

test('cancellation reverses cash and stock exactly once while cash is open', async () => {
  const session=await mutate('abrir',0); const request=await sale();
  await sale({...request,status:'cancelada'});
  await mutate('fechar',0,{session});
  assert.equal((await sql('SELECT count(*)::int AS n FROM partner_cash_movements')).rows[0].n,2);
  assert.equal((await sql('SELECT stock FROM partner_products')).rows[0].stock,10);
});

test('closed cash blocks cancellation/deletion, preserving financial and stock history', async () => {
  const session=await mutate('abrir',0); const request=await sale(); await mutate('fechar',100,{session});
  await assert.rejects(sale({...request,status:'cancelada'}),/caixa fechado/);
  await assert.rejects(sql('SELECT execute_partner_sale_delete(NULL,NULL,$1)',[request.id]),/nao podem ser excluidas|caixa fechado/);
  assert.equal((await sql('SELECT status FROM partner_sales')).rows[0].status,'concluida');
  assert.equal((await sql('SELECT stock FROM partner_products')).rows[0].stock,9);
});

test('tenant, branch, actor and anonymous access are denied on read and mutation', async () => {
  const session=await mutate('abrir',100);
  await assert.rejects(mutate('abrir',0,{branch:foreignBranch}),/Filial inválida/);
  await login(employeeAuth);
  await assert.rejects(mutate('fechar',100,{session}),/não pertence/);
  const snapshot=(await sql('SELECT read_partner_cash_register($1) AS data',[branch])).rows[0].data;
  assert.equal(snapshot.sessions.length,1);
  assert.equal(snapshot.sessions[0].id,session);
  assert.equal(snapshot.sessions[0].history_complete,false);
  assert.equal(snapshot.movements.length,0);
  await assert.rejects(sql('SELECT read_partner_cash_register($1)',[foreignBranch]),/filial/);
  await login(null); await assert.rejects(mutate('abrir',0),/autenticado/);
  await login(owner); await db.exec('SET ROLE authenticated');
  await assert.rejects(sql('SELECT * FROM partner_cash_sessions'),/permission denied/);
  await assert.rejects(sql('SELECT * FROM partner_cash_movements'),/permission denied/);
  await assert.rejects(sql('SELECT partner_cash_private.totals($1)',[session]),/permission denied/);
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(sql('SELECT read_partner_cash_register($1)',[branch]),/permission denied/);
});

test('invalid precision, negative amounts and withdrawals exceeding available cash are rejected', async () => {
  await assert.rejects(mutate('abrir',-1),/Valor inválido/);
  await assert.rejects(mutate('abrir',1.001),/Valor inválido/);
  const session=await mutate('abrir',10);
  await assert.rejects(mutate('movimentar',11,{session,kind:'sangria',reason:'Retirada'}),/disponível/);
});

test('only the owner can switch branches; administrator employees stay on their assigned branch', async () => {
  const secondBranch = randomUUID();
  const secondProduct = randomUUID();
  await sql('INSERT INTO partner_branches(id,user_id,name) VALUES($1,$2,\'Second\')', [secondBranch, owner]);
  await sql("INSERT INTO partner_products(id,user_id,branch_id,name,stock,is_service) VALUES($1,$2,$3,'Other branch product',4,false)", [secondProduct, owner, secondBranch]);
  await sql("UPDATE partner_salespeople SET role='administrador' WHERE id=$1", [employee]);

  await login(employeeAuth);
  const employeeData = (await sql('SELECT read_partner_cash_register($1) AS data', [branch])).rows[0].data;
  assert.equal(employeeData.actor_key, employee);
  assert.equal((await sql('SELECT public.partner_employee_can_access_branch($1,$2) AS allowed', [owner, branch])).rows[0].allowed, true);
  await assert.rejects(sql('SELECT read_partner_cash_register($1) AS data', [secondBranch]), /Acesso negado a filial/);

  await db.exec('ALTER TABLE partner_branches ENABLE ROW LEVEL SECURITY; ALTER TABLE partner_products ENABLE ROW LEVEL SECURITY; GRANT SELECT ON partner_branches,partner_products TO authenticated; SET ROLE authenticated');
  try {
    const employeeBranches = (await sql('SELECT id FROM partner_branches ORDER BY id')).rows.map(row => row.id);
    const employeeProducts = (await sql('SELECT id FROM partner_products ORDER BY id')).rows.map(row => row.id);
    assert.deepEqual(employeeBranches, [branch]);
    assert.deepEqual(employeeProducts, [product]);
    await login(owner);
    const ownerBranches = (await sql('SELECT id FROM partner_branches ORDER BY id')).rows.map(row => row.id);
    assert.deepEqual(ownerBranches.sort(), [branch, secondBranch].sort());
  } finally {
    await db.exec('RESET ROLE; ALTER TABLE partner_branches DISABLE ROW LEVEL SECURITY; ALTER TABLE partner_products DISABLE ROW LEVEL SECURITY');
  }
});

test('unassigned administrator employee cannot access any branch', async () => {
  await db.exec('ALTER TABLE partner_salespeople DISABLE TRIGGER require_partner_salesperson_branch');
  await sql("UPDATE partner_salespeople SET role='administrador', branch_id=NULL WHERE id=$1", [employee]);
  await db.exec('ALTER TABLE partner_salespeople ENABLE TRIGGER require_partner_salesperson_branch');
  await login(employeeAuth);
  await assert.rejects(sql('SELECT read_partner_cash_register($1)', [branch]), /Acesso negado a filial/);
  assert.equal(
    (await sql('SELECT public.partner_employee_can_access_branch($1,$2) AS allowed', [owner, branch])).rows[0].allowed,
    false,
  );
});

test('collaborators cannot be created or reassigned without a branch', async () => {
  await assert.rejects(
    sql("INSERT INTO partner_salespeople(id,user_id,role,active) VALUES($1,$2,'administrador',true)", [randomUUID(), owner]),
    /Cada colaborador precisa estar vinculado a uma filial/,
  );
  await assert.rejects(
    sql('UPDATE partner_salespeople SET branch_id=NULL WHERE id=$1', [employee]),
    /Cada colaborador precisa estar vinculado a uma filial/,
  );
});

test('manager reads branch history across operators while cashier sees only own cash', async () => {
  await mutate('abrir',100);
  await login(employeeAuth); const session=await mutate('abrir',20);
  await login(owner);
  const data=(await sql('SELECT read_partner_cash_register($1) AS data',[branch])).rows[0].data;
  assert.equal(data.sessions.length,2); assert.equal(data.actor_key,owner);
  assert.ok(data.sessions.some(s=>s.id===session));
});

test('cash movements use exact cents and pending requests survive remount without credentials', async () => {
  const code=ts.transpileModule(await read('../../src/lib/cashRegister.ts'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
  const { CashRequestStore, cashAmount, cashTotals }=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const data=new Map(); const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const store=new CashRequestStore(storage,'owner:branch');
  const request={id:randomUUID(),action:'movimentar',sessionId:randomUUID(),amount:0.1,kind:'sangria',reason:'Troco'};
  store.save(request);
  assert.deepEqual(new CashRequestStore(storage,'owner:branch').read(),request);
  assert.equal(new CashRequestStore(storage,'other:branch').read(),null);
  assert.ok(![...data.values()].join('').includes('pin'));
  assert.equal(cashAmount('10,25'),10.25); assert.throws(()=>cashAmount('10.001'));
  assert.equal(cashTotals([{kind:'venda',payment_method:'dinheiro',amount:0.1},{kind:'venda',payment_method:'dinheiro',amount:0.2},{kind:'sangria',payment_method:'dinheiro',amount:0.1}]).dinheiro,0.2);
  store.clear(); assert.equal(store.read(),null);
});

async function supervisedSale(session, extra={}) {
 const r={id:randomUUID(),operator:null,pin:null,...extra};
 await sql('SELECT supervised_execute_partner_sale_mutation($1,$2,$3,$4,NULL,$5,$6::jsonb,100,NULL,NULL,$7,$8,$9,$10,$11,$12,NULL,0,NULL)',
 [session,r.operator,r.pin,r.id,'Cliente',JSON.stringify([{product_id:product,name:'Produto',quantity:1,unit_price:100}]),'dinheiro',branch,'concluida','pdv','varejo','balcao']);
 return r;
}

test('owner supervises employee cash, views its sales, finalizes and closes without impersonation',async()=>{
 await login(employeeAuth); const session=await mutate('abrir',20);
 await login(owner); const request=await supervisedSale(session);
 assert.equal((await sql('SELECT session_id FROM partner_cash_movements WHERE sale_id=$1',[request.id])).rows[0].session_id,session);
 const snapshot=(await sql('SELECT read_partner_cash_register($1) AS data',[branch])).rows[0].data;
 assert.equal(snapshot.can_manage,true); assert.ok(snapshot.sales.some(s=>s.id===request.id));
 await supervisedSale(session,request);
 await sql("SELECT supervised_mutate_partner_cash_register('fechar',$1,NULL,NULL,$2,120,NULL,'Fechado pelo proprietário',NULL,NULL,$3)",[branch,session,randomUUID()]);
 await supervisedSale(session,request);
 const closed=(await sql('SELECT * FROM partner_cash_sessions WHERE id=$1',[session])).rows[0];
 assert.equal(closed.actor_key,employee);assert.equal(Number(closed.expected_amount),120);
 const audit=(await sql("SELECT actor_name,action FROM partner_audit_logs WHERE action LIKE '%supervisionado%'")).rows;
 assert.equal(audit.length,2);assert.ok(audit.every(log=>log.actor_name===owner));
});

test('linked manager finalizes and closes employee cash but cashier cannot supervise',async()=>{
 const managerAuth=randomUUID();await sql('UPDATE partner_salespeople SET auth_user_id=$1 WHERE id=$2',[managerAuth,manager]);
 await login(employeeAuth); const session=await mutate('abrir',0);
 await assert.rejects(supervisedSale(session),/Somente gerente/);
 await login(managerAuth);await supervisedSale(session);
 await sql("SELECT supervised_mutate_partner_cash_register('fechar',$1,NULL,NULL,$2,100,NULL,'',NULL,NULL,$3)",[branch,session,randomUUID()]);
 assert.equal(Number((await sql('SELECT expected_amount FROM partner_cash_sessions WHERE id=$1',[session])).rows[0].expected_amount),100);
});

test('supervision refuses foreign cash, another branch, changed retry destination and new sale in closed cash',async()=>{
 await login(employeeAuth);const employeeCash=await mutate('abrir',0);
 await login(owner);const ownerCash=await mutate('abrir',0);const request=await supervisedSale(employeeCash);
 await assert.rejects(supervisedSale(ownerCash,request),/outro caixa/);
 await sql("SELECT supervised_mutate_partner_cash_register('fechar',$1,NULL,NULL,$2,100,NULL,'',NULL,NULL,$3)",[branch,employeeCash,randomUUID()]);
 await assert.rejects(supervisedSale(employeeCash),/Abra o caixa/);
 await login(other);await assert.rejects(supervisedSale(employeeCash),/inválido|filial/i);
 await login(owner);await assert.rejects(sql("SELECT supervised_mutate_partner_cash_register('fechar',$1,NULL,NULL,$2,0,NULL,'',NULL,NULL,$3)",[foreignBranch,ownerCash,randomUUID()]),/Filial inválida/);
});

test('cash refund cannot exceed money in the new session; supply enables it and retries remain idempotent',async()=>{
 const original=await mutate('abrir',0);const sold=await sale();await mutate('fechar',100,{session:original});
 const session=await mutate('abrir',0);const request=randomUUID();
 const refund=()=>sql('SELECT record_partner_cash_refund($1,NULL,NULL,$2,$3,100,$4,NULL,NULL,$5)',[branch,session,sold.id,'Devolução',request]);
 await assert.rejects(refund(),/dinheiro disponível/);
 assert.equal((await sql("SELECT count(*)::int n FROM partner_cash_movements WHERE kind='devolucao'")).rows[0].n,0);
 await mutate('movimentar',100,{session,kind:'suprimento',reason:'Fundos para devolução'});
 await refund();await refund();await mutate('fechar',0,{session});await refund();
 assert.equal((await sql("SELECT count(*)::int n FROM partner_cash_movements WHERE kind='devolucao'")).rows[0].n,1);
});

test('supervised refunds use destination cash balance and record the real supervisor',async()=>{
 const original=await mutate('abrir',0);const sold=await sale();await mutate('fechar',100,{session:original});
 await login(employeeAuth);const session=await mutate('abrir',0);await login(owner);
 const request=randomUUID();const refund=()=>sql('SELECT supervised_record_partner_cash_refund($1,NULL,NULL,$2,$3,100,$4,NULL,NULL,$5,$6)',[branch,session,sold.id,'Devolução',request,'dinheiro']);
 await assert.rejects(refund(),/dinheiro disponível/);
 await sql("SELECT supervised_mutate_partner_cash_register('movimentar',$1,NULL,NULL,$2,100,'suprimento','Fundos',NULL,NULL,$3)",[branch,session,randomUUID()]);
 await refund();await refund();
 assert.equal((await sql("SELECT authorized_by FROM partner_cash_movements WHERE request_id=$1",[request])).rows[0].authorized_by,owner);
});

test('pending reconciliation distinguishes absent, confirmed and conflicting payloads without new financial writes',async()=>{
 const id=randomUUID();const request={id,action:'abrir',amount:20,sessionId:null,kind:'sangria',reason:'',saleId:null};
 const resolve=payload=>sql('SELECT resolve_partner_cash_request($1,NULL,NULL,$2::jsonb) AS confirmed',[branch,JSON.stringify(payload)]);
 assert.equal((await resolve(request)).rows[0].confirmed,false);
 await assert.rejects(mutate('abrir',20,{request:id}),/conciliada como não registrada/);
 request.id=randomUUID();const session=await mutate('abrir',20,{request:request.id});assert.equal((await resolve(request)).rows[0].confirmed,true);
 await assert.rejects(resolve({...request,amount:21}),/divergentes/);
 const closeId=randomUUID();const closing={id:closeId,action:'fechar',amount:20,sessionId:session,reason:''};
 assert.equal((await resolve(closing)).rows[0].confirmed,false);
 await assert.rejects(mutate('fechar',20,{session,request:closeId}),/conciliada como não registrada/);
 closing.id=randomUUID();await mutate('fechar',20,{session,request:closing.id});assert.equal((await resolve(closing)).rows[0].confirmed,true);
 await login(employeeAuth);await assert.rejects(resolve(closing),/não autorizado/);
});

test('new public supervision functions are invoker-only and anonymous cannot execute',async()=>{
 const funcs=(await sql("SELECT p.proname,p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') AS anon FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'supervised_%' OR p.proname='resolve_partner_cash_request')")).rows;
 assert.equal(funcs.length,4);assert.ok(funcs.every(f=>!f.prosecdef&&!f.anon));
});

test('PIX refunds do not require physical cash, while inactive supervisors cannot access cash',async()=>{
 const original=await mutate('abrir',0);const sold=await sale({method:'pix'});await mutate('fechar',0,{session:original});
 const session=await mutate('abrir',0);
 await sql('SELECT record_partner_cash_refund($1,NULL,NULL,$2,$3,100,$4,NULL,NULL,$5,$6)',[branch,session,sold.id,'Devolução PIX',randomUUID(),'pix']);
 assert.deepEqual((await sql('SELECT partner_cash_private.totals($1) AS totals',[session])).rows[0].totals,{dinheiro:0,pix:-100,cartao:0,faturado:0});
 const managerAuth=randomUUID();await sql('UPDATE partner_salespeople SET auth_user_id=$1,active=false WHERE id=$2',[managerAuth,manager]);await login(managerAuth);
 await assert.rejects(supervisedSale(session),/inativo/);
});

const actOnQuote=(id,action='cancel',supervisor=null,pin=null,targetBranch=branch)=>sql('SELECT mutate_partner_open_order($1,$2,$3,NULL,NULL,$4,$5) AS id',[id,targetBranch,action,supervisor,pin]);
test('owner and linked manager authorize open-order cancel/delete with their authenticated identity',async()=>{
 const quote=await sale({status:'pre_venda'});await actOnQuote(quote.id);await actOnQuote(quote.id);
 assert.equal((await sql('SELECT status FROM partner_sales WHERE id=$1',[quote.id])).rows[0].status,'cancelada');
 const managerAuth=randomUUID();await sql('UPDATE partner_salespeople SET auth_user_id=$1 WHERE id=$2',[managerAuth,manager]);await login(managerAuth);
 const second=await sale({status:'pre_venda'});await actOnQuote(second.id,'delete');
 assert.equal((await sql('SELECT count(*)::int n FROM partner_sales WHERE id=$1',[second.id])).rows[0].n,0);
 assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,10);
});
test('cashier authorizes with separate supervisor PIN and remains the audited operator',async()=>{
 await login(employeeAuth);const quote=await sale({status:'pre_venda'});
 await assert.rejects(actOnQuote(quote.id),/exige autorização/);
 await assert.rejects(actOnQuote(quote.id,'cancel',manager,'0000'),/PIN incorreto/);
 await actOnQuote(quote.id,'cancel',manager,'9876');
 const log=(await sql("SELECT * FROM partner_audit_logs WHERE action='cancelamento_pedido_aberto'")).rows[0];
 assert.equal(log.actor_role,'caixa');assert.match(log.details,new RegExp(employee));assert.match(log.details,new RegExp(manager));
});
test('open-order supervisor must be active, in company and in the authorized branch',async()=>{
 await login(employeeAuth);const quote=await sale({status:'pre_venda'});
 await sql('UPDATE partner_salespeople SET active=false WHERE id=$1',[manager]);await assert.rejects(actOnQuote(quote.id,'delete',manager,'9876'),/PIN incorreto/);
 await sql('UPDATE partner_salespeople SET active=true,branch_id=$1 WHERE id=$2',[foreignBranch,manager]);await assert.rejects(actOnQuote(quote.id,'delete',manager,'9876'),/PIN incorreto/);
 await sql('UPDATE partner_salespeople SET branch_id=$1,user_id=$2 WHERE id=$3',[branch,other,manager]);await assert.rejects(actOnQuote(quote.id,'delete',manager,'9876'),/PIN incorreto/);
 await login(other);await assert.rejects(actOnQuote(quote.id),/Filial inválida/);
 await login(employeeAuth);await assert.rejects(actOnQuote(quote.id,'cancel',manager,'9876',foreignBranch),/filial/);
});
test('new open-order actions cannot delete or cancel completed/paid orders or financial entries',async()=>{
 const session=await mutate('abrir',0);const paid=await sale();
 for(const action of ['cancel','delete'])await assert.rejects(actOnQuote(paid.id,action),/Somente pedidos em aberto/);
 assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,9);
 const quote=await sale({status:'pre_venda'});await sql("UPDATE partner_sales SET payment_status='pago' WHERE id=$1",[quote.id]);
 await assert.rejects(actOnQuote(quote.id),/exige o fluxo de estorno/);
 assert.equal((await sql('SELECT count(*)::int n FROM partner_cash_movements WHERE session_id=$1',[session])).rows[0].n,1);
 await db.exec('SET ROLE anon');await assert.rejects(actOnQuote(quote.id),/permission denied/);
});

const cancelHistory=(id,supervisor=null,pin=null,targetBranch=branch)=>sql('SELECT cancel_partner_history_sale($1,$2,NULL,NULL,$3,$4) id',[id,targetBranch,supervisor,pin]);
test('history owner cancels without registered supervisor and retry reverses split cash and stock once',async()=>{
 await sql('DELETE FROM partner_salespeople WHERE id=$1',[manager]);await mutate('abrir',0);const sold=await splitSale();
 await cancelHistory(sold.id);await cancelHistory(sold.id);
 assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,10);
 assert.equal((await sql("SELECT count(*)::int n FROM partner_cash_movements WHERE sale_id=$1 AND kind='estorno'",[sold.id])).rows[0].n,2);
 assert.equal((await sql("SELECT count(*)::int n FROM partner_audit_logs WHERE action='cancelamento_historico_autorizado'")).rows[0].n,1);
});
test('history cashier uses supervisor PIN without impersonating the manager',async()=>{
 await login(employeeAuth);await mutate('abrir',0);const sold=await sale();
 await assert.rejects(cancelHistory(sold.id),/autorização/);
 await assert.rejects(cancelHistory(sold.id,manager,'bad'),/PIN/);
 await cancelHistory(sold.id,manager,'9876');
 const log=(await sql("SELECT actor_name,actor_role,details FROM partner_audit_logs WHERE action='cancelamento_historico_autorizado'")).rows[0];
 assert.equal(log.actor_name,employee);assert.equal(log.actor_role,'caixa');assert.ok(log.details.includes(manager));
 assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,10);
});
test('history cancellation rejects inactive supervisor, foreign supervisor, branch mismatch and closed original cash',async()=>{
 await login(employeeAuth);const session=await mutate('abrir',0);const sold=await sale();
 await sql('UPDATE partner_salespeople SET active=false WHERE id=$1',[manager]);await assert.rejects(cancelHistory(sold.id,manager,'9876'),/PIN/);
 await sql('UPDATE partner_salespeople SET active=true,user_id=$2 WHERE id=$1',[manager,other]);await assert.rejects(cancelHistory(sold.id,manager,'9876'),/PIN/);
 await sql('UPDATE partner_salespeople SET user_id=$2,branch_id=$3 WHERE id=$1',[manager,owner,foreignBranch]);await assert.rejects(cancelHistory(sold.id,manager,'9876'),/PIN/);
 await login(owner);await assert.rejects(cancelHistory(sold.id,null,null,foreignBranch),/Filial|encontrada/);
 await sql('UPDATE partner_salespeople SET branch_id=$2 WHERE id=$1',[manager,branch]);
 await login(employeeAuth);await mutate('fechar',100,{session});
 await login(owner);await assert.rejects(cancelHistory(sold.id),/caixa fechado/);
 assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,9);
});
test('history cancellation preserves returned sales and denies anonymous and private API access',async()=>{
 await mutate('abrir',0);const sold=await sale();
 await sql('INSERT INTO rma_requests_v2(user_id,sale_id,sale_item_index,quantity) VALUES($1,$2,0,1)',[owner,sold.id]);
 await assert.rejects(cancelHistory(sold.id),/devolução/);
 await login(null);await assert.rejects(cancelHistory(sold.id),/autenticado/);
 await login(owner);await db.exec('SET ROLE anon');await assert.rejects(cancelHistory(sold.id),/permission denied/);
 await db.exec('RESET ROLE; SET ROLE authenticated');
 assert.equal((await sql("SELECT has_function_privilege('authenticated','partner_history_private.resolve_cancel_operator(uuid,text,uuid,uuid,text)','EXECUTE') allowed")).rows[0].allowed,false);
});
test('service presale completion is immutable, independent of stock, and appears on completion day',async()=>{
 await sql('UPDATE partner_products SET is_service=true WHERE id=$1',[product]);await mutate('abrir',0);
 const sold=await sale({status:'pre_venda'});await sql("UPDATE partner_sales SET created_at=now()-interval '5 days' WHERE id=$1",[sold.id]);
 await sale({...sold,status:'concluida'});
 const completed=(await sql('SELECT completed_at FROM partner_sales WHERE id=$1',[sold.id])).rows[0].completed_at;assert.ok(completed);
 assert.equal((await sql('SELECT count(*)::int n FROM stock_movements')).rows[0].n,0);
 const today=(await sql("SELECT read_partner_sales_history($1,$2,(now() AT TIME ZONE 'America/Sao_Paulo')::date,(now() AT TIME ZONE 'America/Sao_Paulo')::date,'all','',0) result",[owner,branch])).rows[0].result;
 assert.equal(Number(today.total),1);assert.equal(today.sales[0].id,sold.id);
 const numbered=(await sql("SELECT read_partner_sales_history($1,$2,NULL,NULL,'all',lpad($3::text,6,'0'),0) result",[owner,branch,today.sales[0].sale_number])).rows[0].result;
 assert.equal(Number(numbered.total),1);assert.equal(numbered.sales[0].id,sold.id);
 await sql("UPDATE partner_sales SET completed_at=now()-interval '1 year' WHERE id=$1",[sold.id]);await cancelHistory(sold.id);
 assert.equal(new Date((await sql('SELECT completed_at FROM partner_sales WHERE id=$1',[sold.id])).rows[0].completed_at).toISOString(),new Date(completed).toISOString());
});

test('history cancellation cancels unpaid invoice but preserves partially received invoices atomically',async()=>{
 await mutate('abrir',0);const customer=randomUUID();
 await sql('INSERT INTO partner_customers(id,user_id,branch_id,allow_credit,credit_limit) VALUES($1,$2,$3,true,1000)',[customer,owner,branch]);
 const unpaid=await freightSale({customer,method:'faturado'});await cancelHistory(unpaid.id);
 assert.equal((await sql('SELECT status FROM partner_invoices WHERE sale_id=$1',[unpaid.id])).rows[0].status,'cancelada');
 const paid=await freightSale({customer,method:'faturado'});
 await sql("UPDATE partner_invoices SET paid_amount=50,status='parcial' WHERE sale_id=$1",[paid.id]);
 await assert.rejects(cancelHistory(paid.id),/recebimentos|estorno/);
 assert.equal((await sql('SELECT status FROM partner_sales WHERE id=$1',[paid.id])).rows[0].status,'concluida');
 assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,9);
 assert.equal((await sql("SELECT count(*)::int n FROM partner_cash_movements WHERE sale_id=$1 AND kind='estorno'",[paid.id])).rows[0].n,0);
});
test('completion backfill recovers cash evidence for legacy services and leaves unknown dates unguessed',async()=>{
 await sql('UPDATE partner_products SET is_service=true WHERE id=$1',[product]);await mutate('abrir',0);const sold=await sale();const unknown=(await sale()).id;
 // Simulate a legacy service sale for which no completion evidence survived.
 await sql('DELETE FROM partner_cash_movements WHERE sale_id=$1',[unknown]);
 await db.exec('ALTER TABLE partner_sales DISABLE TRIGGER partner_sale_completion');
 await sql("UPDATE partner_sales SET completed_at=NULL,created_at=now()-interval '10 days'");
 await sql("INSERT INTO stock_movements(user_id,branch_id,type,quantity,reason) VALUES($1,$2,'saida',1,$3)",[other,foreignBranch,'Saida por venda '+unknown]);
 const migration=await read('../migrations/20261015013718_fix_sales_history_cancellation_and_completion.sql');
 const update=migration.slice(migration.indexOf('UPDATE public.partner_sales s SET'),migration.indexOf('\n\nCREATE FUNCTION'));
 await db.exec(update);await db.exec('ALTER TABLE partner_sales ENABLE TRIGGER partner_sale_completion');
 const rows=(await sql('SELECT id,completed_at FROM partner_sales')).rows;
 assert.ok(rows.find(r=>r.id===sold.id).completed_at);assert.equal(rows.find(r=>r.id===unknown).completed_at,null);
});
