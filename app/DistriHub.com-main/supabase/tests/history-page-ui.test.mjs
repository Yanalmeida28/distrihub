import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import TestRenderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
const source=await readFile(new URL('../../src/components/partner/SalesHistoryModule.tsx',import.meta.url),'utf8');
async function harness(rpc,extra={},clock=Date) {
 const timers=new Map();let timerId=0;const calls=[];const merged=[];
 const deps={react:React,'react/jsx-runtime':jsx,'lucide-react':new Proxy({},{get:()=>()=>null}),
  '../../lib/pdv':{saleChargeTotal:s=>s.total,salePaymentDescription:()=> 'PIX'},
  '../../lib/saleReturns':{saleReturnLabel:()=>'',saleItemDescription:()=>''},
  './SaleActionsMenu':{SaleActionsMenu:props=>React.createElement('sale-actions',props)},'../../utils':{money:{format:v=>String(v)}},
  '../../lib/salePrint':{},'../../lib/saleShare':{},
  '../../lib/supabase':{supabase:{rpc:async(name,args)=>{calls.push({name,args});return rpc(args);}}}};
 const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>deps[name],setTimeout:callback=>{const id=++timerId;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),Date:clock,Error});
 let props={companyId:'company',branchId:'branch',isActive:true,sales:[],customers:[],salespeople:[],segment:'distribuidor',onCancelSale:async()=>{},onDeleteSale:async()=>{},onPageLoaded:rows=>merged.push(...rows),...extra};
 let view;await act(async()=>{view=TestRenderer.create(React.createElement(exports.SalesHistoryModule,props));});
 return {view,calls,merged,async flush(){await act(async()=>{for(const [id,callback]of[...timers]){timers.delete(id);callback();}});},async update(change){props={...props,...change};await act(async()=>view.update(React.createElement(exports.SalesHistoryModule,props)));},async close(){await act(async()=>view.unmount());}};
}
const row=(index,branch='branch')=>({id:'sale-'+branch+'-'+index,user_id:'company',branch_id:branch,customer_name:branch,status:'concluida',created_at:new Date().toISOString(),total:10,items:[]});
const response=(sales,total,completed_total)=>({data:{sales,rmas:[],total,completed_total,page_size:25},error:null});
const text=view=>JSON.stringify(view.toJSON());
test('history displays full server totals across pages and resets pagination when filters change',async()=>{
 const h=await harness(args=>response(Array.from({length:args.p_page===2?5:25},(_,i)=>row(args.p_page*25+i)),55,550));try{
  await h.flush();assert.equal(h.calls[0].name,'read_partner_sales_history');assert.equal(h.calls[0].args.p_company_id,'company');assert.match(text(h.view),/550/);
  assert.equal(h.view.root.findAllByType('tbody')[0].findAllByType('tr').length,25);
  await act(async()=>h.view.root.findAllByType('button').find(b=>b.children.includes('Pr\u00f3xima')).props.onClick());await h.flush();assert.equal(h.calls.at(-1).args.p_page,1);assert.match(text(h.view),/550/);
  await act(async()=>h.view.root.findByProps({name:'sales-history-search'}).props.onChange({target:{value:'Joao'}}));await h.flush();assert.equal(h.calls.at(-1).args.p_page,0);assert.equal(h.calls.at(-1).args.p_search,'Joao');
 }finally{await h.close();}
});
test('hidden history performs no requests and a late response from the previous branch is ignored',async()=>{
 let resolveOld;const old=new Promise(resolve=>{resolveOld=resolve;});
 const h=await harness(args=>args.p_branch_id==='branch'?old:response([row(0,'new-branch')],1,200),{isActive:false});try{
  await h.flush();assert.equal(h.calls.length,0);
  await h.update({isActive:true});await h.flush();assert.equal(h.calls.length,1);
  await h.update({branchId:'new-branch'});await h.flush();assert.match(text(h.view),/200/);
  await act(async()=>resolveOld(response([row(0,'old-branch')],1,100)));
  assert.doesNotMatch(text(h.view),/old-branch/);assert.equal(h.merged.length,1);assert.equal(h.merged[0].branch_id,'new-branch');
 }finally{await h.close();}
});
test('history errors remain visible and do not announce an empty period as a confirmed result',async()=>{
 let failure=true;const h=await harness(()=>failure?{data:null,error:{message:'Unavailable'}}:response([row(0)],1,10));try{
  await h.flush();assert.match(text(h.view),/Unavailable/);assert.doesNotMatch(text(h.view),/vendas encontradas no per\u00edodo/);
  failure=false;await act(async()=>h.view.root.findAllByType('button').find(b=>b.children.includes('Tentar novamente')).props.onClick());await h.flush();assert.doesNotMatch(text(h.view),/Unavailable/);assert.equal(h.merged.length,1);
 }finally{await h.close();}
});

