import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { checkoutCreditDatabase } from './fixtures/checkout_credit_database.mjs';

test('checkout credit is atomic, retry-safe, shared with invoice credits, and never cash', async () => {
 const db=await checkoutCreditDatabase();
 const one=async(text,args=[]) => (await db.query(text,args)).rows[0];
 const read=path=>readFile(new URL(path,import.meta.url),'utf8');
 try {
  await db.exec(`CREATE FUNCTION public.partner_employee_can_access_branch(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
   ALTER TABLE rma_requests_v2 ADD COLUMN branch_id uuid, ADD COLUMN customer_id uuid, ADD COLUMN status text, ADD COLUMN updated_at timestamptz, ADD COLUMN product_name text;
   CREATE TABLE partner_invoice_receipts(user_id uuid,invoice_id uuid,branch_id uuid,customer_id uuid,customer_name text,invoice_number text,amount numeric,occurred_at timestamptz);`);
  await db.exec(await read('../migrations/20261010200046_add_rma_customer_credits.sql'));
  await db.exec(await read('../migrations/20261020220000_use_rma_credit_at_checkout.sql'));
  await db.exec(await read('../migrations/20261125163916_pdv_sale_observations.sql'));
  const [owner,other,branch,otherBranch,customer,otherCustomer,product,origin,rma]=Array.from({length:9},()=>randomUUID());
  await db.query('INSERT INTO auth.users VALUES($1),($2)',[owner,other]);
  await db.query("INSERT INTO partner_profiles(id,account_name,business_name) VALUES($1,'Owner','Test'),($2,'Other','Test')",[owner,other]);
  await db.query("INSERT INTO partner_branches(id,user_id,name) VALUES($1,$3,'Main'),($2,$4,'Other')",[branch,otherBranch,owner,other]);
  await db.query("INSERT INTO partner_customers(id,user_id,branch_id,name) VALUES($1,$3,$4,'Customer'),($2,$3,$4,'Other customer')",[customer,otherCustomer,owner,branch]);
  await db.query("INSERT INTO partner_products(id,user_id,branch_id,name,stock,is_service) VALUES($1,$2,$3,'Product',10,false)",[product,owner,branch]);
  await db.query("SELECT set_config('test.auth_uid',$1,false)",[owner]);
  const session=(await one("SELECT mutate_partner_cash_register('abrir',$1,NULL,NULL,NULL,0,NULL,'',NULL,NULL,$2) id",[branch,randomUUID()])).id;
  // Historical return source; no business credit limit is needed to spend a return balance.
  await db.query("SELECT execute_partner_sale_mutation(NULL,NULL,$1,$2,'Customer',$3,100,NULL,NULL,'pix',$4,'concluida','pdv','varejo','balcao',NULL,0,'[]'::jsonb)",[origin,customer,JSON.stringify([{product_id:product,name:'Product',quantity:1,unit_price:100}]),branch]);
  await db.query("INSERT INTO rma_requests_v2(id,user_id,sale_id,sale_item_index,quantity,branch_id,customer_id,status) VALUES($1,$2,$3,0,1,$4,$5,'reintegrado_estoque')",[rma,owner,origin,branch,customer]);
  await db.query('SELECT grant_partner_rma_credit($1,100)',[rma]);
  const request=(credit=50)=>({id:randomUUID(),customer_id:customer,customer_name:'Customer',branch_id:branch,items:[{product_id:product,name:'Product',quantity:1,unit_price:100}],total:100,freight_fee:0,payment_method:'misto',payment_splits:[{method:'credito_rma',amount:credit},...(credit===100?[]:[{method:'pix',amount:100-credit}])],status:'concluida',origin:'pdv',customer_type:'varejo',delivery_type:'balcao'});
  const execute=(sale,creditId=rma)=>db.query('SELECT execute_partner_sale_with_rma_credit($1,$2,NULL,NULL,NULL) id',[sale,creditId]);
  const saveObserved=(sale,creditId=null,cashSession=null) => db.query(
    'SELECT save_pdv_sale_with_observation($1,NULL,NULL,$2,$3) id',[sale,cashSession,creditId]);
  const first={...request(),observations:'Entregar após as 14h'};
  await saveObserved(first,rma);await saveObserved(first,rma);
  assert.equal((await one('SELECT observations FROM partner_sales WHERE id=$1',[first.id])).observations,first.observations);
  await assert.rejects(saveObserved({...first,observations:'Texto diferente'},rma),/diverge/);
  assert.equal(Number((await one('SELECT stock FROM partner_products WHERE id=$1',[product])).stock),8);
  assert.equal(Number((await one('SELECT count(*) n FROM partner_rma_credit_applications')).n),1);
  const totals=(await one('SELECT partner_cash_private.totals($1) value',[session])).value;
  assert.equal(totals.pix,150);assert.equal(totals.dinheiro,0);assert.equal(totals.credito_rma,50);
  assert.equal(Number((await one('SELECT count(*) n FROM partner_invoice_receipts')).n),0);
  const snapshot=(await one('SELECT get_partner_pdv_snapshot($1) value',[branch])).value;
  assert.equal(Number(snapshot.return_credits[0].credit_used_amount),50);
  await assert.rejects(execute({...first,payment_splits:[{method:'credito_rma',amount:40},{method:'pix',amount:60}]}),/diverge/);
  await assert.rejects(execute({...request(),customer_id:otherCustomer}),/mesmo cliente/);
  await assert.rejects(execute({...request(),branch_id:otherBranch}),/filial|permiss|mesmo cliente/i);
  await assert.rejects(execute(request(51)),/insuficiente/);
  // Existing invoice application must account for the credit already spent at checkout.
  const invoice=randomUUID();await db.query("INSERT INTO partner_invoices(id,user_id,branch_id,customer_id,customer_name,number,amount,paid_amount,status) VALUES($1,$2,$3,$4,'Customer','F001',100,0,'aberta')",[invoice,owner,branch,customer]);
  await assert.rejects(db.query('SELECT apply_partner_rma_credit($1,$2,51,$3)',[rma,invoice,randomUUID()]),/insuficiente/);
  await db.query('SELECT apply_partner_rma_credit($1,$2,10,$3)',[rma,invoice,randomUUID()]);
  await assert.rejects(execute(request(41)),/insuficiente/);
  const badStock={...request(40),items:[{product_id:product,name:'Product',quantity:100,unit_price:100}],total:10000,payment_splits:[{method:'credito_rma',amount:40},{method:'pix',amount:9960}]};
  await assert.rejects(execute(badStock),/Estoque/);
  assert.equal(Number((await one('SELECT sum(amount) used FROM partner_rma_credit_applications')).used),60);
  // Old endpoints cannot forge the new payment type without a matching reservation.
  const forged=request(40);
  await assert.rejects(db.query("SELECT execute_partner_sale_mutation(NULL,NULL,$1,$2,'Customer',$3,100,NULL,NULL,'misto',$4,'concluida','pdv','varejo','balcao',NULL,0,$5)",[forged.id,customer,forged.items,branch,forged.payment_splits]),/reservado/);
  await assert.rejects(db.query("UPDATE partner_sales SET status='cancelada' WHERE id=$1",[first.id]),/preservar|devolucao/);
  await assert.rejects(db.query('DELETE FROM partner_sales WHERE id=$1',[first.id]),/preservar|devolucao/);
  // A fully credit-funded purchase still belongs to a cash session, with zero money received.
  const fullRma=randomUUID();await db.query("INSERT INTO rma_requests_v2(id,user_id,sale_id,sale_item_index,quantity,branch_id,customer_id,status) VALUES($1,$2,$3,0,1,$4,$5,'reintegrado_estoque')",[fullRma,owner,origin,branch,customer]);
  await db.query('SELECT grant_partner_rma_credit($1,100)',[fullRma]);
  const full=request(100);
  const executeSupervised=()=>saveObserved({...full,observations:'Crédito usado integralmente'},fullRma,session);
  await executeSupervised();await executeSupervised();
  assert.equal(Number((await one("SELECT amount FROM partner_cash_movements WHERE sale_id=$1 AND payment_method='credito_rma'",[full.id])).amount),100);
  assert.equal(Number((await one("SELECT count(*) n FROM partner_cash_movements WHERE sale_id=$1 AND payment_method IN ('pix','dinheiro','cartao')",[full.id])).n),0);
  assert.equal(Number((await one('SELECT sum(amount) used FROM partner_rma_credit_applications WHERE rma_id=$1',[fullRma])).used),100);
  await assert.rejects(execute(request(1),fullRma),/insuficiente/);
  const quote={...request(),status:'pre_venda',payment_method:'pix',payment_splits:[],observations:'Separar para retirada'};
  await saveObserved(quote);
  await saveObserved({...quote,observations:'Retirada amanhã'});
  assert.equal((await one('SELECT observations FROM partner_sales WHERE id=$1',[quote.id])).observations,'Retirada amanhã');
  await saveObserved({...quote,observations:null});
  assert.equal((await one('SELECT observations FROM partner_sales WHERE id=$1',[quote.id])).observations,null);
  const invalidQuote={...quote,id:randomUUID(),observations:'x'.repeat(1001)};
  await assert.rejects(saveObserved(invalidQuote),/observação/);
  assert.equal(Number((await one('SELECT count(*) n FROM partner_sales WHERE id=$1',[invalidQuote.id])).n),0);
  await db.query("SELECT set_config('test.auth_uid',$1,false)",[other]);
  await assert.rejects(execute(request(40)),/mesmo cliente|filial|permiss/i);
  await db.exec("SET test.auth_uid=''");await assert.rejects(execute(request(40)),/autenticado|sessao|autenticacao/i);
  assert.equal((await one("SELECT has_function_privilege('anon','execute_partner_sale_with_rma_credit(jsonb,uuid,uuid,text,uuid)','EXECUTE') allowed")).allowed,false);
  assert.equal((await one("SELECT has_function_privilege('anon','save_pdv_sale_with_observation(jsonb,uuid,text,uuid,uuid)','EXECUTE') allowed")).allowed,false);
 } finally { await db.close(); }
});
