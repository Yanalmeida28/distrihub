import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';

const require = createRequire(import.meta.url);
const source = ts.transpileModule(await readFile(new URL('../../src/components/partner/CatalogShareLinks.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
let view;
afterEach(async () => { if (view) await act(async () => view.unmount()); view = null; });
async function mount(writeText, slug = 'minha-loja', selectedBranchId) {
  const exports = {};
  vm.runInNewContext(source, { exports, require, URL,
    window: { location: { origin: 'https://distrihub.com.br' }, isSecureContext: true },
    navigator: { clipboard: { writeText } },
  });
  await act(async () => { view = TestRenderer.create(React.createElement(exports.CatalogShareLinks, {
    slug, selectedBranchId, branches: [
      { id: 'a', name: 'Centro & Norte', is_active: true },
      { id: 'b', name: 'Bairro', is_active: true },
      { id: 'c', name: 'Fechada', is_active: false },
    ],
  })); });
}
test('active branches have distinct encoded links and copy the exact absolute URL', async () => {
  const copied = [];
  await mount(async url => copied.push(url));
  const links = view.root.findAllByType('a');
  assert.equal(links.length, 3);
  assert.equal(links[0].props.href, '/catalogo?loja=minha-loja');
  assert.equal(links[1].props.href, '/catalogo?loja=minha-loja&unidade=a');
  assert.equal(links[2].props.href, '/catalogo?loja=minha-loja&unidade=b');
  await act(async () => view.root.findAllByType('button')[1].props.onClick());
  assert.deepEqual(copied, ['https://distrihub.com.br/catalogo?loja=minha-loja&unidade=a']);
  assert.ok(view.root.findByProps({ role: 'status' }));
  assert.ok(!JSON.stringify(view.toJSON()).includes('Fechada'));
});
test('failed clipboard copy reports an error instead of claiming success', async () => {
  await mount(async () => { throw new Error('denied'); });
  await act(async () => view.root.findAllByType('button')[0].props.onClick());
  assert.equal(view.root.findAllByProps({ role: 'status' }).length, 0);
  assert.equal(view.root.findAllByProps({ role: 'alert' }).length, 1);
});
test('no links are generated before the catalog slug exists', async () => {
  await mount(async () => {}, '');
  assert.equal(view.toJSON(), null);
});

test('selected branch only exposes its own catalog and never falls back to retail or general', async () => {
  const copied = [];
  await mount(async url => copied.push(url), 'minha-loja', 'b');
  const links = view.root.findAllByType('a');
  assert.equal(links.length, 1);
  assert.equal(links[0].props.href, '/catalogo?loja=minha-loja&unidade=b');
  await act(async () => view.root.findAllByType('button')[0].props.onClick());
  assert.deepEqual(copied, ['https://distrihub.com.br/catalogo?loja=minha-loja&unidade=b']);
});

test('unavailable selected branch does not expose another branch link', async () => {
  await mount(async () => {}, 'minha-loja', 'missing');
  assert.equal(view.root.findAllByType('a').length, 0);
});
