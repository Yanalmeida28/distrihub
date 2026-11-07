import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../../src/hooks/usePartnerData.ts',import.meta.url),'utf8');
const helperSource = await readFile(new URL('../../src/lib/pdv.ts',import.meta.url),'utf8');
const syncSource = await readFile(new URL('../../src/lib/partnerSync.ts',import.meta.url),'utf8');
const productPersistenceSource = await readFile(new URL('../../src/lib/productPersistence.ts',import.meta.url),'utf8');
const productNamesSource = await readFile(new URL('../../src/lib/productNames.ts',import.meta.url),'utf8');
const compile = source => ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const invoiceModule={exports:{}};
vm.runInNewContext(compile(await readFile(new URL('../../src/lib/invoicePayments.ts',import.meta.url),'utf8')),{exports:invoiceModule.exports});
const operationModule={exports:{}};
vm.runInNewContext(compile(await readFile(new URL('../../src/lib/operationAttempts.ts',import.meta.url),'utf8')),{exports:operationModule.exports,crypto:{randomUUID},Error});
let renderer;

afterEach(async()=>{if(renderer) await act(async()=>renderer.unmount());renderer=null;});
async function harness({initialSales=[],initialInvoices=[],initialCustomers=[],rpc,values=new Map(),readResult,branchId=null,resourceScope=null,identity: suppliedIdentity,storageClient}={}) {
  const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const identity=suppliedIdentity??{authUserId:'owner',companyUserId:'owner',salespersonId:null,branchId:null,role:'administrador'};
  const initial={partner_sales:initialSales,partner_invoices:initialInvoices,partner_customers:initialCustomers};
  const queries=[];
  let activeScope=resourceScope;
  const channels=[];
  const intervals=[];
  const timeouts=new Map();
  let timerId=0;
  const client={rpc,storage:storageClient,auth:{getSession:async()=>({data:{session:{user:{id:identity.authUserId}}},error:null})},from(table){
    queries.push(table); let first=0,last=499; let mutation;
    const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},range(from,to){first=from;last=to;return q;},
      update(value){mutation={type:'update',value};return q;},upsert(value){mutation={type:'upsert',value};return q;},
      maybeSingle(){return Promise.resolve(readResult?.(table,{data:null,error:null},mutation)??{data:null,error:null});},
      single(){return Promise.resolve(readResult?.(table,{data:null,error:null},mutation)??{data:null,error:null});},
      then(resolve,reject){const fallback={data:[...(initial[table]??[])].slice(first,last+1),error:null};return Promise.resolve(readResult?.(table,fallback)??fallback).then(resolve,reject);}};
    return q;
  },channel(name){const channel={name,handlers:[],on(event,filter,handler){channel.handlers.push({filter,handler});return channel;},subscribe(callback){channel.status=callback;return channel;}};channels.push(channel);return channel;},removeChannel(channel){channel.removed=true;return Promise.resolve('ok');}};
  const helperModule={exports:{}};
  vm.runInNewContext(compile(helperSource),{exports:helperModule.exports,require});
  const syncModule={exports:{}};
  vm.runInNewContext(compile(syncSource),{exports:syncModule.exports,AbortController,Date,setTimeout(callback){const id=++timerId;timeouts.set(id,callback);return id;},clearTimeout(id){timeouts.delete(id);}});
  const productNamesModule={exports:{}};
  vm.runInNewContext(compile(productNamesSource),{exports:productNamesModule.exports});
  const productPersistenceModule={exports:{}};
  vm.runInNewContext(compile(productPersistenceSource),{exports:productPersistenceModule.exports});
  const hookModule={exports:{}};
  vm.runInNewContext(compile(source),{
    exports:hookModule.exports,sessionStorage:storage,crypto:{randomUUID},console,
    window:{localStorage:storage,addEventListener(){},removeEventListener(){},setInterval(callback){intervals.push(callback);return intervals.length;},clearInterval(){},setTimeout(callback){const id=++timerId;timeouts.set(id,callback);return id;},clearTimeout(id){timeouts.delete(id);}},
    navigator:{onLine:true},
    document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},
    require(name){
      if(name==='react')return React;
      if(name==='../lib/supabase')return {supabase:client,isSupabaseConfigured:true};
      if(name==='../lib/invoicePayments')return invoiceModule.exports;
      if(name==='../lib/operationAttempts')return operationModule.exports;
      if(name==='../lib/pdv')return helperModule.exports;
      if(name==='../lib/partnerSync')return syncModule.exports;
      if(name==='../lib/productPersistence')return productPersistenceModule.exports;
      if(name==='../lib/productNames')return productNamesModule.exports;
      throw new Error('Unexpected import '+name);
    },
  });
  let current;
  function Probe(){current=hookModule.exports.usePartnerData(identity,branchId,activeScope);return null;}
  await act(async()=>{renderer=TestRenderer.create(React.createElement(Probe));});
  return {get current(){return current;},values,queries,
    async setScope(scope){activeScope=scope;await act(async()=>renderer.update(React.createElement(Probe)));},
    emit(table,eventType,record,old={}){for(const channel of channels.filter(channel=>!channel.removed))for(const {filter,handler} of channel.handlers)if(filter.table===table&&filter.event===eventType)handler({eventType,new:record,old});},
    status(status){channels.findLast(channel=>channel.name.startsWith('partner-sync-')&&!channel.removed)?.status?.(status);},
    tick(){for(const callback of intervals)callback();},
    flushTimers(){for(const [id,callback] of [...timeouts]){timeouts.delete(id);callback();}},
  };
}
test('products open before slow suppliers; supplier editor is still unready', async () => {
 let release;
 const h = await harness({resourceScope:'suporte',rpc:async()=>({data:null,error:null}),readResult:(table,fallback)=>table==='partner_suppliers'?new Promise(resolve=>{release=resolve;}):table==='partner_products'?{data:[{id:'audit-product',user_id:'owner',stock:1}],error:null}:fallback});
 await h.setScope('cadastros:produtos');
 assert.equal(h.current.products[0].id,'audit-product');
 assert.equal(h.current.resourcesReady,true);
 assert.equal(h.current.loading,false);
 assert.equal(h.current.suppliersReady,false);
 await act(async()=>release({data:[],error:null}));
 assert.equal(h.current.products[0].id,'audit-product');
 assert.equal(h.current.resourcesReady,true);
 assert.equal(h.current.suppliersReady,true);
});

