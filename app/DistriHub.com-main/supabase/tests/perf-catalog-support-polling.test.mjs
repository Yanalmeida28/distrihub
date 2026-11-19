import { realtimeTransport } from './fixtures/realtime_transport.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';
import {act,create} from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';

const require=createRequire(import.meta.url);
const hookSource=ts.transpileModule(await readFile(new URL('../../src/hooks/useSupportUnread.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const catalog=await readFile(new URL('../../src/components/PublicCatalogPage.tsx',import.meta.url),'utf8');

test('support unread: realtime INSERT refreshes, hidden tab never polls, returning to the tab refreshes',async()=>{
 let rpcCount=0,realtimeHandler=null;const intervals=new Map(),listeners=new Map(),docListeners=new Map();let timer=0;
 const client={rpc:async()=>{rpcCount++;return {data:{total:1,conversations:[]},error:null};},
  channel(){const q={on(_t,_f,cb){realtimeHandler=cb;return q;},subscribe(){return q;}};return q;},removeChannel(){}};
 const window={setInterval:(f,ms)=>{intervals.set(++timer,{f,ms});return timer;},clearInterval:id=>intervals.delete(id),
  addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:(n,f)=>{if(listeners.get(n)===f)listeners.delete(n);}};
 const document={visibilityState:'visible',addEventListener:(n,f)=>docListeners.set(n,f),removeEventListener:(n,f)=>{if(docListeners.get(n)===f)docListeners.delete(n);}};
 const exports={};vm.runInNewContext(hookSource,{exports,window,document,require:n=>n==='../lib/authenticatedRealtime'?realtimeTransport:n==='../lib/supabase'?{supabase:client}:require(n)});
 function Harness(){exports.useSupportUnread('owner');return null;}
 let view;await act(async()=>{view=create(React.createElement(Harness));});
 try{
  const tick=[...intervals.values()][0];
  assert.ok(tick.ms>=20000,'polling must only reconcile missed Realtime events');
  let base=rpcCount;
  await act(async()=>realtimeHandler());assert.ok(rpcCount>base,'Realtime INSERT triggers a refresh');
  document.visibilityState='hidden';base=rpcCount;
  await act(async()=>tick.f());assert.equal(rpcCount,base,'interval must not query while the tab is hidden');
  await act(async()=>docListeners.get('visibilitychange')());assert.equal(rpcCount,base,'becoming hidden must not query');
  document.visibilityState='visible';
  await act(async()=>docListeners.get('visibilitychange')());assert.ok(rpcCount>base,'returning to the app refreshes immediately');
  base=rpcCount;await act(async()=>tick.f());assert.ok(rpcCount>base,'visible tab reconciles on the interval');
 }finally{await act(async()=>view.unmount());}
 assert.equal(intervals.size,0);assert.equal(docListeners.size,0);assert.equal(listeners.size,0);
});

test('support unread: first SUBSCRIBED does not duplicate the mount refresh, reconnects refresh, focus+visibilitychange coalesce',async()=>{
 let rpcCount=0,statusCb=null;const listeners=new Map(),docListeners=new Map();
 const client={rpc:async()=>{rpcCount++;return {data:{total:0,conversations:[]},error:null};},
  channel(){const q={on(){return q;},subscribe(cb){statusCb=cb;return q;}};return q;},removeChannel(){}};
 const window={setInterval:()=>1,clearInterval(){},addEventListener:(n,f)=>listeners.set(n,f),removeEventListener(){}};
 const document={visibilityState:'visible',addEventListener:(n,f)=>docListeners.set(n,f),removeEventListener(){}};
 const exports={};vm.runInNewContext(hookSource,{exports,window,document,require:n=>n==='../lib/authenticatedRealtime'?realtimeTransport:n==='../lib/supabase'?{supabase:client}:require(n)});
 function Harness(){exports.useSupportUnread('owner');return null;}
 let view;await act(async()=>{view=create(React.createElement(Harness));});
 try{
  assert.equal(rpcCount,1,'mount refresh only');
  await act(async()=>statusCb('SUBSCRIBED'));assert.equal(rpcCount,1,'first subscription adds no duplicate request');
  await act(async()=>statusCb('SUBSCRIBED'));assert.equal(rpcCount,2,'reconnection refreshes to recover missed events');
  const base=rpcCount;
  await act(async()=>docListeners.get('visibilitychange')());
  await act(async()=>listeners.get('focus')());
  assert.equal(rpcCount-base,1,'focus right after visibilitychange is coalesced');
 }finally{await act(async()=>view.unmount());}
});

test('public catalog: single 300 ms debounce, timer cleanup, pagination reset with the applied term, no stale term on catalog change',()=>{
 assert.match(catalog,/window\.setTimeout\([\s\S]*?\},\s*300\)/);
 assert.match(catalog,/return \(\) => window\.clearTimeout\(timer\)/);
 assert.match(catalog,/p_search: debouncedSearch/);
 assert.doesNotMatch(catalog,/p_search: search/);
 // Typing must not reset the offset before the debounced term is applied (would re-request the old term).
 assert.match(catalog,/onChange=\{e => setSearch\(e\.target\.value\)\}/);
 assert.match(catalog,/setOffset\(0\); setDebouncedSearch\(next\)/);
 // Changing slug/branch slug clears the applied term as well.
 assert.match(catalog,/setSearch\(''\); setDebouncedSearch\(''\); appliedSearch\.current = ''/);
 // Stale responses are discarded and products from a previous branch/search are cleared.
 assert.match(catalog,/let active = true/);
 assert.match(catalog,/return \(\) => \{ active = false; \}/);
 assert.match(catalog,/if \(offset === 0\) setProducts\(\[\]\)/);
 assert.match(catalog,/setRequestedBranch\(e\.target\.value\); setOffset\(0\); setCart\(\[\]\)/);
});
