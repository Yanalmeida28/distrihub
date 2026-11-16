import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { helpers, input, sale, payable, intelligenceHarness } from './fixtures/business_intelligence_helpers.mjs';

test('withdrawals stay in cash at payment time and out of operating result and break-even, scoped by company and branch', () => {
  const accounts = [payable({ id:'water', category:'outros', amount:50, paid_amount:0, status:'aberta', expense_behavior:'fixed', due_date:'2026-10-10' }),
    payable({ id:'personal', category:'retirada', creditor_name:'Maria', amount:300, paid_amount:100, due_date:'2026-09-10' }),
    payable({ id:'planned', category:'retirada', creditor_name:'Ana', amount:200, paid_amount:0, status:'aberta', due_date:'2026-10-10' }),
    payable({ id:'foreign', category:'retirada', user_id:'other', amount:900, paid_amount:900, status:'paga', due_date:'2026-10-10' }),
    payable({ id:'branch', category:'retirada', branch_id:'B', amount:800, paid_amount:0, status:'aberta', due_date:'2026-10-10' }),
    payable({ id:'cancelled', category:'retirada', amount:700, paid_amount:0, status:'cancelada', due_date:'2026-10-10' })];
  const payments = [{id:'p',user_id:'company',payable_id:'personal',amount:100,created_at:'2026-11-01T12:00:00Z',paid_at:'2026-10-11T12:00:00Z'},
    {id:'void',user_id:'company',payable_id:'planned',amount:200,created_at:'2026-10-11T12:00:00Z',voided_at:'2026-10-12T12:00:00Z'},
    {id:'foreign',user_id:'other',payable_id:'foreign',amount:900,created_at:'2026-10-11T12:00:00Z'}];
  const args=input({period:'selectedMonth',selectedMonth:'2026-10',rmas:[],sales:[sale({total:1000})],payables:accounts,payments});
  const model=helpers.buildBusinessIntelligence(args);
  assert.equal(model.result.expenses,50); assert.equal(model.result.withdrawals,200); assert.equal(model.result.withdrawalCount,1);
  assert.equal(model.result.result,910); assert.equal(model.paidWithdrawals,100); assert.equal(model.cashResult,920);
  assert.equal(model.withdrawalRecipients.length,1); assert.equal(model.withdrawalRecipients[0].recipient,'Maria'); assert.equal(model.withdrawalRecipients[0].amount,100);
  const point=helpers.registeredBreakEven(model.result,{aluguel:'',energia:'',salarios:'',impostos:'',outros:'',desired:0});
  assert.equal(point.error,''); assert.equal(point.result.fixed,50); assert.equal(point.result.variable,0);
  const consolidated=helpers.buildBusinessIntelligence({...args,branch:''}); assert.equal(consolidated.result.withdrawals,1000);
  const mismatch=helpers.buildBusinessIntelligence({...args,payments:[]}); assert.equal(mismatch.paidWithdrawals,null); assert.equal(mismatch.withdrawalRecipients.length,0);
  const harness=intelligenceHarness(), flow=harness.load('lib/financialFlow.ts');
  const cash=flow.actualFinancialFlow([],[],[],payments.slice(0,1),accounts,[]); assert.equal(cash.length,1); assert.equal(cash[0].amount,-100); assert.match(cash[0].description,/Retirada.*Maria/);
  const projected=flow.projectedFinancialFlow([],accounts.slice(0,3)); assert.equal(projected.find(row=>row.id==='payable-personal').amount,-200);
  const summary=harness.load('lib/accounts.ts').withdrawalSummary(accounts.filter(row=>row.user_id==='company'&&row.branch_id==='A'));
  assert.equal(summary.length,2); assert.equal(summary[0].recipient,'Maria'); assert.equal(summary[0].paid,100); assert.equal(summary[0].open,200);
});

