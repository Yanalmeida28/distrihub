import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import ts from 'typescript';

const require = createRequire(import.meta.url), root = new URL('../../src/', import.meta.url);
let renderer;
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; });
const text = node => typeof node === 'string' ? node : (node.children ?? []).map(text).join('');
function environment(client = null) {
  const cache = new Map(), values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key) };
  const load = name => {
    if (cache.has(name)) return cache.get(name);
    const exports = {}; cache.set(name, exports);
    const source = ts.transpileModule(readFileSync(new URL(name,root),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(source, { exports, Date, Intl, Error, console, crypto: { randomUUID }, window: { localStorage: storage }, require(dep) {
      if (dep.endsWith('/supabase')) return { supabase: client };
      if (dep.endsWith('/utils')) return { money: new Intl.NumberFormat('pt-BR', { style:'currency',currency:'BRL' }) };
      if (!dep.startsWith('.')) return require(dep);
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(name),dep));
      return load(relative + (existsSync(new URL(relative+'.ts',root)) ? '.ts' : '.tsx'));
    } }); return exports;
  }; return { load };
}
const base = { kind:'pagar', branchId:'A', invoices:[], branches:[{id:'A',name:'Centro'}], suppliers:[{id:'supplier',name:'Credor'}], payables:{accounts:[],loading:false,error:''} };
const button = label => renderer.root.findAllByType('button').find(node => text(node)===label);
const change = async (label,value) => act(async () => renderer.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));

