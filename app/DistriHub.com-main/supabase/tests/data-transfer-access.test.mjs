import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';

const require = createRequire(import.meta.url);
async function load(path, dependencies = {}) {
  const exports = {};
  const source = await readFile(new URL('../../src/' + path, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => dependencies[name] ?? require(name) });
  return exports;
}
const owner = { authUserId: 'company', companyUserId: 'company', salespersonId: null, role: 'administrador', branchId: null };

test('only the unlocked owner and active administrator can transfer company data after device admission', async () => {
  const { canTransferCompanyData: allowed } = await load('lib/dataTransferAccess.ts');
  assert.equal(allowed(owner, false, true, null), true);
  assert.equal(allowed(null, false, true, null), false);
  assert.equal(allowed({ ...owner, authUserId: 'foreign' }, false, true, null), false);
  for (const role of ['administrador', 'gerente', 'caixa', 'vendedor', 'tecnico', 'atendente', 'logistica']) {
    const identity = { ...owner, salespersonId: 'staff', role };
    assert.equal(allowed(identity, false, true, { role, is_active: true }), role === 'administrador', role);
    assert.equal(allowed(identity, false, true, { role, is_active: false }), false);
    assert.equal(allowed(identity, false, true, null), false);
    assert.equal(allowed(identity, true, true, { role, is_active: true }), false);
    assert.equal(allowed(identity, false, false, { role, is_active: true }), false);
  }
  assert.equal(allowed(owner, true, true, null), false);
  assert.equal(allowed(owner, false, false, null), false);
});

test('product/customer exports and file import deny by default and disappear immediately when permission is revoked', async () => {
  const { ExportButtons, ImportExportModule } = await load('components/partner/ImportExportModule.tsx', {
    '../../utils': {}, '../../lib/exportSafety': {},
  });
  for (const target of ['produtos', 'clientes']) {
    let renderer;
    const props = { target, products: [], customers: [] };
    await act(async () => { renderer = TestRenderer.create(React.createElement(ExportButtons, props)); });
    assert.equal(renderer.toJSON(), null);
    await act(async () => renderer.update(React.createElement(ExportButtons, { ...props, allowed: true })));
    assert.equal(renderer.root.findAllByType('button').length, 3);
    await act(async () => renderer.update(React.createElement(ExportButtons, { ...props, allowed: false })));
    assert.equal(renderer.toJSON(), null);
    await act(async () => renderer.unmount());
  }
  let renderer;
  let writes = 0;
  const props = { products: [], customers: [], onAddProduct() { writes++; }, onUpdateProduct() { writes++; }, onAddCustomer() { writes++; } };
  await act(async () => { renderer = TestRenderer.create(React.createElement(ImportExportModule, props)); });
  assert.equal(renderer.toJSON(), null);
  await act(async () => renderer.update(React.createElement(ImportExportModule, { ...props, canImportExport: true })));
  assert.equal(renderer.root.findAllByProps({ type: 'file' }).length, 1);
  await act(async () => renderer.update(React.createElement(ImportExportModule, { ...props, canImportExport: false })));
  assert.equal(renderer.toJSON(), null);
  assert.equal(writes, 0);
  await act(async () => renderer.unmount());
});

test('administrative JSON/CSV/XLSX exports require explicit authorization', async () => {
  const { AdminDataExports } = await load('components/partner/AdminSettingsTools.tsx', {
    '../../lib/supabase': {}, '../../hooks/useDeviceHeartbeat': {},
  });
  let renderer;
  const props = { products: [], sales: [], customers: [], branchId: '', extra: {} };
  await act(async () => { renderer = TestRenderer.create(React.createElement(AdminDataExports, props)); });
  assert.equal(renderer.toJSON(), null);
  await act(async () => renderer.update(React.createElement(AdminDataExports, { ...props, allowed: true })));
  assert.equal(renderer.root.findAllByType('button').length, 4);
  await act(async () => renderer.update(React.createElement(AdminDataExports, { ...props, allowed: false })));
  assert.equal(renderer.toJSON(), null);
  await act(async () => renderer.unmount());
});

test('every report export respects the same permission without removing the report itself', async () => {
  const { ReportsModule } = await load('components/partner/ReportsModule.tsx', {
    '../../utils': { money: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }) },
    '../../lib/pdv': {},
    '../../lib/reportMetrics': {
      completedSalesOnly: () => [], filterReportSales: () => [], getCostOfGoodsSold: () => 0,
      legacyCostSalesCount: () => 0, getItemRevenueByType: () => ({ productRevenue: 0, serviceRevenue: 0, productSalesCount: 0, serviceSalesCount: 0 }),
    },
    '../../lib/stagnantStock': { stagnantLevelLabels: {} },
    '../../hooks/useStagnantStock': { useStagnantStock: () => ({ items: [], count: 0, capital: 0 }) },
    './CrmWorkspace': { CrmWorkspace: () => null },
  });
  for (const initialTab of ['vendas', 'financeiro', 'estoque', 'sem-giro', 'crm']) {
    let renderer;
    const props = { initialTab, products: [], sales: [], customers: [], salespeople: [] };
    await act(async () => { renderer = TestRenderer.create(React.createElement(ReportsModule, props)); });
    const exportButtons = () => renderer.root.findAllByType('button').filter(button => JSON.stringify(button.children.filter(child => typeof child === 'string')).includes('Exportar'));
    assert.equal(exportButtons().length, 0, initialTab);
    assert.ok(renderer.toJSON(), initialTab);
    await act(async () => renderer.update(React.createElement(ReportsModule, { ...props, canExport: true })));
    assert.equal(exportButtons().length, 1, initialTab);
    await act(async () => renderer.update(React.createElement(ReportsModule, { ...props, canExport: false })));
    assert.equal(exportButtons().length, 0, initialTab);
    await act(async () => renderer.unmount());
  }
});

test('an Excel export waiting for its library cannot download after permission is revoked', async () => {
  let writes = 0;
  const { ExportButtons } = await load('components/partner/ImportExportModule.tsx', {
    '../../utils': {}, '../../lib/exportSafety': {},
    xlsx: { utils: { book_new: () => ({}), book_append_sheet() {}, aoa_to_sheet: () => ({}) }, writeFile() { writes++; } },
  });
  let renderer;
  const props = { target: 'produtos', products: [], customers: [] };
  await act(async () => { renderer = TestRenderer.create(React.createElement(ExportButtons, { ...props, allowed: true })); });
  act(() => {
    renderer.root.findByProps({ title: 'Exportar para Excel' }).props.onClick();
    renderer.update(React.createElement(ExportButtons, { ...props, allowed: false }));
  });
  await act(async () => { await Promise.resolve(); });
  assert.equal(writes, 0);
  await act(async () => renderer.unmount());
});