test('withdrawal creation, correction of paid legacy accounts, revisions and isolation preserve existing payments', async () => {
  const db=new PGlite(),owner=randomUUID(),other=randomUUID(),branch=randomUUID();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA partner_subscription_private;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
      GRANT USAGE ON SCHEMA auth TO anon,authenticated;
      CREATE FUNCTION partner_subscription_private.require_actor(text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF current_setting('test.blocked',true)='true' THEN RAISE EXCEPTION 'Acesso bloqueado'; END IF; END$$;
      CREATE FUNCTION partner_has_saas_access(uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
      CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${owner}'),('${other}');
      CREATE TABLE partner_branches(id uuid PRIMARY KEY,user_id uuid); INSERT INTO partner_branches VALUES('${branch}','${owner}');
      CREATE TABLE partner_suppliers(id uuid PRIMARY KEY,user_id uuid);`);
    for (const name of ['20261007055110_add_partner_payables.sql','20261114163617_payable_payment_date.sql','20261114180005_payable_purchase_details.sql','20261114183102_payable_edit_and_exclusion.sql','20261115224005_payable_expense_behavior.sql'])
      await db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
    const legacy=randomUUID(); await db.query("INSERT INTO partner_payables(id,user_id,branch_id,description,creditor_name,category,expense_behavior,amount,due_date) VALUES($1,$2,$3,'Uso pessoal','Maria','outros','variable',100,current_date)",[legacy,owner,branch]);
    const migrations=new URL('../migrations/',import.meta.url),name=readdirSync(migrations).find(n=>n.endsWith('_owner_withdrawals.sql'));
    await db.exec(readFileSync(new URL(name,migrations),'utf8'));
    const get=async id=>(await db.query('SELECT * FROM partner_payables WHERE id=$1',[id])).rows[0];
    assert.equal((await get(legacy)).category,'outros');
    const day=(await db.query("SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date-2)::text AS day")).rows[0].day;
    const token=randomUUID(),ids=[randomUUID(),randomUUID()];
    const parts=ids.map(id=>({id,amount:50,due_date:day,expense_behavior:null}));
    const create=(rows=parts)=>db.query("SELECT create_partner_payable_purchase($1,$2,null,'Retirada pessoal','Maria','retirada',100,$3::date,'pix',null,$4::jsonb)",[token,branch,day,JSON.stringify(rows)]);
    const login=id=>db.query("SELECT set_config('test.uid',$1,false)",[id]);
    await db.exec('SET ROLE anon'); await assert.rejects(create(),/permission denied/);
    await db.exec('SET ROLE authenticated'); await login(other); await assert.rejects(create(),/Filial/);
    await login(owner); await create(); await create(); assert.equal((await get(ids[0])).category,'retirada'); assert.equal((await get(ids[1])).expense_behavior,null);
    await assert.rejects(create(parts.map(p=>({...p,expense_behavior:'variable'}))),/Tipo de despesa/);
    await db.query("SELECT record_partner_payable_payment_details($1,100,$2,$3::date,'pix',null)",[legacy,randomUUID(),day]);
    const before=await get(legacy),request=randomUUID();
    const edit=()=>db.query("SELECT manage_partner_payable($1,'edit',$2::jsonb,$3,$4,'Separar retirada pessoal')",[legacy,JSON.stringify({category:'retirada',expense_behavior:null}),before.revision,request]);
    await login(other); await assert.rejects(edit(),/acesso negado/); await login(owner);
    await db.exec("SELECT set_config('test.blocked','true',false)"); await assert.rejects(edit(),/bloqueado/); await db.exec("SELECT set_config('test.blocked','false',false)");
    await edit(); await edit(); const after=await get(legacy);
    assert.equal(after.category,'retirada'); assert.equal(after.expense_behavior,null); assert.equal(after.paid_amount,before.paid_amount); assert.equal(after.status,'paga'); assert.equal(after.amount,before.amount);
    const audit=(await db.query('SELECT before_record,after_record,payment_history FROM partner_payable_changes WHERE id=$1',[request])).rows[0];
    assert.equal(audit.before_record.category,'outros'); assert.equal(audit.after_record.category,'retirada'); assert.equal(audit.payment_history.length,1);
    await assert.rejects(db.query("SELECT manage_partner_payable($1,'edit','{}', $2,$3,'Desatualizada')",[legacy,before.revision,randomUUID()]),e=>e.code==='40001');
    await assert.rejects(db.query("SELECT manage_partner_payable($1,'edit',$2::jsonb,$3,$4,'Invalida')",[legacy,JSON.stringify({expense_behavior:'fixed'}),after.revision,randomUUID()]),/nao recebe tipo/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM partner_payable_payments WHERE payable_id=$1',[legacy])).rows[0].n,1);
  } finally { await db.close(); }
});
