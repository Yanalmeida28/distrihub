import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { intelligenceHarness, fixedNow, sale, product, payable } from './fixtures/business_intelligence_helpers.mjs';

let renderer;
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });
const text = node => typeof node === 'string' ? node : (node.children ?? []).map(text).join('');
function fixture({ fail = false, identity = 'company' } = {}) {
  const calls = [];
  const client = { auth: { getUser: async () => ({ data: { user: { id: identity } }, error: null }) }, from(table) {
    if (table !== 'partner_break_even_settings') calls.push(table);
    const query = { select: () => query, eq: () => query, order: () => query, maybeSingle: async () => ({ data: null, error: null }),
      range: async () => ({ data: [], error: fail ? { message: 'Falha de leitura de teste' } : null }) };
    return query;
  } };
  const harness = intelligenceHarness({ client });
  return { ...harness, calls };
}
const scenarioInputs = () => renderer.root.findByProps({ 'aria-labelledby': 'bi-goals' }).findAllByType('input');
const base = {
  companyId: 'company', branchId: 'A', branches: [{ id: 'A', user_id: 'company', name: 'Centro' }, { id: 'B', user_id: 'company', name: 'Bairro' }, { id: 'foreign', user_id: 'other', name: 'Outra empresa' }],
  isActive: true, dataReady: true, sales: [sale()], products: [product()], customers: [], movements: [], invoices: [], payables: [],
  payablesLoading: false, payablesError: '', onBranchChange() {}, onNavigate() {}, now: fixedNow,
};
const adminProps = { userId: 'company', sales: [], products: [], salespeople: [], customers: [], branches: [], movements: [],
  ownerView: true, allowedModules: ['relatorios', 'financeiro'], intelligenceAllowed: true, intelligenceDataReady: true };

test('month and custom selectors change the diagnosis without new ledger reads and invalid dates hide the result', async () => {
  const { load, calls } = fixture();
  const Component = load('components/partner/BusinessIntelligenceModule.tsx').BusinessIntelligenceModule;
  await act(async () => { renderer = Renderer.create(React.createElement(Component, { ...base, rmas: [], payables: [payable({ amount: 30, paid_amount: 0, due_date: '2026-10-10' })] })); });
  const select = value => renderer.root.findAllByType('select')[0].props.onChange({ target: { value } });
  await act(async () => select('previousMonth'));
  assert.match(text(renderer.toJSON()), /01\/09\/2026 a 30\/09\/2026/);
  await act(async () => select('selectedMonth'));
  await act(async () => renderer.root.findByProps({ type: 'month' }).props.onChange({ target: { value: '2026-10' } }));
  assert.match(text(renderer.toJSON()), /01\/10\/2026 a 31\/10\/2026/);
  assert.match(text(renderer.toJSON()), /Lucro estimado nos registros/);
  await act(async () => select('custom'));
  const dates = () => renderer.root.findAllByProps({ type: 'date' });
  await act(async () => { dates()[0].props.onChange({ target: { value: '2026-10-10' } }); dates()[1].props.onChange({ target: { value: '2026-10-10' } }); });
  assert.match(text(renderer.toJSON()), /10\/10\/2026 a 10\/10\/2026/);
  await act(async () => dates()[1].props.onChange({ target: { value: '2026-10-09' } }));
  assert.match(text(renderer.toJSON()), /A data inicial deve ser anterior/);
  assert.doesNotMatch(text(renderer.toJSON()), /Lucro estimado nos registros/);
  await act(async () => select('selectedMonth'));
  await act(async () => renderer.root.findByProps({ type: 'month' }).props.onChange({ target: { value: '' } }));
  assert.match(text(renderer.toJSON()), /Selecione um mês e ano válidos/);
  assert.equal(calls.length, 3);
});

test('equivalent financial lists do not reload, while changed data, branches and manual refresh do', async () => {
  const { load, calls } = fixture();
  const useMovements = load('hooks/useFinancialMovements.ts').useFinancialMovements;
  let result;
  function Probe({ invoices = [], payables = [], branch = 'A' }) {
    result = useMovements('company', branch, invoices, payables, true);
    return null;
  }
  const render = props => React.createElement(Probe, props);
  await act(async () => { renderer = Renderer.create(render({ invoices: [{ id: 'one', paid: 0 }] })); });
  assert.equal(calls.length, 3); assert.equal(result.loading, false);
  await act(async () => renderer.update(render({ invoices: [{ id: 'one', paid: 0 }] })));
  assert.equal(calls.length, 3);
  await act(async () => renderer.update(render({ invoices: [{ id: 'one', paid: 10 }] })));
  assert.equal(calls.length, 6);
  await act(async () => result.reload());
  assert.equal(calls.length, 9);
  await act(async () => renderer.update(render({ branch: 'B', invoices: [{ id: 'one', paid: 10 }] })));
  assert.equal(calls.length, 12);
});

