import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { helpers as h, input, sale, payable } from './fixtures/business_intelligence_helpers.mjs';

const settings = { aluguel: 'fixed', energia: 'fixed', salarios: 'fixed', impostos: 'variable', outros: 'variable', desired: 500 };
const model = patch => h.buildBusinessIntelligence(input({ period: 'selectedMonth', selectedMonth: '2026-10', rmas: [],
  sales: [sale({ total: 10000, cost_snapshot: { p: 2500 } })],
  payables: [payable({ amount: 1000, due_date: '2026-10-10' }), payable({ id: 'tax', category: 'impostos', amount: 1000, due_date: '2026-10-15' }),
    payable({ id: 'stock', category: 'fornecedor', amount: 9000, due_date: '2026-10-15' }),
    payable({ id: 'deleted', amount: 9999, status: 'cancelada', due_date: '2026-10-10' }), payable({ id: 'next', amount: 8888, due_date: '2026-11-10' })], ...patch }));

test('registered break even uses classified due-date expenses, sold cost and net revenue without double counting stock or payments', () => {
  const result = h.registeredBreakEven(model().result, settings);
  assert.equal(result.error, ''); assert.equal(result.result.fixed, 1000); assert.equal(result.result.variable, 1000);
  assert.equal(result.result.margin, 40); assert.equal(result.result.breakEven, 2500);
  assert.equal(result.result.requiredRevenue, 3750); assert.equal(result.result.remaining, 0);
  assert.equal(h.registeredBreakEven(model({ branch: 'B' }).result, settings).result, null);
  const unknown = h.registeredBreakEven(model().result, { ...settings, impostos: '' });
  assert.match(unknown.error, /Classifique/);
  assert.equal(h.registeredBreakEven(model({ payables: [] }).result, settings).result.breakEven, 0);
});

test('break even refuses incomplete data, invalid premises and nonpositive contribution', () => {
  const data = model().result;
  for (const patch of [{ netRevenue: 0 }, { netCost: null }, { returnsKnown: false }, { undatedExpenses: 1 }, { invalidExpenses: 1 }, { netCost: 10000 }, { netCost: -5000 }])
    assert.equal(h.registeredBreakEven({ ...data, ...patch }, settings).result, null);
  for (const desired of [NaN, Infinity, -1, 1e13]) assert.equal(h.registeredBreakEven(data, { ...settings, desired }).result, null);
  const lowerRevenue = h.registeredBreakEven({ ...data, netRevenue: 2000, netCost: 0 }, settings).result;
  assert.equal(lowerRevenue.breakEven, 2000); assert.equal(lowerRevenue.remaining, 0);
  const returns = h.registeredBreakEven({ ...data, netRevenue: 8000, netCost: 4000 }, settings).result;
  assert.equal(returns.margin, 37.5); assert.ok(Math.abs(returns.breakEven - 2666.6666667) < 0.001);
});

test('saved settings are isolated by owner and branch, idempotently upserted and reject unauthorized or invalid values', async () => {
  const db = new PGlite(), owner = randomUUID(), other = randomUUID(), branch = randomUUID(), sibling = randomUUID();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      grant usage on schema auth to authenticated;
      create function partner_has_saas_access(uuid,text) returns boolean language sql as $$select coalesce(current_setting('test.blocked',true),'false') <> 'true'$$;
      create table auth.users(id uuid primary key); insert into auth.users values('${owner}'),('${other}');
      create table partner_branches(id uuid primary key,user_id uuid); insert into partner_branches values('${branch}','${owner}'),('${sibling}','${other}');
      grant select on partner_branches to authenticated;`);
    await db.exec(readFileSync(new URL('../migrations/20261114190450_break_even_settings.sql', import.meta.url), 'utf8'));
    await db.query("select set_config('test.uid',$1,false)", [owner]);
    await db.exec('set role authenticated');
    const save = (user, scope, desired = 500) => db.query("insert into partner_break_even_settings(user_id,scope,aluguel,desired) values($1,$2,'fixed',$3) on conflict(user_id,scope) do update set desired=excluded.desired", [user, scope, desired]);
    await save(owner, branch); await save(owner, branch, 600); await save(owner, 'all', 700);
    assert.equal((await db.query('select * from partner_break_even_settings')).rows.length, 2);
    assert.equal(Number((await db.query('select desired from partner_break_even_settings where scope=$1', [branch])).rows[0].desired), 600);
    await assert.rejects(save(other, 'all'), /row-level security/);
    await assert.rejects(save(owner, sibling), /row-level security/);
    await assert.rejects(save(owner, 'invalid'), /row-level security|check constraint/);
    await assert.rejects(save(owner, branch, -1), /check constraint/);
    await db.query("select set_config('test.uid',$1,false)", [other]);
    assert.equal((await db.query('select * from partner_break_even_settings')).rows.length, 0);
    await db.query("select set_config('test.uid',$1,false)", [owner]);
    await db.exec("select set_config('test.blocked','true',false)");
    assert.equal((await db.query('select * from partner_break_even_settings')).rows.length, 0);
    await assert.rejects(save(owner, 'all'), /row-level security/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from partner_break_even_settings'), /permission denied/);
  } finally { await db.close(); }
});