test('cash shell does not wait for company-wide customers or historical sales',async()=>{
 const h=await harness({resourceScope:'caixa',rpc:async()=>({data:null,error:null})});
 assert.equal(h.current.resourcesReady,true);assert.equal(h.current.loading,false);
 for(const table of ['partner_customers','partner_sales','partner_products','rma_requests_v2'])assert.equal(h.queries.includes(table),false,table);
 assert(h.queries.includes('partner_branches'));assert(h.queries.includes('partner_salespeople'));
});

test('customer directory opens without history and loads complete sales/returns when requested',async()=>{
 const h=await harness({resourceScope:'cadastros:clientes',initialCustomers:[{id:'customer',user_id:'owner',name:'Cliente'}],initialSales:[{id:'sale',user_id:'owner',customer_id:'customer'}],rpc:async()=>({data:null,error:null})});
 assert.equal(h.current.customers.length,1);assert.equal(h.current.resourcesReady,true);
 assert.equal(h.queries.includes('partner_sales'),false);assert.equal(h.queries.includes('rma_requests_v2'),false);
 await h.setScope('cadastros:clientes-historico');
 for(const table of ['partner_sales','rma_requests_v2','partner_rma_credit_applications'])assert(h.queries.includes(table),table);
 assert.equal(h.current.sales[0].id,'sale');assert.equal(h.current.resourcesReady,true);
});

