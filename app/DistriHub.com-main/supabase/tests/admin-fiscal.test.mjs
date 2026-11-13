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
const rule = { id: 'r', branch_id: 'branch', name: 'Regra', cfop: '5102', cst_csosn: '102', icms_rate: 0, pis_rate: 0, cofins_rate: 0, active: true };
let saved;
let rpc;
const services = {
  getFiscalSettings: async () => ({ data: [rule], error: null }),
  getFiscalEvents: async () => ({ data: [{ id: 'doc', number: '42', status: 'pending', provider_response: { series: '001' } }], error: null }),
  saveFiscalSettings: async (...args) => { saved = args; return { error: null }; },
  requestFiscalCancellation: async () => ({ error: null }),
};
vm.runInNewContext(ts.transpileModule(await readFile(new URL('../../src/components/partner/AdminFiscalModule.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports, Error, require: name => name === '../../services/fiscalService' ? services
  : name === '../../lib/supabase' ? { supabase: { rpc: (...args) => rpc(...args) } }
    : name === '../../utils' ? { money: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }) } : require(name) });
const base = { userId: 'owner', branchId: null, sales: [], branches: [{ id: 'branch', name: 'Filial' }], ownerView: true };

test('edição consolidada salva usando a filial da regra sem liberar criação sem filial', async () => {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(exports.AdminFiscalModule, { ...base, section: 'regras' })); });
  const submit = () => renderer.root.findByProps({ type: 'submit' });
  assert.equal(submit().props.disabled, true);
  await act(async () => renderer.root.findAllByType('button').find(b => b.children.includes('Editar')).props.onClick());
  assert.equal(submit().props.disabled, false);
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(saved[1], 'branch');
  assert.equal(saved[2].id, 'r');
  assert.equal(submit().props.disabled, true);
  await act(async () => renderer.unmount());
});

test('histórico mostra a série armazenada nos detalhes do banco', async () => {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(exports.AdminFiscalModule, { ...base, section: 'historico-notas' })); });
  assert.ok(renderer.root.findAllByType('td').some(td => td.children.join('') === '42 / 001'));
  await act(async () => renderer.unmount());
});

test('regra de NF-e exige preenchimento fiscal e envia a habilitação e os novos campos', async () => {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(exports.AdminFiscalModule, { ...base, section: 'regras' })); });
  await act(async () => renderer.root.findAllByType('button').find(b => b.children.includes('Editar')).props.onClick());
  await act(async () => renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }));
  saved = undefined;
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(saved, undefined);
  const fill = async (label, value) => act(async () => {
    const field = renderer.root.findAllByType('label').find(node => node.children[0] === label);
    const control = field.findAll(node => node.type === 'input' || node.type === 'select')[0];
    control.props.onChange({ target: { value } });
  });
  await fill('NCM', '84713012'); await fill('Origem da mercadoria', '0');
  await fill('Unidade comercial', 'UN'); await fill('CST do PIS', '07'); await fill('CST da COFINS', '07');
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(saved[2].apply_to_nfe, true); assert.equal(saved[2].origin, '0');
  assert.equal(saved[2].unit, 'UN'); assert.equal(saved[2].pis_cst, '07'); assert.equal(saved[2].cofins_cst, '07');
  await act(async () => renderer.unmount());
});

test('dois envios rápidos geram somente uma solicitação enquanto aguarda o banco', async () => {
  let calls = 0; let finish;
  rpc = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(exports.AdminFiscalModule, { ...base, branchId: 'branch', section: 'emitir', sales: [{ id: 'sale', status: 'concluida', total: 100, items: [], customer_name: 'Cliente' }] })); });
  await act(async () => renderer.root.findAllByType('select')[0].props.onChange({ target: { value: 'sale' } }));
  act(() => { const form = renderer.root.findByType('form'); form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} }); });
  assert.equal(calls, 1);
  assert.equal(renderer.root.findByProps({ type: 'submit' }).props.disabled, true);
  await act(async () => finish({ error: null }));
  assert.equal(renderer.root.findByProps({ type: 'submit' }).props.disabled, false);
  await act(async () => renderer.unmount());
});
