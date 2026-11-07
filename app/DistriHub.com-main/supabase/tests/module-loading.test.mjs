import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import * as jsx from 'react/jsx-runtime';
import ts from '../../node_modules/typescript/lib/typescript.js';
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
const timers=new Map();let timerId=0;
const helpers={};vm.runInNewContext(compile(await readFile(new URL('../../src/lib/partnerSync.ts',import.meta.url),'utf8')),{exports:helpers,AbortController,setTimeout(callback){timers.set(++timerId,callback);return timerId;},clearTimeout(id){timers.delete(id);}});
const modules={};vm.runInNewContext(compile(await readFile(new URL('../../src/lib/moduleLoading.ts',import.meta.url),'utf8')),{exports:modules,require:()=>helpers});

test('pending reads share only same context, forced post-mutation reads stay fresh and timeout aborts',async()=>{
 const flight=new helpers.PartnerReadFlight();let calls=0,finishOld,finishFresh;
 const old=flight.run('branch-a',()=>{calls++;return new Promise(resolve=>{finishOld=resolve;});},true);
 assert.equal(flight.run('branch-a',()=>{calls++;},true),old);
 const fresh=flight.run('branch-a',()=>{calls++;return new Promise(resolve=>{finishFresh=resolve;});});
 assert.notEqual(fresh,old);assert.equal(flight.run('branch-a',()=>{},true),fresh);
 await Promise.resolve();assert.equal(calls,2);
 finishOld('old');await old;
 assert.equal(flight.run('branch-a',()=>{},true),fresh);
 finishFresh('fresh');assert.equal(await fresh,'fresh');
 let signal;const stalled=flight.run('branch-b',s=>{signal=s;return new Promise(()=>{});},true);
 await Promise.resolve();const failure=assert.rejects(stalled,/demorou demais/);
 for(const callback of [...timers.values()])callback();await failure;assert.equal(signal.aborted,true);
 assert.equal(await flight.run('branch-b',()=>Promise.resolve('retry'),true),'retry');
});

test('module code prefetch is shared, a failed download can retry, and stalled imports have a deadline',async()=>{
 let calls=0;let fail=true;
 const load=modules.moduleLoader(async()=>{calls++;if(fail)throw Error('offline');return {default:'module'};});
 const first=load();assert.equal(load(),first);await assert.rejects(first,/offline/);
 fail=false;const result=await load();assert.equal(result.default,'module');assert.equal(await load(),result);assert.equal(calls,2);
 const stalled=modules.moduleLoader(()=>new Promise(()=>{}));
 const pending=assert.rejects(stalled(),/arquivos deste módulo/);
 for(const callback of [...timers.values()])callback();await pending;assert.equal(timers.size,0);
});

test('a failed lazy module stays inside its boundary, leaves navigation and other drafts mounted, and provides reload',async()=>{
 let reloads=0;
 const boundary={};vm.runInNewContext(compile(await readFile(new URL('../../src/components/ModuleBoundary.tsx',import.meta.url),'utf8')),{exports:boundary,window:{location:{reload(){reloads++;}}},require:name=>name==='react'?React:jsx});
 function Failed(){throw Error('Failed to fetch dynamically imported module');}
 function Draft(){const [value,setValue]=React.useState('draft');return React.createElement('input',{value,onChange:event=>setValue(event.target.value)});}
 let view;
 const previous=console.error;console.error=()=>{};
 try {
  await act(async()=>{view=TestRenderer.create(React.createElement('main',{},React.createElement('nav',{},'Menu'),React.createElement(Draft),React.createElement(boundary.ModuleBoundary,{},React.createElement(Failed))));});
  assert.equal(view.root.findByType('nav').children[0],'Menu');assert.equal(view.root.findByType('input').props.value,'draft');
  assert.match(view.root.findByProps({role:'alert'}).findByType('h3').children.join(''),/Não foi possível/);
  await act(async()=>view.root.findByType('button').props.onClick());assert.equal(reloads,1);
 } finally {console.error=previous;if(view)await act(async()=>view.unmount());}
});
