import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';

test('trocar módulos preserva rascunhos; revogar acesso desmonta a tela', async () => {
  const source = await readFile(new URL('../../src/components/PartnerPanel.tsx', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('  function renderTab('), source.indexOf('  function renderCadastros('));
  const context = vm.createContext({
    require: createRequire(import.meta.url), exports: {}, Suspense: React.Suspense,
    ModuleBoundary: ({children}) => children,
    visitedTabs: new Set(['cadastros','pdv']), blockedTabs: [], activeTab: 'cadastros', accessLocked: false,
    saas: {subscription: {}}, canUseSaasFeature: () => true,
    partner: {resourcesReady:true,loading:false},
    deviceSession: {ready:true},
  });
  vm.runInContext(ts.transpileModule(code + '\nexports.renderTab=renderTab;', {
    compilerOptions: {module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},
  }).outputText, context);
  function Draft({name}) {
    const [value,setValue] = React.useState('');
    return React.createElement('input', {'aria-label':name,value,onChange:event=>setValue(event.target.value)});
  }
  const screen = () => React.createElement('main', {},
    context.exports.renderTab('cadastros',React.createElement(Draft,{name:'cadastro'})),
    context.exports.renderTab('pdv',React.createElement(Draft,{name:'venda'})));
  let renderer;
  await act(async () => { renderer=TestRenderer.create(screen()); });
  await act(async () => renderer.root.findByProps({'aria-label':'cadastro'}).props.onChange({target:{value:'rascunho'}}));
  context.activeTab='pdv';
  await act(async () => renderer.update(screen()));
  assert.equal(renderer.root.findByProps({'aria-label':'cadastro'}).props.value,'rascunho');
  assert.equal(renderer.toJSON().children[0].props.hidden,true);
  await act(async () => renderer.root.findByProps({'aria-label':'venda'}).props.onChange({target:{value:'produto selecionado'}}));
  context.activeTab='cadastros';
  await act(async () => renderer.update(screen()));
  assert.equal(renderer.root.findByProps({'aria-label':'venda'}).props.value,'produto selecionado');
  context.blockedTabs=['pdv'];
  await act(async () => renderer.update(screen()));
  assert.equal(renderer.root.findAllByProps({'aria-label':'venda'}).length,0);
  context.deviceSession.ready=false;
  await act(async () => renderer.update(screen()));
  assert.equal(renderer.root.findAllByType('input').length,0);
  context.deviceSession.ready=true;
  context.accessLocked=true;
  await act(async () => renderer.update(screen()));
  assert.equal(renderer.root.findAllByType('input').length,0);
  await act(async () => renderer.unmount());
});
