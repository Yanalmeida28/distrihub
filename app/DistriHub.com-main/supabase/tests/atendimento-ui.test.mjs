import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';

const require = createRequire(import.meta.url);

test('Atendimento opens an empty inbox and gives clear connection instructions', async () => {
  const source = await readFile(new URL('../../src/components/partner/AtendimentoModule.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require: id => id.endsWith('.css') ? {} : require(id) });
  let tree;
  act(() => { tree = Renderer.create(React.createElement(exports.default, { branchName: 'Filial Centro' })); });
  const button = label => tree.root.findAllByType('button').find(item => item.props.children === label);
  assert.ok(JSON.stringify(tree.toJSON()).includes('A caixa de entrada está vazia'));
  assert.equal(tree.root.findByProps({ id: 'atendimento-connection-guide' }).props.hidden, true);
  act(() => button('Ver instruções de conexão').props.onClick());
  assert.equal(tree.root.findByProps({ id: 'atendimento-connection-guide' }).props.hidden, false);
  assert.equal(tree.root.findAllByProps({ href: 'https://web.whatsapp.com/' }).length, 0);
  assert.ok(JSON.stringify(tree.toJSON()).includes('Filial Centro'));
  assert.match(tree.root.findByProps({ rel: 'noreferrer' }).props.href, /^https:\/\/developers\.facebook\.com\//);
  const tabs = tree.root.findByType('nav').findAllByType('button');
  act(() => tabs[2].props.onClick());
  assert.ok(JSON.stringify(tree.toJSON()).includes('Nenhuma campanha'));
  assert.equal(tree.root.findAllByType('input').length, 0);
  act(() => tree.unmount());
});
