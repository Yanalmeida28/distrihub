import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { helpers, input, sale, payable } from './fixtures/business_intelligence_helpers.mjs';

const migration = '20261115224005_payable_expense_behavior.sql';
const settings = { aluguel: '', energia: '', salarios: '', impostos: '', outros: 'variable', desired: 0 };
test('individual fixed/variable choices override category defaults, while legacy amounts retain the saved category behavior', () => {
  const model = helpers.buildBusinessIntelligence(input({ period: 'selectedMonth', selectedMonth: '2026-10', rmas: [],
    sales: [sale({ total: 1000, cost_snapshot: { p: 100 } })],
    payables: [payable({ id: 'fixed', category: 'outros', amount: 100, expense_behavior: 'fixed', due_date: '2026-10-10' }),
      payable({ id: 'variable', category: 'outros', amount: 50, expense_behavior: 'variable', due_date: '2026-10-10' }),
      payable({ id: 'legacy', category: 'outros', amount: 25, due_date: '2026-10-10' }),
      payable({ id: 'stock', category: 'fornecedor', amount: 500, due_date: '2026-10-10' }),
      payable({ id: 'cancelled', category: 'outros', amount: 900, status: 'cancelada', expense_behavior: 'variable', due_date: '2026-10-10' }),
      payable({ id: 'foreign', user_id: 'other', category: 'outros', amount: 900, expense_behavior: 'fixed', due_date: '2026-10-10' })] }));
  assert.equal(model.result.expenses, 175); assert.equal(model.result.purchases, 500);
  const category = model.result.categories[0];
  assert.equal(category.fixedAmount, 100); assert.equal(category.variableAmount, 50); assert.equal(category.unclassifiedAmount, 25);
  const calculation = helpers.registeredBreakEven(model.result, settings);
  assert.equal(calculation.error, ''); assert.equal(calculation.result.fixed, 100); assert.equal(calculation.result.variable, 75);
  assert.equal(calculation.result.margin, 72.5); assert.ok(Math.abs(calculation.result.breakEven - 100 / 0.725) < 1e-8);
  assert.match(helpers.registeredBreakEven(model.result, { ...settings, outros: '' }).error, /Classifique/);
  const explicitOnly = { ...model.result, categories: [{ ...category, amount: 150, unclassifiedAmount: 0 }] };
  assert.equal(helpers.registeredBreakEven(explicitOnly, { ...settings, outros: '' }).result.fixed, 100);
  const invalid = helpers.buildBusinessIntelligence(input({ rmas: [], payables: [payable({ due_date: '2026-10-10', expense_behavior: 'bad' })] }));
  assert.equal(invalid.result.invalidExpenses, 1); assert.equal(invalid.result.result, null);
});

