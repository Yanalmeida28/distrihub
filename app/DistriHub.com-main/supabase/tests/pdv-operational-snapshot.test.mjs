import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {checkoutCreditDatabase} from './fixtures/checkout_credit_database.mjs';
const read=file=>readFile(new URL(file,import.meta.url),'utf8');
test('operational PDV omits historical payloads but preserves complete cross-branch credit and refreshes known closed work',async()=>{
 const db=await checkoutCreditDatabase();const [owner,other,branch,second,foreign,customer,shared,product,open,old,invoice,foreignInvoice,rma]=Array.from({length:13},()=>randomUUID());
 try{
  await db.exec(`ALTER TABLE rma_requests_v2 ADD COLUMN branch_id uuid,ADD COLUMN customer_id uuid,ADD COLUMN status text,ADD COLUMN product_name text;
   CREATE FUNCTION public.partner_employee_can_access_branch(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;`);
  await db.exec(await read('../migrations/20261010200046_add_rma_customer_credits.sql'));
  await db.exec(await read('../migrations/20261020220000_use_rma_credit_at_checkout.sql'));
  await db.exec(await read('../migrations/20261119212332_lean_pdv_operational_snapshot.sql'));
  await db.query("INSERT INTO partner_profiles(id,account_name,business_name) VALUES($1,'Owner','Test'),($2,'Other','Test')",[owner,other]);
  await db.query("INSERT INTO partner_branches(id,user_id,name) VALUES($1,$4,'A'),($2,$4,'B'),($3,$5,'Other')",[branch,second,foreign,owner,other]);
  await db.query("INSERT INTO partner_customers(id,user_id,branch_id,name,allow_credit,credit_limit) VALUES($1,$3,$4,'Client',true,1000),($2,$3,NULL,'Shared',true,1000)",[customer,shared,owner,branch]);
  await db.query("INSERT INTO partner_products(id,user_id,branch_id,name,stock,is_service) VALUES($1,$2,$3,'Produto',10,false)",[product,owner,branch]);
  // Trusted synthetic history: pricing guards are covered separately by checkout tests.
  await db.exec('ALTER TABLE partner_sales DISABLE TRIGGER USER; ALTER TABLE partner_invoices DISABLE TRIGGER USER; ALTER TABLE rma_requests_v2 DISABLE TRIGGER USER');
  await db.query("INSERT INTO partner_sales(id,user_id,branch_id,customer_id,customer_name,total,status,created_at) SELECT gen_random_uuid(),$1,$2,$3,'Historical',100,'concluida',now()-interval '2 days' FROM generate_series(1,500)",[owner,branch,customer]);
  await db.query("INSERT INTO partner_sales(id,user_id,branch_id,customer_id,total,status,created_at) VALUES($1,$3,$4,$5,100,'pre_venda',now()),($2,$3,$4,$5,100,'concluida',now()-interval '1 year')",[open,old,owner,branch,customer]);
  await db.query("INSERT INTO partner_invoices(id,user_id,branch_id,customer_id,number,amount,paid_amount,status,due_date) VALUES($1,$3,$4,$6,'A',100,20,'parcial',CURRENT_DATE),($2,$3,$5,$6,'B',200,50,'aberta',CURRENT_DATE)",[invoice,foreignInvoice,owner,branch,second,customer]);
  await db.query("INSERT INTO rma_requests_v2(id,user_id,branch_id,customer_id,status,product_name,credit_amount) VALUES($1,$2,$3,$4,'credito_gerado','Return',75)",[rma,owner,branch,customer]);
  await db.query("SELECT set_config('test.auth_uid',$1,false)",[owner]);
  const full=(await db.query('SELECT get_partner_pdv_snapshot($1) AS value',[branch])).rows[0].value;
  const get=async(sales=[],invoices=[])=>(await db.query('SELECT get_partner_pdv_snapshot($1,true,$2::uuid[],$3::uuid[]) AS value',[branch,sales,invoices])).rows[0].value;
  const lean=await get([old],[invoice]);assert.equal(lean.operational,true);assert.deepEqual(lean.products,full.products);assert.deepEqual(lean.credits,full.credits);assert.deepEqual(lean.return_credits,full.return_credits);
  assert.equal(lean.credits.find(c=>c.customer_id===customer).used,230);assert.equal(lean.credits.find(c=>c.customer_id===customer).available,770);
  assert.ok(lean.sales.some(s=>s.id===open));assert.ok(lean.sales.some(s=>s.id===old));assert.ok(lean.sales.length<=32);assert.equal(lean.movements.length,0);
  assert.ok(JSON.stringify(lean).length<JSON.stringify(full).length/5);
  await db.query("UPDATE partner_sales SET status='cancelada' WHERE id=$1",[open]);await db.query("UPDATE partner_invoices SET status='paga',paid_amount=amount WHERE id=$1",[invoice]);
  const updated=await get([open],[invoice]);assert.equal(updated.sales.find(s=>s.id===open).status,'cancelada');assert.equal(updated.invoices.find(i=>i.id===invoice).status,'paga');assert.equal(updated.credits.find(c=>c.customer_id===customer).used,150);
  await assert.rejects(db.query('SELECT get_partner_pdv_snapshot($1,true,\'{}\',\'{}\')',[foreign]),/Filial|filial|Acesso/);
  await db.exec('SET ROLE anon');await assert.rejects(db.query('SELECT get_partner_pdv_snapshot($1,true,\'{}\',\'{}\')',[branch]),/permission denied/);await db.exec('RESET ROLE');
 }finally{await db.close();}
});
