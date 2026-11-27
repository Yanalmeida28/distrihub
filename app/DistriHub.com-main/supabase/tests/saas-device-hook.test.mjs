import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';

const source = ts.transpileModule(await readFile(new URL('../../src/hooks/useDeviceHeartbeat.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
let renderer;
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });
async function harness(rpc) {
  const exports = {}; const storage = new Map(); let tick;
  vm.runInNewContext(source, {
    exports, Error, crypto: { randomUUID: () => 'device-1' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    window: { setInterval(fn) { tick = fn; return 1; }, clearInterval() {}, addEventListener() {}, removeEventListener() {} },
    require: name => name === 'react' ? React : { supabase: { rpc } },
  });
  let current;
  function Probe({ id, branch }) { current = exports.useDeviceHeartbeat(id, branch); return null; }
  await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, { id: 'owner', branch: 'branch-1' })); });
  return { get current() { return current; }, async tick() { await act(async () => tick()); },
    async switchBranch(branch) { await act(async () => renderer.update(React.createElement(Probe, { id: 'owner', branch }))); } };
}
test('admissão respeita erro retornado pela RPC e permite repetir depois da liberação de uma vaga', async () => {
  let full = true;
  const h = await harness(async () => full ? { error: { message: 'Limite de 3 dispositivos atingido' } } : { data: 'admitted' });
  assert.equal(h.current.ready, false); assert.match(h.current.error, /Limite de 3/);
  full = false; await act(async () => h.current.retry());
  assert.equal(h.current.ready, true); assert.equal(h.current.error, null);
});
test('heartbeat que encontra revogação fecha o acesso já admitido', async () => {
  let revoked = false;
  const h = await harness(async () => revoked ? { error: { message: 'Sessão encerrada' } } : { data: 'admitted' });
  assert.equal(h.current.ready, true); revoked = true; await h.tick();
  assert.equal(h.current.ready, false); assert.match(h.current.error, /encerrada/);
});
test('resposta atrasada da filial anterior não libera a filial cheia', async () => {
  let release;
  const h = await harness(async (_name, args) => args.p_branch_id === 'branch-1'
    ? new Promise(resolve => { release = resolve; }) : { error: { message: 'Filial cheia' } });
  await h.switchBranch('branch-2'); assert.equal(h.current.ready, false);
  await act(async () => release({ data: 'admitted' }));
  assert.equal(h.current.ready, false); assert.equal(h.current.error, 'Filial cheia');
});
test('falha de rede impede operação até nova validação no servidor', async () => {
  let offline = false;
  const h = await harness(async () => { if (offline) throw new Error('Sem conexão'); return { data: 'admitted' }; });
  offline = true; await h.tick(); assert.equal(h.current.ready, false); assert.match(h.current.error, /conexão/);
  offline = false; await h.tick(); assert.equal(h.current.ready, true);
});
test('uma falha de transporte mantém o mesmo terminal aberto e exige validação de outra filial', async () => {
  let status = 200;
  const h = await harness(async () => ({
    status,
    error: status === 0 ? { message: 'TypeError: Failed to fetch' } : status === 403 ? { message: 'Sessão encerrada' } : null,
  }));
  assert.equal(h.current.ready, true);
  status = 0;
  await h.tick();
  assert.equal(h.current.ready, true);
  assert.equal(h.current.interrupted, true);
  await h.switchBranch('branch-2');
  assert.equal(h.current.ready, false);
  status = 200;
  await h.tick();
  assert.equal(h.current.ready, true);
  assert.equal(h.current.interrupted, false);
  status = 403;
  await h.tick();
  status = 0;
  await h.tick();
  assert.equal(h.current.ready, false);
  assert.equal(h.current.error, 'Sessão encerrada');
});
