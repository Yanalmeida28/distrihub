import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';

const require = createRequire(import.meta.url);
const read = path => readFile(new URL('../../src/' + path, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText;
const helperSource = compile(await read('lib/partnerAccess.ts'));
const gateSource = compile(await read('components/partner/PartnerAccessGate.tsx'));
const cashExports = {};
vm.runInNewContext(compile(await read('lib/checkoutCash.ts')), { exports: cashExports });
const identity = { authUserId: 'company', companyUserId: 'company', salespersonId: null, branchId: null, role: 'administrador' };
const user = { id: 'company', email: 'owner@example.test' };
const employee = { company_id: 'company', salesperson_id: 'employee', branch_id: 'north', role: 'caixa' };

function harness({ reply = { data: [employee], error: null }, scope = { can_access_all_branches: false, branches: [{ id: 'north', name: 'Varejo' }] }, directory = [{ id: 'employee', name: 'Ana', active: true, branch_id: 'north', branch_name: 'Varejo' }, { id: 'inactive', name: 'Ana', active: false, branch_id: 'south', branch_name: 'Atacado' }], passwordUser = 'company', saved = null, savedSession = null, issuedSession = null, device = { ready: true, error: null, retry() {} } } = {}) {
  const calls = [], storage = new Map();
  if (saved) storage.set('distrihub:operator-selection:company:company', JSON.stringify(saved));
  if (savedSession) storage.set('distrihub:operator-session:company:company', JSON.stringify(savedSession));
  const sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const client = {
    from(table) {
      calls.push({ table });
      const q = { select(columns) { calls.push({ columns }); return q; }, eq() { return q; }, order() { return q; },
        then(resolve) { return Promise.resolve({ data: [{ id: 'employee', name: 'Ana' }], error: null }).then(resolve); } };
      return q;
    },
    async rpc(name, args) { calls.push({ name, args });
      if (name === 'create_partner_operator_session') return { data: typeof issuedSession === 'function' ? await issuedSession() : issuedSession, error: null };
      if (name === 'revoke_partner_operator_session') return { data: null, error: null };
      if (name === 'list_partner_operator_directory') return { data: directory, error: null };
      if (name === 'read_partner_operator_branch_access') return { data: scope, error: null };
      if (name === 'verify_partner_owner_password') return { data: args.p_password === 'owner-secret' && passwordUser === 'company', error: null };
      return typeof reply === 'function' ? reply() : reply; },
  };
  const deps = { supabase: client, createOwnerVerificationClient() {
    calls.push({ verifier: true });
    return { auth: {
      async signInWithPassword(args) { calls.push({ passwordEmail: args.email }); return {
        data: { user: args.password === 'owner-secret' ? { id: passwordUser } : null }, error: args.password === 'owner-secret' ? null : new Error('Invalid password'),
      }; },
      async signOut(args) { calls.push({ verifierSignOut: args.scope }); return { error: null }; },
    } };
  } };
  const api = {};
  vm.runInNewContext(helperSource, { exports: api, Error, setTimeout: callback => { callback(); }, require: name => name === './supabase' ? deps : require(name) });
  const components = {};
  vm.runInNewContext(gateSource, { exports: components, Error, sessionStorage,
    require: name => name === '../../lib/supabase' ? deps : name === '../../lib/partnerAccess' ? api
      : name === '../../lib/checkoutCash' ? cashExports
      : name === '../../hooks/useDeviceHeartbeat' ? { useDeviceHeartbeat: () => device } : require(name),
  });
  return { ...api, ...components, calls, storage };
}

test('PIN authorizes the server-assigned branch directly without choosing a branch or logging out', async () => {
  const h = harness();
  const access = await h.authorizePin(identity, 'employee', 'Ana', '1234');
  assert.equal(access.kind, 'employee'); assert.equal(access.operator.branchId, 'north'); assert.equal(access.operator.role, 'caixa');
  const rpc = h.calls.find(call => call.name);
  assert.equal(rpc.name, 'resolve_partner_pdv_operator');
  assert.equal(rpc.args.p_requested_branch_id, null);
  assert.equal(rpc.args.p_pin, '1234');
  assert.equal(h.calls.some(call => call.verifier), false);
});

test('the real PartnerPanel renders its own menus while all operational hooks and module prefetch remain disabled', async () => {
  const calls = [], exports = {};
  const partner = { loading: false, syncing: false, settings: null, profile: null,
    branches: [], salespeople: [], suppliers: [], categories: [], products: [], movements: [], sales: [], customers: [], rmas: [], invoices: [], orders: [] };
  const dependencies = {
    './ModuleBoundary': { ModuleBoundary: ({ children }) => children },
    '../hooks/usePartnerData': { usePartnerData: value => { calls.push(['data', value]); return partner; } },
    '../hooks/useDeviceHeartbeat': { useDeviceHeartbeat: value => { calls.push(['device', value]); return { ready: false }; } },
    '../hooks/useSaasSubscription': { useSaasSubscription: value => { calls.push(['subscription', value]); return { loading: false, subscription: null }; } },
    '../hooks/useSupportUnread': { useSupportUnread: value => { calls.push(['unread', value]); return { total: 0 }; } },
    '../hooks/useCheckoutCash': { useCheckoutCash: (...args) => { calls.push(['cash', args[5]]); return { refresh() { throw new Error('Unexpected cash read'); } }; } },
    '../hooks/useSessionDraft': { useSessionDraftState: (_key, initial) => React.useState(initial) },
    '../lib/partnerSync': { branchDirectoryRows: rows => rows },
    '../lib/storeTheme': { storeTheme: () => ({}) },
    '../lib/checkoutCash': cashExports,
    '../lib/moduleLoading': { moduleLoader: () => () => { throw new Error('Unexpected module prefetch'); } },
    './partner/HelpModule': { HelpModule: props => React.createElement('section', { 'data-help': true },
      React.createElement('button', { 'data-help-back': true, onClick: props.onBack }, 'Back')) },
  };
  vm.runInNewContext(compile(await read('components/PartnerPanel.tsx')), { exports, Error,
    require: name => dependencies[name] ?? (name.startsWith('.') ? new Proxy({}, { get: () => () => null }) : require(name)),
  });
  let renderer;
  const requests = [];
  await act(async () => { renderer = TestRenderer.create(React.createElement(exports.PartnerPanel, {
    accessLocked: true, pinOperator: null, user, identity, identityError: null,
    segment: 'assistencia', onBack() {}, onRequestAccess: mode => requests.push(mode),
  })); });
  try {
    assert.equal(renderer.root.findAllByProps({ className: 'partner-panel sidebar-layout' }).length, 1);
    assert.equal(renderer.root.findAllByType('form').length, 0);
    for (const label of ['Financeiro', 'Cadastros', 'PDV & Vendas']) {
      const button = renderer.root.findByProps({ 'aria-label': label });
      await act(async () => { button.props.onPointerEnter(); button.props.onClick(); });
      assert.equal(renderer.root.findAllByType('form').length, 0);
    }
    assert.ok(calls.filter(([kind]) => kind === 'data').every(([, value]) => value === null));
    assert.ok(calls.filter(([kind]) => ['device', 'subscription', 'unread'].includes(kind)).every(([, value]) => value === undefined));
    assert.ok(calls.filter(([kind]) => kind === 'cash').every(([, value]) => value === false));
    assert.equal(renderer.root.findByProps({ 'aria-label': 'Sincronizar' }).props.disabled, true);
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Ajuda' }).props.onClick());
    assert.equal(renderer.root.findAllByProps({ 'data-help': true }).length, 1);
    assert.ok(calls.filter(([kind]) => kind === 'data').every(([, value]) => value === null));
    assert.ok(calls.filter(([kind]) => ['device', 'subscription', 'unread'].includes(kind)).every(([, value]) => value === undefined));
    await act(async () => renderer.root.findByProps({ 'data-help-back': true }).props.onClick());
    assert.equal(renderer.root.findAllByProps({ 'data-help': true }).length, 0);
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Trocar operador por PIN' }).props.onClick());
    assert.deepEqual(requests, ['employee']);
  } finally { await act(async () => renderer.unmount()); }
});

test('wrong PIN, missing branch, foreign company and ambiguous RPC replies never grant owner or employee access', async () => {
  for (const reply of [{ data: null, error: new Error('Bad PIN') },
    { data: [{ ...employee, branch_id: null }], error: null },
    { data: [{ ...employee, company_id: 'foreign' }], error: null },
    { data: [employee, employee], error: null },
    { data: [{ ...employee, salesperson_id: 'other' }], error: null }]) {
    await assert.rejects(harness({ reply }).authorizePin(identity, 'employee', 'Ana', '1234'));
  }
  await assert.rejects(harness().authorizePin(identity, 'employee', 'Ana', ''));
});

test('authorized administrators and managers revalidate their PIN when requesting another branch', async () => {
  for (const role of ['administrador', 'gerente']) {
    const h = harness({ reply: { data: [{ ...employee, role, branch_id: 'south' }], error: null },
      scope: { can_access_all_branches: true, branches: [{ id: 'north', name: 'Atacado' }, { id: 'south', name: 'Varejo' }] } });
    const access = await h.authorizePin({ ...identity, salespersonId: 'employee', branchId: 'north' }, 'employee', 'Ana', '1234', 'south');
    assert.equal(access.operator.branchId, 'south');
    assert.equal(access.operator.canAccessAllBranches, true);
    assert.equal(h.calls[0].args.p_requested_branch_id, 'south');
    assert.equal(h.calls[1].name, 'read_partner_operator_branch_access');
  }
  for (const scope of [null, {}, { can_access_all_branches: true, branches: [] },
    { can_access_all_branches: false, branches: [{ id: 'north', name: 'Atacado' }] }]) {
    await assert.rejects(harness({ scope, reply: { data: [{ ...employee, role: 'gerente', branch_id: 'south' }], error: null } })
      .authorizePin(identity, 'employee', 'Ana', '1234', 'south'));
  }
  await assert.rejects(harness().authorizePin(identity, 'employee', 'Ana', '1234', 'south'));
});

test('owner access verifies its password on the server without signing in or changing the login session', async () => {
  const h = harness();
  await assert.rejects(h.authorizeOwner(identity, user, 'bad-password'));
  assert.equal((await h.authorizeOwner(identity, user, 'owner-secret')).kind, 'owner');
  assert.ok(h.calls.some(call => call.name === 'verify_partner_owner_password'));
  assert.equal(h.calls.some(call => call.verifier || call.passwordEmail), false);
  await assert.rejects(harness({ passwordUser: 'someone-else' }).authorizeOwner(identity, user, 'owner-secret'));
  await assert.rejects(h.authorizeOwner({ ...identity, salespersonId: 'employee' }, user, 'owner-secret'));
});

async function render(h, openOperator = true) {
  let renderer, logouts = 0;
  const props = { user, identity, onSwitchAccount: async () => { logouts++; }, children: (operator, requestAccess, accessLocked) =>
    React.createElement('main', { 'data-partner-panel': true, 'data-locked': accessLocked, 'data-workspace': accessLocked ? undefined : true, 'data-operator': operator?.id ?? 'owner', 'data-branch': operator?.branchId ?? 'all' },
      React.createElement('button', { 'data-switch': true, 'aria-label': 'Trocar operador por PIN', onClick: () => requestAccess('employee') }, 'Trocar operador'),
      React.createElement('button', { 'data-owner': true, onClick: () => requestAccess('owner') }, 'Área do proprietário')) };
  await act(async () => { renderer = TestRenderer.create(React.createElement(h.PartnerAccessGate, props)); });
  if (openOperator) await act(async () => renderer.root.findByProps({ 'aria-label': 'Trocar operador por PIN' }).props.onClick());
  return { renderer, props, get logouts() { return logouts; }, async close() { await act(async () => renderer.unmount()); } };
}
const submit = view => view.renderer.root.findByType('form').props.onSubmit({ preventDefault() {} });

test('reload restores an opaque operator session only after server validation, never from a saved selection', async () => {
  const credential = 'ops_' + 'a'.repeat(64);
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  const h = harness({ issuedSession: { credential, expires_at: expiresAt } });
  let view = await render(h);
  await enterPin(view);
  const savedSession = JSON.parse(h.storage.get('distrihub:operator-session:company:company'));
  assert.equal(savedSession.credential, credential);
  assert.equal(savedSession.branchId, 'north');
  assert.doesNotMatch(JSON.stringify(savedSession), /1234|role|allowedBranches/);
  await view.close();
  const restored = harness({ savedSession });
  view = await render(restored, false);
  assert.equal(view.renderer.root.findByProps({ 'data-workspace': true }).props['data-operator'], 'employee');
  assert.equal(view.renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
  assert.equal(restored.calls.find(call => call.name === 'resolve_partner_pdv_operator').args.p_pin, credential);
  await view.close();
  for (const config of [
    { savedSession, reply: { data: null, error: new Error('revoked') } },
    { savedSession: { ...savedSession, expiresAt: '2000-01-01' } },
    { savedSession: { ...savedSession, credential: '1234' } },
  ]) {
    const denied = await render(harness(config), false);
    assert.equal(denied.renderer.root.findAllByProps({ 'data-workspace': true }).length, 0);
    await denied.close();
  }
});
test('F5 retries temporary validation and recovers without entering the PIN again', async () => {
  const savedSession = { operatorId:'employee', operatorName:'Ana', branchId:'north', credential:'ops_'+'c'.repeat(64), expiresAt:new Date(Date.now()+3600000).toISOString() };
  let attempts=0;
  const h=harness({savedSession,reply:()=>++attempts===1
    ? {data:null,error:{code:'PGRST303',message:'JWT issued at future'}}
    : {data:[employee],error:null}});
  let view=await render(h,false);
  assert.equal(attempts,2);
  assert.equal(view.renderer.root.findByProps({'data-workspace':true}).props['data-operator'],'employee');
  await view.close();
  let recovered=false;
  const retry=harness({savedSession,reply:()=>recovered?{data:[employee],error:null}:{data:null,error:new Error('unavailable')}});
  view=await render(retry,false);
  assert.equal(view.renderer.root.findAllByProps({'data-workspace':true}).length,0);
  recovered=true;
  await act(async()=>view.renderer.root.findAllByType('button').find(button=>button.children.includes('Retomar operador')).props.onClick());
  assert.equal(view.renderer.root.findByProps({'data-workspace':true}).props['data-operator'],'employee');
  assert.equal(retry.calls.filter(call=>call.name==='create_partner_operator_session').length,0);
  assert.ok(retry.calls.filter(call=>call.name==='resolve_partner_pdv_operator').every(call=>call.args.p_pin===savedSession.credential));
  await view.close();
});

test('PIN confirmation stays busy until the reload credential is saved and refuses duplicate requests', async () => {
  let finish, pending;
  const h = harness({ issuedSession: () => new Promise(resolve => { finish = resolve; }) });
  const view = await render(h);
  await act(async () => view.renderer.root.findByProps({ 'aria-label': 'Colaborador' }).props.onChange({ target: { value: 'employee' } }));
  await act(async () => view.renderer.root.findByProps({ 'aria-label': 'PIN de acesso' }).props.onChange({ target: { value: '1234' } }));
  await act(async () => { pending = submit(view); });
  assert.equal(view.renderer.root.findByProps({ 'aria-label': 'PIN de acesso' }).props.disabled, true);
  await act(async () => submit(view));
  assert.equal(h.calls.filter(call => call.name === 'create_partner_operator_session').length, 1);
  await act(async () => { finish({ credential: 'ops_'+'b'.repeat(64), expires_at: new Date(Date.now()+3600000).toISOString() }); await pending; });
  assert.ok(view.renderer.root.findByProps({ 'data-workspace': true }));
  await view.close();
});

test('login opens the app menus without a PIN screen or any operational data query', async () => {
  const h = harness(), view = await render(h, false);
  try {
    assert.equal(view.renderer.root.findByProps({ 'data-partner-panel': true }).props['data-locked'], true);
    assert.equal(view.renderer.root.findAllByProps({ 'data-workspace': true }).length, 0);
    assert.equal(view.renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
    assert.equal(view.renderer.root.findAllByProps({ 'aria-label': 'Colaborador' }).length, 0);
    assert.equal(view.renderer.root.findAllByProps({ 'aria-label': 'PIN de acesso' }).length, 0);
    assert.equal(h.calls.length, 0);
    assert.equal(view.renderer.root.findAllByType('button').some(button => button.children.includes('Entrar com PIN')), false);
    assert.equal(view.renderer.root.findAllByProps({ 'aria-label': 'Senha do proprietário' }).length, 0);
    const ownerButton = view.renderer.root.findAllByType('button').find(button => button.children.some(child => typeof child === 'string' && child.trim() === 'Área do proprietário'));
    await act(async () => ownerButton.props.onClick());
    assert.equal(view.renderer.root.findAllByProps({ 'aria-label': 'Senha do proprietário' }).length, 1);
    assert.equal(h.calls.filter(call => call.table).length, 0);
    await act(async () => view.renderer.root.findByProps({ 'aria-label': 'Fechar' }).props.onClick());
    assert.equal(view.renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
    assert.equal(view.renderer.root.findAllByProps({ 'aria-label': 'PIN de acesso' }).length, 0);
    await act(async () => view.renderer.root.findByProps({ 'aria-label': 'Trocar operador por PIN' }).props.onClick());
    assert.equal(view.renderer.root.findAllByProps({ 'aria-label': 'PIN de acesso' }).length, 1);
    assert.equal(h.calls.filter(call => call.name === 'list_partner_operator_directory').length, 1);
    await act(async () => view.renderer.root.findByProps({ 'aria-label': 'Fechar' }).props.onClick());
    assert.equal(view.renderer.root.findAllByProps({ 'data-workspace': true }).length, 0);
  } finally { await view.close(); }
});

test('operator directory identifies branches and inactive duplicates without reading business tables', async () => {
  const h = harness(), view = await render(h);
  try {
    assert.equal(h.calls.filter(call => call.table).length, 0);
    const options = view.renderer.root.findAllByType('option');
    assert.ok(options.some(o => o.children.join('').includes('Ana — Varejo')));
    assert.ok(options.some(o => o.children.join('').includes('Ana — Atacado') && o.props.disabled));
    const refresh = view.renderer.root.findAllByType('button').find(b => b.children.join('').includes('Atualizar operadores'));
    await act(async () => refresh.props.onClick());
    assert.equal(h.calls.filter(c => c.name === 'list_partner_operator_directory').length, 2);
    await enterPin(view);
    assert.equal(view.renderer.root.findByProps({ 'data-workspace': true }).props['data-branch'], 'north');
  } finally { await view.close(); }
});

async function enterPin(view, pin = '1234') {
  await act(async () => view.renderer.root.findByProps({ 'aria-label': 'Colaborador' }).props.onChange({ target: { value: 'employee' } }));
  await act(async () => view.renderer.root.findByProps({ 'aria-label': 'PIN de acesso' }).props.onChange({ target: { value: pin } }));
  await act(async () => submit(view));
}

test('operational content stays locked until PIN confirmation; PIN staff open their branch without email or password fields', async () => {
  const h = harness(), view = await render(h);
  try {
    assert.equal(view.renderer.root.findAllByProps({ 'data-workspace': true }).length, 0);
    assert.equal(h.calls.some(call => call.table || call.columns), false);
    assert.equal(view.renderer.root.findAllByProps({ 'aria-label': 'Senha do proprietário' }).length, 0);
    await enterPin(view);
    const workspace = view.renderer.root.findByProps({ 'data-workspace': true });
    assert.equal(workspace.props['data-operator'], 'employee'); assert.equal(workspace.props['data-branch'], 'north');
    assert.equal(view.logouts, 0);
    assert.doesNotMatch([...h.storage.values()].join(''), /1234|owner-secret/);
  } finally { await view.close(); }
});

test('the existing operator switch opens a collaborator-only dialog after initial PIN entry', async () => {
  const view = await render(harness());
  try {
    await enterPin(view);
    await act(async () => view.renderer.root.findByProps({ 'data-switch': true }).props.onClick());
    const dialog = view.renderer.root.findByProps({ role: 'dialog' });
    assert.equal(dialog.findAllByProps({ 'aria-label': 'PIN de acesso' }).length, 1);
    assert.equal(dialog.findAllByProps({ 'aria-label': 'Senha do proprietário' }).length, 0);
    await act(async () => dialog.findByProps({ 'aria-label': 'Fechar' }).props.onClick());
    assert.equal(view.renderer.root.findByProps({ 'data-workspace': true }).props['data-operator'], 'employee');
    assert.equal(view.renderer.root.findAllByProps({ 'data-locked-workspace': 'true' }).length, 0);
  } finally { await view.close(); }
});

test('returning from PIN staff to owner requires the password; bad password preserves the employee branch', async () => {
  const h = harness(), view = await render(h);
  try {
    await enterPin(view);
    await act(async () => view.renderer.root.findByProps({ 'data-owner': true }).props.onClick());
    assert.equal(view.renderer.root.findByProps({ 'data-workspace': true }).props['data-operator'], 'employee');
    const password = () => view.renderer.root.findByProps({ 'aria-label': 'Senha do proprietário' });
    await act(async () => password().props.onChange({ target: { value: 'wrong' } }));
    await act(async () => submit(view));
    assert.ok(view.renderer.root.findByProps({ role: 'alert' }));
    assert.equal(view.renderer.root.findByProps({ 'data-workspace': true }).props['data-branch'], 'north');
    await act(async () => password().props.onChange({ target: { value: 'owner-secret' } }));
    await act(async () => submit(view));
    assert.equal(view.renderer.root.findByProps({ 'data-workspace': true }).props['data-operator'], 'owner');
    assert.equal(view.logouts, 0);
  } finally { await view.close(); }
});

test('reload restores only the name, never the PIN or owner access', async () => {
  for (const operatorId of ['employee', null]) {
    const h = harness({ saved: { operatorId, branchId: 'south' } }), view = await render(h);
    try {
      assert.equal(view.renderer.root.findAllByProps({ 'data-workspace': true }).length, 0);
      assert.equal(view.renderer.root.findByProps({ 'aria-label': 'PIN de acesso' }).props.value, '');
      if (operatorId) assert.equal(view.renderer.root.findByProps({ 'aria-label': 'Colaborador' }).props.value, 'employee');
    } finally { await view.close(); }
  }
});

test('wrong PIN cannot mount any workspace or fall back to free access', async () => {
  const view = await render(harness({ reply: { data: null, error: new Error('Wrong PIN') } }));
  try { await enterPin(view); assert.equal(view.renderer.root.findAllByProps({ 'data-workspace': true }).length, 0);
    assert.ok(view.renderer.root.findByProps({ role: 'alert' }));
  } finally { await view.close(); }
});

test('pending PIN validation blocks duplicate submission and its late reply is ignored after unmount', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = harness({ reply: () => pending }), view = await render(h);
  await act(async () => view.renderer.root.findByProps({ 'aria-label': 'Colaborador' }).props.onChange({ target: { value: 'employee' } }));
  await act(async () => view.renderer.root.findByProps({ 'aria-label': 'PIN de acesso' }).props.onChange({ target: { value: '1234' } }));
  await act(async () => { void submit(view); void submit(view); });
  assert.equal(h.calls.filter(call => call.name === 'resolve_partner_pdv_operator').length, 1);
  await view.close();
  await act(async () => finish({ data: [employee], error: null }));
  assert.equal(h.storage.size, 0);
});
