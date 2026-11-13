import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require = createRequire(import.meta.url);
function harness(invoke) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../src/components/partner/FocusNfcePanel.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Error, Response, URL, require: name => name === '../../lib/supabase' ? { supabase: { functions: { invoke } } } : require(name) });
  return exports.FocusNfcePanel;
}
const props = { saleId: 'sale', branchId: 'branch', companyId: 'company', canEmit: true };
const send = renderer => renderer.root.findAllByType('button').find(b => b.children.includes('Enviar ou consultar NFC-e de teste'));

test('Focus UI: duas ações rápidas enviam uma requisição e recuperação continua disponível', async () => {
  const calls = []; let finish;
  const Panel = harness((name, options) => { calls.push({ name, options }); return new Promise(resolve => { finish = resolve; }); });
  let renderer; await act(async () => { renderer = Renderer.create(React.createElement(Panel, props)); });
  try {
    const click = send(renderer).props.onClick;
    act(() => { click(); click(); });
    assert.equal(calls.length, 1); assert.equal(renderer.root.findAllByType('button').every(b => b.props.disabled), true);
    assert.equal(calls[0].options.body.saleId, 'sale'); assert.equal(calls[0].options.body.branchId, 'branch');
    assert.equal(calls[0].options.body.token, undefined);
    await act(async () => finish({ data: { environment: 'homologacao', state: 'unknown', reference: 'same' }, error: null }));
    assert.equal(send(renderer).props.disabled, false); assert.match(JSON.stringify(renderer.toJSON()), /não confirmado/);
  } finally { await act(async () => renderer.unmount()); }
});

test('Focus UI: erro do servidor não anuncia autorização, produção é recusada e links externos são omitidos', async () => {
  for (const result of [
    { data: null, error: { context: new Response(JSON.stringify({ error: 'Confira o CSC de homologação.' })) } },
    { data: { environment: 'producao', state: 'authorized' }, error: null },
  ]) {
    const Panel = harness(async () => result); let renderer;
    await act(async () => { renderer = Renderer.create(React.createElement(Panel, props)); });
    await act(async () => send(renderer).props.onClick());
    assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 1);
    assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /NFC-e autorizada/);
    await act(async () => renderer.unmount());
  }
  const Panel = harness(async () => ({ data: { environment: 'homologacao', state: 'authorized', result: { caminho_danfe: 'https://evil.test/nota' } }, error: null }));
  let renderer; await act(async () => { renderer = Renderer.create(React.createElement(Panel, props)); });
  await act(async () => send(renderer).props.onClick()); assert.equal(renderer.root.findAllByType('a').length, 0);
  await act(async () => renderer.unmount());
});

test('Focus UI: trocar empresa/filial/venda ignora a resposta antiga e limpa o resultado', async () => {
  let finish;
  const Panel = harness(() => new Promise(resolve => { finish = resolve; }));
  const wrapper = data => React.createElement(Panel, { ...data, key: `${data.companyId}:${data.branchId}:${data.saleId}` });
  let renderer; await act(async () => { renderer = Renderer.create(wrapper(props)); });
  act(() => send(renderer).props.onClick());
  await act(async () => renderer.update(wrapper({ ...props, companyId: 'other', saleId: 'other' })));
  await act(async () => finish({ data: { environment: 'homologacao', state: 'authorized', reference: 'old-reference' }, error: null }));
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /old-reference|NFC-e autorizada/);
  assert.equal(send(renderer).props.disabled, false);
  await act(async () => renderer.unmount());
});