const button=(h,label)=>h.view.root.findAllByType('button').find(b=>b.children.some(c=>typeof c==='string'&&c.trim()===label));
const openCancel=async h=>act(async()=>h.view.root.findByType('sale-actions').props.onCancel());
const manager={id:'manager',name:'Gerente',role:'gerente',branch_id:'branch',active:true};
test('history owner and manager self-authorize without registered supervisor and deletion is absent',async()=>{
 for(const currentRole of ['administrador','gerente']){
  const calls=[];const h=await harness(()=>response([row(1)],1,10),{currentRole,onCancelSale:async(...args)=>calls.push(args)});
  try{await h.flush();await openCancel(h);assert.equal(button(h,'Cancelar Venda').props.disabled,false);assert.equal(button(h,'Apagar Venda'),undefined);
   await act(async()=>button(h,'Cancelar Venda').props.onClick());assert.deepEqual(calls,[['sale-branch-1',null,null]]);
  }finally{await h.close();}
 }
});
test('history cancellation locks synchronously, keeps dialog open and freezes credentials while pending',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});const calls=[];
 const h=await harness(()=>response([row(1)],1,10),{currentRole:'caixa',salespeople:[manager],onCancelSale:async(...args)=>{calls.push(args);await pending;}});
 try{await h.flush();await openCancel(h);await act(async()=>h.view.root.findByProps({type:'password'}).props.onChange({target:{value:'9876'}}));
  const click=button(h,'Cancelar Venda').props.onClick;let a,b;await act(async()=>{a=click();b=click();});assert.equal(calls.length,1);
  assert.equal(h.view.root.findByProps({type:'password'}).props.disabled,true);
  await act(async()=>h.view.root.findByProps({className:'modal-backdrop'}).props.onClick());assert.equal(h.view.root.findAllByProps({id:'sales-history-cancel-authorization'}).length,1);
  release();await act(async()=>{await a;await b;});assert.deepEqual(calls,[['sale-branch-1','manager','9876']]);
 }finally{release();await h.close();}
});
test('history invalidates authorization on branch, company and operator changes and ignores old actions',async()=>{
 for(const change of [{branchId:'other-branch'},{companyId:'other-company'},{operatorKey:'other-operator'}]){
  let reject;const pending=new Promise((_,r)=>{reject=r;});
  const h=await harness(()=>response([row(1)],1,10),{currentRole:'administrador',onCancelSale:async()=>pending});
  try{await h.flush();await openCancel(h);let action;await act(async()=>{action=button(h,'Cancelar Venda').props.onClick();});
   await h.update(change);await h.flush();assert.equal(h.view.root.findAllByProps({id:'sales-history-cancel-authorization'}).length,0);
   await openCancel(h);await act(async()=>{reject(new Error('Old context failure'));await action;});assert.doesNotMatch(text(h.view),/Old context failure/);
   assert.equal(h.view.root.findAllByProps({id:'sales-history-cancel-authorization'}).length,1);
  }finally{await h.close();}
 }
});
test('leaving history clears authorization and ignores a late cancellation error',async()=>{
 let reject;const pending=new Promise((_,r)=>{reject=r;});
 const h=await harness(()=>response([row(1)],1,10),{currentRole:'administrador',onCancelSale:async()=>pending});
 try{await h.flush();await openCancel(h);let action;await act(async()=>{action=button(h,'Cancelar Venda').props.onClick();});
  await h.update({isActive:false});assert.equal(h.view.root.findAllByProps({id:'sales-history-cancel-authorization'}).length,0);
  await act(async()=>{reject(new Error('Late failure'));await action;});await h.update({isActive:true});await h.flush();assert.doesNotMatch(text(h.view),/Late failure/);
 }finally{await h.close();}
});
test('supervisors are active, allowed in PDV and in the sale branch when viewing all branches',async()=>{
 const people=[{...manager,id:'inactive',active:false},{...manager,id:'legacy-inactive',active:undefined,is_active:false},{...manager,id:'blocked',blocked_modules:['pdv']},{...manager,id:'foreign',branch_id:'other'},manager];
 const h=await harness(()=>response([row(1)],1,10),{branchId:null,currentRole:'caixa',salespeople:people});
 try{await h.flush();await openCancel(h);assert.deepEqual(h.view.root.findAllByType('option').filter(o=>o.props.value==='manager'||people.some(p=>p.id===o.props.value)).map(o=>o.props.value),['manager']);}
 finally{await h.close();}
});
test('initial date and Today use Sao Paulo even when the browser is in UTC',async()=>{
 const previous=process.env.TZ;process.env.TZ='UTC';
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-15T01:00:00Z']));}}
 const h=await harness(()=>response([],0,0),{},FixedDate);
 try{await h.flush();assert.equal(h.calls[0].args.p_start,'2026-10-14');
  await act(async()=>button(h,'Limpar período').props.onClick());await h.flush();await act(async()=>button(h,'Hoje').props.onClick());await h.flush();assert.equal(h.calls.at(-1).args.p_end,'2026-10-14');
 }finally{await h.close();if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