test('intelligence refreshes once per activation and branch despite callback and readiness changes', async () => {
  const { load } = fixture();
  const Component = load('components/partner/BusinessIntelligenceModule.tsx').BusinessIntelligenceModule;
  let refreshed = 0;
  const render = patch => React.createElement(Component, { ...base, onRefreshPayables: async () => { refreshed++; }, ...patch });
  await act(async () => { renderer = Renderer.create(render()); });
  assert.equal(refreshed, 1);
  await act(async () => renderer.update(render()));
  await act(async () => renderer.update(render({ dataReady: false })));
  await act(async () => renderer.update(render()));
  assert.equal(refreshed, 1);
  await act(async () => renderer.update(render({ branchId: 'B' })));
  assert.equal(refreshed, 2);
  await act(async () => renderer.update(render({ isActive: false })));
  await act(async () => renderer.update(render()));
  assert.equal(refreshed, 3);
});

test('the automatic result uses registered expenses, responds to changes and displays profit, loss and its calculation', async () => {
  const { load } = fixture();
  const Component = load('components/partner/BusinessIntelligenceModule.tsx').BusinessIntelligenceModule;
  const props = { ...base, rmas: [], payables: [payable({ amount: 30, paid_amount: 0, status: 'aberta', due_date: '2026-10-10' })] };
  const status = () => renderer.root.findAll(node => typeof node.props.className === 'string' && node.props.className.startsWith('module-card bi-result-status'))[0];
  await act(async () => { renderer = Renderer.create(React.createElement(Component, props)); });
  assert.match(text(status()), /Lucro estimado nos registros/);
  assert.match(text(status()), /30,00/);
  assert.match(text(renderer.toJSON()), /Como o resultado foi calculado/);
  assert.match(text(renderer.toJSON()), /Despesas consideradas no resultado/);
  await act(async () => renderer.update(React.createElement(Component, { ...props, payables: [payable({ amount: 80, paid_amount: 0, status: 'aberta', due_date: '2026-10-10' })] })));
  assert.match(text(status()), /Prejuízo estimado nos registros/); assert.match(text(status()), /20,00/);
  assert.ok(scenarioInputs().every(input => input.props.value === ''));
});

test('month-to-date is the default and today shows new expenses without pretending that earlier sales happened today', async () => {
  const { load } = fixture();
  const Component = load('components/partner/BusinessIntelligenceModule.tsx').BusinessIntelligenceModule;
  await act(async () => { renderer = Renderer.create(React.createElement(Component, { ...base, rmas: [], payables: [payable({ amount: 30, paid_amount: 0, due_date: '2026-10-19' })] })); });
  const period = renderer.root.findAllByType('select')[0];
  assert.equal(period.props.value, 'month');
  await act(async () => period.props.onChange({ target: { value: 'today' } }));
  const status = renderer.root.findAll(node => node.props.className === 'module-card bi-result-status bi-result-loss')[0];
  assert.match(text(status), /30,00/);
  assert.match(text(renderer.toJSON()), /19\/10\/2026 a 19\/10\/2026/);
});

test('financial refresh reads the existing sources and asks the parent to reload payables', async () => {
  const { load, calls } = fixture();
  const Component = load('components/partner/BusinessIntelligenceModule.tsx').BusinessIntelligenceModule;
  let refreshed = 0;
  const refresh = async () => { refreshed++; return true; };
  await act(async () => { renderer = Renderer.create(React.createElement(Component, { ...base, rmas: [], onRefreshPayables: refresh })); });
  assert.equal(refreshed, 1);
  const before = calls.length;
  await act(async () => renderer.root.findAllByType('button').find(button => text(button) === 'Atualizar financeiro').props.onClick());
  assert.equal(refreshed, 2); assert.ok(calls.length > before);
});