test('new expenses require an explicit type, persist variable choice, and inventory purchases have no expense type', async () => {
  const { load } = environment(), Component = load('components/partner/AccountsModule.tsx').AccountsModule;
  const saved=[];
  await act(async () => { renderer = Renderer.create(React.createElement(Component,{...base,payables:{...base.payables,create:async account=>saved.push(account)}})); });
  await act(async () => button('Nova conta a pagar').props.onClick());
  assert.equal(renderer.root.findByProps({'aria-label':'Tipo de despesa'}).props.value,'');
  await act(async () => renderer.root.findAllByType('label').find(node=>node.children[0]==='Descrição').findByType('input').props.onChange({target:{value:'Taxa de venda'}}));
  const supplier=()=>renderer.root.findAllByType('select').find(node=>node.findAllByType('option').some(option=>option.props.value==='supplier'));
  await act(async () => supplier().props.onChange({target:{value:'supplier'}}));
  await act(async () => renderer.root.findByProps({inputMode:'decimal'}).props.onChange({target:{value:'30,00'}}));
  await change('Vencimento','2026-10-15');
  await act(async () => renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(saved.length,0); assert.match(text(renderer.toJSON()),/Selecione se a despesa é fixa ou variável/);
  await change('Tipo de despesa','variable');
  await act(async () => renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(saved[0].expense_behavior,'variable'); assert.equal(saved[0].category,'outros'); assert.equal(saved[0].amount,30);
  await act(async () => button('Nova conta a pagar').props.onClick());
  const category=renderer.root.findByProps({'aria-label':'Categoria da nova conta'});
  await act(async () => category.props.onChange({target:{value:'fornecedor'}}));
  assert.equal(renderer.root.findAllByProps({'aria-label':'Tipo de despesa'}).length,0);
});

test('editing preserves existing type and permits an audited correction without changing the paid amount', async () => {
  const { load } = environment(), Component = load('components/partner/PayableManagementPanel.tsx').PayableManagementPanel;
  const updates=[];
  const account={id:'p',description:'Taxa',creditor_name:'Credor',category:'outros',amount:100,paid_amount:100,status:'paga',due_date:'2026-10-15',expense_behavior:'variable',revision:2};
  await act(async () => { renderer=Renderer.create(React.createElement(Component,{account,mode:'edit',suppliers:[],branchName:'Centro',blocked:false,isActive:true,onEdit:async (...args)=>updates.push(args),onDone(){},onCancel(){}})); });
  assert.equal(renderer.root.findByProps({'aria-label':'Editar tipo de despesa'}).props.value,'variable');
  await change('Editar tipo de despesa','fixed');
  await act(async () => renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(updates[0][0].expense_behavior,'fixed'); assert.equal(updates[0][0].amount,100); assert.equal(updates[0][1],2); assert.ok(updates[0][2]);
  assert.equal(account.paid_amount,100);
});

test('installment RPC and uncertain-operation recovery retain the exact expense type', async () => {
  const calls=[]; let fail=true;
  const client={auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},from(){const q={select:()=>q,eq:()=>q,order:()=>q,range:async()=>({data:[],error:null})};return q;},rpc:async(name,args)=>{calls.push({name,args});return fail?{error:{message:'Resposta perdida'}}:{data:args.p_purchase_id,error:null};}};
  const { load } = environment(client), usePayables = load('hooks/usePayables.ts').usePayables;
  let state; function Probe(){state=usePayables('owner');return null;}
  const account={description:'Taxa',creditor_name:'Credor',category:'outros',supplier_id:null,branch_id:'A',amount:100,due_date:'2026-10-15',purchased_on:'2026-10-15',expense_behavior:'variable',installments:[{id:'a',amount:50,due_date:'2026-10-15'},{id:'b',amount:50,due_date:'2026-11-15'}]};
  await act(async()=>{renderer=Renderer.create(React.createElement(Probe));});
  await act(async()=>assert.rejects(state.create(account,'original'),/Resposta perdida/));
  assert.equal(calls[0].name,'create_partner_payable_purchase'); assert.ok(calls[0].args.p_installments.every(row=>row.expense_behavior==='variable'));
  await act(async()=>assert.rejects(state.create({...account,expense_behavior:'fixed'},'changed'),/sem confirmação/)); assert.equal(calls.length,1);
  await act(async()=>renderer.unmount());
  await act(async()=>{renderer=Renderer.create(React.createElement(Probe));});
  fail=false; await act(async()=>state.recoveries[0].run());
  assert.equal(calls[1].args.p_purchase_id,'original'); assert.deepEqual(JSON.parse(JSON.stringify(calls[1].args.p_installments)),JSON.parse(JSON.stringify(calls[0].args.p_installments))); assert.equal(state.recoveries.length,0);
});

test('withdrawals require a recipient, omit fixed/variable, filter due periods and reset on branch changes', async () => {
  const {load}=environment(),Component=load('components/partner/AccountsModule.tsx').AccountsModule,saved=[];
  const accounts=[{id:'w',branch_id:'A',category:'retirada',description:'Pessoal',creditor_name:'Maria',amount:100,paid_amount:40,status:'parcial',due_date:'2026-10-10'},
    {id:'b',branch_id:'B',category:'retirada',description:'Outra filial',creditor_name:'Ana',amount:900,paid_amount:0,status:'aberta',due_date:'2026-10-10'},
    {id:'e',branch_id:'A',category:'outros',description:'Água da loja',creditor_name:'Distribuidor',expense_behavior:'fixed',amount:30,paid_amount:0,status:'aberta',due_date:'2026-10-10'}];
  const props={...base,payables:{...base.payables,accounts,create:async account=>saved.push(account)}};
  await act(async()=>{renderer=Renderer.create(React.createElement(Component,props));});
  await change('Filtrar categoria das contas','retirada');
  assert.match(text(renderer.toJSON()),/Maria/); assert.doesNotMatch(text(renderer.toJSON()),/Outra filial|Água da loja/);
  await change('Vencimento de','2026-11-01'); assert.doesNotMatch(text(renderer.toJSON()),/Maria/);
  await change('Vencimento até','2026-10-01'); assert.match(text(renderer.toJSON()),/Confira o período/);
  await act(async()=>button('Limpar filtros de categoria e período').props.onClick());
  await act(async()=>button('Nova conta a pagar').props.onClick());
  await change('Categoria da nova conta','retirada');
  assert.equal(renderer.root.findAllByProps({'aria-label':'Tipo de despesa'}).length,0);
  assert.equal(renderer.root.findByProps({'aria-label':'Credor ou beneficiário'}).props.required,true);
  await act(async()=>renderer.root.findAllByType('label').find(node=>node.children[0]==='Descrição').findByType('input').props.onChange({target:{value:'Uso pessoal'}}));
  await change('Credor ou beneficiário','Maria');
  await act(async()=>renderer.root.findByProps({inputMode:'decimal'}).props.onChange({target:{value:'100'}}));
  await change('Vencimento','2026-10-15');
  await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(saved[0].category,'retirada'); assert.equal(saved[0].expense_behavior,null); assert.equal(saved[0].creditor_name,'Maria'); assert.equal(saved[0].supplier_id,null);
  await change('Filtrar categoria das contas','retirada');
  await act(async()=>renderer.update(React.createElement(Component,{...props,branchId:'B'})));
  assert.equal(renderer.root.findByProps({'aria-label':'Filtrar categoria das contas'}).props.value,'');
  assert.doesNotMatch(text(renderer.toJSON()),/Maria/); assert.match(text(renderer.toJSON()),/Ana/);
});

test('a paid expense can be reclassified as withdrawal without asking for another payment', async () => {
  const {load}=environment(),Component=load('components/partner/PayableManagementPanel.tsx').PayableManagementPanel,updates=[];
  const account={id:'paid',description:'Uso pessoal',creditor_name:'Maria',category:'outros',expense_behavior:'variable',amount:100,paid_amount:100,status:'paga',due_date:'2026-10-15',revision:3};
  await act(async()=>{renderer=Renderer.create(React.createElement(Component,{account,mode:'edit',suppliers:[],blocked:false,isActive:true,onEdit:async(...args)=>updates.push(args),onDone(){},onCancel(){}}));});
  await change('Editar categoria da conta','retirada');
  assert.equal(renderer.root.findAllByProps({'aria-label':'Editar tipo de despesa'}).length,0);
  await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(updates[0][0].category,'retirada'); assert.equal(updates[0][0].expense_behavior,null); assert.equal(updates[0][0].amount,100); assert.equal(updates[0][1],3); assert.equal(account.paid_amount,100);
});
