import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { intelligenceHarness, helpers, input, payable } from './fixtures/business_intelligence_helpers.mjs';

const details = intelligenceHarness().load('lib/payableDetails.ts');
test('installments preserve cents, month-end anchors and leap years without inventing invalid dates', () => {
  const rows = details.payableSchedule(100,3,'2025-01-31');
  assert.deepEqual(Array.from(rows,row=>row.amount),[33.34,33.33,33.33]);
  assert.deepEqual(Array.from(rows,row=>row.due_date),['2025-01-31','2025-02-28','2025-03-31']);
  assert.equal(details.payableSchedule(1,2,'2024-01-31')[1].due_date,'2024-02-29');
  for(const [amount,count,date] of [[0,2,'2026-01-01'],[0.01,2,'2026-01-01'],[1,121,'2026-01-01'],[1,1.5,'2026-01-01'],[1,2,'2026-02-30']])
    assert.equal(details.payableSchedule(amount,count,date).length,0);
});

test('monthly expenses use installment values and due dates, never the purchase total or purchase date twice',()=>{
  const accounts=details.payableSchedule(100,3,'2026-10-10').map((item,index)=>payable({
    id:'part-'+index,amount:item.amount,paid_amount:0,status:'aberta',due_date:item.due_date,
    purchased_on:'2026-09-30',purchase_id:'purchase',installment_number:index+1,installment_count:3,purchase_total:100,payment_method:'cartao_credito',
  }));
  const october=helpers.buildBusinessIntelligence(input({period:'selectedMonth',selectedMonth:'2026-10',payables:accounts,rmas:[]}));
  assert.equal(october.result.expenses,33.34);assert.equal(october.result.result,26.66);
  assert.equal(helpers.buildBusinessIntelligence(input({period:'selectedMonth',selectedMonth:'2026-11',payables:accounts,rmas:[]})).result.expenses,33.33);
});

