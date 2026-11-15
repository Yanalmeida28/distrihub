import { intelligenceHarness } from './fixtures/business_intelligence_helpers.mjs';
import { pdvHelpers } from './fixtures/pdv_helpers.mjs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../../src/lib/reportMetrics.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const metrics = {};
vm.runInNewContext(compiled, {exports:metrics, Date, require(name){if(name==='./adminDashboard')return intelligenceHarness().load('lib/adminDashboard.ts');if(name==='./pdv')return pdvHelpers;throw Error(name);}});

function sale(overrides = {}) {
  return {
    id: 'sale-1',
    created_at: '2026-06-15T12:00:00.000Z',
    customer_name: 'Cliente',
    status: 'concluida',
    payment_method: 'pix',
    total: 100,
    items: [],
    ...overrides,
  };
}

test('reports include only completed sales and custom dates include their full final day', () => {
  const localDate = '2026-06-10';
  const insideDate = new Date(2026, 5, 10, 12).toISOString();
  const outsideDate = new Date(2026, 5, 11, 0).toISOString();
  const sales = [
    sale({ id: 'inside', created_at: insideDate }),
    sale({ id: 'outside', created_at: outsideDate }),
    sale({ id: 'cancelled', status: 'cancelada', created_at: insideDate }),
  ];

  assert.deepEqual(
    metrics.filterReportSales(sales, 'custom', localDate, localDate).map(({ id }) => id),
    ['inside'],
  );
  assert.equal(metrics.filterReportSales(sales, 'custom', '2026-06-31', '2026-07-01').length, 0);
  assert.equal(metrics.completedSalesOnly(sales).some(({ id }) => id === 'cancelled'), false);
});

test('mixed product and service orders split item revenue without duplicating total sale', () => {
  const products = [
    { id: 'physical-svc-id', is_service: false },
    { id: 'service-1', is_service: true },
  ];
  const mixed = sale({
    total: 150,
    items: [
      { product_id: 'physical-svc-id', quantity: 2, unit_price: 50 },
      { product_id: 'service-1', quantity: 1, unit_price: 50 },
      { product_id: 'legacy-svc-item', quantity: 1, unit_price: 25 },
    ],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(metrics.getItemRevenueByType([mixed], products))), {
    productRevenue: 100,
    serviceRevenue: 75,
    productSalesCount: 1,
    serviceSalesCount: 1,
  });
});

test('cost of goods sold ignores services and multiplies cost by quantity', () => {
  const products = [
    { id: 'p1', is_service: false, cost_price: 12 },
    { id: 's1', is_service: true, cost_price: 99 },
  ];
  const order = sale({ items: [
    { product_id: 'p1', quantity: 3, unit_price: 20 },
    { product_id: 's1', quantity: 1, unit_price: 30 },
    { product_id: 'missing', quantity: 5, unit_price: 10 },
  ] });

  assert.equal(metrics.getCostOfGoodsSold([order], products), 36);
});

test('birthday month parsing does not shift ISO dates across time zones', () => {
  assert.equal(metrics.birthdayMonth('2000-01-01T00:00:00.000Z'), 0);
  assert.equal(metrics.birthdayMonth('invalid'), null);
});

test('CSV escapes formula-like text and quotes safely', () => {
  const csv = metrics.buildSalesCsv([sale({ customer_name: '=HYPERLINK("x")' })]);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /;"PIX";"100\.00"/);
});
