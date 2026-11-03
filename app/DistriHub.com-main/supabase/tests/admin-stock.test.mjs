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
const sessionDraftMocks = {
  SessionDraftProvider: ({ children }) => children,
  useSessionDraftScope: () => 'test',
  useSessionDraftState: (_draftId, initialValue) => React.useState(initialValue),
};

const registrationProps = (planId, extra = {}) => ({
  planId, canManageSalespeople: true, initialTab: 'vendedores', selectedBranchId: 'branch',
  branches: [{ id: 'branch', name: 'Filial' }], products: [], categories: [], suppliers: [],
  salespeople: [], combos: [], modifiers: [], customers: [], sales: [], allSales: [],
  segment: 'assistencia', findProductDuplicates: async () => [], ...extra,
});
const buttonText = button => button.children.filter(value => typeof value === 'string').join('').trim();
const collaboratorShortcut = renderer => renderer.root.findAllByType('button').some(button => buttonText(button) === 'Colaboradores');
const collaboratorEditor = renderer => renderer.root.findAllByType('button').some(button => buttonText(button).includes('Adicionar colaborador'));

vm.runInNewContext(ts.transpileModule(await readFile(new URL('../../src/components/partner/CadastrosModule.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText, {
  exports,
  Error,
  require: name => name === '../../hooks/useSessionDraft'
    ? sessionDraftMocks
    : name === '../../lib/productNames' ? { normalizeProductName: value => String(value ?? '') }
    : name === './ProductProfitPreview' ? { ProductProfitPreview: () => null }
    : name === './ProductPhotoField' ? { ProductPhotoField: () => null }
    : name === './ProductLabelModal' ? { ProductLabelModal: () => null }
    : name === './ImportExportModule' ? { ImportExportModule: () => null, ExportButtons: () => null }
    : name === './CustomerPhoto' || name === '../../lib/cadastroXml' || name === '../../utils' || name === '../../lib/saleReturns'
      ? {}
      : require(name),
});

test('estoque no Administrativo não duplica menus; valida e salva o saldo contado, incluindo zero', async () => {
  const calls = [];
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(exports.CadastrosModule, {
    adminTarget: 'estoque', initialTab: 'produtos', selectedBranchId: 'branch',
    products: [{ id: 'p', branch_id: 'branch', name: 'Produto', stock: 10, min_stock: 2, is_service: false },
      { id: 'svc', branch_id: 'branch', name: 'Serviço', stock: 0, is_service: true }],
    onUpdateProduct: async (...args) => calls.push(args),
  })); });
  assert.equal(renderer.root.findAllByProps({ className: 'subtab-bar cadastros-subtab-bar' }).length, 0);
  assert.equal(renderer.root.findAllByType('button').length, 1);
  await act(async () => renderer.root.findByType('button').props.onClick());
  const amount = () => renderer.root.findByProps({ 'aria-label': 'Novo saldo de Produto' });
  await act(async () => amount().props.onChange({ target: { value: '-1' } }));
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(calls.length, 0);
  assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 1);
  await act(async () => amount().props.onChange({ target: { value: '0' } }));
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(calls[0][0], 'p');
  assert.equal(calls[0][1].stock, 0);
  await act(async () => renderer.unmount());
});

for (const plan of ['basico', 'profissional', 'enterprise', undefined]) {
  test(`Colaboradores outside Administrative is visible only in Basic: ${plan ?? 'loading'}`, async () => {
    let renderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(exports.CadastrosModule, registrationProps(plan))); });
    try {
      assert.equal(collaboratorShortcut(renderer), plan === 'basico');
      assert.equal(collaboratorEditor(renderer), plan === 'basico');
      if (plan !== 'basico') assert.ok(renderer.root.findAllByType('button').some(button =>
        button.props.className?.includes('active') && buttonText(button) === 'Produtos & Serviços'));
    } finally { await act(async () => renderer.unmount()); }
  });
}

for (const plan of ['basico', 'profissional', 'enterprise']) {
  test(`Administrative collaborator management remains available in ${plan}`, async () => {
    let renderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(exports.CadastrosModule,
      registrationProps(plan, { adminTarget: 'vendedores' }))); });
    try { assert.equal(collaboratorShortcut(renderer), false); assert.equal(collaboratorEditor(renderer), true); }
    finally { await act(async () => renderer.unmount()); }
  });
}

test('a restored or open Basic collaborator tab closes when the plan changes', async () => {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(exports.CadastrosModule, registrationProps('basico'))); });
  try {
    assert.equal(collaboratorEditor(renderer), true);
    for (const plan of ['profissional', 'enterprise']) {
      await act(async () => renderer.update(React.createElement(exports.CadastrosModule, registrationProps(plan))));
      assert.equal(collaboratorShortcut(renderer), false); assert.equal(collaboratorEditor(renderer), false);
    }
  } finally { await act(async () => renderer.unmount()); }
});

