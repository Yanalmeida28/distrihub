import assert from 'node:assert/strict';
import { pdvHelpers } from './fixtures/pdv_helpers.mjs';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import TestRenderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';

const source = await readFile(new URL('../../src/components/partner/SalesHistoryModule.tsx', import.meta.url), 'utf8');
const module = { exports: {} };
const printed = [];
const returnHelpers = { exports: {} };
vm.runInNewContext(ts.transpileModule(await readFile(new URL('../../src/lib/saleReturns.ts', import.meta.url), 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
} }).outputText, { exports: returnHelpers.exports });
function Actions(props) { return React.createElement('actions', props); }
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020,
} }).outputText, {
  exports: module.exports,
  require(name) {
    if (name === '../../lib/pdv') return pdvHelpers;
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (name === './SaleActionsMenu') return { SaleActionsMenu: Actions };
    if (name === '../../lib/saleReturns') return returnHelpers.exports;
    if (name === '../../lib/pdv') return pdvHelpers;
    if (name === '../../utils') return { money: { format: value => String(value) } };
    if (name === '../../lib/salePrint') return { printSale: (...args) => printed.push(args) };
    return {};
  },
});

test('sales history filters local day, period and status without limiting to ten sales', () => {
  const now = new Date();
  const previous = new Date(now); previous.setDate(previous.getDate() - 1);
  const sales = Array.from({ length: 12 }, (_, index) => ({
    id: String(index), customer_name: 'João', status: 'concluida',
    created_at: now.toISOString(), total: 10, items: [],
  }));
  sales.push({ ...sales[0], id: 'old', created_at: previous.toISOString() });
  sales.push({ ...sales[0], id: 'cancel', status: 'cancelada' });
  sales.push({ ...sales[0], id: 'quote', status: 'pre_venda' });
  let view;
  act(() => { view = TestRenderer.create(React.createElement(module.exports.SalesHistoryModule, {
    sales, customers: [], salespeople: [], segment: 'assistencia',
  })); });
  try {
    const rows = () => view.root.findByType('tbody').findAllByType('tr');
    assert.equal(rows().length, 13);
    act(() => view.root.findAllByType('button').find(b => b.children.includes('Limpar período')).props.onClick());
    assert.equal(rows().length, 14);
    act(() => view.root.findByType('select').props.onChange({ target: { value: 'concluida' } }));
    assert.equal(rows().length, 13);
    act(() => view.root.findAllByType('input')[0].props.onChange({ target: { value: 'JOAO' } }));
    assert.equal(rows().length, 13);
    act(() => view.root.findAllByType('button').find(b => b.children.includes('Hoje')).props.onClick());
    assert.equal(rows().length, 12);
  } finally { act(() => view.unmount()); }
});

test('sales history shows returned quantities and includes physical returns in the return filter', () => {
  const sale = { id:'returned',user_id:'owner',customer_name:'Cliente',status:'concluida',created_at:new Date().toISOString(),total:40,
    items:[{product_id:'piece',name:'Peça',quantity:2,unit_price:20}] };
  let view;
  act(() => { view = TestRenderer.create(React.createElement(module.exports.SalesHistoryModule, {
    sales:[sale],rmaRequests:[{id:'rma',user_id:'owner',sale_id:'returned',sale_item_index:0,quantity:1}],customers:[],salespeople:[],segment:'assistencia',
  })); });
  try {
    assert.match(JSON.stringify(view.toJSON()),/Devolução parcial/);
    assert.match(JSON.stringify(view.toJSON()),/1 devolvido/);
    assert.equal(view.root.findByType(Actions).props.onCancel,undefined);
    act(() => view.root.findByType('select').props.onChange({target:{value:'devolucao'}}));
    assert.match(JSON.stringify(view.toJSON()),/Devolução parcial/);
    act(() => view.root.findByType('select').props.onChange({target:{value:'concluida'}}));
    assert.match(JSON.stringify(view.toJSON()),/Nenhuma venda registrada/);
  } finally { act(() => view.unmount()); }
});

test('sales history preserves receipt details and requires supervisor PIN before cancellation', async () => {
  const calls = [];
  const sale = { id: 'sale', customer_id: 'customer', salesperson_id: 'manager', customer_name: 'Cliente', status: 'concluida', created_at: new Date().toISOString(), total: 10, items: [] };
  let view;
  act(() => { view = TestRenderer.create(React.createElement(module.exports.SalesHistoryModule, {
    sales: [sale], customers: [{ id: 'customer', name: 'Cliente' }],
    salespeople: [{ id: 'manager', role: 'gerente', name: 'Gerente' }],
    segment: 'assistencia', receiptDetails: { companyName: 'Loja' },
    onCancelSale: async (...args) => calls.push(args),
  })); });
  try {
    act(() => view.root.findByType(Actions).props.onPrintReceipt());
    assert.equal(printed.at(-1)[0].id, 'sale');
    assert.equal(printed.at(-1)[2].companyName, 'Loja');
    assert.equal(printed.at(-1)[2].salespersonName, 'Gerente');
    act(() => view.root.findByType(Actions).props.onCancel());
    const cancel = () => view.root.findAllByType('button').find(b => b.children.includes('Cancelar Venda'));
    await act(async () => cancel().props.onClick());
    assert.equal(calls.length, 0);
    act(() => view.root.findByProps({ type: 'password' }).props.onChange({ target: { value: '1234' } }));
    await act(async () => cancel().props.onClick());
    assert.deepEqual([...calls[0]], ['sale', 'manager', '1234']);
  } finally { act(() => view.unmount()); }
});

test('opening cancellation preserves the search and ignores credential autofill events until the dialog closes', () => {
  const sale = { id: 'sale', customer_name: 'Cliente', status: 'concluida', created_at: new Date().toISOString(), total: 10, items: [] };
  let view;
  act(() => { view = TestRenderer.create(React.createElement(module.exports.SalesHistoryModule, {
    sales: [sale], customers: [], salespeople: [{ id: 'manager', role: 'gerente', name: 'Gerente' }], segment: 'assistencia',
  })); });
  const search = () => view.root.findByProps({ name: 'sales-history-search' });
  try {
    act(() => search().props.onChange({ target: { value: 'Cliente' } }));
    act(() => view.root.findByType(Actions).props.onCancel());
    assert.equal(search().props.value, 'Cliente');
    assert.equal(search().props.disabled, true);
    const authorization = view.root.findByProps({ id: 'sales-history-cancel-authorization' });
    assert.equal(authorization.findByProps({ name: 'sales-cancellation-supervisor-pin' }).props.autoComplete, 'new-password');
    act(() => search().props.onChange({ target: { value: 'empresa@example.com' } }));
    assert.equal(search().props.value, 'Cliente');
    act(() => authorization.findByProps({ className: 'modal-header' }).findByType('button').props.onClick());
    assert.equal(search().props.disabled, false);
    assert.equal(search().props.value, 'Cliente');
    act(() => search().props.onChange({ target: { value: '' } }));
    assert.equal(search().props.value, '');
  } finally { act(() => view.unmount()); }
});
