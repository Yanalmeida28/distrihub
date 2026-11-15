import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { intelligenceHarness, sale, invoice, payable } from './fixtures/business_intelligence_helpers.mjs';

let renderer;
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });
const text = node => typeof node === 'string' ? node : (node.children ?? []).map(text).join('');
function fixture({ fail = false, identity = 'company', receipts = [] } = {}) {
  const calls = [];
  const client = { auth: { getUser: async () => ({ data: { user: { id: identity } }, error: null }) }, from(table) {
    calls.push(table);
    const query = { select: () => query, eq: () => query, order: () => query,
      range: async () => ({ data: table === 'partner_invoice_receipts' ? receipts : [], error: fail ? { message: 'Leitura indisponível' } : null }) };
    return query;
  } };
  return { ...intelligenceHarness({ client }), calls };
}
const seed = intelligenceHarness();
const { localDate } = seed.load('lib/financialFlow.ts');
const { shiftAdminDay } = seed.load('lib/adminDashboard.ts');
const today = localDate(new Date().toISOString(), 'America/Manaus');
const rows = Array.from({ length: 45 }, (_, i) => sale({ id: String(i).padStart(3, '0'), customer_name: 'Movimento ' + i, total: i + 1, freight_fee: 0, completed_at: `${today}T${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z` }));
const base = { userId: 'company', branchId: 'A', branches: [{ id: 'A', user_id: 'company', name: 'Centro' }, { id: 'B', user_id: 'company', name: 'Bairro' }, { id: 'foreign', user_id: 'other', name: 'Outra empresa' }], onBranchChange() {}, timeZone: 'America/Manaus', invoices: [], payables: [], sales: rows, movements: [], payablesUnavailable: false };
const button = label => renderer.root.findAllByType('button').find(node => text(node) === label);
const period = () => renderer.root.findAllByType('select').find(node => node.findAllByType('option').some(option => option.props.value === 'custom'));
const tableRows = () => renderer.root.findByType('tbody').findAllByType('tr');
const totals = () => text(renderer.root.findByProps({ 'aria-label': 'Totais do período' }));
const choosePeriod = async value => act(async () => period().props.onChange({ target: { value } }));

test('actual statement orders by instant and stable id, attaches chronological cent balances before reversing', () => {
  const { financialStatement } = seed.load('lib/financialStatement.ts');
  const result = financialStatement([
    { id: 'c', date: '2026-11-16T03:30:00Z', amount: -0.20, description: 'late in Manaus' },
    { id: 'b', date: '2026-11-15T16:00:00Z', amount: 0.10, description: 'same instant' },
    { id: 'a', date: '2026-11-15T12:00:00-04:00', amount: 0.20, description: 'same instant' },
    { id: 'unknown', date: null, amount: 10, description: 'no date' },
  ], '2026-11-15', '2026-11-15', 'realizado', 'America/Manaus');
  assert.deepEqual(Array.from(result.rows, row => [row.id, row.running]), [['c', 0.10], ['b', 0.30], ['a', 0.20]]);
  assert.equal(result.incoming, 0.30); assert.equal(result.outgoing, 0.20); assert.equal(result.result, 0.10); assert.equal(result.undated.length, 1);
  assert.equal(result.rows[0].day, '2026-11-15');
  const projected = financialStatement([
    { id: 'later', date: '2026-11-16', amount: -2, description: '' },
    { id: 'b', date: '2026-11-15', amount: -3, description: '' },
    { id: 'a', date: '2026-11-15', amount: 10, description: '' },
  ], '2026-11-15', '2026-11-16', 'previsto', 'America/Manaus');
  assert.deepEqual(Array.from(projected.rows, row => [row.id, row.running]), [['a', 10], ['b', 7], ['later', 5]]);
});

