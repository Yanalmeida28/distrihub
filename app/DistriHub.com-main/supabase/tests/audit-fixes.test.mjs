import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';

const require = createRequire(import.meta.url);
async function load(path, dependencies = {}, globals = {}, extra = '') {
  const exports = {};
  const source = await readFile(new URL('../../src/' + path, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, Error, JSON, Number, crypto: { randomUUID: () => 'request-id' },
    require: name => dependencies[name] ?? require(name), ...globals });
  return exports;
}
const documentUtils = await load('utils.ts', { './data': {} });
const safety = await load('lib/exportSafety.ts');
const catalog = await load('lib/catalogOrders.ts');
const metrics = await load('lib/reportMetrics.ts', { './pdv': { salePaymentDescription: () => 'PIX' } });
const b2b = await load('lib/b2bOrder.ts', { './catalogOrders': catalog });
const { saveB2bOrder } = b2b;
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const shared = [];
const { CartDrawer } = await load('components/CartDrawer.tsx', {
  '../lib/b2bOrder': b2b,
  '../utils': { money, formatWhatsAppMessage: (...args) => JSON.stringify(args), openWhatsApp: message => shared.push(message) },
  '../data': { WHATSAPP_NUMBER: '5511999999999', paymentMethods: [{ value: 'pix', label: 'PIX' }, { value: 'faturado', label: 'Faturado' }], deliveryMethods: [{ value: 'balcao', label: 'Balcão' }, { value: 'motoboy', label: 'Motoboy' }] },
});
const item = { id: 1, name: 'Produto', sku: 'SKU', price: 12.34, quantity: 2 };
const baseProps = { open: true, cart: [item], cartCount: 2, cartTotal: 24.68, businessName: 'Loja', city: 'São Paulo',
  onClose() {}, onIncrement() {}, onDecrement() {}, onRemove() {}, onBusinessNameChange() {}, onCityChange() {}, onExplore() {},
  isAuthenticated: true, onLoginRequired() {} };
const text = node => node.toJSON() ? JSON.stringify(node.toJSON()) : '';
const button = (renderer, className) => renderer.root.findAllByType('button').find(node => node.props.className === className);

test('B2B waits for persistence, blocks duplicate clicks and shares the saved ID and full total', async () => {
  shared.length = 0;
  let resolve, calls = 0;
  const pending = new Promise(done => { resolve = done; });
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(CartDrawer, { ...baseProps, onSendOrder: async () => { calls++; return pending; } })); });
  await act(async () => button(renderer, 'whatsapp-button').props.onClick());
  await act(async () => { button(renderer, 'module-submit-btn').props.onClick(); button(renderer, 'module-submit-btn').props.onClick(); });
  assert.equal(calls, 1); assert.doesNotMatch(text(renderer), /Pedido Enviado/); assert.equal(shared.length, 0);
  await act(async () => resolve({ id: 'persisted-id', total: 39.68 }));
  assert.match(text(renderer), /persisted-id/); assert.match(shared[0], /persisted-id/); assert.match(shared[0], /39.68/);
  await act(async () => renderer.unmount());
});

test('B2B rejection stays editable without announcing success and retry uses the same ID', async () => {
  shared.length = 0; const ids = []; let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(CartDrawer, { ...baseProps, onSendOrder: async (...args) => { ids.push(args[2]); throw new Error('Falha de conexão'); } })); });
  await act(async () => button(renderer, 'whatsapp-button').props.onClick());
  await act(async () => button(renderer, 'module-submit-btn').props.onClick());
  assert.match(text(renderer), /Falha de conexão/); assert.doesNotMatch(text(renderer), /Pedido Enviado/); assert.equal(shared.length, 0);
  await act(async () => button(renderer, 'module-submit-btn').props.onClick());
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  await act(async () => renderer.unmount());
});

