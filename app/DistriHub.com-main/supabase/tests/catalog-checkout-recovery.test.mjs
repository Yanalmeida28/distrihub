import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require = createRequire(import.meta.url);
async function load(file, mocks = {}, globals = {}) {
  const source = ts.transpileModule(await readFile(new URL(`../../src/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, Error, ...globals, require: name => mocks[name] ?? require(name) });
  return exports;
}
const operations = await load('lib/operationAttempts.ts', {}, { crypto: { randomUUID } });
const orders = await load('lib/catalogOrders.ts');
let view;
afterEach(async () => { if (view) await act(async () => view.unmount()); view = null; });
const props = { slug: 'loja', branchId: 'filial', userId: 'buyer-a', cart: [{ id: 'p', name: 'Produto', quantity: 1, sale_price: 10 }], onQuantity() {}, onComplete() {} };
async function mount(save, overrides = {}, initialStorage = new Map()) {
  const storage = { getItem: key => initialStorage.get(key) ?? null, setItem: (key, value) => initialStorage.set(key, value), removeItem: key => initialStorage.delete(key) };
  const { PublicCatalogCheckout: Checkout } = await load('components/PublicCatalogCheckout.tsx', {
    '../lib/supabase': { supabase: {} }, '../lib/operationAttempts': operations,
    '../lib/catalogOrders': { ...orders, saveCatalogOrder: save }, '../utils': { money: { format: String } },
  }, { window: { localStorage: storage } });
  await act(async () => { view = Renderer.create(React.createElement(Checkout, { ...props, ...overrides })); });
  return { Checkout, initialStorage };
}
const submit = () => view.root.findByType('form').props.onSubmit({ preventDefault() {} });

test('late confirmation preserves a newer attempt stored in the same scope', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const attempts = new operations.OperationAttempts(storage);
  const first = attempts.get('buyer:store:branch', 'catalog-order', { product: 'first' });
  attempts.confirm('buyer:store:branch', 'catalog-order', first.id);
  const second = attempts.get('buyer:store:branch', 'catalog-order', { product: 'second' });
  attempts.confirm('buyer:store:branch', 'catalog-order', first.id);
  assert.equal(attempts.pending('buyer:store:branch', 'catalog-order').id, second.id);
});

test('network failure retains request ID; definitive rejection on recovery releases the form', async () => {
  let reject = false;
  const ids = [], blocked = [];
  const { initialStorage } = await mount(async (_client, _user, input) => {
    ids.push(input.requestId);
    if (reject) throw new orders.CatalogOrderRejected('Produto indisponível');
    throw new Error('Sem conexão');
  }, { onBlockedChange: value => blocked.push(value) });
  await act(async () => submit());
  assert.equal(initialStorage.size, 1);
  assert.equal(view.root.findByType('fieldset').props.disabled, true);
  assert.equal(blocked.at(-1), true);
  reject = true;
  await act(async () => submit());
  assert.equal(ids[0], ids[1]);
  assert.equal(initialStorage.size, 0);
  assert.equal(view.root.findByType('fieldset').props.disabled, false);
  assert.equal(blocked.at(-1), false);
});

test('late result after switching accounts never confirms or clears the current cart', async () => {
  let finish, task, completed = 0;
  const { Checkout, initialStorage } = await mount(() => new Promise(resolve => { finish = resolve; }), { onComplete() { completed++; } });
  await act(async () => view.root.findAllByType('input').find(input => input.props.maxLength === 200).props.onChange({ target: { value: 'Conta anterior' } }));
  await act(async () => { task = submit(); });
  await act(async () => view.update(React.createElement(Checkout, { ...props, userId: 'buyer-b', onComplete() { completed++; } })));
  assert.equal(view.root.findAllByType('input').find(input => input.props.maxLength === 200).props.value, '');
  await act(async () => { finish({ id: 'old-account-order', total: 10 }); await task; });
  assert.equal(completed, 0);
  assert.equal(initialStorage.size, 0);
  assert.equal(view.root.findAllByProps({ role: 'status' }).length, 0);
});

test('unmounted checkout ignores its late result', async () => {
  let finish, task, completed = 0;
  await mount(() => new Promise(resolve => { finish = resolve; }), { onComplete() { completed++; } });
  await act(async () => { task = submit(); });
  await act(async () => view.unmount()); view = null;
  await act(async () => { finish({ id: 'old-order', total: 10 }); await task; });
  assert.equal(completed, 0);
});

test('only locked definitive server rejection is classified as safe to edit', async () => {
  const input = { requestId: 'id', catalogSlug: 'loja', branchId: 'b', cart: [{ id: 'p', quantity: 1 }], businessName: 'Cliente', contact: '11999999999', deliveryAddress: '', paymentMethod: 'pix', deliveryMethod: 'balcao' };
  for (const code of ['P0001', '23514', '22023', 'PDC01']) {
    await assert.rejects(orders.saveCatalogOrder({ rpc: async () => ({ error: { code, message: 'Falha' } }) }, 'buyer', input), error => (error instanceof orders.CatalogOrderRejected) === (code === 'PDC01'));
  }
});

test('personalization saves catalog activation and slug and reports persistence errors', async () => {
  const helpers = await load('lib/personalization.ts');
  const theme = await load('lib/storeTheme.ts');
  const { WhiteLabelModule } = await load('components/partner/WhiteLabelModule.tsx', {
    '../../lib/personalization': helpers, '../../lib/storeTheme': theme,
    '../../lib/salePrint': { printSale() {} }, './CatalogShareLinks': { CatalogShareLinks: () => null },
  });
  let saved, fail = false;
  await act(async () => { view = Renderer.create(React.createElement(WhiteLabelModule, {
    settings: { catalog_slug: 'varejo', catalog_enabled: false, primary_color: '#3193e5', nav_color: '#0f2747' },
    onUpdate: async data => { if (fail) throw new Error('Não salvo'); saved = data; },
  })); });
  await act(async () => view.root.findAllByType('input').find(input => input.props.maxLength === 40).props.onChange({ target: { value: 'atacado' } }));
  await act(async () => view.root.findAllByType('input').find(input => input.props.checked === false && input.parent.children.some(child => typeof child === 'string' && child.includes('Ativar catálogo público'))).props.onChange({ target: { checked: true } }));
  await act(async () => view.root.findByProps({ className: 'module-save-btn' }).props.onClick());
  assert.equal(saved.catalog_slug, 'atacado'); assert.equal(saved.catalog_enabled, true);
  fail = true;
  await act(async () => view.root.findAllByType('input').find(input => input.props.maxLength === 40).props.onChange({ target: { value: 'outra-loja' } }));
  await act(async () => view.root.findByProps({ className: 'module-save-btn' }).props.onClick());
  assert.ok(!JSON.stringify(view.toJSON()).includes('Personalização salva'));
  assert.ok(JSON.stringify(view.toJSON()).includes('Não salvo'));
});
