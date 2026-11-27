import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';
import { hasTerminal, openTerminal, prepareSnapshot, recordSale, remainingStock, terminalMatches } from '../../public/contingencia/storage.js';

const snapshot = {
  scope: 'company:operator', branchId: 'branch', branchName: 'Central', cashId: 'cash',
  products: [{ id: 'p', name: 'Produto reservado', sku: '1', barcode: '', priceCents: 1499, tracksStock: true, stock: 3 }],
};

test('contingency records cash sales against cached stock and rejects expired and excessive quantities', () => {
  const state = prepareSnapshot(null, snapshot, 1000);
  const next = recordSale(state, new Map([['p', 2]]), 1500, 'request-a');
  assert.equal(next.queue[0].id, 'request-a');
  assert.equal(next.queue[0].total, 29.98);
  assert.equal(remainingStock(next, snapshot.products[0]), 1);
  assert.throws(() => recordSale(next, new Map([['p', 2]]), 2000), /Quantidade/);
  assert.throws(() => recordSale(next, new Map([['p', 1]]), state.snapshot.expiresAt), /expirou/);
  assert.throws(() => prepareSnapshot(next, snapshot, 2000), /Sincronize/);
  assert.equal(state.queue.length, 0);
});

test('the encrypted queue survives reopening and rejects stale writes from another tab', async () => {
  const storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    locks: { request: async (_key, callback) => callback() },
  } });
  const localPassword = 'terminal-seguro-1';
  const terminal = await openTerminal(localPassword, true);
  const prepared = prepareSnapshot(null, snapshot, 1000);
  await terminal.save(prepared);
  assert.equal(hasTerminal(), true);
  assert.equal(await terminalMatches(snapshot.scope, snapshot.branchId), true);
  assert.equal(await terminalMatches(snapshot.scope, 'outra-filial'), false);
  const competing = await openTerminal(localPassword);
  const pending = recordSale(prepared, new Map([['p', 1]]), 1200, 'same-id');
  await terminal.save(pending);
  await assert.rejects(competing.save(prepared), /outra aba/);
  await assert.rejects(openTerminal('senha-errada'), /Senha local incorreta/);
  assert.equal((await openTerminal(localPassword)).state.queue[0].id, 'same-id');
  assert.doesNotMatch([...storage.values()][0], /Produto reservado|terminal-seguro-1/);
});

test('the service worker caches the contingency shell and leaves API requests alone', async () => {
  const handlers = {};
  const cachedShell = { body: 'PDV em contingência' };
  const cached = [];
  const localCache = { addAll: async files => { cached.push(...files); }, match: async () => cachedShell };
  vm.runInNewContext(await readFile(new URL('../../public/contingencia-sw.js', import.meta.url), 'utf8'), {
    self: { location: { origin: 'https://distrihub.test' }, addEventListener: (name, callback) => { handlers[name] = callback; }, skipWaiting() {} },
    caches: { open: async () => localCache },
    fetch: async () => { throw new Error('offline'); },
    URL, Response, AbortController, setTimeout, clearTimeout,
  });
  let result;
  handlers.install({ waitUntil(promise) { result = promise; } });
  await result;
  assert.ok(cached.includes('/contingencia/storage.js'));
  const request = { method: 'GET', mode: 'navigate', url: 'https://distrihub.test/' };
  handlers.fetch({ request, respondWith(promise) { result = promise; } });
  assert.equal(await result, cachedShell);
  handlers.fetch({ request: { ...request, url: 'https://distrihub.test/contingencia/index.html#scope=company%3Aoperator&branch=branch' }, respondWith(promise) { result = promise; } });
  assert.equal(await result, cachedShell);
  handlers.fetch({ request: { ...request, url: 'https://supabase.test/rest/v1/partner_sales' }, respondWith() { assert.fail(); } });
});

test('a prepared PDV enters and leaves offline mode without remounting the online cart', async () => {
  const source = await readFile(new URL('../../src/components/partner/OfflineTerminal.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source.replace('await import(/* @vite-ignore */ url)', 'runtime'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const require = createRequire(import.meta.url);
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, URLSearchParams,
    runtime: { terminalMatches: async (_scope, branchId) => branchId === snapshot.branchId },
    window: { addEventListener() {}, removeEventListener() {} },
    require(name) {
      return ['../../lib/pdv', '../../utils'].includes(name) ? {} : require(name);
    },
  });
  let mounts = 0;
  function Cart({ offline }) {
    React.useEffect(() => { mounts += 1; }, []);
    return React.createElement('div', { id: 'online-cart', 'data-offline': offline });
  }
  let renderer;
  const update = async (connected, branchId = snapshot.branchId) => act(async () => {
    const view = React.createElement(exports.OfflineTerminal, {
      key: branchId, connected, branchId, scope: snapshot.scope,
      children: offline => React.createElement(Cart, { offline }),
    });
    if (renderer) renderer.update(view);
    else renderer = TestRenderer.create(view);
  });
  await update(true);
  assert.equal(renderer.root.findAllByType('iframe').length, 0);
  await update(false);
  const frame = renderer.root.findByType('iframe');
  assert.equal(frame.parent.props.hidden, false);
  assert.equal(renderer.root.findByProps({ id: 'online-cart' }).props['data-offline'], true);
  await update(true);
  assert.equal(frame.parent.props.hidden, true);
  assert.equal(renderer.root.findByProps({ id: 'online-cart' }).props['data-offline'], false);
  assert.equal(mounts, 1);
  await update(false, 'outra-filial');
  assert.equal(renderer.root.findAllByType('iframe').length, 0);
  await act(async () => renderer.unmount());
});