test('PDV concurrent navigation reads share RPC, but explicit refresh after write cannot reuse old result',async()=>{
 const pending=[];let calls=0;
 const h=await harness({resourceScope:'suporte',rpc:()=>{calls++;return new Promise(resolve=>pending.push(resolve));}});
 let first,joined,fresh;
 await act(async()=>{first=h.current.refreshPdv('branch',true);joined=h.current.refreshPdv('branch',true);});
 assert.equal(calls,1);
 await act(async()=>{fresh=h.current.refreshPdv('branch');});assert.equal(calls,2);
 const snapshot={credits:[],products:[{id:'new-stock',user_id:'owner',branch_id:'branch',stock:1}],sales:[],invoices:[],movements:[]};
 await act(async()=>{pending[1]({data:snapshot,error:null});await fresh;});
 await act(async()=>{pending[0]({data:{...snapshot,products:[{id:'old-stock',user_id:'owner',stock:99}]},error:null});await first;await joined;});
 assert.equal(h.current.products[0].id,'new-stock');
});
test('automatic reconciliation preserves secondary failure while finance stays unready', async () => {
 let fail=true;
 const h=await harness({resourceScope:'suporte',rpc:async()=>({data:null,error:null}),readResult:(table,fallback)=>table==='partner_rma_credit_applications'&&fail?{data:null,error:{message:'audit unavailable'}}:fallback});
 await h.setScope('financeiro');
 fail=true;
 await act(async()=>h.current.loadData(true));
 assert.match(h.current.syncError,/atualizados/);
 assert.equal(h.current.resourcesReady,false);
 const reads=h.queries.length;
 await act(async()=>{h.tick();h.flushTimers();});
 assert.ok(h.queries.length>reads);
 assert.match(h.current.syncError,/atualizados/);
 assert.equal(h.current.resourcesReady,false);
});
test('timeout stops original pagination before another page is requested',async()=>{
 let release,productReads=0;
 const h=await harness({resourceScope:'suporte',rpc:async()=>({data:null,error:null}),readResult:(table,fallback)=>{
 if(table!=='partner_products')return fallback;
 productReads++;return productReads===1?new Promise(resolve=>{release=resolve;}):fallback;
 }});
 await h.setScope('cadastros:produtos');
 await act(async()=>h.flushTimers());
 assert.match(h.current.error,/demorou demais/);
 await act(async()=>release({data:Array.from({length:500},(_,i)=>({id:String(i),user_id:'owner'})),error:null}));
 assert.equal(productReads,1);
});

test('report sections defer unused histories and financial sections still load their required data',async()=>{
 const sale={id:'sale',user_id:'owner',status:'concluida',items:[],total:20};
 const h=await harness({resourceScope:'relatorios:vendas',initialSales:[sale],rpc:async()=>({data:null,error:null})});
 assert.equal(h.current.sales.length,1);
 assert.equal(h.queries.includes('partner_invoices'),false);
 assert.equal(h.queries.includes('partner_stock_movements'),false);
 assert.equal(h.queries.includes('partner_audit_logs'),false);
 await h.setScope('relatorios:sem-giro');
 assert.ok(h.queries.includes('partner_stock_movements'));
 await h.setScope('administrativo:financeiro');
 for(const table of ['partner_invoices','partner_suppliers','rma_requests_v2','partner_rma_credit_applications'])assert.ok(h.queries.includes(table),table);
 assert.equal(h.current.resourcesReady,true);
 assert.equal(h.current.sales[0].id,'sale');
});

test('changing identity aborts pending requests without aborting a new identity request',async()=>{
 const exports={};vm.runInNewContext(compile(syncSource),{exports,AbortController,setTimeout,clearTimeout});
 const cache=new exports.PartnerLoadCache();cache.reset('old');
 let oldSignal,newSignal,finishOld,finishNew;
 const old=cache.read('products',signal=>{oldSignal=signal;return new Promise(resolve=>{finishOld=resolve;});});
 await Promise.resolve();cache.reset('new');assert.equal(oldSignal.aborted,true);
 const current=cache.read('products',signal=>{newSignal=signal;return new Promise(resolve=>{finishNew=resolve;});});
 await Promise.resolve();finishOld('old');await old;
 assert.equal(newSignal.aborted,false);
 finishNew('new');assert.equal(await current,'new');
});

test('installed Supabase client receives an aborted fetch signal when a cached query expires',async()=>{
 const timers=new Map();let id=0,requestSignal;
 const exports={};vm.runInNewContext(compile(syncSource),{exports,AbortController,setTimeout(callback){timers.set(++id,callback);return id;},clearTimeout(key){timers.delete(key);}});
 const {createClient}=require('@supabase/supabase-js');
 const client=createClient('https://audit.invalid','public-audit-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(_url,options)=>{
   requestSignal=options.signal;
   return new Promise((_resolve,reject)=>requestSignal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
 }}});
 const cache=new exports.PartnerLoadCache();cache.reset('owner');
 const query=cache.read('products',signal=>client.from('partner_products').select('id').abortSignal(signal));
 const failure=assert.rejects(query,/demorou demais/);
 for(let i=0;i<30&&!requestSignal;i++)await Promise.resolve();
 assert.ok(requestSignal);
 for(const callback of [...timers.values()])callback();
 await failure;assert.equal(requestSignal.aborted,true);
});

