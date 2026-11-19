import { realtimeTransport } from './fixtures/realtime_transport.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import React from 'react';
import {act,create} from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require=createRequire(import.meta.url);
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const operations={};vm.runInNewContext(compile(await readFile(new URL('../../src/lib/operationAttempts.ts',import.meta.url),'utf8')),{exports:operations,crypto:{randomUUID},Error});
const chatSource=compile(await readFile(new URL('../../src/components/partner/SupportChatModule.tsx',import.meta.url),'utf8'));
const inboxSource=compile(await readFile(new URL('../../src/components/AdminSupportInbox.tsx',import.meta.url),'utf8'));
const row=(n,user='owner')=>({id:'message-'+n,user_id:user,sender_role:'cliente',message:'Mensagem '+n,message_position:n,created_at:'2026-10-14T12:00:00Z'});
const button=(view,label)=>view.root.findAllByType('button').find(b=>b.children.some(c=>typeof c==='string'&&c.trim()===label));
const text=view=>JSON.stringify(view.toJSON());
async function chat({rows=[],send,read,values=new Map(),storageBlocked=false,extra={},visibility='visible'}={}){
 const acknowledgements=[],rpcCalls=[],reads=[],intervals=new Map();let timer=0;let props={user:{id:'owner'},...extra};let server=rows;
 const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const client={rpc:async(name,args)=>{if(name==='mark_support_messages_read'){acknowledgements.push(args);return {data:args.p_position,error:null};}rpcCalls.push({name,args});return send?send(args):{data:{...row(server.length+1,args.p_user_id),id:args.p_request_id,message:args.p_message,sender_role:args.p_admin?'suporte':'cliente'},error:null};},from(){
  const query={user:null,gt:null,lt:null,ascending:false,limit:50};const q={select(){return q;},eq(_,v){query.user=v;return q;},gt(_,v){query.gt=v;return q;},lt(_,v){query.lt=v;return q;},order(_,o){query.ascending=o.ascending;return q;},limit(v){query.limit=v;return q;},then(resolve){reads.push({...query});const result=read?read(query):{data:server.filter(r=>r.user_id===query.user&&(query.gt===null||r.message_position>query.gt)&&(query.lt===null||r.message_position<query.lt)).sort((a,b)=>query.ascending?a.message_position-b.message_position:b.message_position-a.message_position).slice(0,query.limit),error:null};return Promise.resolve(result).then(resolve);}};return q;
 },channel(){const q={on(){return q;},subscribe(){return q;}};return q;},removeChannel(){}};
 const listeners=new Map();const document={visibilityState:visibility,addEventListener:(n,f)=>listeners.set(f,n),removeEventListener:(n,f)=>listeners.delete(f)};const exports={};const window={setInterval:f=>{intervals.set(++timer,f);return timer;},clearInterval:id=>intervals.delete(id),addEventListener:(n,f)=>listeners.set(f,n),removeEventListener:(n,f)=>listeners.delete(f),dispatchEvent(){}};Object.defineProperty(window,'sessionStorage',{get(){if(storageBlocked)throw new Error('Blocked');return storage;}});
 vm.runInNewContext(chatSource,{exports,Error,window,document,Event:class {},require:n=>n==='../../lib/authenticatedRealtime'?realtimeTransport:n==='../../lib/supabase'?{supabase:client}:n==='../../lib/operationAttempts'?operations:n==='lucide-react'?new Proxy({},{get:()=>()=>null}):require(n)});
 let view;await act(async()=>{view=create(React.createElement(exports.SupportChatModule,props));});
 return {view,rpcCalls,reads,values,acknowledgements,async visibility(value){document.visibilityState=value;await act(async()=>{for(const f of listeners.keys())await f();});},setRows:r=>{server=r;},async type(value){await act(async()=>view.root.findByType('input').props.onChange({target:{value}}));},async submit(){await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));},async tick(){await act(async()=>{for(const f of intervals.values())f();});},async update(change){props={...props,...change};await act(async()=>view.update(React.createElement(exports.SupportChatModule,props)));},async close(){await act(async()=>view.unmount());}};
}
test('support locks synchronous submits and input, and confirms only one persistent attempt',async()=>{
 let release;const h=await chat({send:()=>new Promise(r=>{release=r;})});
 try{await h.type('Ajuda');const submit=h.view.root.findByType('form').props.onSubmit;let a,b;await act(async()=>{a=submit({preventDefault(){}});b=submit({preventDefault(){}});});
  assert.equal(h.rpcCalls.length,1);assert.equal(h.view.root.findByType('input').props.disabled,true);await h.type('Rascunho que deve estar bloqueado');assert.equal(h.view.root.findByType('input').props.value,'Ajuda');
  const args=h.rpcCalls[0].args;await act(async()=>{release({data:{...row(1),id:args.p_request_id,message:'Ajuda'},error:null});await a;await b;});assert.equal(h.view.root.findByType('input').props.value,'');assert.equal(h.values.size,0);
 }finally{await h.close();}
});
test('uncertain support send survives reload and retries the same UUID and payload without duplication',async()=>{
 const values=new Map(),saved=new Map(),calls=[];let lost=true;
 const send=async args=>{calls.push(args);if(!saved.has(args.p_request_id))saved.set(args.p_request_id,{...row(1),id:args.p_request_id,message:args.p_message});if(lost)return {data:null,error:{message:'Timeout'}};return {data:saved.get(args.p_request_id),error:null};};
 let h=await chat({values,send});await h.type('Preservar');await h.submit();assert.equal(h.values.size,1);assert.match(text(h.view),/Envio não confirmado/);await h.close();
 h=await chat({values,send});try{assert.equal(h.view.root.findByType('input').props.value,'Preservar');assert.equal(h.view.root.findByType('input').props.disabled,true);lost=false;await h.submit();assert.equal(saved.size,1);assert.deepEqual({...calls[0]},{...calls[1]});assert.equal(values.size,0);}finally{await h.close();}
});
test('support refuses unavailable storage and unconfirmed responses without losing the draft or attempt',async()=>{
 let h=await chat({storageBlocked:true});try{assert.equal(h.view.root.findByType('input').props.disabled,true);await h.submit();assert.equal(h.rpcCalls.length,0);assert.match(text(h.view),/recuperar/);}finally{await h.close();}
 h=await chat({send:async()=>({data:row(1),error:null})});try{await h.type('Ajuda');await h.submit();assert.equal(h.values.size,1);assert.equal(h.view.root.findByType('input').props.value,'Ajuda');assert.match(text(h.view),/não confirmado/);}finally{await h.close();}
});
test('support recovers 121 messages across multiple pages and keeps older pagination independent',async()=>{
 const h=await chat({rows:[row(1)]});try{h.setRows(Array.from({length:122},(_,i)=>row(i+1)));await h.tick();assert.equal(h.view.root.findAllByProps({className:'support-message cliente'}).length,122);assert.ok(h.reads.some(r=>r.gt===51));assert.ok(h.reads.some(r=>r.gt===101));await h.tick();assert.equal(h.view.root.findAllByProps({className:'support-message cliente'}).length,122);}finally{await h.close();}
 const older=await chat({rows:Array.from({length:80},(_,i)=>row(i+1))});try{assert.equal(older.view.root.findAllByProps({className:'support-message cliente'}).length,50);await act(async()=>button(older.view,'Carregar mensagens anteriores').props.onClick());assert.equal(older.view.root.findAllByProps({className:'support-message cliente'}).length,80);assert.equal(button(older.view,'Carregar mensagens anteriores'),undefined);}finally{await older.close();}
});
test('support send response cannot advance the read cursor past missing messages',async()=>{
 const h=await chat({rows:[row(1)],send:async args=>({data:{...row(102),id:args.p_request_id,message:args.p_message},error:null})});
 try{h.setRows(Array.from({length:101},(_,i)=>row(i+1)));await h.type('Nova');await h.submit();assert.equal(h.view.root.findAllByProps({className:'support-message cliente'}).length,102);}finally{await h.close();}
});
test('support ignores late old-account sends and stops reads in hidden tabs',async()=>{
 let release;const h=await chat({rows:[row(1),row(2,'other')],send:()=>new Promise(r=>{release=r;})});
 try{await h.type('Conta A');let pending;await act(async()=>{pending=h.view.root.findByType('form').props.onSubmit({preventDefault(){}});});const sent=h.rpcCalls[0].args;
  await h.update({user:{id:'other'}});await h.type('Conta B');await act(async()=>{release({data:{...row(3),id:sent.p_request_id,message:'Conta A'},error:null});await pending;});assert.equal(h.view.root.findByType('input').props.value,'Conta B');assert.doesNotMatch(text(h.view),/Mensagem 3/);
  await h.update({isActive:false});const count=h.reads.length;await h.tick();assert.equal(h.reads.length,count);h.setRows([row(2,'other'),row(4,'other')]);await h.update({isActive:true});assert.match(text(h.view),/Mensagem 4/);
 }finally{await h.close();}
});
const conversation=(n,user='owner',overrides={})=>({...row(n,user),priority:'normal',closed_at:null,closed_message_position:null,closed:false,company_name:user,...overrides});
async function inbox({mutate,detail}={}){
 let entries=[conversation(1),conversation(2,'other')];const calls=[],intervals=[];const user={id:'admin'};
 const client={auth:{getUser:async()=>({data:{user},error:null})},rpc:async(name,args)=>{
  calls.push({name,args});if(name==='get_admin_support_inbox')return {data:{conversations:entries,total:entries.length,pending:entries.length},error:null};
  if(name==='get_admin_support_conversation')return detail?detail(args):{data:entries.find(r=>r.user_id===args.p_user_id),error:null};
  return mutate?mutate(args):{data:{user_id:args.p_user_id,priority:'high',closed_at:null,closed_message_position:null},error:null};
 },channel(){const q={on(){return q;},subscribe(){return q;}};return q;},removeChannel(){}};
 const exports={};vm.runInNewContext(inboxSource,{exports,require:n=>n==='../lib/authenticatedRealtime'?realtimeTransport:n==='./SupportUnreadBadge'?{SupportUnreadBadge:()=>null}:n==='../lib/supabase'?{supabase:client}:n==='./partner/SupportChatModule'?{SupportChatModule:p=>React.createElement('support-chat',p)}:n==='../lib/saasAdminControls'?{saasAdminError:e=>e.message}:require(n),window:{setInterval:f=>{intervals.push(f);return intervals.length;},clearInterval(){}}});
 let view;await act(async()=>{view=create(React.createElement(exports.AdminSupportInbox,{companies:[]}));});
 return {view,calls,setEntries:r=>{entries=r;},async select(index){await act(async()=>view.root.findAllByType('button').filter(b=>String(b.props.className??'').startsWith('admin-support-conversation'))[index].props.onClick());},async tick(){await act(async()=>intervals.forEach(f=>f()));},async close(){await act(async()=>view.unmount());}};
}
test('admin support cannot switch the selected customer with an old mutation response',async()=>{
 let release;const h=await inbox({mutate:()=>new Promise(r=>{release=r;})});try{
  await h.select(0);await act(async()=>button(h.view,'Marcar prioridade alta').props.onClick());await h.select(1);
  await act(async()=>release({data:{user_id:'owner',priority:'high',closed_at:null,closed_message_position:null},error:null}));
  assert.equal(h.view.root.findByType('support-chat').props.conversationUserId,'other');assert.equal(h.view.root.findByType('h4').children[0],'other');
 }finally{await h.close();}
});
test('admin support refreshes selected status and sends only the requested action with its snapshot',async()=>{
 const h=await inbox();try{await h.select(0);h.setEntries([conversation(3,'owner',{priority:'high',closed:true,closed_at:'2026-10-14T13:00:00Z',closed_message_position:3})]);await h.tick();
  assert.ok(button(h.view,'Reabrir atendimento'));await act(async()=>button(h.view,'Remover prioridade alta').props.onClick());
  const mutation=h.calls.find(c=>c.name==='update_admin_support_state');assert.deepEqual({...mutation.args},{p_user_id:'owner',p_action:'priority_normal',p_expected_position:3});assert.equal('closed_at' in mutation.args,false);
 }finally{await h.close();}
});
test('admin support ignores a late detail read after selecting another customer',async()=>{
 let release;const h=await inbox({detail:args=>args.p_user_id==='owner'?new Promise(r=>{release=r;}):{data:conversation(2,'other'),error:null}});
 try{await h.select(0);await h.select(1);await act(async()=>release({data:conversation(1),error:null}));assert.equal(h.view.root.findByType('support-chat').props.conversationUserId,'other');}finally{await h.close();}
});

test('support acknowledges only rendered incoming messages while the conversation and document are visible',async()=>{
 const incoming={...row(2),sender_role:'suporte'};
 const h=await chat({rows:[row(1),incoming],visibility:'hidden'});
 try{assert.equal(h.acknowledgements.length,0);await h.visibility('visible');assert.equal(h.acknowledgements.at(-1).p_position,2);
 await h.update({isActive:false});h.setRows([row(1),incoming,{...row(3),sender_role:'suporte'}]);await h.tick();assert.equal(h.acknowledgements.at(-1).p_position,2);
 await h.update({isActive:true});assert.equal(h.acknowledgements.at(-1).p_position,3);
 await h.visibility('hidden');const count=h.acknowledgements.length;h.setRows([incoming,{...row(4),sender_role:'suporte'}]);await h.tick();assert.equal(h.acknowledgements.length,count);
 }finally{await h.close();}
});
