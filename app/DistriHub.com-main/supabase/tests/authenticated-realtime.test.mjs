import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
const source=ts.transpileModule(await readFile(new URL('../../src/lib/authenticatedRealtime.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const settle=()=>new Promise(setImmediate);
function harness({session={access_token:'synthetic-A',user:{id:'owner'}},read,forward}={}){
 const api={},channels=[],tokens=[],removed=[],timers=new Map(),listeners=new Map(),messages=[],statuses=[];let authChanged,unsubscribed=0,id=0;
 const client={auth:{getSession:read??(async()=>({data:{session},error:null})),onAuthStateChange:fn=>{authChanged=fn;return {data:{subscription:{unsubscribe(){unsubscribed++;}}}};}},realtime:{setAuth:async token=>{tokens.push(token);if(forward)await forward();}},removeChannel:async c=>{removed.push(c);}};
 vm.runInNewContext(source,{exports:api,setTimeout:(fn,ms)=>{const key=++id;timers.set(key,{fn,ms});return key;},clearTimeout:key=>timers.delete(key),console:{warn:msg=>messages.push(msg)},window:{addEventListener:(name,fn)=>listeners.set('w:'+name,fn),removeEventListener:name=>listeners.delete('w:'+name)},document:{visibilityState:'visible',addEventListener:(name,fn)=>listeners.set('d:'+name,fn),removeEventListener:name=>listeners.delete('d:'+name)}});
 const stop=api.authenticatedRealtime(client,()=>{const c={subscribe(fn){c.status=fn;return c;}};channels.push(c);return c;},{label:'test-channel',expectedUserId:'owner',onStatus:s=>statuses.push(s)});
 return {channels,tokens,removed,timers,listeners,messages,statuses,stop,get unsubscribed(){return unsubscribed;},auth:(event,value)=>authChanged(event,value),async next(){const entry=timers.entries().next().value;if(entry){timers.delete(entry[0]);entry[1].fn();}await settle();}};
}
test('private channel waits for session recovery and JWT forwarding before subscribing',async()=>{
 let resolveSession,resolveForward;const h=harness({read:()=>new Promise(r=>{resolveSession=r;}),forward:()=>new Promise(r=>{resolveForward=r;})});
 await settle();assert.equal(h.channels.length,0);resolveSession({data:{session:{access_token:'synthetic-A',user:{id:'owner'}}},error:null});await settle();
 assert.equal(h.channels.length,0);assert.deepEqual(h.tokens,['synthetic-A']);resolveForward();await settle();assert.equal(h.channels.length,1);h.stop();await settle();assert.equal(h.removed.length,1);
});
test('anonymous, mismatched and disposed sessions never create private subscriptions',async()=>{
 for(const session of [null,{access_token:'test',user:{id:'other'}}]){const h=harness({session});await settle();assert.equal(h.channels.length,0);assert.equal(h.tokens.length,0);h.stop();}
 let finish;const h=harness({read:()=>new Promise(resolve=>{finish=resolve;})});await settle();h.stop();finish({data:{session:{access_token:'test',user:{id:'owner'}}},error:null});await settle();assert.equal(h.channels.length,0);assert.equal(h.unsubscribed,1);assert.equal(h.listeners.size,0);
});
test('join failures use one bounded retry, replace the channel and keep credentials out of diagnostics',async()=>{
 const h=harness();await settle();h.channels[0].status('CHANNEL_ERROR');h.channels[0].status('TIMED_OUT');
 assert.equal(h.timers.size,1);assert.ok([...h.timers.values()][0].ms>=1000);assert.ok([...h.timers.values()][0].ms<=30000);
 assert.doesNotMatch(h.messages.join(''),/synthetic-A/);await h.next();assert.equal(h.channels.length,2);assert.equal(h.removed.length,1);
 h.channels[1].status('SUBSCRIBED');h.stop();await settle();assert.equal(h.timers.size,0);assert.equal(h.removed.length,2);
});
test('token renewal is deferred outside the auth callback and logout cancels retries and old callbacks',async()=>{
 const h=harness();await settle();h.channels[0].status('CHANNEL_ERROR');h.auth('TOKEN_REFRESHED',{user:{id:'owner'},access_token:'renewed'});
 assert.equal(h.channels.length,1);assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].ms,0);await h.next();assert.equal(h.channels.length,2);
 h.auth('SIGNED_OUT',null);await settle();const count=h.statuses.length;h.channels[1].status('CHANNEL_ERROR');assert.equal(h.statuses.length,count);assert.equal(h.timers.size,0);h.stop();
});