test('UI distinguishes missing expenses, estimated profit, zero costs and temporary scenarios without storage writes', async () => {
  const { load, calls } = fixture();
  const Component = load('components/partner/BusinessIntelligenceModule.tsx').BusinessIntelligenceModule;
  await act(async () => { renderer = Renderer.create(React.createElement(Component, { ...base, sales: [sale({ cost_snapshot: null })] })); });
  let output = JSON.stringify(renderer.toJSON());
  assert.match(output, /Lucro bruto estimado/); assert.match(output, /Nenhuma conta a pagar/); assert.match(output, /Dados insuficientes/);
  assert.ok(!output.includes('Outra empresa'));
  assert.equal(calls.length, 3);
  const inputs = scenarioInputs();
  await act(async () => { inputs[0].props.onChange({ target: { value: '1000' } }); inputs[1].props.onChange({ target: { value: '25' } }); inputs[2].props.onChange({ target: { value: '500' } }); });
  output = JSON.stringify(renderer.toJSON()); assert.match(output, /Ponto de equilíbrio simulado/); assert.match(output, /4\.000,00/); assert.match(output, /6\.000,00/);
  await act(async () => renderer.root.findAllByType('button').find(button => text(button) === 'Limpar simulação').props.onClick());
  assert.ok(scenarioInputs().every(input => input.props.value === ''));
});

test('base errors, loading, ledger errors and mismatched authentication never render a financial diagnosis', async () => {
  for (const patch of [{ dataReady: false }, { dataError: 'Base incompleta' }, { payablesError: 'Sem autorização' }, { branchId: 'foreign' }]) {
    const { load, calls } = fixture();
    const Component = load('components/partner/BusinessIntelligenceModule.tsx').BusinessIntelligenceModule;
    await act(async () => { renderer = Renderer.create(React.createElement(Component, { ...base, ...patch })); });
    assert.ok(!JSON.stringify(renderer.toJSON()).includes('Faturamento registrado'));
    assert.equal(calls.length, 0);
    await act(async () => renderer.unmount()); renderer = null;
  }
  for (const options of [{ fail: true }, { identity: 'employee' }]) {
    const { load } = fixture(options);
    const Component = load('components/partner/BusinessIntelligenceModule.tsx').BusinessIntelligenceModule;
    await act(async () => { renderer = Renderer.create(React.createElement(Component, base)); });
    const output = JSON.stringify(renderer.toJSON()); assert.match(output, /Análise indisponível/); assert.ok(!output.includes('Faturamento registrado'));
    await act(async () => renderer.unmount()); renderer = null;
  }
});

test('hidden intelligence does not read the financial ledger', async () => {
  const { load, calls } = fixture();
  const Component = load('components/partner/BusinessIntelligenceModule.tsx').BusinessIntelligenceModule;
  await act(async () => { renderer = Renderer.create(React.createElement(Component, { ...base, isActive: false })); });
  assert.equal(renderer.toJSON(), null); assert.equal(calls.length, 0);
});

test('leaving the outer Administrative module clears temporary premises even when its component stays mounted', async () => {
  const { load } = fixture();
  const Component = load('components/partner/BusinessIntelligenceModule.tsx').BusinessIntelligenceModule;
  await act(async () => { renderer = Renderer.create(React.createElement(Component, base)); });
  await act(async () => scenarioInputs()[0].props.onChange({ target: { value: '7000' } }));
  assert.equal(scenarioInputs()[0].props.value,'7000');
  await act(async () => renderer.update(React.createElement(Component, { ...base, isActive: false })));
  await act(async () => renderer.update(React.createElement(Component, base)));
  assert.ok(scenarioInputs().every(input => input.props.value === ''));
});

test('Administrative navigation places intelligence after Reports and blocks employees, missing permissions and SaaS denial', async () => {
  for (const patch of [{ ownerView: false }, { intelligenceAllowed: false }, { allowedModules: ['relatorios'] }]) {
    const { load, calls } = fixture();
    const Component = load('components/partner/AdminModule.tsx').AdminModule;
    await act(async () => { renderer = Renderer.create(React.createElement(Component, { ...adminProps, ...patch })); });
    assert.ok(!text(renderer.toJSON()).includes('Inteligência Empresarial')); assert.equal(calls.length, 0);
    await act(async () => renderer.unmount()); renderer = null;
  }
  const { load } = fixture();
  const Component = load('components/partner/AdminModule.tsx').AdminModule;
  await act(async () => { renderer = Renderer.create(React.createElement(Component, adminProps)); });
  const sections = renderer.root.findAll(node => node.props.className?.startsWith?.('admin-sidebar-section-header'));
  const labels = sections.map(section => text(section).trim());
  assert.equal(labels.indexOf('Inteligência Empresarial'), labels.indexOf('Relatórios') + 1);
  await act(async () => sections.find(section => text(section).trim() === 'Inteligência Empresarial').props.onClick());
  assert.ok(renderer.root.findAllByProps({ 'aria-label': 'Inteligência Empresarial' }).length > 0);
  await act(async () => renderer.update(React.createElement(Component, { ...adminProps, intelligenceAllowed: false })));
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Inteligência Empresarial' }).length, 0);
});

