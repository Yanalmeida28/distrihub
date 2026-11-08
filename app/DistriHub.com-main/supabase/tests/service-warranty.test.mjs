import assert from 'node:assert/strict';
import { personalizationHelpers } from './fixtures/personalization_helpers.mjs';
import { test, afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../../src/components/partner/WhiteLabelModule.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const module = { exports: {} };
const receiptPreviews = [];
const theme = { exports: {} };
vm.runInNewContext(ts.transpileModule(await readFile(new URL('../../src/lib/storeTheme.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: theme.exports });
vm.runInNewContext(compiled, { exports: module.exports, require: name => name === './CatalogShareLinks' ? { CatalogShareLinks: () => null } : name === '../../lib/salePrint' ? { printSale(...args) { receiptPreviews.push(args); } } : name === '../../lib/personalization' ? personalizationHelpers : name === '../../lib/storeTheme' ? theme.exports : require(name) });
const Component = module.exports.WhiteLabelModule;
const settings = {
  id: 'settings', user_id: 'owner', logo_url: null, banner_url: null,
  primary_color: '#3193e5', nav_color: '#0b1927', internal_notice: '',
  warranty_terms: 'Garantia dos produtos', receipt_footer_text: 'Rodapé do cupom',
  show_logo_on_receipt: true, show_cnpj_on_receipt: true, updated_at: '',
  service_warranty_terms: '',
};
let renderer;
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });
const saveButton = () => renderer.root.findAllByType('button').find(button => button.props.className === 'module-save-btn');

test('receipt preview renders the current customization through the production renderer', async () => {
  const frame = {};
  receiptPreviews.length = 0;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Component, { settings, onUpdate: async () => {}, receiptDetails: { companyName: 'Saunier Atacado', companyAddress: 'Store address' } }), {
    createNodeMock: node => node.type === 'iframe' ? { contentWindow: frame } : null,
  }); });
  await act(async () => renderer.root.findAllByType('button').find(button => button.children.includes('Cupom e termos')).props.onClick());
  assert.ok(receiptPreviews.length > 0);
  const preview = receiptPreviews.at(-1);
  assert.equal(preview[1], 'receipt');
  assert.equal(preview[2].companyName, 'Saunier Atacado');
  assert.equal(preview[2].companyAddress, 'Store address');
  assert.equal(preview[3], frame);
  assert.equal(preview[4].previewOnly, true);
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Mensagem no cabeçalho do cupom' }).props.onChange({ target: { value: 'Current draft' } }));
  assert.equal(receiptPreviews.at(-1)[2].settings.personalization.receipt.header_text, 'Current draft');
});

test('personalization saves multiline service terms independently and reloads the saved text', async () => {
  let submitted;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Component, { settings, onUpdate: async value => { submitted = value; } })); });
  const text = 'Garantia do serviço\nCondições de atendimento';
  await act(async () => renderer.root.findByProps({ id: 'service-warranty-terms' }).props.onChange({ target: { value: text } }));
  await act(async () => saveButton().props.onClick());
  assert.equal(submitted.service_warranty_terms, text);
  assert.equal(submitted.receipt_footer_text, settings.receipt_footer_text);
  assert.equal(submitted.warranty_terms, undefined);
  await act(async () => renderer.update(React.createElement(Component, { settings: { ...settings, service_warranty_terms: text }, onUpdate: async () => {} })));
  assert.equal(renderer.root.findByProps({ id: 'service-warranty-terms' }).props.value, text);
});

test('failed service-term save retains the draft and shows an error until a successful retry', async () => {
  let fail = true;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Component, { settings, onUpdate: async () => { if (fail) throw new Error('Falha ao salvar'); } })); });
  await act(async () => renderer.root.findByProps({ id: 'service-warranty-terms' }).props.onChange({ target: { value: 'Meu termo' } }));
  await act(async () => saveButton().props.onClick());
  assert.equal(renderer.root.findByProps({ role: 'alert' }).children.join(''), 'Falha ao salvar');
  assert.equal(renderer.root.findByProps({ id: 'service-warranty-terms' }).props.value, 'Meu termo');
  assert.equal(saveButton().children.join(''), 'Salvar personalização');
  fail = false;
  await act(async () => saveButton().props.onClick());
  assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 0);
});

