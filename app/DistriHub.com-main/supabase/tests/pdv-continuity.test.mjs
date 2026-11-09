import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
const helpers={};
vm.runInNewContext(ts.transpileModule(await fs.readFile(new URL('../../src/lib/pdv.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:helpers,Date,Error});
const {PdvCartBackupStore,PdvSaleAttemptStore}=helpers;
function storage(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),get length(){return values.size;},key:index=>[...values.keys()][index]??null};}
const items=[{product_id:'synthetic-product',name:'Produto fictício',quantity:2,unit_price:15}];
const sale={id:'same-request-id',branch_id:'branch-a',items,total:30,user_id:'company-a',customer_name:'Cliente fictício',draft_scope:'auth:company:branch',draft_backup_id:'backup-a'};

test('cart survives a new browser session, expires after 24h and remains scoped to user/company/branch',()=>{
 const local=storage();let now=1000;
 const scope='user-a:company-a:branch-a';
 const store=new PdvCartBackupStore(local,scope,()=>now);
 store.save('tab-a',items);store.save('tab-b',[{...items[0],quantity:3}]);
 const reopened=new PdvCartBackupStore(local,scope,()=>now);
 assert.equal(reopened.list().length,2);assert.equal(reopened.read('tab-a').items[0].quantity,2);
 for(const other of ['user-b:company-a:branch-a','user-a:company-b:branch-a','user-a:company-a:branch-b'])assert.equal(new PdvCartBackupStore(local,other,()=>now).list().length,0);
 reopened.save('tab-a',[]);assert.equal(reopened.read('tab-a'),null);assert.equal(reopened.list().length,1);
 now+=PdvCartBackupStore.lifetime+1;assert.equal(reopened.list().length,0);assert.equal(local.length,0);
});
test('cart persists an allowlist only; malformed or tampered backups cannot be recovered',()=>{
 const local=storage(),store=new PdvCartBackupStore(local,'synthetic-scope',()=>1000);
 store.save('tab',[{...items[0],pin:'not-a-real-pin',access_token:'not-a-real-token',customer_name:'private'}]);
 assert(![...local.values.values()][0].includes('not-a-real'));assert(![...local.values.values()][0].includes('private'));
 const key=local.key(0);local.setItem(key,'{broken');assert.equal(store.list().length,0);
 store.save('tab',[{...items[0],quantity:-3}]);assert.equal(store.read('tab'),null);
 store.save('tab',[{...items[0],unit_price:Infinity}]);assert.equal(store.read('tab'),null);
});
test('uncertain sale migrates from tab to durable storage without credentials and reuses its ID after closure',()=>{
 const local=storage(),legacy=storage();
 legacy.setItem('distrihub:pdv-attempt:auth:company',JSON.stringify({...sale,pin:'not-a-real-pin',access_token:'not-a-real-token'}));
 const migrated=new PdvSaleAttemptStore(local,'auth:company',legacy);
 assert.equal(migrated.read().id,sale.id);assert.equal(legacy.length,0);
 assert(!local.getItem('distrihub:pdv-attempt:auth:company').includes('not-a-real'));
 const nextSession=new PdvSaleAttemptStore(local,'auth:company',storage());
 assert.equal(nextSession.begin({...sale,id:'new-candidate'}).id,sale.id);
 assert.equal(nextSession.read().draft_backup_id,'backup-a');
 assert.throws(()=>nextSession.begin({...sale,total:50}),/pendente/);
 assert.equal(new PdvSaleAttemptStore(local,'other-user:company').read(),null);
 nextSession.complete(sale.id);assert.equal(local.length,0);
});
test('unknown conflicting attempts and unavailable durable storage fail closed',()=>{
 const local=storage(),legacy=storage(),key='distrihub:pdv-attempt:auth:company';
 local.setItem(key,JSON.stringify(sale));legacy.setItem(key,JSON.stringify({...sale,id:'other-id'}));
 assert.throws(()=>new PdvSaleAttemptStore(local,'auth:company',legacy).read(),/duas tentativas/);
 assert.equal(local.length,1);assert.equal(legacy.length,1);
 const blocked={...storage(),setItem(){throw Error('Storage unavailable');}};
 assert.throws(()=>new PdvSaleAttemptStore(blocked,'auth:company').begin(sale),/Storage unavailable/);
});
