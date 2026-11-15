import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
const modules = {};
for (const name of ['adminDashboard', 'accounts', 'pdv', 'financialFlow']) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(await readFile(new URL(`../../src/lib/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: path => modules[path.slice(2)] });
  modules[name] = exports;
}
const { actualFinancialFlow, projectedFinancialFlow, localDate } = modules.financialFlow;

test('return credit funds the sale without becoming cash received; fully credit-funded purchases receive zero',()=>{
 const sale={id:'s',status:'concluida',total:100,freight_fee:0,payment_method:'misto',payment_splits:[{method:'credito_rma',amount:50},{method:'pix',amount:50}],created_at:'2026-10-20',customer_name:'Cliente'};
 assert.equal(actualFinancialFlow([sale],[],[],[],[],[])[0].amount,50);
 assert.equal(actualFinancialFlow([{...sale,payment_splits:[{method:'credito_rma',amount:100}]}],[],[],[],[],[])[0].amount,0);
 assert.match(modules.pdv.salePaymentDescription(sale),/Crédito de devolução/);
});

test('cash flow shows the full receipt including freight without changing merchandise revenue', () => {
  const sale={id:'s',status:'concluida',total:100,freight_fee:15,payment_method:'pix',created_at:'2026-10-09',customer_name:'Cliente'};
  const rows=actualFinancialFlow([sale],[],[],[],[],[]);
  assert.equal(rows[0].amount,115);
  assert.match(rows[0].description,/frete para repasse/);
  assert.equal(sale.total,100);
});

test('faturamento não conta como entrada; recebimentos parciais entram uma vez por baixa', () => {
  const sales = [{ id: 's', status: 'concluida', total: 100, payment_method: 'faturado', created_at: '2026-09-01', customer_name: 'Cliente' }];
  const receipts = [
    { id: 'r1', invoice_number: '1', customer_name: 'Cliente', amount: 40, occurred_at: '2026-10-01' },
    { id: 'r2', invoice_number: '1', customer_name: 'Cliente', amount: 60, occurred_at: '2026-10-07' },
  ];
  const rows = actualFinancialFlow(sales, [], receipts, [], [], [{ sale_id: 's', status: 'paga' }]);
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 100);
});

test('venda à vista concluída depois usa a data da baixa de estoque', () => {
  const sales = [{ id: 's', status: 'concluida', total: 100, payment_method: 'dinheiro', created_at: '2026-09-01', customer_name: 'Cliente' }];
  const movements = [{ type: 'saida', reason: 'Saida por venda s', quantity: 1, created_at: '2026-10-07' }];
  assert.equal(actualFinancialFlow(sales, movements, [], [], [], [])[0].date, '2026-10-07');
});

test('pagamentos de contas são saídas; contas fora da filial não entram', () => {
  const rows = actualFinancialFlow([], [], [], [{ id: 'p1', payable_id: 'a', amount: 25, created_at: '2026-10-07' }, { id: 'p2', payable_id: 'b', amount: 50, created_at: '2026-10-07' }], [{ id: 'a', description: 'Aluguel', creditor_name: 'Credor' }], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, -25);
});

test('previsão usa somente saldo pendente e preserva contas sem vencimento', () => {
  const rows = projectedFinancialFlow([{ id: 'a', status: 'parcial', amount: 100, paid_amount: 40, due_date: null, customer_name: 'Cliente', number: '1' }, { id: 'b', status: 'cancelada', amount: 100 }], [{ id: 'c', status: 'parcial', amount: 80, paid_amount: 30, due_date: '2026-10-09', description: 'Conta', creditor_name: 'Credor' }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, null);
  assert.equal(rows[0].amount, 60);
  assert.equal(rows[1].amount, -50);
  assert.equal(localDate('2026-10-09'), '2026-10-09');
});
