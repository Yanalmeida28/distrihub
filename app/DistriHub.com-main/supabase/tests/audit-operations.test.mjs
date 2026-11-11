import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const sql = (query, values = []) => db.query(query, values);
const owner = randomUUID(), other = randomUUID(), employee = randomUUID(), buyer = randomUUID(), branch = randomUUID(), otherBranch = randomUUID(), product = randomUUID(), customer = randomUUID();
const login = id => sql("SELECT set_config('test.auth_uid',$1,false)", [id ?? '']);
const read = file => readFile(new URL(file, import.meta.url), 'utf8');
before(async () => {
  await db.exec(await read('./fixtures/pdv_schema.sql'));
  await db.exec(`
    CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${owner}'),('${other}'),('${employee}'),('${buyer}');
    ALTER TABLE partner_branches ADD COLUMN is_active boolean DEFAULT true, ADD COLUMN name text, ADD COLUMN address text;
    ALTER TABLE partner_customers ADD COLUMN name text;
    ALTER TABLE partner_products ADD COLUMN IF NOT EXISTS sku text, ADD COLUMN IF NOT EXISTS cost_price numeric DEFAULT 10, ADD COLUMN IF NOT EXISTS sale_price numeric DEFAULT 25;
    CREATE SCHEMA partner_subscription_private;
    CREATE FUNCTION partner_subscription_private.require_actor(text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF; END$$;
    CREATE FUNCTION partner_subscription_private.require_access(uuid,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN; END$$;
    CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
    CREATE FUNCTION public.partner_has_saas_access(uuid,text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$SELECT $1=auth.uid() OR EXISTS(SELECT 1 FROM partner_salespeople WHERE user_id=$1 AND auth_user_id=auth.uid() AND active)$$;
    CREATE FUNCTION public.partner_employee_can_access_branch(uuid,uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$SELECT EXISTS(SELECT 1 FROM partner_salespeople WHERE user_id=$1 AND branch_id=$2 AND auth_user_id=auth.uid() AND active)$$;
    CREATE FUNCTION public.resolve_partner_operator(uuid,text,uuid) RETURNS TABLE(company_id uuid) LANGUAGE plpgsql AS $$BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF; RETURN QUERY SELECT auth.uid(); END$$;
    CREATE FUNCTION public.execute_partner_stock_replenishment(uuid,text,uuid,uuid,integer,numeric,text) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$DECLARE value integer; BEGIN UPDATE partner_products SET stock=stock+$5 WHERE id=$3 AND user_id=auth.uid() AND branch_id=$4 RETURNING stock INTO value; IF NOT FOUND OR $5<=0 THEN RAISE EXCEPTION 'Produto não autorizado'; END IF; INSERT INTO stock_movements(user_id,product_id,branch_id,type,quantity) VALUES(auth.uid(),$3,$4,'entrada',$5);RETURN jsonb_build_object('new_stock',value);END$$;
    CREATE TABLE service_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,branch_id uuid,customer_id uuid,customer_name text,service_segment text,equipment_type text,equipment_identification text,serial_number text,accessories_left text,physical_condition text,entry_damage text,entry_notes text,status text DEFAULT 'aberta',labor_total numeric DEFAULT 0,parts_total numeric DEFAULT 0,total numeric DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(), CHECK(total=labor_total+parts_total));
    CREATE TABLE service_order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),service_order_id uuid,user_id uuid,product_id uuid,branch_id uuid,product_name text,quantity integer,unit_cost numeric,unit_price numeric,created_at timestamptz DEFAULT now());
    CREATE TABLE service_order_photos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),service_order_id uuid,user_id uuid,branch_id uuid,photo_type text,operation_type text,label text,storage_path text,created_at timestamptz DEFAULT now());
    ALTER TABLE service_orders ENABLE ROW LEVEL SECURITY; ALTER TABLE service_order_items ENABLE ROW LEVEL SECURITY; ALTER TABLE service_order_photos ENABLE ROW LEVEL SECURITY;
    CREATE POLICY os_read ON service_orders FOR SELECT TO authenticated USING(true);
    CREATE POLICY os_items_read ON service_order_items FOR SELECT TO authenticated USING(true);
    CREATE POLICY os_photos_read ON service_order_photos FOR SELECT TO authenticated USING(true);
    GRANT SELECT ON service_orders,service_order_items,service_order_photos TO authenticated;
    CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage,auth TO authenticated; GRANT SELECT,INSERT,UPDATE ON storage.objects TO authenticated;
    CREATE TABLE b2b_orders(id uuid PRIMARY KEY,user_id uuid); GRANT SELECT,INSERT,UPDATE,DELETE ON b2b_orders TO authenticated;
    CREATE TABLE store_settings_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,catalog_slug text,catalog_enabled boolean);
    CREATE FUNCTION public.read_public_store_catalog(text,text) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;
    CREATE TABLE support_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,sender_role text,message text,created_at timestamptz DEFAULT now());
    CREATE TABLE admin_support_states(user_id uuid PRIMARY KEY,priority text,closed_at timestamptz);
    INSERT INTO partner_profiles(id,business_name) VALUES('${owner}','Loja A'),('${other}','Loja B');
    INSERT INTO partner_branches(id,user_id,name) VALUES('${branch}','${owner}','Centro'),('${otherBranch}','${other}','Outra');
    INSERT INTO partner_customers(id,user_id,branch_id,name) VALUES('${customer}','${owner}','${branch}','Cliente');
    INSERT INTO partner_products(id,user_id,branch_id,name,stock,cost_price,sale_price,is_service) VALUES('${product}','${owner}','${branch}','Peça',100,10,25,false);
    INSERT INTO partner_salespeople(id,user_id,auth_user_id,branch_id,role,active) VALUES(gen_random_uuid(),'${owner}','${employee}','${branch}','gerente',true);
    INSERT INTO store_settings_v2(user_id,catalog_slug,catalog_enabled) VALUES('${owner}','loja-a',true),('${other}','loja-b',true);
  `);
  await db.exec(await read('../migrations/20261012195624_fix_audited_operations.sql'));
  await db.exec(await read('../migrations/20261012201545_close_legacy_operation_paths.sql'));
  await db.exec(await read('../migrations/20261015010204_fix_service_order_customer_and_billing.sql'));
  await db.exec(await read('../migrations/20261015184249_service_order_manual_parts.sql'));
  await db.exec(await read('../migrations/20261015205000_service_order_manual_customer.sql'));
  await db.exec(await read('../migrations/20261015213923_fix_service_order_manual_billing_and_contacts.sql'));
  await db.exec(await read('../migrations/20261111232441_recover_catalog_order_attempts.sql'));
});
after(() => db.close());
test('reposição: mesma tentativa soma uma vez; tentativa diferente é uma nova entrada; outros dados são rejeitados', async () => {
  await login(owner); const request = randomUUID();
  const replenish = (id, qty) => sql('SELECT execute_partner_stock_replenishment_once($1,NULL,NULL,$2,$3,$4,NULL,NULL) result', [id, product, branch, qty]);
  const initial = Number((await sql('SELECT stock FROM partner_products WHERE id=$1', [product])).rows[0].stock);
  await replenish(request, 10); await replenish(request, 10);
  assert.equal(Number((await sql('SELECT stock FROM partner_products WHERE id=$1', [product])).rows[0].stock), initial + 10);
  await assert.rejects(replenish(request, 20), /outra reposição/);
  await replenish(randomUUID(), 10);
  assert.equal(Number((await sql('SELECT stock FROM partner_products WHERE id=$1', [product])).rows[0].stock), initial + 20);
});
const osPayload = () => ({ branch_id: branch, customer_id: customer, equipment_type: 'Celular', identification: 'Teste', serial: '', segment: 'assistencia', accessories: '', condition: '', damage: '', notes: 'Vistoria', labor_total: 30, items: [{ product_id: product, quantity: 2, unit_price: 25 }] });

