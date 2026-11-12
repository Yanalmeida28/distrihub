import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
const migration = readFileSync(new URL('../migrations/20261112185215_super_admin_company_segment.sql', import.meta.url), 'utf8');

test('ramo: somente superadministrador altera, valida o valor e preserva as outras empresas', async () => {
  const db = new PGlite();
  const company = '00000000-0000-0000-0000-000000000001';
  const other = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
      CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.admin',true),'false') = 'true' $$;
      CREATE TABLE partner_profiles(id uuid PRIMARY KEY, segment text);
      CREATE TABLE admin_lojistas(user_id uuid, segment text);
      INSERT INTO partner_profiles VALUES ('${company}','assistencia'),('${other}','assistencia');
      INSERT INTO admin_lojistas SELECT id,segment FROM partner_profiles;`);
    await db.exec(migration);
    const save = segment => db.query('SELECT public.set_super_admin_company_segment($1,$2) AS segment', [company, segment]);
    await assert.rejects(save('varejo'), /superadministrador/);
    await db.query("SELECT set_config('test.uid',$1,false)", [company]);
    await assert.rejects(save('varejo'), /superadministrador/);
    await db.exec("SELECT set_config('test.admin','true',false)");
    await assert.rejects(save('invalido'), /ramo válido/);
    await assert.rejects(save(null), /ramo válido/);
    for (const segment of ['varejo', 'servicos', 'assistencia']) {
      assert.equal((await save(segment)).rows[0].segment, segment);
      assert.equal((await db.query('SELECT segment FROM partner_profiles WHERE id=$1', [company])).rows[0].segment, segment);
      assert.equal((await db.query('SELECT segment FROM admin_lojistas WHERE user_id=$1', [company])).rows[0].segment, segment);
    }
    assert.equal((await db.query('SELECT segment FROM partner_profiles WHERE id=$1', [other])).rows[0].segment, 'assistencia');
    await assert.rejects(db.query('SELECT public.set_super_admin_company_segment($1,$2)', ['00000000-0000-0000-0000-000000000003', 'varejo']), /não encontrada/);
    const permissions = await db.query("SELECT has_function_privilege('anon','public.set_super_admin_company_segment(uuid,text)','EXECUTE') AS anon, has_function_privilege('authenticated','public.set_super_admin_company_segment(uuid,text)','EXECUTE') AS authenticated");
    assert.deepEqual(permissions.rows[0], { anon: false, authenticated: true });
  } finally { await db.close(); }
});

function loadField(rpc) {
  const source = readFileSync(new URL('../../src/components/AdminCompanySegmentField.tsx', import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, Error, require: name => name === '../lib/supabase' ? { supabase: { rpc } } : name === '../lib/businessSegments' ? { businessSegmentLabels: { assistencia: 'Assistência técnica', varejo: 'Varejo', servicos: 'Serviços' } } : require(name),
  });
  return exports.AdminCompanySegmentField;
}

for (const outcome of ['success', 'error', 'unconfirmed']) test(`ramo: edição na tela com resposta ${outcome}`, async () => {
  const calls = [], saved = [];
  const Field = loadField(async (name, args) => {
    calls.push({ name, args });
    return outcome === 'error' ? { data: null, error: { message: 'Sem permissão.' } } : { data: outcome === 'success' ? 'varejo' : null, error: null };
  });
  let renderer;
  await act(async () => { renderer = Renderer.create(React.createElement(Field, { companyId: 'empresa', companyName: 'Loja', value: 'assistencia', onSaved: value => saved.push(value) })); });
  try {
    assert.equal(renderer.root.findByType('button').props.disabled, true);
    await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'varejo' } }));
    assert.equal(calls.length, 0);
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ name: 'set_super_admin_company_segment', args: { company_id: 'empresa', new_segment: 'varejo' } }]);
    assert.deepEqual(saved, outcome === 'success' ? ['varejo'] : []);
    assert.equal(renderer.root.findAllByProps({ role: outcome === 'success' ? 'status' : 'alert' }).length, 1);
  } finally { await act(async () => renderer.unmount()); }
});
