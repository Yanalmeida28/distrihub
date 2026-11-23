import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
const require=createRequire(import.meta.url);
test('Atendimento simulates replies and a timed image campaign without contacting WhatsApp', async () => {
 const { default: AtendimentoModule } = await load('src/components/partner/AtendimentoModule.tsx', {
  require: id => id.endsWith('.css') ? {} : require(id),
  URL: { createObjectURL: () => 'blob:demo', revokeObjectURL: () => {} },
 });
 let tree;
 act(() => { tree = Renderer.create(React.createElement(AtendimentoModule)); });
 const button = text => tree.root.findAllByType('button').find(item => item.props.children === text);
 const click = text => act(() => button(text).props.onClick());
 const change = (item, target) => act(() => item.props.onChange({ target }));
 assert.equal(button('Simular resposta').props.disabled, true);
 click('Assumir conversa');
 change(tree.root.findByType('textarea'), { value: 'Segue o catálogo.' });
 act(() => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
 assert.ok(JSON.stringify(tree.toJSON()).includes('Segue o catálogo.'));
 click('Contatos');
 const contacts = tree.root.findAllByProps({ type: 'checkbox' });
 change(contacts[0], { checked: true });
 change(contacts[1], { checked: true });
 click('Campanhas');
 change(tree.root.findByProps({ type: 'file' }), { files: [{ name: 'catalogo.png' }] });
 change(tree.root.findByType('select'), { value: '60' });
 assert.equal(tree.root.findByType('img').props.src, 'blob:demo');
 assert.ok(JSON.stringify(tree.toJSON()).includes('+60 s'));
 click('Chatbot');
 change(tree.root.findByType('input'), { value: '1' });
 act(() => tree.root.findByType('form').props.onSubmit({ preventDefault() {} }));
 assert.ok(JSON.stringify(tree.toJSON()).includes('Transferência simulada'));
 act(() => tree.unmount());
});
async function load(file,context={}){
 const exports={};vm.runInNewContext(ts.transpileModule(await readFile(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {exports,require,URL,Date,Promise,Set,Error,JSON,setTimeout,clearTimeout,...context});return exports;
}
