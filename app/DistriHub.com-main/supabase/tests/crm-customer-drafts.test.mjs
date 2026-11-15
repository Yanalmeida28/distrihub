import { intelligenceHarness } from './fixtures/business_intelligence_helpers.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require=createRequire(import.meta.url);
const source=await readFile(new URL('../../src/components/partner/CrmWorkspace.tsx',import.meta.url),'utf8');

async function fixture() {
  const writes=[],rows=new Map(); let failNext=false,holdLookup=null;
  const client={from(){let id;return {
    select(){return this;},eq(key,value){if(key==='id')id=value;return this;},order(){return this;},range(){return this;},
    async maybeSingle(){if(holdLookup)await holdLookup;return {data:rows.has(id)?{id}:null,error:null};},
    async insert(row){writes.push(row);if(failNext){failNext=false;return {error:{message:'Conexão interrompida'}};}rows.set(row.id,row);return {error:null};},
    then(resolve){resolve({data:[...rows.values()],error:null});},
  };}};
  const exports={};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText,{exports,crypto:{randomUUID},require(name){
    if(name==='../../lib/adminDashboard')return intelligenceHarness().load('lib/adminDashboard.ts');
    if(name==='../../lib/supabase')return {supabase:client};
    if(name==='../../lib/accounts')return {accountBalance:()=>0,isOverdue:()=>false};
    if(name==='../../utils')return {money:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})};
    return require(name);
  }});
  let props={customers:[{id:'a',name:'Cliente A'},{id:'b',name:'Cliente B'}],sales:[],invoices:[],salespeople:[{id:'r',name:'Responsável',branch_id:'branch'}],companyUserId:'company',branchId:'branch'};
  let view;
  await act(async()=>{view=Renderer.create(React.createElement(exports.CrmWorkspace,props));});
  const openButtons=()=>view.root.findAllByType('button').filter(n=>n.children.includes('Abrir ficha'));
  const change=(type,value)=>act(async()=>view.root.findByType(type).props.onChange({target:{value}}));
  return {
    view,writes,rows,openButtons,change,
    open:index=>act(async()=>openButtons()[index].props.onClick()),
    close:()=>act(async()=>view.root.findAllByType('button').find(n=>n.children.includes(' Fechar ficha')).props.onClick()),
    save:()=>act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}})),
    update:patch=>act(async()=>{props={...props,...patch};view.update(React.createElement(exports.CrmWorkspace,props));}),
    fail:()=>{failNext=true;},hold:promise=>{holdLookup=promise;},
    cleanup:()=>act(async()=>view.unmount()),
  };
}

test('CRM isolates text, due date and responsible by customer, preserving drafts on close',async()=>{
  const f=await fixture();
  try {
    await f.open(0); await f.change('textarea','Somente cliente A');
    await act(async()=>f.view.root.findByProps({type:'date'}).props.onChange({target:{value:'2026-12-25'}}));
    await act(async()=>f.view.root.findAllByType('select').find(n=>n.props.value==='').props.onChange({target:{value:'r'}}));
    await f.close(); await f.open(1);
    assert.equal(f.view.root.findByType('textarea').props.value,'');
    assert.notEqual(f.view.root.findByProps({type:'date'}).props.value,'2026-12-25');
    assert.equal(f.view.root.findAllByType('select').find(n=>n.props.children?.[0]?.props?.value==='').props.value,'');
    await f.change('textarea','Somente cliente B'); await f.save();
    assert.equal(f.writes[0].customer_id,'b');assert.equal(f.writes[0].description,'Somente cliente B');
    await f.open(0);
    assert.equal(f.view.root.findByType('textarea').props.value,'Somente cliente A');
    assert.equal(f.view.root.findByProps({type:'date'}).props.value,'2026-12-25');
    await f.save();
    assert.equal(f.writes[1].customer_id,'a');assert.equal(f.writes[1].responsible_id,'r');
  } finally {await f.cleanup();}
});
test('CRM direct switching does not transfer a draft; branch and company changes clear it',async()=>{
  const f=await fixture();
  try {
    await f.open(0); await f.change('textarea','A');await f.open(1);
    assert.equal(f.view.root.findByType('textarea').props.value,'');
    await f.open(0);assert.equal(f.view.root.findByType('textarea').props.value,'A');
    await f.update({branchId:'other'});await f.open(0);
    assert.equal(f.view.root.findByType('textarea').props.value,'');
    await f.change('textarea','Outra filial');await f.update({companyUserId:'other-company'});await f.open(0);
    assert.equal(f.view.root.findByType('textarea').props.value,'');
  } finally {await f.cleanup();}
});
test('CRM failed save keeps customer and idempotency key for retry',async()=>{
  const f=await fixture();
  try {
    await f.open(0);await f.change('textarea','Não duplicar');f.fail();await f.save();
    assert.equal(f.openButtons()[1].props.disabled,true);
    await f.close();await f.open(0);await f.save();
    assert.equal(f.writes.length,2);assert.equal(f.writes[0].id,f.writes[1].id);
    assert.ok(f.writes.every(row=>row.customer_id==='a'));assert.equal(f.rows.size,1);
    assert.equal(f.view.root.findByType('textarea').props.value,'');
  } finally {await f.cleanup();}
});
test('CRM in-flight save retains its original scope and cannot populate the next branch',async()=>{
  const f=await fixture();let release;
  try {
    await f.open(0);await f.change('textarea','Filial original');
    f.hold(new Promise(resolve=>{release=resolve;}));
    let pending;
    await act(async()=>{pending=f.view.root.findByType('form').props.onSubmit({preventDefault(){}});});
    await f.update({branchId:'next-branch'});await f.open(1);
    await act(async()=>{release();await pending;});
    assert.equal(f.writes[0].customer_id,'a');assert.equal(f.writes[0].branch_id,'branch');
    assert.equal(f.view.root.findByType('textarea').props.value,'');
  } finally {release?.();await f.cleanup();}
});
