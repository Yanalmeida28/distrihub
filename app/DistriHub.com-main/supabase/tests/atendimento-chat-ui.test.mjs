import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';

const require = createRequire(import.meta.url);

test('Atendimento preserves selection and drafts when history fails and recovers after a retry', async () => {
  const code = await readFile(new URL('../../src/components/partner/AtendimentoChatModule.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  const timers = new Map();
  let counter = 0;
  let offline = false;
  const conversation = { id: 'conversation', phone: '+5511999000000', customer_name: 'Cliente teste', state: 'active', mine: true };
  const request = async (_name, input) => {
    if (input.p_action === 'list') return { data: { channel: 'test', rows: [conversation] } };
    if (input.p_action === 'details') return { data: { operators: [], quotes: [] } };
    if (offline) return { error: { message: 'network' } };
    return { data: [{ position: 1, direction: 'incoming', body: 'Mensagem original' }] };
  };
  vm.runInNewContext(outputText, {
    exports, AbortController, crypto: globalThis.crypto,
    setTimeout: callback => { timers.set(++counter, callback); return counter; },
    clearTimeout: id => timers.delete(id),
    require: name => {
      if (name.endsWith('.css') || name.endsWith('orderQuotePdf')) return {};
      if (name.endsWith('/supabase')) return { supabase: { rpc: (...args) => ({ abortSignal: () => request(...args) }) } };
      return require(name);
    },
  });
  let tree;
  await act(async () => {
    tree = Renderer.create(React.createElement(exports.default, { active: true, companyId: 'company', branchId: 'branch', branchName: 'Filial', operatorId: 'operator', credential: 'test', customers: [] }));
  });
  try {
    await act(async () => tree.root.findByProps({ className: 'atendimento-row' }).props.onClick());
    act(() => tree.root.findByType('textarea').props.onChange({ target: { value: 'Em edição' } }));
    const tick = async () => {
      const pending = [...timers.values()];
      timers.clear();
      await act(async () => { for (const callback of pending) callback(); });
    };
    offline = true;
    await tick();
    assert.ok(JSON.stringify(tree.toJSON()).includes('Mensagem original'));
    assert.equal(tree.root.findByType('textarea').props.value, 'Em edição');
    assert.ok(tree.root.findByProps({ role: 'alert' }));
    offline = false;
    await act(async () => tree.root.findAllByType('button').find(button => button.props.children === 'Tentar novamente').props.onClick());
    assert.equal(tree.root.findAllByProps({ role: 'alert' }).length, 0);
    assert.equal(tree.root.findByType('textarea').props.value, 'Em edição');
  } finally {
    act(() => tree.unmount());
  }
});
