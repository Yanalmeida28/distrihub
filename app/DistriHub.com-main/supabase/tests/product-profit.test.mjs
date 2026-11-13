import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';

const require = createRequire(import.meta.url);
const exports = {};
const metricsModule = {};
const metricsSource = await readFile(new URL('../../src/lib/productProfit.ts', import.meta.url), 'utf8');
vm.runInNewContext(ts.transpileModule(metricsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: metricsModule });
const source = await readFile(new URL('../../src/components/partner/ProductProfitPreview.tsx', import.meta.url), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText, {
  exports, require: name => name === '../../lib/productProfit' ? metricsModule : name === '../../utils' ? { money: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }) } : require(name),
});
const metrics = metricsModule.productProfitMetrics;

test('markup e margem usam bases diferentes: custo 100 e venda 150', () => {
  const result = metrics('100', '150');
  assert.equal(result.grossProfit, 50);
  assert.equal(result.markup, 50);
  assert.ok(Math.abs(result.grossMargin - 33.33333333333333) < 1e-10);
});
test('venda abaixo do custo informa prejuízo e preço igual ao custo informa zero', () => {
  const loss = metrics('100', '80');
  assert.equal(loss.grossProfit, -20); assert.equal(loss.markup, -20); assert.equal(loss.grossMargin, -25);
  const zero = metrics('100', '100');
  assert.equal(zero.grossProfit, 0); assert.equal(zero.markup, 0); assert.equal(zero.grossMargin, 0);
});
test('valores monetários em centavos não acumulam erro e custo zero não produz Infinity', () => {
  assert.equal(metrics('0.10', '0.30').grossProfit, 0.2);
  const freeCost = metrics('0', '50');
  assert.equal(freeCost.markup, null); assert.equal(freeCost.grossProfit, 50); assert.equal(freeCost.grossMargin, 100);
});
test('campos vazios ou inválidos e preço de atacado não definido não geram lucro fictício', () => {
  for (const [cost, price] of [['', '150'], ['100', ''], ['abc', '150'], ['100', '0'], ['-10', '150'], ['100', '-5'], ['Infinity', '150']]) {
    assert.equal(metrics(cost, price), null);
  }
});
test('varejo e atacado mostram valores próprios e acompanham alterações do custo', async () => {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(exports.ProductProfitPreview, { cost: '100', retail: '150', wholesale: '120' })); });
  try {
    const rows = label => renderer.root.findByProps({ 'aria-label': `Rentabilidade no ${label}` }).findAllByType('dd').map(node => node.children.join(''));
    assert.deepEqual(rows('varejo').slice(0, 2), ['50,00%', '33,33%']);
    assert.deepEqual(rows('atacado').slice(0, 2), ['20,00%', '16,67%']);
    await act(async () => renderer.update(React.createElement(exports.ProductProfitPreview, { cost: '130', retail: '150', wholesale: '120' })));
    assert.match(renderer.root.findByProps({ 'aria-label': 'Rentabilidade no atacado' }).props.className, /is-loss/);
    assert.equal(rows('varejo')[0], '15,38%');
    assert.ok(JSON.stringify(renderer.toJSON()).includes('antes de taxas, impostos, comissões e despesas'));
  } finally { await act(async () => renderer.unmount()); }
});

test('indicadores na edição não alteram os preços enviados ao salvar o produto', async () => {
  const cadastros = {};
  const source = await readFile(new URL('../../src/components/partner/CadastrosModule.tsx', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source + '\nexports.EditProduct = ProductEditModal;', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText, {
    exports: cadastros, require: name => {
      if (name === './ProductProfitPreview') return exports;
      if (name === './ProductPhotoField') return { ProductPhotoField: () => null };
      if (name === './CustomerCnpjLookup') return { CustomerCnpjLookup: () => null };
      if (name === './ProductLabelModal') return { ProductLabelModal: () => null };
      if (name === '../../lib/productNames') return { normalizeProductName: value => String(value ?? '') };
      if (name === './CustomerPhoto' || name === '../../lib/cadastroXml' || name === './ImportExportModule' || name === '../../lib/saleReturns' || name === '../../hooks/useSessionDraft') return {};
      if (name === '../../utils') return { money: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }) };
      return require(name);
    },
  });
  let saved;
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(cadastros.EditProduct, {
    product: { id: 'product', name: 'Produto', cost_price: 100, sale_price: 150, wholesale_price: 120, stock: 10, min_stock: 5, branch_id: 'branch' },
    categories: [], suppliers: [], onAddSupplier: async () => {}, saving: false, error: null, onClose: () => {}, onSave: async payload => { saved = payload; },
  })); });
  try {
    assert.equal(renderer.root.findByProps({ 'aria-label': 'Rentabilidade no varejo' }).findAllByType('dd')[0].children[0], '50,00%');
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.equal(saved.cost_price, 100); assert.equal(saved.sale_price, 150); assert.equal(saved.wholesale_price, 120);
    assert.equal(saved.stock, 10);
    assert.equal('markup' in saved, false); assert.equal('grossMargin' in saved, false);
  } finally { await act(async () => renderer.unmount()); }
});