test('branch context remount clears all scenario inputs and late old-branch ledger data is rejected', async () => {
  let resolveOld;
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'company' } }, error: null }) }, from(table) {
    const query = { select: () => query, eq: () => query, order: () => query, maybeSingle: async () => ({ data: null, error: null }),
      range: async () => table === 'partner_invoice_receipts' ? new Promise(resolve => { resolveOld = resolve; }) : { data: [], error: null } };
    return query;
  } };
  const { load } = intelligenceHarness({ client });
  const Component = load('components/partner/BusinessIntelligenceModule.tsx').BusinessIntelligenceModule;
  await act(async () => { renderer = Renderer.create(React.createElement(Component, { ...base, key: 'A' })); });
  const old = resolveOld;
  await act(async () => renderer.update(React.createElement(Component, { ...base, branchId: 'B', key: 'B' })));
  await act(async () => { old({ data: [{ id: 'old', user_id: 'company', branch_id: 'A', invoice_id: 'old', amount: 999 }], error: null }); resolveOld({ data: [], error: null }); });
  assert.ok(!JSON.stringify(renderer.toJSON()).includes('999'));
  const inputs = scenarioInputs();
  await act(async () => inputs[0].props.onChange({ target: { value: '1500' } }));
  await act(async () => renderer.update(React.createElement(Component, { ...base, branchId: 'A', key: 'A2' })));
  await act(async () => resolveOld({ data: [], error: null }));
  assert.ok(scenarioInputs().every(input => input.props.value === ''));
});


test('attention opens the exact existing financial, stock and CRM destinations in the selected branch', async () => {
  for (const [label, target, filter] of [
    ['Abrir vencidas a receber', 'receber', 'vencidas'], ['Abrir vencidas a pagar', 'pagar', 'vencidas'],
    ['Abrir relat\u00f3rio Sem giro', 'sem-giro'], ['Abrir clientes inativos no CRM', 'crm', 'inativos'], ['Abrir clientes sem compras', 'crm', 'sem-compras'],
  ]) {
    const { load } = fixture();
    const Component = load('components/partner/AdminModule.tsx').AdminModule;
    await act(async () => { renderer = Renderer.create(React.createElement(Component, { ...adminProps, selectedBranchId: 'A', branches: base.branches, timeZone: 'America/Manaus' })); });
    const sections = renderer.root.findAll(node => node.props.className?.startsWith?.('admin-sidebar-section-header'));
    await act(async () => sections.find(section => text(section).trim() === 'Intelig\u00eancia Empresarial').props.onClick());
    await act(async () => renderer.root.findAllByType('button').find(button => text(button) === label).props.onClick());
    const destination = renderer.root.findAll(node => typeof node.type === 'function').find(node => target === 'receber' || target === 'pagar' ? node.props.kind === target : node.props.initialTab === target);
    assert.ok(destination, label); assert.equal(destination.props.branchId, 'A'); assert.equal(destination.props.timeZone, 'America/Manaus');
    if (target === 'crm') assert.equal(destination.props.initialCrmSegment, filter);
    if (target === 'receber' || target === 'pagar') assert.equal(destination.props.initialFilter, filter);
    await act(async () => renderer.unmount()); renderer = null;
  }
});


test('CRM configured business day uses completion and keeps inactive buyers separate from never purchased', async () => {
  const { load } = fixture();
  const Component = load('components/partner/CrmWorkspace.tsx').CrmWorkspace;
  const before = days => new Date(Date.now() - days * 86400000).toISOString();
  const props = { companyUserId: 'company', branchId: 'A', timeZone: 'America/Manaus', initialSegment: 'inativos', customers: [{ id: 'old', name: 'Dormant buyer' }, { id: 'never', name: 'Never buyer' }, { id: 'recent', name: 'Recent buyer' }], sales: [sale({ customer_id: 'old', created_at: before(1), completed_at: before(100) }), sale({ id: 'recent', customer_id: 'recent', completed_at: before(1) })], invoices: [], salespeople: [] };
  await act(async () => { renderer = Renderer.create(React.createElement(Component, props)); });
  assert.match(text(renderer.toJSON()), /Dormant buyer/); assert.doesNotMatch(text(renderer.toJSON()), /Never buyer|Recent buyer/);
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Segmento de clientes' }).props.onChange({ target: { value: 'sem-compras' } }));
  assert.match(text(renderer.toJSON()), /Never buyer/); assert.doesNotMatch(text(renderer.toJSON()), /Dormant buyer|Recent buyer/);
});
