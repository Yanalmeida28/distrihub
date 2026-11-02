import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8');
const clockHelpers = {};
vm.runInNewContext(ts.transpileModule(await readFile(new URL('../../src/hooks/useAuth.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
  exports: clockHelpers, Error, window: { setTimeout: fn => fn() },
  require: name => name === '../utils' || name === '../lib/supabase' ? {} : require(name),
});
const cashExports = {};
vm.runInNewContext(ts.transpileModule(await readFile(new URL('../../src/lib/checkoutCash.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: cashExports });
async function harness({ user = { id: 'owner' }, master = false, permissionError = null, loading = false, recovery = false, clockFailures = 0, legacy = false, signoutError = false } = {}) {
  let auth, renderer, signouts = 0, checks = 0;
  const stored = new Map(legacy ? [['distrihub:operator-selection:owner:owner', JSON.stringify({ branchId: 'a', operatorId: 'employee' })]] : []);
  const storage = { getItem: key => stored.get(key) ?? null, removeItem: key => stored.delete(key) };
  function partner({ onBack, onRequestAccess }) { return React.createElement('button', { onClick: onBack, onDoubleClick: () => onRequestAccess('owner'), 'data-panel': 'partner' }, 'Sair do app'); }
  function admin({ onBack }) { return React.createElement('button', { onClick: onBack, 'data-panel': 'master' }, 'Sair do app'); }
  function login(props) { return React.createElement('div', { 'data-panel': 'login', 'data-recovery': props.recoveryMode }); }
  const dependencies = {
    './components/AppUpdateNotice': { AppUpdateNotice: props => React.createElement('aside', { 'data-update-notice': props.expectedUserId }) },
    './hooks/useAuth': { useAuth: () => auth, readWithJwtRecovery: clockHelpers.readWithJwtRecovery },
    './hooks/useSuperAdminAuth': { useSuperAdminAuth: () => ({}) },
    './hooks/useCart': { useCart: () => ({ cart: [], cartCount: 0, cartTotal: 0 }) },
    './components/CartDrawer': { CartDrawer: () => null },
    './components/HubHome': { HubHome: props => React.createElement('button', { 'data-panel': 'hub', onClick: props.onAccessPanel }) },
    './components/PartnerPanel': { PartnerPanel: partner },
    './components/AdminPanel': { AdminPanel: admin },
    './components/AuthScreen': { AuthScreen: login },
    './components/partner/PartnerAccessGate': { PartnerAccessGate: props => props.children(null, props.onSwitchAccount) },
    './lib/supabase': { supabase: { async rpc() { checks++; return clockFailures-- > 0 ? { data: null, error: { code: 'PGRST303', message: 'JWT issued at future' } } : { data: master, error: permissionError }; } } },
    './lib/b2bOrder': {},
    './lib/checkoutCash': cashExports,
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, Error, sessionStorage: storage, require: name => dependencies[name] ?? require(name) });
  auth = { user, loading, passwordRecovery: recovery, profile: null, identity: null,
    async signOut() { signouts++; if (signoutError) throw new Error('Logout failed'); auth = { ...auth, user: null }; renderer.update(React.createElement(exports.default)); } };
  await act(async () => { renderer = TestRenderer.create(React.createElement(exports.default)); });
  return { renderer, stored, get signouts() { return signouts; }, get checks() { return checks; },
    recoverClock() { clockFailures = 0; },
    async update(changes) { auth = { ...auth, ...changes }; await act(async () => renderer.update(React.createElement(exports.default))); },
    async close() { await act(async () => renderer.unmount()); } };
}

test('update notice only mounts inside an authenticated panel, never on landing, login or recovery', async () => {
  const visitor=await harness({user:null});
  assert.equal(visitor.renderer.root.findAllByType('aside').length,0);
  await act(async()=>visitor.renderer.root.findByProps({'data-panel':'hub'}).props.onClick());
  assert.ok(visitor.renderer.root.findByProps({'data-panel':'login'}));
  assert.equal(visitor.renderer.root.findAllByType('aside').length,0);
  await visitor.close();
  const signed=await harness();
  assert.ok(signed.renderer.root.findByProps({'data-update-notice':'owner'}));
  await act(async()=>signed.renderer.root.findByProps({'data-panel':'partner'}).props.onClick());
  assert.equal(signed.renderer.root.findAllByType('aside').length,0);
  await signed.close();
  for(const settings of [{recovery:true},{permissionError:new Error('denied')},{loading:true}]) {
    const blocked=await harness(settings);
    assert.equal(blocked.renderer.root.findAllByType('aside').length,0);
    await blocked.close();
  }
});

test('switching accounts ends the current session and requires a new login', async () => {
  const h = await harness();
  await act(async () => h.renderer.root.findByProps({ 'data-panel': 'partner' }).props.onDoubleClick());
  assert.equal(h.signouts, 1);
  assert.ok(h.renderer.root.findByProps({ 'data-panel': 'login' }));
  assert.equal(h.renderer.root.findAllByProps({ 'data-panel': 'partner' }).length, 0);
  await h.close();
});

test('failed account switch keeps the session and does not navigate to login', async () => {
  const h = await harness({ signoutError: true });
  await act(async () => assert.rejects(h.renderer.root.findByProps({ 'data-panel': 'partner' }).props.onDoubleClick(), /Logout failed/));
  assert.ok(h.renderer.root.findByProps({ 'data-panel': 'partner' }));
  assert.equal(h.renderer.root.findAllByProps({ 'data-panel': 'login' }).length, 0);
  await h.close();
});

test('legacy PIN selections remain available to the PIN gate without terminating the company session', async () => {
  const h = await harness({ legacy: true });
  assert.equal(h.signouts, 0);
  assert.equal(h.checks, 1);
  assert.equal(h.stored.size, 1);
  await h.close();
});

test('reload restores the partner panel from an existing session without logging out', async () => {
  const h = await harness();
  assert.equal(h.renderer.root.findByProps({ 'data-panel': 'partner' }).children[0], 'Sair do app');
  assert.equal(h.signouts, 0);
  await h.update({ user: { id: 'owner' }, session: { access_token: 'renewed' } });
  assert.equal(h.checks, 1); assert.equal(h.signouts, 0);
  assert.ok(h.renderer.root.findByProps({ 'data-panel': 'partner' }));
  await h.close();
  const reloaded = await harness();
  assert.ok(reloaded.renderer.root.findByProps({ 'data-panel': 'partner' })); assert.equal(reloaded.signouts, 0);
  await reloaded.close();
});

test('panel permission check also recovers from future JWT without inferring administrator access', async () => {
  const h=await harness({clockFailures:2});
  try { assert.equal(h.checks,3);assert.ok(h.renderer.root.findByProps({'data-panel':'partner'}));assert.equal(h.signouts,0); }
  finally { await h.close(); }
});

test('persistent clock failure in permission check stays blocked and the retry button validates again', async () => {
  const h=await harness({clockFailures:99});
  try {
    assert.equal(h.checks,4);assert.equal(h.renderer.root.findAllByProps({'data-panel':'partner'}).length,0);
    assert.match(JSON.stringify(h.renderer.toJSON()),/diferença de horário/);
    h.recoverClock();await act(async()=>h.renderer.root.findAllByType('button').find(button=>button.children.includes('Tentar novamente')).props.onClick());
    assert.equal(h.checks,5);assert.ok(h.renderer.root.findByProps({'data-panel':'partner'}));assert.equal(h.signouts,0);
  } finally { await h.close(); }
});

test('master session is restored only after server permission validation and explicit exit ends it', async () => {
  const h = await harness({ master: true });
  assert.ok(h.renderer.root.findByProps({ 'data-panel': 'master' })); assert.equal(h.checks, 1);
  await act(async () => h.renderer.root.findByProps({ 'data-panel': 'master' }).props.onClick());
  assert.equal(h.signouts, 1); assert.ok(h.renderer.root.findByProps({ 'data-panel': 'login' }));
  await h.close();
});

test('partner explicit exit shows login and a new page without session does not restore protected panels', async () => {
  const h = await harness();
  await act(async () => h.renderer.root.findByProps({ 'data-panel': 'partner' }).props.onClick());
  assert.equal(h.signouts, 1); assert.ok(h.renderer.root.findByProps({ 'data-panel': 'login' })); await h.close();
  const loggedOut = await harness({ user: null });
  assert.equal(loggedOut.checks, 0); assert.ok(loggedOut.renderer.root.findByProps({ 'data-panel': 'hub' }));
  await loggedOut.close();
});

test('loading and permission errors do not show login or silently terminate a saved session', async () => {
  const loading = await harness({ loading: true });
  assert.match(JSON.stringify(loading.renderer.toJSON()), /Recuperando sua sessão/); assert.equal(loading.checks, 0);
  await loading.update({ loading: false }); assert.ok(loading.renderer.root.findByProps({ 'data-panel': 'partner' })); await loading.close();
  const failed = await harness({ permissionError: { message: 'Network unavailable' } });
  assert.match(JSON.stringify(failed.renderer.toJSON()), /Tentar novamente/); assert.equal(failed.signouts, 0);
  assert.equal(failed.renderer.root.findAllByProps({ 'data-panel': 'login' }).length, 0); await failed.close();
});

test('a recoverable session error shows recovery instead of a login screen', async () => {
  const h = await harness({ user: null });
  await h.update({ sessionRecoveryError: 'Conexão indisponível', retrySession() {} });
  assert.match(JSON.stringify(h.renderer.toJSON()), /Conexão indisponível/);
  assert.match(JSON.stringify(h.renderer.toJSON()), /Tentar novamente/);
  assert.equal(h.renderer.root.findAllByProps({ 'data-panel': 'login' }).length, 0);
  assert.equal(h.signouts, 0);
  await h.close();
});

for (const mode of ['error-result', 'rejected-promise']) test(`mobile recovery retains authentication on ${mode} and retries without password`, async () => {
  let current, listener, calls = 0, signouts = 0;
  const events = new Map();
  const session = { user: { id: 'owner' }, access_token: 'renewed' };
  const client = { from: table => ({
    select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
    async maybeSingle() { return { data: table === 'partner_profiles' ? { id: 'owner' } : null, error: null }; },
  }), auth: {
    async getSession() {
      calls++;
      if (calls === 1) {
        if (mode === 'rejected-promise') throw new Error('Offline');
        return { data: { session: null }, error: { message: 'Network unavailable' } };
      }
      return { data: { session }, error: null };
    },
    onAuthStateChange(callback) { listener = callback; callback('INITIAL_SESSION', null); return { data: { subscription: { unsubscribe() {} } } }; },
    async signOut() { signouts++; return { error: null }; },
  } };
  const exports = {};
  const authSource = await readFile(new URL('../../src/hooks/useAuth.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(authSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
    exports, Error, window: { setTimeout: callback => callback(), addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) },
    require: name => name === '../utils' ? {} : name === '../lib/supabase' ? { supabase: client, isSupabaseConfigured: true } : require(name),
  });
  function Probe() { current = exports.useAuth(); return null; }
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
  try {
    assert.equal(current.user, null);
    assert.equal(current.loading, false);
    assert.match(current.sessionRecoveryError, /recuperar sua sessão/);
    assert.equal(signouts, 0);
    await act(async () => events.get('online')());
    assert.equal(calls, 2);
    assert.equal(current.user.id, 'owner');
    assert.equal(current.identity.companyUserId, 'owner');
    assert.equal(current.sessionRecoveryError, null);
    await act(async () => listener('SIGNED_OUT', null));
    assert.equal(current.user, null);
    assert.equal(current.identity, null);
  } finally { await act(async () => renderer.unmount()); }
});

test('password recovery remains on its reset screen and session removal closes a protected panel', async () => {
  const recovery = await harness({ recovery: true });
  assert.ok(recovery.renderer.root.findByProps({ 'data-panel': 'login', 'data-recovery': true })); assert.equal(recovery.checks, 0); await recovery.close();
  const h = await harness(); await h.update({ user: null });
  assert.ok(h.renderer.root.findByProps({ 'data-panel': 'login' })); await h.close();
});

test('a delayed initial session cannot overwrite login, token refresh preserves identity, and failed exit retains the session', async () => {
  let current, listener, finishInitial, profileReads = 0;
  const initial = new Promise(resolve => { finishInitial = resolve; });
  const user = { id: 'owner' };
  const client = { from: table => ({
    select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
    async maybeSingle() { if (table === 'partner_profiles') profileReads++; return { data: table === 'partner_profiles' ? { id: 'owner', business_name: 'Loja' } : null, error: null }; },
  }), auth: {
    getSession: () => initial,
    onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    async signOut(options) { assert.equal(options.scope,'local'); return { error: { message: 'Não foi possível sair' } }; },
  } };
  const exports = {};
  const authSource = await readFile(new URL('../../src/hooks/useAuth.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(authSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
    exports, Error, window: { setTimeout: callback => callback() },
    require: name => name === '../utils' ? {} : name === '../lib/supabase' ? { supabase: client, isSupabaseConfigured: true } : require(name),
  });
  function Probe() { current = exports.useAuth(); return null; }
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
  await act(async () => { listener('SIGNED_IN', { user, access_token: 'first' }); });
  assert.equal(current.user.id, 'owner'); const reads = profileReads;
  await act(async () => finishInitial({ data: { session: null } }));
  assert.equal(current.user.id, 'owner'); assert.equal(current.identity.companyUserId, 'owner');
  await act(async () => listener('TOKEN_REFRESHED', { user, access_token: 'renewed' }));
  assert.equal(profileReads, reads); assert.equal(current.session.access_token, 'renewed');
  await act(async () => { await assert.rejects(current.signOut(), /Não foi possível sair/); });
  assert.equal(current.user.id, 'owner'); assert.equal(current.identity.companyUserId, 'owner');
  await act(async () => renderer.unmount());
});
