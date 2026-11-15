import { intelligenceHarness } from './fixtures/business_intelligence_helpers.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require=createRequire(import.meta.url),exports={};
const source=await readFile(new URL('../../src/components/partner/CrmWorkspace.tsx',import.meta.url),'utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require(name){
    if(name==='../../lib/adminDashboard')return intelligenceHarness().load('lib/adminDashboard.ts');
 if(name==='../../lib/supabase')return {supabase:null};
 if(name==='../../lib/accounts')return {accountBalance:()=>0,isOverdue:()=>false};
 if(name==='../../utils')return {money:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})};
 return require(name);
}});
test('CRM closes a customer sheet without clearing search or an unsaved follow-up',async()=>{
 let view;
 try {
  await act(async()=>{view=Renderer.create(React.createElement(exports.CrmWorkspace,{customers:[{id:'a',name:'Cliente A'}],sales:[],invoices:[],salespeople:[],companyUserId:null,branchId:'branch'}));});
  const button=text=>view.root.findAllByType('button').find(node=>node.children.includes(text));
  await act(async()=>view.root.findByProps({'aria-label':'Buscar cliente no CRM'}).props.onChange({target:{value:'Cliente A'}}));
  await act(async()=>button('Abrir ficha').props.onClick());
  await act(async()=>view.root.findByType('textarea').props.onChange({target:{value:'Retornar contato amanhã'}}));
  await act(async()=>button(' Fechar ficha').props.onClick());
  assert.equal(view.root.findAllByType('textarea').length,0);
  assert.equal(view.root.findByProps({'aria-label':'Buscar cliente no CRM'}).props.value,'Cliente A');
  await act(async()=>button('Abrir ficha').props.onClick());
  assert.equal(view.root.findByType('textarea').props.value,'Retornar contato amanhã');
 } finally {if(view)await act(async()=>view.unmount());}
});