test('expense classification persists in installments, validates exact retries and edits with audit without changing payments or old rows', async () => {
  const db = new PGlite(), owner = randomUUID(), other = randomUUID(), branch = randomUUID();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA partner_subscription_private;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
      GRANT USAGE ON SCHEMA auth TO anon,authenticated;
      CREATE FUNCTION partner_subscription_private.require_actor(text) RETURNS void LANGUAGE plpgsql AS $$
        BEGIN IF current_setting('test.blocked',true)='true' THEN RAISE EXCEPTION 'Acesso bloqueado'; END IF; END $$;
      CREATE FUNCTION partner_has_saas_access(uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
      CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${owner}'),('${other}');
      CREATE TABLE partner_branches(id uuid PRIMARY KEY,user_id uuid); INSERT INTO partner_branches VALUES('${branch}','${owner}');
      CREATE TABLE partner_suppliers(id uuid PRIMARY KEY,user_id uuid);`);
    for (const name of ['20261007055110_add_partner_payables.sql','20261114163617_payable_payment_date.sql','20261114180005_payable_purchase_details.sql','20261114183102_payable_edit_and_exclusion.sql'])
      await db.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'));
    const legacy = randomUUID();
    await db.query("INSERT INTO partner_payables(id,user_id,branch_id,description,creditor_name,category,amount,due_date) VALUES($1,$2,$3,'Legacy','Credor','outros',10,current_date)", [legacy,owner,branch]);
    await db.exec(readFileSync(new URL('../migrations/' + migration, import.meta.url), 'utf8'));
    const get = async id => (await db.query('SELECT * FROM partner_payables WHERE id=$1', [id])).rows[0];
    assert.equal((await get(legacy)).expense_behavior, null);
    const day = (await db.query("SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date-2)::text AS day")).rows[0].day;
    const purchase = randomUUID(), ids = [randomUUID(), randomUUID()];
    const parts = ids.map(id => ({ id, amount: 50, due_date: day, expense_behavior: 'variable' }));
    const create = (rows=parts, category='outros', token=purchase) => db.query("SELECT create_partner_payable_purchase($1,$2,null,'Despesa','Credor',$3,100,$4::date,'pix',null,$5::jsonb)", [token,branch,category,day,JSON.stringify(rows)]);
    const login = id => db.query("SELECT set_config('test.uid',$1,false)", [id]);
    await db.exec('SET ROLE anon'); await assert.rejects(create(), /permission denied/);
    await db.exec('SET ROLE authenticated'); await login(other); await assert.rejects(create(), /Filial/);
    await login(owner); await db.exec("SELECT set_config('test.blocked','true',false)"); await assert.rejects(create(), /bloqueado/);
    await db.exec("SELECT set_config('test.blocked','false',false)");
    await create(); await create();
    assert.equal((await get(ids[0])).expense_behavior, 'variable'); assert.equal((await get(ids[1])).expense_behavior, 'variable');
    await assert.rejects(create(parts.map(row => ({ ...row, expense_behavior: 'fixed' }))), /diverge/);
    const invalidIds = [randomUUID(),randomUUID()];
    await assert.rejects(create(parts.map((row,i) => ({ ...row, id: invalidIds[i], expense_behavior: i ? 'bad' : 'fixed' })), 'outros', randomUUID()), /Tipo de despesa/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM partner_payables WHERE id=ANY($1::uuid[])', [invalidIds])).rows[0].n, 0);
    await assert.rejects(create(parts.map(row => ({ ...row, id: randomUUID() })), 'fornecedor', randomUUID()), /Tipo de despesa/);
    await db.query("SELECT record_partner_payable_payment_details($1,20,$2,$3::date,'pix',null)", [ids[0],randomUUID(),day]);
    const before = await get(ids[0]), token = randomUUID();
    const edit = (behavior, request=token) => db.query("SELECT manage_partner_payable($1,'edit',$2::jsonb,$3,$4,'Classificacao conferida')", [ids[0],JSON.stringify({ expense_behavior: behavior }),before.revision,request]);
    await login(other); await assert.rejects(edit('fixed'), /acesso negado/); await login(owner);
    await edit('fixed'); await edit('fixed');
    const after = await get(ids[0]); assert.equal(after.expense_behavior, 'fixed'); assert.equal(after.amount, before.amount); assert.equal(after.paid_amount, before.paid_amount); assert.equal(after.status, before.status);
    const event = (await db.query('SELECT before_record,after_record FROM partner_payable_changes WHERE id=$1', [token])).rows[0];
    assert.equal(event.before_record.expense_behavior, 'variable'); assert.equal(event.after_record.expense_behavior, 'fixed');
    await assert.rejects(edit('variable'), /diverge/); await assert.rejects(edit('variable', randomUUID()), error => error.code==='40001');
    assert.equal((await get(ids[1])).expense_behavior, 'variable'); assert.equal((await get(legacy)).expense_behavior, null);
    const latest = await get(ids[0]);
    await assert.rejects(db.query("SELECT manage_partner_payable($1,'edit',$2::jsonb,$3,$4,'Invalida')", [ids[0],JSON.stringify({ expense_behavior: 'bad' }),latest.revision,randomUUID()]), /Tipo de despesa/);
  } finally { await db.close(); }
});
