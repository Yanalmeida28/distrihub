import { businessTimeHelpers } from './fixtures/business-time.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';

const module={exports:{}};
vm.runInNewContext(ts.transpileModule(await readFile(new URL('../../src/lib/cashRegister.ts',import.meta.url),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText,{exports:module.exports,Date,Intl,require:()=>businessTimeHelpers});
const {cashBusinessDay,cashDaySalesTotal}=module.exports;

test('daily sales sum all payment methods across the operator sessions and exclude cash management',()=>{
 const sessions=[{id:'first',branch_id:'branch',actor_key:'operator'},{id:'second',branch_id:'branch',actor_key:'operator'},
  {id:'other-operator',branch_id:'branch',actor_key:'other'},{id:'other-branch',branch_id:'foreign',actor_key:'operator'}];
 const movement=(kind,payment_method,amount,session_id='first',created_at='2026-10-10T15:00:00Z')=>({kind,payment_method,amount,session_id,created_at});
 const movements=[movement('venda','dinheiro',100),movement('venda','pix',50),movement('venda','cartao',25,'second'),
  movement('venda','faturado',200),movement('estorno','pix',10),movement('devolucao','cartao',5),
  movement('suprimento','dinheiro',500),movement('sangria','dinheiro',40),
  movement('venda','pix',999,'other-operator'),movement('venda','pix',999,'other-branch'),
  movement('venda','pix',999,'first','2026-10-10T02:59:59Z')];
 assert.equal(cashDaySalesTotal(movements,sessions,'branch','operator','2026-10-10'),360);
 assert.equal(cashDaySalesTotal([],sessions,'branch','operator','2026-10-10'),0);
});

test('daily sales use São Paulo midnight and exact cents without changing movements or closed snapshots',()=>{
 assert.equal(cashBusinessDay('2026-10-10T02:59:59Z'),'2026-10-09');
 assert.equal(cashBusinessDay('2026-10-10T03:00:00Z'),'2026-10-10');
 assert.equal(cashBusinessDay('invalid'),'');
 const sessions=[{id:'session',branch_id:'branch',actor_key:'operator',closing_totals:{pix:999}}];
 const movements=[0.1,0.2].map(amount=>({session_id:'session',kind:'venda',payment_method:'pix',amount,created_at:'2026-10-10T03:00:00Z'}));
 const before=JSON.stringify({sessions,movements});
 assert.equal(cashDaySalesTotal(movements,sessions,'branch','operator','2026-10-10'),0.3);
 assert.equal(JSON.stringify({sessions,movements}),before);
});

test('Manaus commercial day stays consistent with administration, cash and order filters',()=>{
 const stamp='2026-11-17T03:30:00Z';
 assert.equal(cashBusinessDay(stamp,'America/Manaus'),'2026-11-16');
 assert.equal(cashBusinessDay(stamp),'2026-11-17');
 assert.equal(cashBusinessDay(stamp,'invalid'),'2026-11-17');
 assert.equal(cashBusinessDay('not a timestamp','America/Manaus'),'');
 const sessions=[{id:'session',branch_id:'branch',actor_key:'owner'}];
 const movements=[{session_id:'session',created_at:stamp,kind:'venda',payment_method:'pix',amount:12.34}];
 assert.equal(cashDaySalesTotal(movements,sessions,'branch','owner','2026-11-16','America/Manaus'),12.34);
 assert.equal(cashDaySalesTotal(movements,sessions,'other','owner','2026-11-16','America/Manaus'),0);
 assert.equal(cashDaySalesTotal(movements,sessions,'branch','owner','2026-11-17','America/Manaus'),0);
});
