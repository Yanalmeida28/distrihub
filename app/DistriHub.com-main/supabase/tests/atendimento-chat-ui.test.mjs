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
  let backlog = [];
  let registered;
  let sendCount = 0;
  let schemaVersion = 2;
  let queue = [];
  const storage = new Map();
  const conversation = { id: 'conversation', phone: '+5511999000000', customer_name: 'Cliente teste', state: 'active', mine: true };
  let currentConversation = conversation;
  queue = [conversation];
  const request = async (_name, input) => {
    if (input.p_action === 'list') {
      const matches = input.p_input.filter === 'mine' ? queue.filter(row => row.mine) : queue;
      const start = input.p_input.beforeId ? matches.findIndex(row => row.id === input.p_input.beforeId) + 1 : 0;
      return { data: { schemaVersion, channel: 'test', rows: matches.slice(start, start + 26) } };
    }
    if (input.p_action === 'details') return { data: { conversation: currentConversation, operators: [], quotes: [] } };
    if (input.p_action === 'test_send') {
      sendCount++;
      assert.ok([...storage.values()].some(value => JSON.parse(value).id === input.p_input.requestId));
      registered = input.p_input;
      return { error: { message: 'response lost' } };
    }
    if (input.p_action === 'send_status') {
      return { data: registered && registered.requestId === input.p_input.requestId && registered.body === input.p_input.body ? { delivery: 'submitted' } : {} };
    }
    if (offline) return { error: { message: 'network' } };
    if (input.p_input.after !== undefined) return { data: backlog.filter(message => message.position > input.p_input.after).slice(0, 31) };
    return { data: [{ position: 1, direction: 'incoming', body: 'Mensagem original' }] };
  };
  vm.runInNewContext(outputText, {
    exports, AbortController, crypto: globalThis.crypto,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    setTimeout: callback => { timers.set(++counter, callback); return counter; },
    clearTimeout: id => timers.delete(id),
    require: name => {
      if (name.endsWith('.css') || name.endsWith('orderQuotePdf')) return {};
      if (name.endsWith('/supabase')) return { supabase: { rpc: (...args) => ({
        abortSignal: () => request(...args), then: (resolve, reject) => request(...args).then(resolve, reject),
      }) } };
      return require(name);
    },
  });
  const props = { active: true, authUserId: 'user', companyId: 'company', branchId: 'branch', branchName: 'Filial', operatorId: 'operator', credential: 'test', customers: [] };
  let tree;
  const mount = () => act(async () => { tree = Renderer.create(React.createElement(exports.default, props)); });
  await mount();
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
    backlog = Array.from({ length: 130 }, (_, index) => ({ position: index + 2, direction: 'incoming', body: `Recuperada ${index}` }));
    await act(async () => tree.root.findAllByType('button').find(button => button.props.children === 'Tentar novamente').props.onClick());
    assert.equal(tree.root.findAllByProps({ role: 'alert' }).length, 0);
    assert.equal(tree.root.findByType('textarea').props.value, 'Em edição');
    assert.equal(tree.root.findAllByType('li').length, 131);
    await act(async () => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.equal(sendCount, 1);
    assert.equal(storage.size, 1);
    act(() => tree.unmount());
    await mount();
    await act(async () => tree.root.findByProps({ className: 'atendimento-row' }).props.onClick());
    assert.equal(sendCount, 1);
    assert.equal(storage.size, 0);
    assert.ok(JSON.stringify(tree.toJSON()).includes('Envio aceito pelo provedor'));
    const button = label => tree.root.findAllByType('button').find(item => item.props.children === label);
    queue = [...Array.from({ length: 25 }, (_, index) => ({ ...conversation, id: `other-${index}`, customer_name: `Contato ${index}` })), conversation];
    await act(async () => button('Minhas').props.onClick());
    await act(async () => button('Mais conversas').props.onClick());
    assert.equal(tree.root.findAllByProps({ className: 'atendimento-row' }).length, 26);
    currentConversation = { ...conversation, mine: false, assignee_name: 'Outro atendente' };
    queue[25] = currentConversation;
    await tick();
    assert.equal(tree.root.findAllByProps({ className: 'atendimento-row' }).length, 25);
    assert.ok(JSON.stringify(tree.toJSON()).includes('Outro atendente'));
    assert.equal(tree.root.findAllByType('textarea').length, 0);
    schemaVersion = 1;
    await tick();
    assert.ok(JSON.stringify(tree.toJSON()).includes('Estrutura do banco indisponível'));
    assert.equal(tree.root.findAllByProps({ className: 'atendimento-row' }).length, 0);
  } finally {
    act(() => tree.unmount());
  }
});
