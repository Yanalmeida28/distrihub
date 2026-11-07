import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require = createRequire(import.meta.url);
const React = require('react');
const Renderer = require('react-test-renderer');
const { act } = Renderer;
const source = await readFile(new URL('../../src/hooks/useAuth.ts', import.meta.url), 'utf8');

async function harness({employee=null}={}) {
  let state, listener, gate = null;
  const timers = [], reads = [];
  const client = { auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
  }, from(table) {
    let user;
    return { select() { return this; }, eq(_key, value) { user = value; return this; }, order() { return this; }, limit() { return this; },
      async maybeSingle() { reads.push({ table, user }); if (gate) await gate; return { data: table === 'partner_profiles' ? { id: user } : employee, error: null }; },
    };
  } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
    exports, Error, window: { setTimeout: fn => timers.push(fn) },
    require: name => name === '../utils' ? {} : name === '../lib/supabase' ? { supabase: client, isSupabaseConfigured: true } : require(name),
  });
  function Probe() { state = exports.useAuth(); return null; }
  let view;
  await act(async () => { view = Renderer.create(React.createElement(Probe)); });
  return { get state() { return state; }, reads,
    emit: (event, id) => listener(event, id ? { user: { id }, access_token: event + id } : null),
    flush() { for (const fn of timers.splice(0)) fn(); },
    pause() { let resolve; gate = new Promise(r => { resolve = r; }); return () => { gate = null; resolve(); }; },
    close: () => act(async () => view.unmount()),
  };
}

test('owner reuses the verified profile in the same login, but never across logouts', async () => {
  const h=await harness();
  try {
    await act(async()=>{h.emit('SIGNED_IN','owner');h.flush();});
    assert.equal(h.state.identity.companyUserId,'owner');
    assert.equal(h.reads.filter(r=>r.table==='partner_profiles').length,1);
    await act(async()=>{h.emit('SIGNED_OUT');h.flush();});
    await act(async()=>{h.emit('SIGNED_IN','owner');h.flush();});
    assert.equal(h.reads.filter(r=>r.table==='partner_profiles').length,2);
  }finally{await h.close();}
});

test('employee still resolves its company profile and inactive membership cannot become owner', async () => {
  const employee={id:'staff',user_id:'company',active:true,role:'caixa',branch_id:'branch'};
  const h=await harness({employee});
  try{
    await act(async()=>{h.emit('SIGNED_IN','employee');h.flush();});
    assert.equal(h.state.identity.companyUserId,'company');assert.equal(h.state.profile.id,'company');
    assert.deepEqual(h.reads.filter(r=>r.table==='partner_profiles').map(r=>r.user),['company']);
  }finally{await h.close();}
  const inactive=await harness({employee:{...employee,active:false}});
  try{
    await act(async()=>{inactive.emit('SIGNED_IN','employee');inactive.flush();});
    assert.equal(inactive.state.identity,null);assert.equal(inactive.state.profile,null);
    assert.equal(inactive.reads.filter(r=>r.table==='partner_profiles').length,0);
  }finally{await inactive.close();}
});

test('queued login cannot restore the user, profile or identity after logout', async () => {
  const h = await harness();
  try {
    await act(async () => { h.emit('SIGNED_IN', 'old'); h.emit('SIGNED_OUT'); h.flush(); });
    assert.equal(h.state.user, null); assert.equal(h.state.identity, null); assert.equal(h.state.profile, null);
    assert.equal(h.reads.length, 0);
  } finally { await h.close(); }
});

test('only the most recent queued account can load its identity', async () => {
  const h = await harness();
  try {
    await act(async () => { h.emit('SIGNED_IN', 'old'); h.emit('SIGNED_IN', 'new'); h.flush(); });
    assert.equal(h.state.user.id, 'new'); assert.equal(h.state.identity.companyUserId, 'new'); assert.equal(h.state.profile.id, 'new');
    assert.ok(h.reads.every(read => read.user === 'new'));
  } finally { await h.close(); }
});

test('an identity response in flight is invalidated before the next login timer starts', async () => {
  const h = await harness();
  try {
    const release = h.pause();
    await act(async () => { h.emit('SIGNED_IN', 'old'); h.flush(); });
    await act(async () => { h.emit('SIGNED_IN', 'new'); release(); });
    assert.equal(h.state.user.id, 'new'); assert.equal(h.state.identity, null); assert.equal(h.state.profile, null);
    await act(async () => h.flush());
    assert.equal(h.state.identity.companyUserId, 'new'); assert.equal(h.state.profile.id, 'new');
  } finally { await h.close(); }
});

test('switching an already resolved account clears its profile immediately and renewal preserves the current account', async () => {
  const h = await harness();
  try {
    await act(async () => { h.emit('SIGNED_IN', 'old'); h.flush(); });
    await act(async () => h.emit('SIGNED_IN', 'new'));
    assert.equal(h.state.identity, null); assert.equal(h.state.profile, null);
    await act(async () => h.flush());
    const identity = h.state.identity, reads = h.reads.length;
    await act(async () => { h.emit('TOKEN_REFRESHED', 'new'); h.flush(); });
    assert.equal(h.state.identity, identity); assert.equal(h.reads.length, reads);
  } finally { await h.close(); }
});

test('unmounting prevents queued authentication work from running', async () => {
  const h = await harness();
  await act(async () => h.emit('SIGNED_IN', 'old'));
  await h.close();
  await act(async () => h.flush());
  assert.equal(h.reads.length, 0);
});