test('a purchase creates only its installments atomically and exact retries preserve paid balances and methods', async () => {
  const db = new PGlite(), owner=randomUUID(), other=randomUUID(), branch=randomUUID(), foreignBranch=randomUUID(), purchase=randomUUID();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA partner_subscription_private;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
      CREATE FUNCTION partner_subscription_private.require_actor(text) RETURNS void LANGUAGE plpgsql AS $$
        BEGIN IF current_setting('test.blocked',true)='true' THEN RAISE EXCEPTION 'Acesso bloqueado'; END IF; END $$;
      CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${owner}'),('${other}');
      CREATE TABLE partner_branches(id uuid PRIMARY KEY,user_id uuid);
      INSERT INTO partner_branches VALUES('${branch}','${owner}'),('${foreignBranch}','${other}');
      CREATE TABLE partner_suppliers(id uuid PRIMARY KEY,user_id uuid);`);
    await db.exec(readFileSync(new URL('../migrations/20261007055110_add_partner_payables.sql',import.meta.url),'utf8'));
    const legacy=randomUUID();
    await db.query(`INSERT INTO partner_payables(id,user_id,branch_id,description,creditor_name,category,amount,due_date)
      VALUES($1,$2,$3,'Antiga','Credor','outros',10,current_date)`,[legacy,owner,branch]);
    await db.exec(readFileSync(new URL('../migrations/20261114163617_payable_payment_date.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('../migrations/20261114180005_payable_purchase_details.sql',import.meta.url),'utf8'));
    const {today,old,future}=(await db.query(`SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today,
      ((now() AT TIME ZONE 'America/Sao_Paulo')::date-40)::text AS old,((now() AT TIME ZONE 'America/Sao_Paulo')::date+1)::text AS future`)).rows[0];
    const installments=[{id:randomUUID(),amount:33.34,due_date:today},{id:randomUUID(),amount:33.33,due_date:today},{id:randomUUID(),amount:33.33,due_date:today}];
    const create=({id=purchase,parts=installments,total=100,date=old,method='cartao_credito',detail=null,selectedBranch=branch}={})=>
      db.query('SELECT create_partner_payable_purchase($1,$2,null,$3,$4,$5,$6,$7::date,$8,$9,$10::jsonb)',
        [id,selectedBranch,'Compra de teste','Fornecedor','fornecedor',total,date,method,detail,JSON.stringify(parts)]);
    const login=id=>db.query("SELECT set_config('test.uid',$1,false)",[id??'']);
    await db.exec('SET ROLE anon'); await assert.rejects(create(),/permission denied/);
    await db.exec('SET ROLE authenticated'); await assert.rejects(create(),/Não autenticado/);
    await login(other); await assert.rejects(create(),/Filial/); await login(owner);
    await assert.rejects(create({selectedBranch:foreignBranch}),/Filial/);
    await db.exec("SELECT set_config('test.blocked','true',false)"); await assert.rejects(create(),/Acesso bloqueado/);
    await db.exec("SELECT set_config('test.blocked','false',false)");
    for(const date of [null,future,'infinity','2026-02-30'])await assert.rejects(create({date}));
    await assert.rejects(create({method:'invalido'}),/Forma/); await assert.rejects(create({method:'outro'}),/Forma/);
    await assert.rejects(create({total:101}),/somar/);
    await assert.rejects(create({parts:[installments[0],installments[0]],total:66.68}),/únicos/);
    const invalidId=randomUUID();
    await assert.rejects(create({id:invalidId,parts:installments.map((item,i)=>({...item,id:randomUUID(),due_date:i===2?'2026-02-30':today}))}));
    await create(); await create();
    await assert.rejects(create({method:'pix'}),/diverge/);
    await assert.rejects(create({parts:installments.map((item,i)=>({...item,due_date:i===2?old:today}))}),/diverge/);
    await db.exec('RESET ROLE');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM partner_payables WHERE purchase_id=$1',[invalidId])).rows[0].n,0);
    const totals=(await db.query('SELECT count(*)::int AS n,sum(amount)::text AS total,sum(paid_amount)::text AS paid FROM partner_payables WHERE purchase_id=$1',[purchase])).rows[0];
    assert.deepEqual(totals,{n:3,total:'100.00',paid:'0.00'});
    const rows=(await db.query('SELECT purchased_on::text,payment_method,installment_number,installment_count,purchase_total::text FROM partner_payables WHERE purchase_id=$1 ORDER BY installment_number',[purchase])).rows;
    assert.equal(rows[0].purchased_on,old);assert.equal(rows[0].payment_method,'cartao_credito');assert.equal(rows[2].installment_number,3);assert.equal(rows[2].installment_count,3);
    const oldRow=(await db.query('SELECT purchased_on,payment_method,purchase_id FROM partner_payables WHERE id=$1',[legacy])).rows[0];
    assert.deepEqual(oldRow,{purchased_on:null,payment_method:null,purchase_id:null});
    await db.exec('SET ROLE authenticated');
    const token=randomUUID();
    const pay=(method='pix',amount=10,date=old,id=token,detail=null)=>db.query('SELECT record_partner_payable_payment_details($1,$2,$3,$4::date,$5,$6)',
      [installments[0].id,amount,id,date,method,detail]);
    await pay(); await pay(); await assert.rejects(pay('cartao_debito'),/diverge/);
    await assert.rejects(pay('pix',10,future,randomUUID()),/data real/);
    await assert.rejects(pay('pix',24,old,randomUUID()),/saldo/);
    await pay('cartao_debito',23.34,today,randomUUID());
    await create();
    await db.exec('RESET ROLE');
    const paid=(await db.query('SELECT paid_amount::text,status,payment_method FROM partner_payables WHERE id=$1',[installments[0].id])).rows[0];
    assert.deepEqual(paid,{paid_amount:'33.34',status:'paga',payment_method:'cartao_credito'});
    const history=(await db.query(`SELECT payment_method,(paid_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS day,
      (created_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS registered FROM partner_payable_payments WHERE id=$1`,[token])).rows[0];
    assert.deepEqual(history,{payment_method:'pix',day:old,registered:today});
    assert.equal((await db.query('SELECT count(*)::int AS n FROM partner_payable_payments WHERE payable_id=$1',[installments[0].id])).rows[0].n,2);
    await db.exec('SET ROLE authenticated');
    for(const method of ['pix','dinheiro','cartao_debito','cartao_credito','boleto','transferencia','cheque','outro']){
      await db.query('SELECT record_partner_payable_payment_details($1,1,$2,$3::date,$4,$5)',
        [installments[1].id,randomUUID(),today,method,method==='outro'?'Pagamento por carteira digital':null]);
    }
    await assert.rejects(db.query('SELECT record_partner_payable_payment_details($1,1,$2,$3::date,$4,$5)',
      [installments[1].id,randomUUID(),today,'outro','']),/Forma/);
    await db.exec('RESET ROLE');
    await login(other);await db.exec('SET ROLE authenticated');await assert.rejects(pay('pix',1,old,randomUUID()),/acesso negado/);
  } finally { await db.close(); }
});
