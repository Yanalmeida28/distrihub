import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const blobs = []; const names = []; const workbooks = [];
const exports = {};
vm.runInNewContext(ts.transpileModule(await readFile(new URL('../../src/components/partner/AdminSettingsTools.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports, Blob, Error,
  require: name => name === 'xlsx' ? { ...XLSX, writeFile: (...args) => workbooks.push(args) }
    : name === '../../lib/supabase' || name === '../../hooks/useDeviceHeartbeat' ? {} : require(name),
  URL: { createObjectURL: blob => { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
  window: { setTimeout: callback => callback() },
  document: { body: { append() {} }, createElement: () => ({ click() { names.push(this.download); }, remove() {} }) },
});

test('exportações geram arquivos reais, removem credenciais do JSON e protegem CSV de fórmulas', async () => {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(exports.AdminDataExports, {
    allowed: true,
    branchId: 'branch', products: [{ name: 'Produto', sku: 'p', stock: 2, sale_price: 5, cost_price: 3 }],
    sales: [{ id: 'sale', customer_name: '=HYPERLINK("url")', total: 10, status: 'concluida' }],
    customers: [{ id: 'customer', name: 'Cliente' }], extra: { collaborators: [{ name: 'Colaborador', pin_hash: 'secret', new_pin: '1234' }] },
  })); });
  const buttons = renderer.root.findAllByType('button');
  await act(async () => buttons[0].props.onClick());
  const json = JSON.parse(await blobs[0].text());
  assert.equal(json.products.length, 1);
  assert.equal(json.collaborators[0].pin_hash, undefined);
  assert.equal(json.collaborators[0].new_pin, undefined);
  assert.ok(names[0].endsWith('.json'));
  await act(async () => buttons[1].props.onClick());
  assert.ok(workbooks[0][1].endsWith('.xlsx'));
  assert.ok(workbooks[0][0].Sheets.Produtos);
  await act(async () => buttons[2].props.onClick());
  assert.ok((await blobs[1].text()).includes("'=HYPERLINK"));
  assert.ok(names[1].endsWith('.csv'));
  await act(async () => renderer.unmount());
});
