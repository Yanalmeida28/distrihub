import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
const source=await readFile(new URL('../../src/hooks/useFinancialMovements.ts',import.meta.url),'utf8');
async function harness(){
 const listeners=new Map(),timers=new Set();const network={onLine:true},document={visibilityState:'visible'};let rows=[],reads=0,current,view,branch='A',active=true,identity='owner',hold=null;
 const add=(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);};const remove=(name,fn)=>listeners.get(name)?.delete(fn);
 document.addEventListener=add;document.removeEventListener=remove;
 const window={addEventListener:add,removeEventListener:remove,setInterval(fn){timers.add(fn);return fn;},clearInterval(fn){timers.delete(fn);}};
 const client={auth:{getUser:async()=>({data:{user:{id:identity}},error:null})},from(table){return {select(){return this;},eq(){return this;},order(){return this;},async range(){reads++;if(hold&&table==='rma_requests_v2')return hold;return {data:table==='rma_requests_v2'?rows:[],error:null};}};}};
 const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,Error,window,document,navigator:network,require(name){if(name==='react')return React;if(name==='../lib/supabase')return {supabase:client};throw Error(name);}});
 function Probe(){current=exports.useFinancialMovements('owner',branch,[],[],active);return null;}
 const update=()=>act(async()=>view.update(React.createElement(Probe)));
 await act(async()=>{view=Renderer.create(React.createElement(Probe));});
 return {get state(){return current;},get reads(){return reads;},rows(value){rows=value;},hold(value){hold=value;},identity(value){identity=value;},network,document,timers,
  async event(name,detail){await act(async()=>{for(const fn of [...(listeners.get(name)??[])])fn({detail});});},
  async tick(){await act(async()=>{for(const fn of [...timers])fn();});},
  async branch(value){branch=value;await update();},async active(value){active=value;await update();},async close(){await act(async()=>view.unmount());},
 };
}
const refund=(patch={})=>({id:'refund',user_id:'owner',branch_id:'A',refund_amount:20,refund_request_id:'request',...patch});
test('refund events refresh an already open ledger without invoice changes and reject unrelated contexts',async()=>{
 const h=await harness();try{
  const initial=h.reads;h.rows([refund()]);await h.event('distrihub:financial-changed',{companyId:'foreign',branchId:'A'});await h.event('distrihub:financial-changed',{companyId:'owner',branchId:'B'});assert.equal(h.reads,initial);
  await h.event('distrihub:financial-changed',{companyId:'owner',branchId:'A'});assert.equal(h.state.refunds[0].refund_amount,20);assert.equal(h.reads,initial+3);
 }finally{await h.close();}assert.equal(h.timers.size,0);
});
test('missed events recover periodically and polling pauses offline, hidden or inactive',async()=>{
 const h=await harness();try{
  h.rows([refund()]);const initial=h.reads;h.document.visibilityState='hidden';await h.tick();h.document.visibilityState='visible';h.network.onLine=false;await h.tick();assert.equal(h.reads,initial);
  h.network.onLine=true;await h.event('online');assert.equal(h.state.refunds.length,1);
  h.rows([refund({refund_amount:30})]);await h.tick();assert.equal(h.state.refunds[0].refund_amount,30);
  await h.active(false);assert.equal(h.timers.size,0);const stopped=h.reads;await h.event('distrihub:financial-changed',{companyId:'owner',branchId:'A'});await h.tick();assert.equal(h.reads,stopped);
  await h.active(true);assert.equal(h.timers.size,1);
 }finally{await h.close();}
});
test('a delayed old-branch result cannot replace the current branch ledger',async()=>{
 const h=await harness();let release;try{
  h.hold(new Promise(resolve=>{release=resolve;}));await h.event('distrihub:financial-changed',{companyId:'owner',branchId:'A'});
  const pendingReads=h.reads;await h.tick();assert.equal(h.reads,pendingReads);
  h.hold(null);h.rows([refund(),refund({id:'B',branch_id:'B',refund_amount:50}),refund({id:'foreign',user_id:'foreign',branch_id:'B'})]);await h.branch('B');assert.equal(h.state.refunds.length,1);assert.equal(h.state.refunds[0].id,'B');
  await act(async()=>release({data:[refund()],error:null}));assert.equal(h.state.refunds[0].id,'B');
 }finally{await h.close();}
});
test('authentication mismatch hides financial data on automatic refresh',async()=>{
 const h=await harness();try{h.identity('foreign');await h.tick();assert.match(h.state.error,/propriet/);assert.equal(h.state.refunds.length,0);}finally{await h.close();}
});

test('automatic refresh preserves current rows until its replacement arrives',async()=>{
 const h=await harness();let release;try{
  h.rows([refund()]);await h.tick();assert.equal(h.state.refunds.length,1);
  h.hold(new Promise(resolve=>{release=resolve;}));await h.tick();assert.equal(h.state.loading,true);assert.equal(h.state.refunds.length,1);
  await act(async()=>release({data:[refund({refund_amount:35})],error:null}));assert.equal(h.state.refunds[0].refund_amount,35);
 }finally{await h.close();}
});
