import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(
  new URL('../migrations/20261026123000_default_deny_new_collaborators.sql', import.meta.url),
  'utf8',
);
const authHook = await readFile(
  new URL('../../src/hooks/useAuth.ts', import.meta.url),
  'utf8',
);
const collaboratorForm = await readFile(
  new URL('../../src/components/partner/CadastrosModule.tsx', import.meta.url),
  'utf8',
);
const partnerPanel = await readFile(
  new URL('../../src/components/PartnerPanel.tsx', import.meta.url),
  'utf8',
);

test('new collaborators are inactive and all modules are blocked even when the insert requests access', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE SCHEMA partner_subscription_private;
      CREATE TABLE public.partner_salespeople (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        role text,
        active boolean DEFAULT true,
        blocked_modules text[] NOT NULL DEFAULT '{}'
      );
    `);
    await db.exec(migration);

    const requestedModules = ['cadastros', 'pdv', 'caixa'];
    const { rows } = await db.query(
      `INSERT INTO public.partner_salespeople (role, active, blocked_modules)
       VALUES ('vendedor', true, $1)
       RETURNING active, blocked_modules`,
      [requestedModules],
    );

    assert.equal(rows[0].active, false);
    assert.deepEqual(new Set(rows[0].blocked_modules), new Set([
      'cadastros', 'pdv', 'caixa', 'pedidos', 'os', 'historico', 'suporte',
      'fiscal', 'administrativo', 'entregas', 'financeiro', 'rma',
      'relatorios', 'white-label', 'configuracoes',
    ]));
  } finally {
    await db.close();
  }
});

test('inactive collaborator identity is denied by the application and creation form', () => {
  assert.match(authHook, /select\('id, user_id, role, branch_id, active'\)/);
  assert.match(authHook, /salesperson\.active !== true/);
  assert.match(authHook, /Acesso pendente de liberação pelo administrador da empresa/);
  assert.match(collaboratorForm, /active: false/);
  assert.match(collaboratorForm, /is_active: false/);
  assert.match(collaboratorForm, /Novos colaboradores ficam inativos e sem acesso aos módulos/);
});

test('only Basic plan registrations expose the owner collaborator shortcut', () => {
  assert.match(partnerPanel, /canManageSalespeople={Boolean\(identity && !identity\.salespersonId\)}/);
  assert.match(partnerPanel, /planId={saas\.subscription\?\.effective_plan}/);
  assert.match(collaboratorForm, /showSalespeopleOutsideAdmin = canManageSalespeople && planId === 'basico'/);
  assert.match(collaboratorForm, /showSalespeopleOutsideAdmin\s*\?\s*\[\.\.\.availableSubTabs/);
  assert.match(collaboratorForm, /label: 'Colaboradores'/);
  assert.match(collaboratorForm, /adminTarget === 'vendedores' \|\| \(!adminTarget && showSalespeopleOutsideAdmin\)/);
});