test('B2B credit does not show a fake verification or accept a credit checkout', async () => {
  let calls = 0, renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(CartDrawer, { ...baseProps, onSendOrder: async () => { calls++; return { id: 'id', total: 24.68 }; } })); });
  await act(async () => button(renderer, 'whatsapp-button').props.onClick());
  await act(async () => renderer.root.findAllByType('button').find(node => node.children.includes('Faturado')).props.onClick());
  assert.equal(button(renderer, 'module-submit-btn').props.disabled, true);
  await act(async () => button(renderer, 'module-submit-btn').props.onClick());
  assert.equal(calls, 0); assert.doesNotMatch(text(renderer), /Código.*enviado|1234/);
  await act(async () => renderer.unmount());
});

const input = { requestId: 'id', catalogSlug: 'loja', branchId: 'branch', cart: [{ ...item, id: 'product' }], businessName: ' Loja ', contact: '11999999999', deliveryAddress: '', paymentMethod: 'pix', deliveryMethod: 'balcao' };
test('catalogue service sends only product identities and quantities and requires server confirmation', async () => {
  let payload;
  const client = { async rpc(name, args) { assert.equal(name, 'place_catalog_order'); payload = args; return { data: { id: 'id', total: 30 }, error: null }; } };
  assert.equal((await saveB2bOrder(client, 'buyer', input)).total, 30);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.p_items)), [{ id: 'product', quantity: 2 }]);
  await assert.rejects(saveB2bOrder({ rpc: async () => ({ error: { message: 'RLS denied' } }) }, 'buyer', input), /RLS denied/);
  await assert.rejects(saveB2bOrder({ rpc: async () => ({ data: { id: 'other', total: 30 } }) }, 'buyer', input), /confirmou/);
  await assert.rejects(saveB2bOrder(client, null, input), /Entre/);
  await assert.rejects(saveB2bOrder(client, 'buyer', { ...input, paymentMethod: 'rma' }), /Forma de pagamento/);
});

