import { intelligenceHarness } from './fixtures/business_intelligence_helpers.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';

const exports = {};
vm.runInNewContext(ts.transpileModule(await readFile(new URL('../../src/lib/accounts.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports, require: () => intelligenceHarness().load('lib/adminDashboard.ts') });
const { accountBalance, accountPaid, financialAccounts, isOverdue } = exports;

test('crédito de devolução liquida saldo sem aumentar dinheiro recebido', () => {
  const invoices = [{ amount: 100, paid_amount: 100, return_credit_amount: 70, status: 'paga' }, { amount: 50, paid_amount: 50, return_credit_amount: 50, status: 'paga' }];
  assert.equal(financialAccounts(invoices, []).received, 30);
  assert.equal(financialAccounts(invoices, []).receivable, 0);
});

test('recebimentos parciais reduzem saldo e faturas canceladas não geram saldo ou receita', () => {
  const invoices = [
    { amount: 100, paid_amount: 40, status: 'parcial' },
    { amount: 25, status: 'paga' },
    { amount: 200, paid_amount: 10, status: 'cancelada' },
  ];
  const result = financialAccounts(invoices, [{ amount: 50, paid_amount: 15, status: 'parcial' }]);
  assert.equal(result.receivable, 60);
  assert.equal(result.received, 65);
  assert.equal(result.payable, 35);
  assert.equal(result.paid, 15);
});

test('vencimento hoje não está vencido; saldo quitado não aparece vencido', () => {
  const today = new Date(2026, 9, 7, 18, 30);
  const account = { amount: 100, paid_amount: 40, status: 'parcial', due_date: '2026-10-07' };
  assert.equal(isOverdue(account, today), false);
  assert.equal(isOverdue({ ...account, due_date: '2026-10-06' }, today), true);
  assert.equal(isOverdue({ ...account, due_date: '2026-10-06', paid_amount: 100, status: 'paga' }, today), false);
});

test('saldo usa centavos e mantém compatibilidade com faturas antigas quitadas', () => {
  assert.equal(accountBalance({ amount: 0.3, paid_amount: 0.1, status: 'parcial' }), 0.2);
  assert.equal(accountBalance({ amount: 100, status: 'paga' }), 0);
  assert.equal(accountPaid({ amount: 100, status: 'paga' }), 100);
});