test('personalization preserves independent panel, receipt and catalog choices when saved',async()=>{
  let submitted;
  await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{settings,onUpdate:async value=>{submitted=value;}}));});
  const change=async(label,value)=>act(async()=>renderer.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
  await act(async()=>renderer.root.findByProps({'aria-label':'Aplicar tema Verde'}).props.onClick());
  await change('Largura do papel do cupom','58');
  await change('Fonte do cupom','14');
  await change('Tamanho dos textos do painel','large');
  await change('Mensagem de boas-vindas do catálogo','Bem-vindo!\nConfira nossos produtos.');
  await change('WhatsApp do catálogo','11999999999');
  await act(async()=>saveButton().props.onClick());
  assert.equal(submitted.primary_color,'#199863');
  assert.equal(submitted.nav_color,'#14532d');
  assert.equal(submitted.personalization.receipt.paper_width,'58');
  assert.equal(submitted.personalization.receipt.font_size,14);
  assert.equal(submitted.personalization.panel.text_size,'large');
  assert.equal(submitted.personalization.catalog.welcome_message,'Bem-vindo!\nConfira nossos produtos.');
  assert.equal(submitted.receipt_footer_text,settings.receipt_footer_text);
});

test('barcode reader can be disabled in PDV personalization and persists across reloads', async () => {
  let submitted;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Component, { settings, onUpdate: async value => { submitted = value; } })); });
  await act(async () => renderer.root.findAllByType('button').find(button => button.children.includes('PDV')).props.onClick());
  const toggle = () => renderer.root.findByProps({ 'aria-label': 'Ativar leitor de código de barras' });
  assert.equal(toggle().props.checked, true);
  await act(async () => toggle().props.onChange({ target: { checked: false } }));
  await act(async () => saveButton().props.onClick());
  assert.equal(submitted.personalization.pdv.barcode_scanner_enabled, false);
  await act(async () => renderer.update(React.createElement(Component, {
    settings: { ...settings, personalization: submitted.personalization },
    onUpdate: async () => {},
  })));
  assert.equal(toggle().props.checked, false);
});

test('camera barcode reader is an independent setting disabled by default and persists when enabled', async () => {
  let submitted;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Component, { settings, onUpdate: async value => { submitted = value; } })); });
  await act(async () => renderer.root.findAllByType('button').find(button => button.children.includes('PDV')).props.onClick());
  const toggle = () => renderer.root.findByProps({ 'aria-label': 'Ativar leitura de código de barras pela câmera' });
  assert.equal(toggle().props.checked, false);
  await act(async () => toggle().props.onChange({ target: { checked: true } }));
  await act(async () => saveButton().props.onClick());
  assert.equal(submitted.personalization.pdv.barcode_scanner_enabled, undefined);
  assert.equal(submitted.personalization.pdv.camera_scanner_enabled, true);
  await act(async () => renderer.update(React.createElement(Component, {
    settings: { ...settings, personalization: submitted.personalization },
    onUpdate: async () => {},
  })));
  assert.equal(toggle().props.checked, true);
  assert.equal(renderer.root.findByProps({ 'aria-label': 'Ativar leitor de código de barras' }).props.checked, true);
});

test('restoring panel defaults preserves the receipt draft and invalid WhatsApp blocks saving',async()=>{
  let submitted,calls=0;
  await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{settings,onUpdate:async value=>{submitted=value;calls++;}}));});
  await act(async()=>renderer.root.findByProps({'aria-label':'Largura do papel do cupom'}).props.onChange({target:{value:'58'}}));
  await act(async()=>renderer.root.findAllByType('button').find(button=>button.children.includes('Painel')).props.onClick());
  await act(async()=>renderer.root.findByProps({'aria-label':'Tamanho dos textos do painel'}).props.onChange({target:{value:'extra-large'}}));
  await act(async()=>renderer.root.findAllByType('button').find(button=>button.children.includes('Restaurar padrões desta seção')).props.onClick());
  assert.equal(renderer.root.findByProps({'aria-label':'Tamanho dos textos do painel'}).props.value,'normal');
  await act(async()=>renderer.root.findByProps({'aria-label':'WhatsApp do catálogo'}).props.onChange({target:{value:'javascript:alert(1)'}}));
  await act(async()=>saveButton().props.onClick());
  assert.equal(calls,0);
  assert.ok(renderer.root.findByProps({role:'alert'}));
  await act(async()=>renderer.root.findByProps({'aria-label':'WhatsApp do catálogo'}).props.onChange({target:{value:''}}));
  await act(async()=>saveButton().props.onClick());
  assert.equal(submitted.personalization.receipt.paper_width,'58');
  assert.equal(Object.keys(submitted.personalization.panel).length,0);
});