test('product/customer PDF and CSV exports treat malicious fields as text; Excel writes real string cells', async () => {
  const html = [], blobs = [], books = [];
  const XLSX = require('xlsx');
  const module = await load('components/partner/ImportExportModule.tsx', {
    '../../utils': { money }, '../../lib/exportSafety': safety,
    xlsx: { ...XLSX, writeFile: (...args) => books.push(args) },
  }, { Blob, URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    document: { body: { append() {} }, createElement() { return { click() {}, remove() {} }; } },
    window: { setTimeout: callback => callback(), open: () => ({ document: { write: value => html.push(value), close() {} }, print() {} }) },
  }, '\nexports.productPdf=exportProductsPDF; exports.customerPdf=exportCustomersPDF; exports.productCsv=exportProductsCSV; exports.customerCsv=exportCustomersCSV; exports.excel=exportProductsExcel;');
  const marker = '<img src=x onerror="alert(1)">';
  module.productPdf([{ name: marker, sku: marker, category: marker, cost_price: 1, sale_price: 2, wholesale_price: 0, stock: 1 }]);
  module.customerPdf([{ name: marker, document: marker, phone: marker, email: marker, city: marker, customer_type: marker }]);
  for (const output of html) { assert.ok(!output.includes(marker)); assert.match(output, /&lt;img/); }
  module.productCsv([{ name: '=1+1', sku: 'a";b', category: 'a\nb', cost_price: 1, sale_price: 2, wholesale_price: 0, stock: 1 }]);
  module.customerCsv([{ name: '@SUM(1)', email: 'a"b' }]);
  assert.match(await blobs[0].text(), /"'=1\+1"/); assert.match(await blobs[0].text(), /a"";b/);
  assert.match(await blobs[1].text(), /"'@SUM/);
  await module.excel([{ name: '=1+1', cost_price: 1, sale_price: 2, wholesale_price: 0, stock: 1 }]);
  assert.match(books[0][1], /\.xlsx$/); assert.equal(books[0][0].Sheets.Produtos.A2.t, 's'); assert.equal(books[0][0].Sheets.Produtos.A2.f, undefined);
});

test('signup with email confirmation makes no anonymous profile write; confirmation completes the profile idempotently', async () => {
  let listener, current, signupArgs, user, profile, writes = 0;
  const query = table => ({
    select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
    async maybeSingle() { return { data: table === 'partner_profiles' ? profile ?? null : null, error: null }; },
    async upsert(value, options) { writes++; assert.equal(options.ignoreDuplicates, true); profile ??= value; return { error: null }; },
  });
  const client = { from: query, auth: {
    async getSession() { return { data: { session: null } }; },
    onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    async getUser() { return { data: { user }, error: null }; },
    async signUp(args) { signupArgs = args; user = { id: 'owner', user_metadata: args.options.data }; return { data: { user, session: null }, error: null }; },
  } };
  const { useAuth } = await load('hooks/useAuth.ts', { '../utils': documentUtils, '../lib/supabase': { supabase: client, isSupabaseConfigured: true } }, {
    window: { location: { origin: 'https://app.example' }, setTimeout: callback => callback() },
  });
  function Probe() { current = useAuth(); return null; }
  let renderer, result;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
  await act(async () => { result = await current.signUp({ email: 'owner@example.com', password: 'secret', businessName: ' Loja ', whatsapp: '5511999999999', document: '529.982.247-25', personType: 'PF' }); });
  assert.equal(result.error, null); assert.equal(result.needsEmailConfirmation, true); assert.equal(writes, 0);
  assert.equal(signupArgs.options.data.business_name, 'Loja'); assert.equal(signupArgs.options.data.role, undefined);
  await act(async () => { listener('SIGNED_IN', { user }); });
  assert.equal(current.profile.document, '52998224725');
  assert.equal(writes, 1); assert.equal(current.profile.business_name, 'Loja'); assert.equal(current.identity.companyUserId, 'owner');
  await act(async () => { listener('SIGNED_IN', { user }); });
  assert.equal(writes, 1);
  await act(async () => renderer.unmount());
});

test('signup with immediate session completes a profile without choosing roles or subscription fields', async () => {
  let current, user, profile, writes = 0;
  const client = { from: table => ({
    select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
    async maybeSingle() { return { data: table === 'partner_profiles' ? profile ?? null : null, error: null }; },
    async upsert(value) { writes++; profile = value; return { error: null }; },
  }), auth: {
    async getSession() { return { data: { session: null } }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    async getUser() { return { data: { user }, error: null }; },
    async signUp(args) { user = { id: 'owner', user_metadata: args.options.data }; return { data: { user, session: { user } }, error: null }; },
  } };
  const { useAuth } = await load('hooks/useAuth.ts', { '../utils': documentUtils, '../lib/supabase': { supabase: client, isSupabaseConfigured: true } }, { window: { location: { origin: 'https://app.example' } } });
  function Probe() { current = useAuth(); return null; }
  let renderer, result;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
  for (const document of ['', '00000000000', '11222333000180']) {
    await act(async () => { result = await current.signUp({ email: 'owner@example.com', password: 'secret', businessName: 'Loja', whatsapp: '5511999999999', document, personType: 'PJ' }); });
    assert.ok(result.error); assert.equal(writes, 0); assert.equal(user, undefined);
  }
  await act(async () => { result = await current.signUp({ email: 'owner@example.com', password: 'secret', businessName: 'Loja', whatsapp: '5511999999999', document: '11.222.333/0001-81', personType: 'PJ' }); });
  assert.equal(result.error, null); assert.equal(result.needsEmailConfirmation, undefined); assert.equal(writes, 1);
  assert.equal(profile.document, '11222333000181');
  assert.equal(profile.subscription_plan, undefined); assert.equal(profile.role, undefined);
  assert.equal(current.identity.companyUserId, 'owner');
  await act(async () => renderer.unmount());
});

test('signup form selects CPF or CNPJ, blocks invalid document and submits normalized digits', async () => {
  const { AuthScreen } = await load('components/AuthScreen.tsx', { '../utils': documentUtils });
  const calls = [];
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(AuthScreen, {
    onBack() {}, onSignIn: async () => ({error:null}), onSignUp: async data => { calls.push(data); return {error:null}; },
    onRequestPasswordReset: async () => ({error:null}), onUpdatePassword: async () => ({error:null}),
  })); });
  await act(async () => renderer.root.findAllByType('button').find(n => n.children.includes('Cadastrar')).props.onClick());
  const change = async (node, value) => act(async () => node.props.onChange({target:{value}}));
  await change(renderer.root.findAllByType('input').find(n=>n.props.placeholder==='Nome da sua empresa'), 'Loja');
  await change(renderer.root.findAllByType('input').find(n=>n.props.placeholder==='(11) 99999-9999'), '11999999999');
  const submit = () => act(async () => renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
  await change(renderer.root.findByProps({'aria-label':'CNPJ'}), '00000000000000');
  await submit(); assert.equal(calls.length, 0);
  await change(renderer.root.findByProps({'aria-label':'CNPJ'}), '11.222.333/0001-81');
  await submit(); assert.equal(calls[0].document, '11222333000181'); assert.equal(calls[0].personType, 'PJ');
  await change(renderer.root.findByProps({'aria-label':'Tipo de cadastro'}), 'PF');
  assert.equal(renderer.root.findByProps({'aria-label':'CPF'}).props.value, '');
  await change(renderer.root.findByProps({'aria-label':'CPF'}), '529.982.247-25');
  await submit(); assert.equal(calls[1].document, '52998224725'); assert.equal(calls[1].personType, 'PF');
  await act(async () => renderer.unmount());
});