test('Basic plan does not expose collaborator management without owner permission', async () => {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(exports.CadastrosModule,
    registrationProps('basico', { canManageSalespeople: false }))); });
  try { assert.equal(collaboratorShortcut(renderer), false); assert.equal(collaboratorEditor(renderer), false); }
  finally { await act(async () => renderer.unmount()); }
});

test('editar colaborador conserva bloqueios, permite escolher módulos e respeita a função', async () => {
  const calls = [];
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(exports.CadastrosModule, {
    adminTarget: 'vendedores', initialTab: 'vendedores', branches: [{id:'branch',name:'Filial'}],
    salespeople: [{id:'employee',name:'Funcionário',email:'employee@example.test',role:'vendedor',commission_rate:0,active:true,branch_id:'branch',blocked_modules:['pdv']}],
    onUpdateSalesperson: async (...args) => calls.push(args),
  })); });
  await act(async () => renderer.root.findByProps({title:'Editar'}).props.onClick());
  const pdv = () => renderer.root.findByProps({'aria-label':'Acesso a PDV'});
  assert.equal(pdv().props.checked, false);
  assert.equal(renderer.root.findByProps({'aria-label':'Acesso a Financeiro'}).props.disabled, true);
  await act(async () => pdv().props.onChange({target:{checked:true}}));
  await act(async () => renderer.root.findByProps({'aria-label':'Acesso a Caixa'}).props.onChange({target:{checked:false}}));
  const save = renderer.root.findByProps({title:'Salvar alterações'});
  assert.ok(save);
  await act(async () => save.props.onClick());
  assert.equal(calls[0][0], 'employee');
  assert.deepEqual([...calls[0][1].blocked_modules], ['caixa']);
  await act(async () => renderer.unmount());
});

test('all-branch authorization saves independently of activation and module permissions', async () => {
  for (const role of ['administrador', 'gerente', 'vendedor']) {
    const calls = [];
    let renderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(exports.CadastrosModule,
      registrationProps('profissional', { adminTarget: 'vendedores',
        salespeople: [{ id: 'employee', name: 'Amanda', role, active: false, branch_id: 'branch', blocked_modules: ['caixa'], commission_rate: 0 }],
        onUpdateSalesperson: async (...args) => calls.push(args) }))); });
    try {
      await act(async () => renderer.root.findByProps({ title: 'Editar' }).props.onClick());
      const fields = renderer.root.findAllByProps({ 'aria-label': 'Autorizar todas as filiais para Amanda' });
      assert.equal(fields.length, role === 'vendedor' ? 0 : 1);
      if (fields.length) {
        assert.equal(fields[0].props.checked, false);
        await act(async () => fields[0].props.onChange({ target: { checked: true } }));
        assert.equal(calls[0][0], 'employee');
        assert.deepEqual(Object.keys(calls[0][1]), ['can_access_all_branches']);
        assert.equal(calls[0][1].can_access_all_branches, true);
      }
    } finally { await act(async () => renderer.unmount()); }
  }
});

test('filial mostra colaboradores locais e globais, sem incluir outra filial', async () => {
  let renderer;
  const employee = (id, branch_id) => ({ id, branch_id, name: id, role: 'vendedor', commission_rate: 0, active: true, blocked_modules: [] });
  await act(async () => { renderer = TestRenderer.create(React.createElement(exports.CadastrosModule, {
    adminTarget: 'vendedores', initialTab: 'vendedores', selectedBranchId: 'branch-a',
    canGrantAllBranches: true, branches: [], products: [],
    salespeople: [employee('local', 'branch-a'), employee('global', null), employee('other', 'branch-b')],
  })); });
  const names = renderer.root.findAllByType('strong').map(node => node.children.join(''));
  assert.ok(names.includes('local'));
  assert.ok(names.includes('global'));
  assert.ok(!names.includes('other'));
  await act(async () => renderer.unmount());
});



test('import and XML shortcuts require explicit permission, including restored tabs and permission revocation', async () => {
  for (const initialTab of ['importar', 'xml']) {
    let renderer;
    const props = registrationProps('profissional', { initialTab, canManageSalespeople: false });
    await act(async () => { renderer = TestRenderer.create(React.createElement(exports.CadastrosModule, props)); });
    const transferShortcuts = () => renderer.root.findAllByType('button').filter(button => /Importar|Entrada via XML/.test(buttonText(button)));
    assert.equal(transferShortcuts().length, 0);
    assert.equal(renderer.root.findAllByProps({ type: 'file' }).length, 0);
    await act(async () => renderer.update(React.createElement(exports.CadastrosModule, { ...props, canImportExport: true })));
    assert.equal(transferShortcuts().length, 2);
    await act(async () => renderer.update(React.createElement(exports.CadastrosModule, { ...props, canImportExport: false })));
    assert.equal(transferShortcuts().length, 0);
    assert.equal(renderer.root.findAllByProps({ type: 'file' }).length, 0);
    await act(async () => renderer.unmount());
  }
});
