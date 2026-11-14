import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { helpers, input, payable } from './fixtures/business_intelligence_helpers.mjs';

test('editing and exclusion preserve payment history, detect stale data and replay each correction exactly once',async()=>{
 const db=new PGlite(),owner=randomUUID(),other=randomUUID(),branch=randomUUID(),purchase=randomUUID();
 const first=randomUUID(),second=randomUUID(),payment=randomUUID(),editToken=randomUUID(),deleteToken=randomUUID();
 try{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA partner_subscription_private;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
   GRANT USAGE ON SCHEMA auth TO anon,authenticated;
   CREATE FUNCTION partner_subscription_private.require_actor(text) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN IF current_setting('test.blocked',true)='true' THEN RAISE EXCEPTION 'Acesso bloqueado'; END IF; END $$;
   CREATE FUNCTION partner_has_saas_access(uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
   CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${owner}'),('${other}');
   CREATE TABLE partner_branches(id uuid PRIMARY KEY,user_id uuid);INSERT INTO partner_branches VALUES('${branch}','${owner}');
   CREATE TABLE partner_suppliers(id uuid PRIMARY KEY,user_id uuid);`);
  for(const name of ['20261007055110_add_partner_payables.sql','20261114163617_payable_payment_date.sql','20261114180005_payable_purchase_details.sql','20261114183102_payable_edit_and_exclusion.sql'])
   await db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const login=id=>db.query("SELECT set_config('test.uid',$1,false)",[id??'']);
  const day=(await db.query("SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date-40)::text AS day")).rows[0].day;
  await login(owner);
  await db.query("SELECT create_partner_payable_purchase($1,$2,null,'Compra','Credor','outros',100,$3::date,'pix',null,$4::jsonb)",
   [purchase,branch,day,JSON.stringify([{id:first,amount:60,due_date:day},{id:second,amount:40,due_date:day}])]);
  const get=async(id=first)=>(await db.query('SELECT * FROM partner_payables WHERE id=$1',[id])).rows[0];
  const pay=(amount,id=payment,account=first)=>db.query("SELECT record_partner_payable_payment_details($1,$2,$3,$4::date,'pix',null)",[account,amount,id,day]);
  await pay(20);
  const initial=await get(),changes={description:'Despesa corrigida',amount:70,due_date:day};
  const manage=(action,patch,revision,token,reason='Correção de teste',account=first)=>db.query('SELECT manage_partner_payable($1,$2,$3::jsonb,$4,$5,$6)',[account,action,JSON.stringify(patch),revision,token,reason]);
  await db.exec('SET ROLE anon');await assert.rejects(manage('edit',changes,initial.revision,editToken),/permission denied/);
  await db.exec('SET ROLE authenticated');await login(null);await assert.rejects(manage('edit',changes,initial.revision,editToken),/Não autenticado/);
  await login(other);await assert.rejects(manage('edit',changes,initial.revision,editToken),/acesso negado/);
  await login(owner);
  await db.exec("SELECT set_config('test.blocked','true',false)");await assert.rejects(manage('edit',changes,initial.revision,editToken),/Acesso bloqueado/);
  await db.exec("SELECT set_config('test.blocked','false',false)");
  await assert.rejects(manage('edit',{branch_id:randomUUID()},initial.revision,randomUUID()),/Campos/);
  await assert.rejects(manage('edit',{amount:19},initial.revision,randomUUID()),/menor/);
  await manage('edit',changes,initial.revision,editToken);await manage('edit',changes,initial.revision,editToken);
  await assert.rejects(manage('edit',{...changes,description:'Outro'},initial.revision,editToken),/diverge/);
  await assert.rejects(manage('edit',changes,initial.revision,randomUUID()),error=>error.code==='40001');
  await db.exec('RESET ROLE');
  let current=await get();
  assert.equal(current.description,'Despesa corrigida');assert.equal(Number(current.amount),70);assert.equal(Number(current.paid_amount),20);assert.equal(current.status,'parcial');
  assert.equal(Number(current.purchase_total),110);assert.equal(Number((await get(second)).purchase_total),110);
  assert.equal(Number((await get(second)).amount),40);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM partner_payable_changes')).rows[0].n,1);
  const edit=(await db.query('SELECT before_record,after_record,payment_history FROM partner_payable_changes WHERE id=$1',[editToken])).rows[0];
  assert.equal(edit.before_record.amount,60);assert.equal(edit.after_record.amount,70);assert.equal(edit.payment_history.length,1);
  const beforePaymentRevision=current.revision;
  await pay(10,randomUUID());
  await assert.rejects(manage('delete',{},beforePaymentRevision,randomUUID()),error=>error.code==='40001');
  current=await get();
  await assert.rejects(manage('delete',{},current.revision,randomUUID(),''),/motivo/);
  await manage('delete',{},current.revision,deleteToken,'Cadastro duplicado');
  await manage('delete',{},current.revision,deleteToken,'Cadastro duplicado');
  await assert.rejects(manage('edit',{description:'Não deve alterar'},current.revision,randomUUID()),/excluída/);
  const deleted=await get();assert.ok(deleted.deleted_at);assert.equal(deleted.status,'cancelada');assert.equal(Number(deleted.paid_amount),30);
  const history=(await db.query('SELECT amount,voided_at,void_reason,created_at FROM partner_payable_payments WHERE payable_id=$1',[first])).rows;
  assert.equal(history.length,2);assert.ok(history.every(item=>item.voided_at&&item.void_reason==='Cadastro duplicado'));
  await assert.rejects(pay(1,randomUUID()),/saldo/);
  await pay(20); // Recuperar um pagamento antigo não o reativa após a exclusão.
  assert.ok((await db.query('SELECT voided_at FROM partner_payable_payments WHERE id=$1',[payment])).rows[0].voided_at);
  assert.equal((await get(second)).deleted_at,null);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM partner_payable_changes')).rows[0].n,2);
  await pay(40,randomUUID(),second);
  const paidSecond=await get(second);
  await manage('edit',{description:'Conta quitada corrigida'},paidSecond.revision,randomUUID(),'Correção de descrição',second);
  assert.equal((await get(second)).status,'paga');
  await assert.rejects(manage('edit',{amount:39},(await get(second)).revision,randomUUID(),'Correção',second),/menor/);
  await manage('delete',{},(await get(second)).revision,randomUUID(),'Registro quitado duplicado',second);
  assert.ok((await get(second)).deleted_at);
  await db.exec('SET ROLE authenticated');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM partner_payable_changes')).rows[0].n,4);
  await assert.rejects(db.query('DELETE FROM partner_payable_changes'),/permission denied/);
  await assert.rejects(db.query("UPDATE partner_payables SET amount=1 WHERE id=$1",[second]),/permission denied/);
  await login(other);assert.equal((await db.query('SELECT count(*)::int AS n FROM partner_payable_changes')).rows[0].n,0);
 }finally{await db.close();}
});

test('excluded account payments leave historical cash and result together without producing an artificial refund',()=>{
 const deleted=payable({id:'wrong',amount:100,paid_amount:100,status:'cancelada',deleted_at:'2026-11-14T15:00:00Z',due_date:'2026-10-10'});
 const valid=payable({id:'valid',amount:5,paid_amount:0,status:'aberta',due_date:'2026-10-10'});
 const result=helpers.buildBusinessIntelligence(input({period:'selectedMonth',selectedMonth:'2026-10',rmas:[],payables:[deleted,valid],
  payments:[{id:'wrong-payment',user_id:'company',payable_id:'wrong',amount:100,paid_at:'2026-10-10T15:00:00Z',created_at:'2026-10-10T15:00:00Z',voided_at:'2026-11-14T15:00:00Z'}]}));
 assert.equal(result.result.expenses,5);assert.equal(result.result.result,55);assert.equal(result.paid,0);assert.equal(result.cashResult,120);
});
