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
const source=ts.transpileModule(await readFile(new URL('../../src/hooks/useSupportUnread.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
test('support badge refreshes without opening chat, preserves confirmed counts on failure and isolates account changes',async()=>{
 let response={data:{total:3,conversations:[{user_id:'owner',unread_count:3}]},error:null};
 let release,hold=false,count=0,removed=0;const listeners=new Map(),intervals=new Map();let timer=0;
 const client={rpc:async()=>{count++;return hold?new Promise(r=>{release=r;}):response;},channel(){const q={on(){return q;},subscribe(){return q;}};return q;},removeChannel(){removed++;}};
 const window={setInterval:f=>{intervals.set(++timer,f);return timer;},clearInterval:id=>intervals.delete(id),addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:(n,f)=>{if(listeners.get(n)===f)listeners.delete(n);}};
 const document={addEventListener(){},removeEventListener(){}};
 const exports={};vm.runInNewContext(source,{exports,window,document,require:n=>n==='../lib/authenticatedRealtime'?realtimeTransport:n==='../lib/supabase'?{supabase:client}:require(n)});
 let snapshot;function Harness({actor}){snapshot=exports.useSupportUnread(actor);return null;}
 let view;await act(async()=>{view=create(React.createElement(Harness,{actor:'owner'}));});
 try{
  assert.equal(snapshot.total,3);assert.equal(snapshot.conversations.owner,3);
  response={data:null,error:{message:'Offline'}};await act(async()=>listeners.get('focus')());assert.equal(snapshot.total,3);
  response={data:{total:0,conversations:[]},error:null};await act(async()=>listeners.get('distrihub:support-read')());assert.equal(snapshot.total,0);
  hold=true;await act(async()=>listeners.get('focus')());const oldRelease=release;
  await act(async()=>view.update(React.createElement(Harness,{actor:'other'})));assert.equal(snapshot.total,0);
  const newRelease=release;await act(async()=>oldRelease({data:{total:9,conversations:[]},error:null}));assert.equal(snapshot.total,0);
  await act(async()=>newRelease({data:{total:2,conversations:[{user_id:'other',unread_count:2}]},error:null}));assert.equal(snapshot.total,2);assert.equal(snapshot.conversations.owner,undefined);
  assert.ok(count>=5);
 }finally{await act(async()=>view.unmount());}
 assert.equal(intervals.size,0);assert.equal(listeners.size,0);assert.equal(removed,2);
});