test('45 movements paginate without changing full totals or attached balances, and page changes do not reload', async () => {
  const { load, calls } = fixture();
  const Component = load('components/partner/FinancialFlowModule.tsx').FinancialFlowModule;
  await act(async () => { renderer = Renderer.create(React.createElement(Component, base)); });
  assert.equal(tableRows().length, 20); assert.equal(tableRows()[0].props['data-movement-id'], 'sale-044');
  assert.match(text(renderer.toJSON()), /1–20 de 45 movimentos/);
  const allTotals = totals(); assert.match(allTotals, /1\.035,00/);
  assert.match(text(tableRows()[0]), /1\.035,00/);
  await act(async () => button('Próxima').props.onClick());
  assert.match(text(renderer.toJSON()), /21–40 de 45 movimentos/); assert.equal(totals(), allTotals);
  assert.equal(tableRows()[0].props['data-movement-id'], 'sale-024'); assert.match(text(tableRows()[0]), /325,00/);
  await act(async () => button('Próxima').props.onClick());
  assert.equal(tableRows().length, 5); assert.equal(button('Próxima').props.disabled, true); assert.equal(totals(), allTotals);
  await act(async () => button('Anterior').props.onClick());
  assert.equal(tableRows()[0].props['data-movement-id'], 'sale-024'); assert.match(text(tableRows()[0]), /325,00/);
  assert.equal(calls.length, 3);
  const cards = renderer.root.findByProps({ className: 'financial-flow-mobile' }).findAllByType('li');
  assert.equal(cards.length, 20); assert.match(text(cards[0]), /Entrada/); assert.match(text(cards[0].findByType('details')), /325,00/);
  assert.equal(cards[0].findByType('summary').children[0], 'Ver acumulado');
});

test('period, branch and mode reset the page; refresh shrinking data clamps the page', async () => {
  const { load } = fixture(); const Component = load('components/partner/FinancialFlowModule.tsx').FinancialFlowModule;
  await act(async () => { renderer = Renderer.create(React.createElement(Component, base)); });
  await act(async () => button('Próxima').props.onClick()); await choosePeriod('7');
  assert.match(text(renderer.toJSON()), /1–20 de 45/);
  await act(async () => button('Próxima').props.onClick());
  await act(async () => renderer.update(React.createElement(Component, { ...base, sales: rows.slice(0, 3) })));
  assert.match(text(renderer.toJSON()), /1–3 de 3 movimentos/); assert.equal(button('Próxima').props.disabled, true);
  await act(async () => renderer.update(React.createElement(Component, { ...base, sales: rows.concat(rows.map(row => ({ ...row, id: 'b' + row.id, branch_id: 'B' }))) })));
  await act(async () => button('Próxima').props.onClick());
  await act(async () => renderer.update(React.createElement(Component, { ...base, branchId: 'B', sales: rows.map(row => ({ ...row, branch_id: 'B' })) })));
  assert.match(text(renderer.toJSON()), /1–20 de 45/); assert.match(text(renderer.toJSON()), /Bairro/);
  await act(async () => button('Previsto').props.onClick());
  assert.equal(period().props.value, '30'); assert.equal(renderer.root.findAllByType('input').length, 0);
  assert.match(text(renderer.toJSON()), /Entradas previstas/);
});

test('custom dates validate empty/reversed ranges, preserve refresh, and normal presets hide dates', async () => {
  const { load, calls } = fixture(); const Component = load('components/partner/FinancialFlowModule.tsx').FinancialFlowModule;
  await act(async () => { renderer = Renderer.create(React.createElement(Component, base)); });
  assert.equal(renderer.root.findAllByType('input').length, 0);
  await choosePeriod('custom'); const inputs = () => renderer.root.findAllByType('input');
  assert.equal(inputs()[0].props.value, shiftAdminDay(today, -29)); assert.equal(inputs()[1].props.value, today);
  await act(async () => inputs()[0].props.onChange({ target: { value: shiftAdminDay(today, 1) } }));
  assert.match(text(renderer.toJSON()), /A data inicial deve ser anterior/); assert.equal(renderer.root.findAllByType('tbody').length, 0); assert.match(totals(), /Indisponível/);
  await act(async () => inputs()[0].props.onChange({ target: { value: '' } })); assert.match(text(renderer.toJSON()), /Informe duas datas válidas/);
  await choosePeriod('today'); assert.equal(renderer.root.findAllByType('input').length, 0); assert.equal(tableRows().length, 20);
  await act(async () => button('Atualizar').props.onClick()); assert.equal(calls.length, 6);
});