test('manual OS parts persist names and prices, charge exactly once and never consume or return stock',async()=>{
  await login(employee);
  const id=randomUUID();const payload={...osPayload(),items:[{product_id:null,name:'Tela comprada de terceiros',quantity:2,unit_price:125.50},{product_id:null,name:'Conector avulso',quantity:1,unit_price:10}]};
  const stock=Number((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock);
  const movements=(await sql('SELECT count(*)::int n FROM stock_movements')).rows[0].n;
  for(let i=0;i<2;i++)await sql('SELECT create_service_order_once($1,$2::jsonb)',[id,JSON.stringify(payload)]);
  const parts=(await sql('SELECT product_id,product_name,quantity,unit_price,stock_consumed FROM service_order_items WHERE service_order_id=$1 ORDER BY product_name',[id])).rows;
  assert.equal(parts.length,2);assert.equal(parts[1].product_name,'Tela comprada de terceiros');assert.equal(Number(parts[1].unit_price),125.5);
  assert.ok(parts.every(part=>part.product_id===null&&part.stock_consumed===false));
  assert.equal(Number((await sql('SELECT total FROM service_orders WHERE id=$1',[id])).rows[0].total),291);
  await assert.rejects(sql('SELECT create_service_order_once($1,$2::jsonb)',[id,JSON.stringify({...payload,items:[{...payload.items[0],name:'Outra peça'}]})]),/outra OS/);
  for(let i=0;i<2;i++)await sql("SELECT update_service_order_workflow($1,'cancelada','','aguardando_aprovacao','Cliente desistiu',$2)",[id,customer]);
  assert.equal(Number((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock),stock);
  assert.equal((await sql('SELECT count(*)::int n FROM stock_movements')).rows[0].n,movements);
});

test('manual OS customer details persist without a registered customer and invalid details are rejected',async()=>{
 await login(owner);
 const id=randomUUID();
 const payload={...osPayload(),customer_id:null,manual_customer:{name:'Cliente avulso',email:'avulso@example.com',address:'Rua das Flores, 123',phone:'(11) 98888-7777'}};
 await sql('SELECT create_service_order_once($1,$2::jsonb)',[id,JSON.stringify(payload)]);
 await sql('SELECT create_service_order_once($1,$2::jsonb)',[id,JSON.stringify(payload)]);
 const order=(await sql('SELECT customer_id,customer_name,customer_email,customer_address,customer_phone FROM service_orders WHERE id=$1',[id])).rows[0];
 assert.equal(order.customer_id,null);
 assert.deepEqual([order.customer_name,order.customer_email,order.customer_address,order.customer_phone],['Cliente avulso','avulso@example.com','Rua das Flores, 123','(11) 98888-7777']);
 for(const manual of [{name:''},{name:'x'.repeat(201)},{name:'Cliente',email:'invalido'}]){
  const invalidId=randomUUID();
  await assert.rejects(sql('SELECT create_service_order_once($1,$2::jsonb)',[invalidId,JSON.stringify({...osPayload(),customer_id:null,manual_customer:manual})]));
  assert.equal((await sql('SELECT count(*)::int n FROM service_orders WHERE id=$1',[invalidId])).rows[0].n,0);
 }
});

test('mixed OS invoices include manual parts while cancellation returns only catalog pieces',async()=>{
  await login(owner);const id=randomUUID();const payload=osPayload();payload.items.push({product_id:null,name:'Peça externa',quantity:2,unit_price:15.25});
  const stock=Number((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock);
  await sql('SELECT create_service_order_once($1,$2::jsonb)',[id,JSON.stringify(payload)]);
  assert.equal(Number((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock),stock-2);
  await sql("SELECT update_service_order_workflow($1,'pronta','Técnico','aprovado','Concluído',$2)",[id,customer]);
  for(let i=0;i<2;i++)await sql("SELECT bill_service_order_once($1,'2026-10-30')",[id]);
  const invoices=(await sql('SELECT amount FROM partner_invoices WHERE service_order_id=$1',[id])).rows;
  assert.equal(invoices.length,1);assert.equal(Number(invoices[0].amount),110.5);
  await sql("SELECT update_service_order_workflow($1,'cancelada','Técnico','aprovado','Cliente desistiu',$2)",[id,customer]);
  assert.equal(Number((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock),stock);
});

test('manual customer OS bills once without creating a registry customer and keeps billed identity locked',async()=>{
 await login(owner);const id=randomUUID();const name='Cliente avulso para cobrança';
 const payload={...osPayload(),customer_id:null,manual_customer:{name,email:'manual@example.com',phone:'11999999999',address:'Rua manual'}};
 const customers=(await sql('SELECT count(*)::int n FROM partner_customers')).rows[0].n;
 await sql('SELECT create_service_order_once($1,$2::jsonb)',[id,JSON.stringify(payload)]);
 await assert.rejects(sql("SELECT bill_service_order_once($1,'2026-10-30')",[id]),/pronta/);
 await sql("SELECT update_service_order_workflow_checked($1,'pronta','Técnico','aprovado','Pronta',NULL,false)",[id]);
 for(let i=0;i<2;i++)await sql("SELECT bill_service_order_once($1,'2026-10-30')",[id]);
 const invoices=(await sql('SELECT customer_id,customer_name,amount FROM partner_invoices WHERE service_order_id=$1',[id])).rows;
 assert.equal(invoices.length,1);assert.equal(invoices[0].customer_id,null);assert.equal(invoices[0].customer_name,name);assert.equal(Number(invoices[0].amount),80);
 assert.equal((await sql('SELECT count(*)::int n FROM partner_customers')).rows[0].n,customers);
 await assert.rejects(sql("SELECT update_service_order_workflow_checked($1,'pronta','Técnico','aprovado','Troca',$2,false)",[id,customer]),/já faturada/);
 const unnamed=randomUUID();await sql('SELECT create_service_order_once($1,$2::jsonb)',[unnamed,JSON.stringify({...osPayload(),customer_id:null})]);
 await sql("SELECT update_service_order_workflow_checked($1,'pronta','Técnico','aprovado','Pronta',NULL,false)",[unnamed]);
 await assert.rejects(sql("SELECT bill_service_order_once($1,'2026-10-30')",[unnamed]),/Informe cliente/);
});

test('both workflow APIs clear the former contact only when customer identity changes',async()=>{
 await login(owner);
 for(const checked of [false,true]){
  const id=randomUUID();const payload={...osPayload(),customer_id:null,manual_customer:{name:'Anterior',email:'old@example.com',address:'Antigo',phone:'111'}};
  await sql('SELECT create_service_order_once($1,$2::jsonb)',[id,JSON.stringify(payload)]);
  const api=checked?'update_service_order_workflow_checked':'update_service_order_workflow';
  await sql(`SELECT ${api}($1,'aberta','','aguardando_aprovacao','Nota',NULL${checked?',false':''})`,[id]);
  assert.equal((await sql('SELECT customer_email FROM service_orders WHERE id=$1',[id])).rows[0].customer_email,'old@example.com');
  await sql(`SELECT ${api}($1,'aberta','','aguardando_aprovacao','Troca',$2${checked?',false':''})`,[id,customer]);
  const current=(await sql('SELECT customer_id,customer_email,customer_address,customer_phone FROM service_orders WHERE id=$1',[id])).rows[0];
  assert.equal(current.customer_id,customer);assert.equal(current.customer_email,null);assert.equal(current.customer_address,null);assert.equal(current.customer_phone,null);
 }
});

test('invalid manual parts roll back the entire OS and stock; other branches remain forbidden',async()=>{
  await login(owner);
  const stock=Number((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock);
  for(const item of [{name:''},{name:'x'.repeat(201)},{quantity:0},{quantity:1.5},{quantity:1000},{unit_price:-1},{unit_price:0.001},{unit_price:'NaN'}]){
    const id=randomUUID();const payload=osPayload();payload.items.push({product_id:null,name:'Peça manual',quantity:1,unit_price:10,...item});
    await assert.rejects(sql('SELECT create_service_order_once($1,$2::jsonb)',[id,JSON.stringify(payload)]));
    assert.equal((await sql('SELECT count(*)::int n FROM service_orders WHERE id=$1',[id])).rows[0].n,0);
    assert.equal(Number((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock),stock);
  }
  await login(other);
  await assert.rejects(sql('SELECT create_service_order_once($1,$2::jsonb)',[randomUUID(),JSON.stringify({...osPayload(),items:[{product_id:null,name:'Peça externa',quantity:1,unit_price:1}]})]),/Filial não autorizada/);
});
test('OS: colaborador autorizado cria uma vez, baixa peças uma vez e uma repetição com dados diferentes é rejeitada', async () => {
  await login(employee); const request = randomUUID(); const payload = osPayload();
  const initial = Number((await sql('SELECT stock FROM partner_products WHERE id=$1', [product])).rows[0].stock);
  for (let i = 0; i < 2; i++) await sql('SELECT create_service_order_once($1,$2::jsonb)', [request, JSON.stringify(payload)]);
  assert.equal(Number((await sql('SELECT stock FROM partner_products WHERE id=$1', [product])).rows[0].stock), initial - 2);
  assert.equal((await sql('SELECT count(*)::int n FROM service_orders WHERE id=$1', [request])).rows[0].n, 1);
  assert.equal(Number((await sql('SELECT total FROM service_orders WHERE id=$1', [request])).rows[0].total), 80);
  await assert.rejects(sql('SELECT create_service_order_once($1,$2::jsonb)', [request, JSON.stringify({ ...payload, labor_total: 40 })]), /outra OS/);
  await login(other); await assert.rejects(sql('SELECT create_service_order_once($1,$2::jsonb)', [randomUUID(), JSON.stringify(payload)]), /Filial não autorizada/);
});
test('OS: cancelamento devolve peças uma vez; cobrança gera uma única fatura e não aceita cancelamento com recebimento', async () => {
  await login(owner); const canceled = randomUUID(); const billed = randomUUID();
  await sql('SELECT create_service_order_once($1,$2::jsonb)', [canceled, JSON.stringify(osPayload())]);
  const beforeCancel = Number((await sql('SELECT stock FROM partner_products WHERE id=$1', [product])).rows[0].stock);
  for (let i = 0; i < 2; i++) await sql("SELECT update_service_order_workflow($1,'cancelada','','aguardando_aprovacao','Cliente desistiu',$2)", [canceled, customer]);
  assert.equal(Number((await sql('SELECT stock FROM partner_products WHERE id=$1', [product])).rows[0].stock), beforeCancel + 2);
  await sql('SELECT create_service_order_once($1,$2::jsonb)', [billed, JSON.stringify(osPayload())]);
  await sql("SELECT update_service_order_workflow($1,'pronta','Técnico','aprovado','Concluído',$2)", [billed, customer]);
  for (let i = 0; i < 2; i++) await sql("SELECT bill_service_order_once($1,'2026-10-30')", [billed]);
  assert.equal((await sql('SELECT count(*)::int n FROM partner_invoices WHERE service_order_id=$1', [billed])).rows[0].n, 1);
  await sql("UPDATE partner_invoices SET paid_amount=10,status='parcial' WHERE service_order_id=$1", [billed]);
  await assert.rejects(sql("SELECT update_service_order_workflow($1,'cancelada','Técnico','aprovado','Cliente desistiu',$2)", [billed, customer]), /recebimentos/);
});
test('catálogo: preço é calculado no servidor, retentativa não duplica e preço do navegador é ignorado', async () => {
  await login(buyer); const id = randomUUID(); const items = JSON.stringify([{ id: product, quantity: 2, price: 0 }]);
  const place = () => sql("SELECT place_catalog_order($1,'loja-a',$2,$3::jsonb,'Comprador','11999999999','','pix','balcao') result", [id, branch, items]);
  const first = (await place()).rows[0].result; const replay = (await place()).rows[0].result;
  assert.equal(Number(first.total), 50); assert.equal(first.id, replay.id);
  assert.equal((await sql('SELECT count(*)::int n FROM catalog_orders WHERE id=$1', [id])).rows[0].n, 1);
  await login(other); await assert.rejects(sql("SELECT update_catalog_order_status($1,'confirmado')", [id]), /Filial não autorizada/);
  await login(owner); await sql("SELECT update_catalog_order_status($1,'confirmado')", [id]);
});
test('catalog recovery returns the committed result after the store is disabled and rejects changed payloads', async () => {
  await login(buyer);
  const id = randomUUID(), items = JSON.stringify([{ id: product, quantity: 1 }]);
  const place = (quantity = 1) => sql("SELECT place_catalog_order($1,'loja-a',$2,$3::jsonb,'Comprador','11999999999','','pix','balcao') result", [id, branch, quantity === 1 ? items : JSON.stringify([{ id: product, quantity }])]);
  const first = (await place()).rows[0].result;
  await sql('UPDATE store_settings_v2 SET catalog_enabled=false WHERE user_id=$1', [owner]);
  try {
    const replay = (await place()).rows[0].result;
    assert.equal(replay.id, first.id); assert.equal(replay.total, first.total);
    await assert.rejects(place(2), /outro pedido/);
    await login(other);
    await assert.rejects(place(), error => error.code === 'PDC01');
    assert.equal((await sql('SELECT count(*)::int n FROM catalog_orders WHERE id=$1', [id])).rows[0].n, 1);
  } finally { await sql('UPDATE store_settings_v2 SET catalog_enabled=true WHERE user_id=$1', [owner]); }
});

test('catalog definitive rejection records no order or pending server operation', async () => {
  await login(buyer);
  const id = randomUUID(), stock = (await sql('SELECT stock FROM partner_products WHERE id=$1', [product])).rows[0].stock;
  await sql('UPDATE partner_products SET stock=0 WHERE id=$1', [product]);
  try {
    await assert.rejects(sql("SELECT place_catalog_order($1,'loja-a',$2,$3::jsonb,'Comprador','11999999999','','pix','balcao')", [id, branch, JSON.stringify([{ id: product, quantity: 1 }])]), error => error.code === 'PDC01');
    assert.equal((await sql('SELECT count(*)::int n FROM catalog_orders WHERE id=$1', [id])).rows[0].n, 0);
    assert.equal((await sql('SELECT count(*)::int n FROM partner_operations_private.operation_requests WHERE request_id=$1', [id])).rows[0].n, 0);
  } finally { await sql('UPDATE partner_products SET stock=$2 WHERE id=$1', [product, stock]); }
});

test('RLS: outra empresa não lê OS ou pedidos; escrita direta dos totais B2B fica bloqueada', async () => {
  await login(other); await db.exec('SET ROLE authenticated');
  try {
    assert.equal((await sql('SELECT id FROM service_orders')).rows.length, 0);
    assert.equal((await sql('SELECT id FROM catalog_orders')).rows.length, 0);
    await assert.rejects(sql('INSERT INTO b2b_orders(id,user_id) VALUES($1,$2)', [randomUUID(), other]), /permission denied/);
  } finally { await db.exec('RESET ROLE'); }
});

test('OS: checked workflow clears the customer explicitly, old NULL calls preserve it, and another branch cannot assign it',async()=>{
 await login(owner);const id=randomUUID();await sql('SELECT create_service_order_once($1,$2::jsonb)',[id,JSON.stringify(osPayload())]);
 await sql("SELECT update_service_order_workflow($1,'aberta','','aguardando_aprovacao','',NULL)",[id]);
 assert.equal((await sql('SELECT customer_id FROM service_orders WHERE id=$1',[id])).rows[0].customer_id,customer);
 await sql("SELECT update_service_order_workflow_checked($1,'aberta','','aguardando_aprovacao','',NULL,true)",[id]);
 const cleared=(await sql('SELECT customer_id,customer_name FROM service_orders WHERE id=$1',[id])).rows[0];assert.equal(cleared.customer_id,null);assert.equal(cleared.customer_name,'');
 await sql("SELECT update_service_order_workflow_checked($1,'aberta','','aguardando_aprovacao','',$2,false)",[id,customer]);
 assert.equal((await sql('SELECT customer_id FROM service_orders WHERE id=$1',[id])).rows[0].customer_id,customer);
 await assert.rejects(sql("SELECT update_service_order_workflow_checked($1,'aberta','','aguardando_aprovacao','',$2,true)",[id,customer]),/inconsistente/);
 await login(other);await assert.rejects(sql("SELECT update_service_order_workflow_checked($1,'aberta','','aguardando_aprovacao','',NULL,true)",[id]),/Filial não autorizada/);
});
test('OS: both old and checked APIs protect billed customer identity and preserve invoice, stock and receipts',async()=>{
 await login(owner);const id=randomUUID(),secondCustomer=randomUUID();
 await sql('INSERT INTO partner_customers(id,user_id,branch_id,name) VALUES($1,$2,$3,$4)',[secondCustomer,owner,branch,'Segundo']);
 await sql('SELECT create_service_order_once($1,$2::jsonb)',[id,JSON.stringify(osPayload())]);
 await sql("SELECT update_service_order_workflow($1,'pronta','Técnico','aprovado','Concluído',$2)",[id,customer]);
 await sql("SELECT bill_service_order_once($1,'2026-10-30')",[id]);
 const stock=(await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock;
 await assert.rejects(sql("SELECT update_service_order_workflow($1,'pronta','Técnico','aprovado','Troca',$2)",[id,secondCustomer]),/já faturada/);
 await assert.rejects(sql("SELECT update_service_order_workflow_checked($1,'pronta','Técnico','aprovado','Troca',$2,false)",[id,secondCustomer]),/já faturada/);
 await assert.rejects(sql("SELECT update_service_order_workflow_checked($1,'pronta','Técnico','aprovado','Limpar',NULL,true)",[id]),/já faturada/);
 await sql("SELECT update_service_order_workflow_checked($1,'pronta','Técnico B','aprovado','Atualização',$2,false)",[id,customer]);
 assert.equal((await sql('SELECT customer_id FROM partner_invoices WHERE service_order_id=$1',[id])).rows[0].customer_id,customer);
 assert.equal((await sql('SELECT stock FROM partner_products WHERE id=$1',[product])).rows[0].stock,stock);
 await sql("UPDATE partner_invoices SET paid_amount=10,status='parcial' WHERE service_order_id=$1",[id]);
 await assert.rejects(sql("SELECT update_service_order_workflow_checked($1,'cancelada','Técnico B','aprovado','Desistência',$2,false)",[id,customer]),/recebimentos/);
});
test('OS: new workflow public API is invoker-only and unavailable to anonymous callers',async()=>{
 const row=(await sql("SELECT prosecdef,has_function_privilege('anon',oid,'EXECUTE') anon FROM pg_proc WHERE oid='public.update_service_order_workflow_checked(uuid,text,text,text,text,uuid,boolean)'::regprocedure")).rows[0];
 assert.equal(row.prosecdef,false);assert.equal(row.anon,false);
});