test('master recovery announces only a requested link, never a changed password', async () => {
  const { RecoveryFlow } = await load('App.tsx', {
    './hooks/useAuth': {}, './hooks/useSuperAdminAuth': {}, './hooks/useCart': {}, './components/CartDrawer': {},
    './components/HubHome': {}, './lib/supabase': {}, './lib/b2bOrder': b2b,
    './lib/checkoutCash': await load('lib/checkoutCash.ts'),
    './components/partner/PartnerAccessGate': {},
    './components/AppUpdateNotice': {},
  }, {}, '\nexports.RecoveryFlow=RecoveryFlow;');
  let requests = 0, renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(RecoveryFlow, {
    auth: { requestRecovery: async () => { requests++; return { error: null }; } }, onBack() {}, onSuccess() {},
  })); });
  await act(async () => renderer.root.findByType('input').props.onChange({ target: { value: 'admin@example.com' } }));
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(requests, 1); assert.match(text(renderer), /Confira seu e-mail/); assert.doesNotMatch(text(renderer), /Senha redefinida com sucesso/);
  await act(async () => renderer.unmount());
});

test('executive PDF escapes names, SKU and category; executive CSV protects formulas and separators', async () => {
  const output = [], blobs = [];
  const dashboardDates = await load('lib/adminDashboard.ts');
  const { ExecutiveDashboard } = await load('components/partner/AdminModule.tsx', {
    '../../lib/adminDashboard': dashboardDates, '../../hooks/useFinancialMovements': {}, '../../lib/financialFlow': {},
    '../../lib/pdv': { saleRevenuePayments: sale => [{ method: 'pix', amount: sale.total }], salePaymentDescription: () => 'PIX' },
    '../../lib/exportSafety': safety, '../../lib/reportMetrics': metrics, '../../utils': { money }, './ReportsModule': {},
    '../../hooks/useStagnantStock': { useStagnantStock: () => ({}) }, '../../hooks/usePayables': {}, './AccountsModule': {},
    './CustomerAccountsModule': {}, './FinancialFlowModule': {}, './AdminFiscalModule': {}, './AdminSettingsTools': {}, '../../lib/accounts': {},
  }, { Blob, window: { open: () => ({ document: { write: html => output.push(html), close() {} }, print() {} }) },
    URL: { createObjectURL: blob => { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} }, document: { createElement: () => ({ click() {} }) },
  }, '\nexports.ExecutiveDashboard=ExecutiveDashboard;');
  const marker = '<img src=x onerror="alert(1)">'; let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(ExecutiveDashboard, {
    canExport: true,
    sales: [{ id: 'sale', status: 'concluida', created_at: new Date().toISOString(), total: 20, customer_name: '=1+1;Cliente',
      items: [{ product_id: 'product', name: marker, quantity: 1, unit_price: 20 }] }],
    products: [{ id: 'product', name: marker, sku: marker, category: marker, cost_price: 10, stock: 1 }],
    salespeople: [], customers: [], branches: [], branchFilter: '', onBranchChange() {},
  })); });
  const exports = renderer.root.findAllByProps({ className: 'admin-export-btn' });
  await act(async () => exports[0].props.onClick());
  await act(async () => exports[1].props.onClick());
  assert.ok(!output[0].includes(marker)); assert.match(output[0], /&lt;img/);
  assert.match(await blobs[0].text(), /"'=1\+1;Cliente"/);
  await act(async () => renderer.unmount());
});

