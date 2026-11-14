import assert from 'node:assert/strict';
import { test } from 'node:test';
import { helpers as h, sale, product, invoice, payable, input } from './fixtures/business_intelligence_helpers.mjs';

test('calendar months include complete months, leap days and the year boundary in Sao Paulo', () => {
  for (const [now, period, selectedMonth, first, last, days] of [
    ['2026-01-01T02:00:00Z', 'previousMonth', '', '2025-11-01', '2025-11-30', 30],
    ['2026-01-01T12:00:00Z', 'previousMonth', '', '2025-12-01', '2025-12-31', 31],
    ['2026-10-19T12:00:00Z', 'selectedMonth', '2024-02', '2024-02-01', '2024-02-29', 29],
    ['2026-10-19T12:00:00Z', 'selectedMonth', '2025-02', '2025-02-01', '2025-02-28', 28],
  ]) {
    const result = h.buildBusinessIntelligence(input({ now: new Date(now), period, selectedMonth }));
    assert.equal(result.periodError, ''); assert.equal(result.first, first); assert.equal(result.last, last); assert.equal(result.periodDays, days);
  }
});

test('monthly results include a late registered expense by original due date, while cash uses the payment date', () => {
  const data = input({ now: new Date('2026-11-14T12:00:00Z'), period: 'selectedMonth', selectedMonth: '2026-10', rmas: [],
    sales: [sale({ completed_at: '2026-11-01T02:59:59Z' }), sale({ id: 'next', completed_at: '2026-11-01T03:00:00Z', total: 999 })],
    payables: [payable({ amount: 30, paid_amount: 30, status: 'paga', due_date: '2026-10-15', created_at: '2026-11-14T12:00:00Z' })],
    payments: [{ id: 'payment', user_id: 'company', payable_id: 'bill', amount: 30, created_at: '2026-11-14T12:00:00Z' }],
  });
  const october = h.buildBusinessIntelligence(data);
  assert.equal(october.currentRevenue, 100); assert.equal(october.result.expenses, 30); assert.equal(october.result.result, 30); assert.equal(october.paid, 0);
  const november = h.buildBusinessIntelligence({ ...data, selectedMonth: '2026-11' });
  assert.equal(november.result.expenses, 0); assert.equal(november.paid, 30);
});

test('custom periods include both selected days and reject missing, impossible and reversed dates', () => {
  const selected = h.buildBusinessIntelligence(input({ period: 'custom', customStart: '2026-10-10', customEnd: '2026-10-10' }));
  assert.equal(selected.periodDays, 1); assert.equal(selected.currentRevenue, 100);
  for (const patch of [
    { period: 'selectedMonth', selectedMonth: '' }, { period: 'selectedMonth', selectedMonth: '2026-13' },
    { period: 'custom', customStart: '', customEnd: '2026-10-10' },
    { period: 'custom', customStart: '2026-02-30', customEnd: '2026-10-10' },
    { period: 'custom', customStart: '2026-10-11', customEnd: '2026-10-10' },
  ]) assert.ok(h.buildBusinessIntelligence(input(patch)).periodError);
});