test('projected mode uses next 30 days inclusive, excludes cancelled/foreign rows, and keeps unknown dates warning', async () => {
  const { load } = fixture(); const Component = load('components/partner/FinancialFlowModule.tsx').FinancialFlowModule;
  const selectBranch = [];
  const props = { ...base, sales: [], onBranchChange: id => selectBranch.push(id), invoices: [invoice({ id: 'now', due_date: today }), invoice({ id: 'last', due_date: shiftAdminDay(today, 29) }), invoice({ id: 'after', due_date: shiftAdminDay(today, 30) }), invoice({ id: 'foreign', user_id: 'other', due_date: today }), invoice({ id: 'branch', branch_id: 'B', due_date: today }), invoice({ id: 'unknown', due_date: null }), invoice({ id: 'cancelled', status: 'cancelada', due_date: today })], payables: [payable({ due_date: today })] };
  await act(async () => { renderer = Renderer.create(React.createElement(Component, props)); });
  await act(async () => button('Previsto').props.onClick());
  assert.equal(tableRows().length, 3); assert.equal(tableRows()[0].props['data-movement-id'], 'invoice-now');
  assert.match(text(renderer.toJSON()), /1 registro\(s\) sem data comprovada/);
  const sum = text(renderer.root.findByProps({ 'aria-label': 'Totais projetados do período' })); assert.match(sum, /150,00/);
  assert.ok(!tableRows().some(row => /foreign|branch|cancelled|after/.test(row.props['data-movement-id'])));
  await choosePeriod('7'); assert.equal(tableRows().length, 2);
  const branchSelect = renderer.root.findAllByType('select').find(node => node.props.value === 'A');
  assert.ok(!text(branchSelect).includes('Outra empresa'));
  await act(async () => branchSelect.props.onChange({ target: { value: 'B' } })); assert.deepEqual(selectBranch, ['B']);
});

test('loading, read errors, unavailable payables and employee identity never display usable totals', async () => {
  for (const [options, patch] of [[{ fail: true }, {}], [{ identity: 'employee' }, {}], [{}, { payablesUnavailable: true }]]) {
    const { load } = fixture(options); const Component = load('components/partner/FinancialFlowModule.tsx').FinancialFlowModule;
    await act(async () => { renderer = Renderer.create(React.createElement(Component, { ...base, ...patch })); });
    assert.match(totals(), /Indisponível/); assert.equal(renderer.root.findAllByType('tbody').length, 0);
    await act(async () => renderer.unmount()); renderer = null;
  }
});

test('pending ledger keeps loading visible and totals unavailable until authenticated reads complete', async () => {
  let finish;
  const client = { auth: { getUser: () => new Promise(resolve => { finish = resolve; }) }, from() {
    const query = { select: () => query, eq: () => query, order: () => query, range: async () => ({ data: [], error: null }) }; return query;
  } };
  const { load } = intelligenceHarness({ client }); const Component = load('components/partner/FinancialFlowModule.tsx').FinancialFlowModule;
  await act(async () => { renderer = Renderer.create(React.createElement(Component, base)); });
  assert.match(text(renderer.toJSON()), /Carregando movimentações/); assert.match(totals(), /Indisponível/); assert.equal(renderer.root.findAllByType('tbody').length, 0);
  await act(async () => finish({ data: { user: { id: 'company' } }, error: null }));
  assert.match(totals(), /1\.035,00/); assert.equal(tableRows().length, 20);
});

test('Administration passes branch selector context to the flow and uses its existing branch callback', async () => {
  const { load } = fixture(); const Component = load('components/partner/AdminModule.tsx').AdminModule;
  const selected = [];
  await act(async () => { renderer = Renderer.create(React.createElement(Component, { userId: 'company', sales: [], products: [], movements: [], salespeople: [], customers: [], branches: base.branches, selectedBranchId: 'A', allowedModules: ['financeiro'], ownerView: true, timeZone: 'America/Manaus', onSelectBranch: id => selected.push(id) })); });
  const financialSection = renderer.root.findAll(node => node.props.className?.startsWith?.('admin-sidebar-section-header')).find(node => text(node).trim() === 'Financeiro');
  await act(async () => financialSection.props.onClick());
  await act(async () => button('Fluxo Financeiro').props.onClick());
  const flow = () => renderer.root.findAll(node => typeof node.type === 'function' && 'payablesUnavailable' in node.props && 'branchId' in node.props)[0];
  assert.equal(flow().props.branchId, 'A'); assert.equal(flow().props.timeZone, 'America/Manaus'); assert.equal(flow().props.branches, base.branches);
  await act(async () => flow().props.onBranchChange('B'));
  assert.deepEqual(selected, ['B']); assert.equal(flow().props.branchId, 'B');
  // Echo the controlled selection as PartnerPanel does before changing operators.
  await act(async () => renderer.update(React.createElement(Component, { ...renderer.root.findByType(Component).props, selectedBranchId: 'B' })));
  await act(async () => renderer.update(React.createElement(Component, { userId: 'company', sales: [], products: [], movements: [], salespeople: [], customers: [], branches: base.branches, selectedBranchId: 'A', allowedModules: ['financeiro'], ownerView: false })));
  assert.equal(flow().props.onBranchChange, undefined);
  assert.equal(flow().props.branchId, 'A');
});
