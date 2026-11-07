import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require=createRequire(import.meta.url),React=require('react'),Renderer=require('react-test-renderer'),{act}=Renderer;
const source=await readFile(new URL('../../src/hooks/useAuth.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const future={code:'PGRST303',message:'JWT issued at future'};
async function harness({failures=2,error=future,target='employee'}={}){
 let state,listener,remaining=failures,gate=null,session={user:{id:'owner'},access_token:'opaque-token'},signouts=0,refreshes=0;
 const timers=[],reads=[],writes=[];
 const client={auth:{
  getSession:async()=>({data:{session},error:null}),
  onAuthStateChange(callback){listener=callback;return {data:{subscription:{unsubscribe(){}}}};},
  async signOut(){signouts++;session=null;return {error:null};},
  async refreshSession(){refreshes++;return {data:{session},error:null};},
  async getUser(){return {data:{user:{...session.user,user_metadata:{business_name:'Store',whatsapp:'5511999999999'}}},error:null};},
 },from(table){let user;return {
  select(){return this;},eq(_key,value){user=value;return this;},order(){return this;},limit(){return this;},
  async maybeSingle(){
   // Owner validation now returns the full profile. The separate profile path
   // remains necessary for employees loading their linked company's profile.
   const kind=table==='partner_salespeople'?'employee':target==='profile'?'profile':'owner';reads.push({kind,user});
   if(gate)await gate;
   if(kind===target&&remaining-->0)return {data:null,error};
   return {data:table==='partner_profiles'?{id:user,business_name:'Store'}:target==='profile'?{id:'staff',user_id:'owner',role:'caixa',active:true,branch_id:'branch'}:null,error:null};
  },async upsert(value){writes.push(value);return {error:null};},
 };}};
 const exports={};
 vm.runInNewContext(compiled,{exports,Error,window:{setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;}},require:name=>name==='../utils'?{}:name==='../lib/supabase'?{supabase:client,isSupabaseConfigured:true}:require(name)});
 function Probe(){state=exports.useAuth();return null;}
 let view;await act(async()=>{view=Renderer.create(React.createElement(Probe));});
 return {get state(){return state;},get signouts(){return signouts;},get refreshes(){return refreshes;},reads,writes,timers,
  recover(){remaining=0;},
  async tick(){assert.ok(timers.length,'Expected a scheduled retry');const {fn,delay}=timers.shift();await act(async()=>fn());return delay;},
  async retry(){await act(async()=>state.retrySession());},
  async logout(){await act(async()=>{session=null;listener('SIGNED_OUT',null);});},
  async switchUser(id){await act(async()=>{session={user:{id},access_token:'other-opaque-token'};listener('SIGNED_IN',session);});},
  pause(){let release;gate=new Promise(resolve=>{release=resolve;});return ()=>{gate=null;release();};},
  close:()=>act(async()=>view.unmount()),
 };
}

for(const target of ['employee','owner','profile'])test(`future JWT on ${target} read recovers with bounded waits and only then publishes identity`,async()=>{
 const h=await harness({target});
 try{
  assert.equal(h.state.identity,null);assert.equal(h.state.profile,null);assert.equal(h.state.error,null);
  assert.equal(await h.tick(),1000);assert.equal(h.state.identity,null);
  assert.equal(await h.tick(),2000);assert.equal(h.state.identity.companyUserId,'owner');assert.equal(h.state.profile.id,'owner');
  assert.equal(h.reads.filter(r=>r.kind===target).length,3);assert.equal(h.timers.length,0);assert.equal(h.signouts,0);assert.equal(h.refreshes,0);assert.equal(h.writes.length,0);
 }finally{await h.close();}
});

test('persistent future JWT stops after four reads, keeps session and permits explicit recovery',async()=>{
 const h=await harness({failures:99});
 try{
  for(const delay of [1000,2000,4000])assert.equal(await h.tick(),delay);
  assert.equal(h.reads.length,4);assert.equal(h.timers.length,0);assert.equal(h.state.identity,null);assert.equal(h.state.profile,null);assert.equal(h.state.user.id,'owner');
  assert.match(h.state.error,/diferença de horário/);assert.match(h.state.error,/Tentar novamente/);assert.doesNotMatch(h.state.error,/JWT issued|opaque-token/);
  h.recover();await h.retry();assert.equal(h.state.identity.companyUserId,'owner');assert.equal(h.state.error,null);assert.equal(h.signouts,0);assert.equal(h.refreshes,0);
 }finally{await h.close();}
});

for(const error of [{code:'PGRST303',message:'JWT expired'},{code:'PGRST301',message:'Invalid signature'},{code:'42501',message:'permission denied'},{code:'42501',message:'JWT issued at future'}])test(`other auth/access failures are never retried or converted into owner access: ${error.message} / ${error.code}`,async()=>{
 const h=await harness({failures:99,error});
 try{assert.equal(h.reads.length,1);assert.equal(h.timers.length,0);assert.equal(h.state.identity,null);assert.match(h.state.error,new RegExp(error.message));}finally{await h.close();}
});

test('logout during the wait cancels old reads and cannot restore protected identity',async()=>{
 const h=await harness();
 try{await h.logout();await h.tick();assert.equal(h.reads.length,1);assert.equal(h.state.user,null);assert.equal(h.state.identity,null);assert.equal(h.state.error,null);}finally{await h.close();}
});

test('a new account invalidates the pending old-user retry before another read',async()=>{
 const h=await harness();
 try{
  h.recover();await h.switchUser('new');assert.equal(h.state.identity,null);
  assert.equal(await h.tick(),1000);assert.equal(h.reads.length,1);
  assert.equal(await h.tick(),0);assert.equal(h.state.identity.authUserId,'new');assert.ok(h.reads.slice(1).every(r=>r.user==='new'));
 }finally{await h.close();}
});

test('unmounting invalidates delayed recovery without extra requests',async()=>{
 const h=await harness();await h.close();await h.tick();assert.equal(h.reads.length,1);
});