test('historical cost wins over current cost; freight, open orders and cancelled sales are excluded from revenue', () => {
  const result = h.buildBusinessIntelligence(input({ sales: [sale(), sale({ id: 'open', status: 'pre_venda', total: 900 }), sale({ id: 'cancel', status: 'cancelada', total: 900 })] }));
  assert.equal(result.currentRevenue, 100);
  assert.equal(result.profit, 60);
  assert.equal(result.margin, 60);
  assert.equal(result.quality.estimatedSales, 0);
  assert.equal(result.received, 120);
});
test('missing historical cost uses the current price with a warning, missing current cost prevents a fictitious profit', () => {
  const estimated = h.buildBusinessIntelligence(input({ sales: [sale({ cost_snapshot: null })] }));
  assert.equal(estimated.profit, 40);
  assert.equal(estimated.quality.estimatedSales, 1);
  const missing = h.buildBusinessIntelligence(input({ sales: [sale({ cost_snapshot: null })], products: [] }));
  assert.equal(missing.profit, null);
  assert.equal(missing.margin, null);
  assert.equal(missing.quality.unknown, 1);
});
test('zero is a valid recorded cost but is counted for review; invalid snapshot falls back explicitly', () => {
  const zero = h.buildBusinessIntelligence(input({ sales: [sale({ cost_snapshot: { p: 0 } })], products: [product({ cost_price: 0 })] }));
  assert.equal(zero.profit, 100);
  assert.equal(zero.quality.estimatedSales, 0);
  assert.equal(zero.quality.zeroCostLines, 1);
  assert.equal(zero.zeroCostProducts, 1);
  const invalid = h.buildBusinessIntelligence(input({ sales: [sale({ cost_snapshot: { p: NaN } })] }));
  assert.equal(invalid.profit, 40);
  assert.equal(invalid.quality.estimatedSales, 1);
});
test('missing payables are unknown expenses and projections, never a zero outgoing or a net profit', () => {
  const result = h.buildBusinessIntelligence(input());
  assert.equal(result.paid, null);
  assert.equal(result.payable, null);
  assert.equal(result.forecast.expenseData, false);
  for (const window of result.forecast.windows) { assert.equal(window.outgoing, null); assert.equal(window.change, null); }
  assert.equal('netProfit' in result, false);
});
test('company and branch isolation reject injected rows, branchless finance is consolidated only', () => {
  const result = h.buildBusinessIntelligence(input({ sales: [sale(), sale({ id: 'foreign', user_id: 'other', total: 999 }), sale({ id: 'B', branch_id: 'B', total: 888 })],
    products: [product(), product({ id: 'foreign', user_id: 'other', cost_price: 1000 })],
    invoices: [invoice(), invoice({ id: 'foreign', user_id: 'other' }), invoice({ id: 'B', branch_id: 'B' }), invoice({ id: 'unassigned', branch_id: null })],
    payables: [payable({ user_id: 'other' })], receipts: [{ id: 'r', user_id: 'other', branch_id: 'A', invoice_id: 'i', amount: 999 }] }));
  assert.equal(result.currentRevenue, 100); assert.equal(result.receivable, 75); assert.equal(result.paid, null); assert.equal(result.received, 120);
  const consolidated = h.buildBusinessIntelligence(input({ branch: '', invoices: [invoice(), invoice({ id: 'unassigned', branch_id: null })] }));
  assert.equal(consolidated.receivable, 150);
  assert.equal(h.intelligenceScope([sale()], '', '').length, 0);
});
test('forecast windows include today and day 6/14/29 only, split overdue, and respect partial/cancelled balances', () => {
  const result = h.businessForecast([invoice(), invoice({ id: 'last7', amount: 10, paid_amount: 0, due_date: '2026-10-25' }), invoice({ id: 'after7', amount: 20, paid_amount: 0, due_date: '2026-10-26' }), invoice({ id: 'day30', amount: 30, paid_amount: 0, due_date: '2026-11-17' }), invoice({ id: 'beyond', due_date: '2026-11-18' }), invoice({ id: 'old', due_date: '2026-10-18' }), invoice({ id: 'cancel', status: 'cancelada' }), invoice({ id: 'undated', due_date: null })], [payable()], '2026-10-19');
  assert.deepEqual(Array.from(result.windows, window => window.incoming), [85, 105, 135]);
  assert.deepEqual(Array.from(result.windows, window => window.outgoing), [150, 150, 150]);
  assert.equal(result.overdueIncoming, 75); assert.equal(result.overdueOutgoing, 0); assert.equal(result.undated, 1);
});
test('cash receipts are not duplicated with billed sales, supplier payments do not reduce gross profit twice, credits are not receipts', () => {
  const result = h.buildBusinessIntelligence(input({ sales: [sale({ payment_method: 'faturado' })],
    invoices: [invoice({ sale_id: 's', paid_amount: 50, return_credit_amount: 25 })], payables: [payable()],
    receipts: [{ id: 'r', user_id: 'company', branch_id: 'A', invoice_id: 'i', amount: 25, occurred_at: '2026-10-10T12:00:00Z' }],
    payments: [{ id: 'payment', user_id: 'company', payable_id: 'bill', amount: 50, created_at: '2026-10-10T12:00:00Z' }],
    refunds: [{ id: 'refund', user_id: 'company', branch_id: 'A', refund_amount: 10, refunded_at: '2026-10-10T12:00:00Z' }] }));
  assert.equal(result.received, 25); assert.equal(result.paid, 50); assert.equal(result.refunded, 10); assert.equal(result.profit, 60); assert.equal(result.receivable, 50);
  assert.equal(result.expenseCategories[0].category, 'aluguel'); assert.equal(result.expenseCategories[0].amount, 50);
});
test('periods use Sao Paulo completion dates and do not include today or another branch customer history', () => {
  const result = h.buildBusinessIntelligence(input({ sales: [sale({ completed_at: '2026-10-19T02:59:59Z' }), sale({ id: 'today', completed_at: '2026-10-19T03:00:00Z' })] }));
  assert.equal(result.currentRevenue, 100); assert.equal(result.first, '2026-09-19'); assert.equal(result.last, '2026-10-18');
});
test('comparisons need reference coverage and five sales; explicit declines trigger auditable alerts', () => {
  assert.equal(h.buildBusinessIntelligence(input()).growth, null);
  const reference = Array.from({ length: 5 }, (_, index) => sale({ id: 'prev'+index, completed_at: '2026-09-01T12:00:00Z', cost_snapshot: { p: 10 } }));
  const result = h.buildBusinessIntelligence(input({ sales: [...reference, sale({ completed_at: '2026-08-01T12:00:00Z' }), sale({ cost_snapshot: { p: 40 } })] }));
  assert.equal(result.growth, -80);
  assert.ok(result.alerts.some(alert => alert.id === 'sales')); assert.ok(result.alerts.some(alert => alert.id === 'margin'));
});
test('inactive customers are separated from customers who never purchased; no automated task is produced', () => {
  const result = h.buildBusinessIntelligence(input({ customers: [{ id: 'old', user_id: 'company', branch_id: 'A' }, { id: 'new', user_id: 'company', branch_id: null }, { id: 'foreign', user_id: 'other' }],
    sales: [sale({ customer_id: 'old', completed_at: '2026-07-01T12:00:00Z' })] }));
  assert.equal(result.inactiveCount, 1); assert.equal(result.neverPurchased, 1);
  assert.ok(result.alerts.some(alert => alert.id === 'customers')); assert.equal('tasks' in result, false);
});
test('simulation requires explicit premises, contribution is not inferred from gross margin, and invalid or huge inputs fail closed', () => {
  assert.equal(h.simulateBusinessGoal('', '', '', '', 100).result, null);
  const valid = h.simulateBusinessGoal('1000', '25', '500', '8000', 2000).result;
  assert.equal(valid.breakEven, 4000); assert.equal(valid.requiredRevenue, 6000); assert.equal(valid.objective, 8000); assert.equal(valid.remaining, 6000);
  assert.equal(h.simulateBusinessGoal('0', '50', '0', '', 100).result.breakEven, 0);
  for (const [fixed, rate, desired] of [['1','0','0'], ['1','-5','0'], ['1','101','0'], ['1e99','25','0'], ['999999999999999999','25','0'], ['1','25','-1']]) assert.equal(h.simulateBusinessGoal(fixed,rate,desired,'',0).result,null);
  assert.equal(h.simulateBusinessGoal('10,50','25','0','',null).result.remaining,null);
});
test('access requires proprietor operating as proprietor and all three existing SaaS/module entitlements', () => {
  const modules = ['administrativo', 'financeiro', 'relatorios'];
  assert.equal(h.canViewBusinessIntelligence(true,true,modules),true);
  assert.equal(h.canViewBusinessIntelligence(false,true,modules),false);
  assert.equal(h.canViewBusinessIntelligence(true,false,modules),false);
  for (const blocked of modules) assert.equal(h.canViewBusinessIntelligence(true,true,modules.filter(module=>module!==blocked)),false);
});
