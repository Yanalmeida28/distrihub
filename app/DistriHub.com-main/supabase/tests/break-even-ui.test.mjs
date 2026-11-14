import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { intelligenceHarness, helpers, input, payable } from './fixtures/business_intelligence_helpers.mjs';

const text = node => typeof node === 'string' ? node : (node?.children ?? []).map(text).join('');
const model = helpers.buildBusinessIntelligence(input({ period: 'selectedMonth', selectedMonth: '2026-10', rmas: [], payables: [payable({ due_date: '2026-10-10', amount: 30 })] }));

test('break even saves explicit settings, reloads them on remount, requires period review and isolates branch changes', async () => {
  const saved = new Map(); let failSave = false;
  const client = { from(table) {
    assert.equal(table, 'partner_break_even_settings'); const filters = {};
    const query = { select: () => query, eq: (key, value) => { filters[key] = value; return query; },
      maybeSingle: async () => ({ data: saved.get(`${filters.user_id}:${filters.scope}`) ?? null, error: null }),
      upsert: async record => { if (failSave) return { error: { message: 'falha' } }; saved.set(`${record.user_id}:${record.scope}`, record); return { error: null }; } };
    return query;
  } };
  const Component = intelligenceHarness({ client }).load('components/partner/BreakEvenPanel.tsx').BreakEvenPanel;
  const props = { companyId: 'company', branchId: 'A', model }; let renderer;
  const render = patch => React.createElement(Component, { ...props, ...patch });
  const button = () => renderer.root.findByType('button');
  try {
    await act(async () => { renderer = Renderer.create(render()); });
    assert.equal(saved.size, 0); assert.doesNotMatch(text(renderer.toJSON()), /Ponto de equilíbrio estimado/);
    await act(async () => renderer.root.findAllByType('select')[0].props.onChange({ target: { value: 'fixed' } }));
    await act(async () => renderer.root.findAllByType('input')[0].props.onChange({ target: { value: '10' } }));
    await act(async () => button().props.onClick());
    assert.equal(saved.get('company:A').desired, 10); assert.equal(saved.get('company:A').aluguel, 'fixed');
    assert.match(text(renderer.toJSON()), /Configurações salvas/);
    await act(async () => renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }));
    assert.match(text(renderer.toJSON()), /Ponto de equilíbrio estimado/); assert.match(text(renderer.toJSON()), /50,00/);
    await act(async () => renderer.update(render({ model: { ...model, first: '2026-09-01' } })));
    assert.equal(renderer.root.findByProps({ type: 'checkbox' }).props.checked, false);
    await act(async () => renderer.unmount());
    await act(async () => { renderer = Renderer.create(render()); });
    assert.equal(renderer.root.findAllByType('select')[0].props.value, 'fixed');
    assert.equal(renderer.root.findAllByType('input')[0].props.value, '10');
    assert.equal(renderer.root.findByProps({ type: 'checkbox' }).props.checked, false);
    await act(async () => renderer.update(render({ branchId: 'B' })));
    assert.equal(renderer.root.findAllByType('select')[0].props.value, '');
    assert.equal(renderer.root.findAllByType('input')[0].props.value, '0');
    failSave = true; await act(async () => button().props.onClick());
    assert.match(text(renderer.toJSON()), /Não foi possível confirmar/); assert.equal(saved.size, 1);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test('an old branch settings response cannot replace the current branch and loading failure never shows a calculation', async () => {
  const pending = [];
  const client = { from() { const query = { select: () => query, eq: () => query,
    maybeSingle: () => new Promise(resolve => pending.push(resolve)) }; return query; } };
  const Component = intelligenceHarness({ client }).load('components/partner/BreakEvenPanel.tsx').BreakEvenPanel;
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(React.createElement(Component, { companyId: 'company', branchId: 'A', model })); });
    await act(async () => renderer.update(React.createElement(Component, { companyId: 'company', branchId: 'B', model })));
    await act(async () => pending[0]({ data: { aluguel: 'fixed', desired: 9000 }, error: null }));
    assert.match(text(renderer.toJSON()), /Carregando/); assert.doesNotMatch(text(renderer.toJSON()), /9000/);
    await act(async () => pending[1]({ data: null, error: { message: 'falha' } }));
    assert.match(text(renderer.toJSON()), /Não foi possível carregar/); assert.equal(renderer.root.findAllByType('input').length, 0);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});