test('support loads the latest 50 messages and retrieves older messages without duplicates', async () => {
  const history = Array.from({ length: 120 }, (_, index) => ({ id: 'id-' + index, user_id: 'owner', sender_role: 'cliente', message: 'Message ' + index, message_position: index + 1, created_at: new Date(Date.UTC(2026, 9, 12, 0, index)).toISOString() }));
  const limits = [];
  const client = { from() { let before = null, after = null, ascending = false; return { select(){ return this; }, eq(){ return this; }, order(_, options){ ascending = options.ascending; return this; }, lt(_, value){ before=value; return this; }, gt(_, value){ after=value; return this; }, async limit(amount){ limits.push(amount); return { data: history.filter(item => (before === null || item.message_position < before) && (after === null || item.message_position > after)).sort((a,b)=>ascending ? a.message_position-b.message_position : b.message_position-a.message_position).slice(0,amount), error: null }; } }; }, channel: () => ({ on(){ return this; }, subscribe(){ return this; } }), removeChannel(){} };
  const operations = await load('lib/operationAttempts.ts');
  const { SupportChatModule } = await load('components/partner/SupportChatModule.tsx', { '../../lib/supabase': { supabase: client }, '../../lib/operationAttempts': operations }, { window: { sessionStorage: { getItem: () => null }, setInterval: () => 1, clearInterval(){} } });
  let renderer; await act(async () => { renderer = TestRenderer.create(React.createElement(SupportChatModule, { user: { id: 'owner' } })); });
  try {
    const count = () => renderer.root.findAllByProps({ className: 'support-message cliente' }).length;
    assert.equal(count(), 50);
    for (const expected of [100, 120]) { await act(async () => renderer.root.findAllByType('button').find(button => button.children.includes('Carregar mensagens anteriores')).props.onClick()); assert.equal(count(), expected); }
    assert.deepEqual(limits, [50, 50, 50, 50]);
    assert.equal(renderer.root.findAllByType('button').some(button => button.children.includes('Carregar mensagens anteriores')), false);
  } finally { await act(async () => renderer.unmount()); }
});

test('Super Admin refresh updates the pending summary and clears a recovered error', async () => {
  let calls = 0; const client = { rpc: async () => { calls++; return calls === 1 ? { error: { message: 'Unavailable' } } : { data: { support: 3, plans: 2 }, error: null }; } };
  const { AdminPendingSummary } = await load('components/AdminActivityModule.tsx', { '../lib/supabase': { supabase: client }, '../lib/saasAdminControls': { saasAdminError: error => error.message }, '../lib/adminOverview': {} });
  let renderer; await act(async () => { renderer = TestRenderer.create(React.createElement(AdminPendingSummary, { version: 0 })); });
  assert.match(text(renderer), /Unavailable/);
  await act(async () => renderer.update(React.createElement(AdminPendingSummary, { version: 1 })));
  assert.equal(calls, 2); assert.doesNotMatch(text(renderer), /Unavailable/);
  assert.deepEqual(renderer.root.findAllByType('strong').map(node => node.children[0]), ['3', '2']);
  await act(async () => renderer.unmount());
});
