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

test('directory visibility changes immediately with branch and never treats legacy unassigned rows as shared',()=>{
 const module={exports:{}};vm.runInNewContext(compile(syncSource),{exports:module.exports,Date});
 const rows=[{id:'wholesale',branch_id:'atacado'},{id:'retail',branch_id:'varejo'},{id:'legacy',branch_id:null}];
 assert.equal(module.exports.branchDirectoryRows(rows,'varejo').map(row=>row.id).join(','),'retail');
 assert.equal(module.exports.branchDirectoryRows(rows,'atacado').map(row=>row.id).join(','),'wholesale');
 assert.equal(module.exports.branchDirectoryRows(rows,null).length,3);
});

test('supplier mutations persist the selected branch and reject a supplier from another unit before sending',async()=>{
 const calls=[];const existing={id:'atacado-supplier',user_id:'owner',branch_id:'atacado',name:'Atacado'};
 const h=await harness({branchId:'varejo',resourceScope:'cadastros:fornecedores',readResult:(table,fallback)=>table==='partner_suppliers'?{data:[existing],error:null}:fallback,
  rpc:async(name,args)=>{calls.push({name,args});return {data:{id:'new-retail',user_id:'owner',branch_id:args.p_branch_id,name:args.p_name,payable_balance:0},error:null};}});
 await act(async()=>h.current.addSupplier({name:'Varejo'}));
 assert.equal(calls[0].name,'mutate_partner_branch_supplier');assert.equal(calls[0].args.p_branch_id,'varejo');
 assert.equal(h.current.suppliers.find(row=>row.id==='new-retail').branch_id,'varejo');
 await assert.rejects(h.current.updateSupplier(existing.id,{name:'Incorreto'}),/outra filial/);
 await assert.rejects(h.current.deleteSupplier(existing.id),/outra filial/);assert.equal(calls.length,1);
});

test('supplier creation refuses consolidated scope and never invents a supplier when confirmation is malformed',async()=>{
 let calls=0;const h=await harness({resourceScope:'cadastros:fornecedores',rpc:async()=>{calls++;return {data:'only-id',error:null};}});
 await assert.rejects(h.current.addSupplier({name:'Sem filial'}),/Selecione uma filial/);assert.equal(calls,0);
 await assert.rejects(h.current.addSupplier({name:'Teste',branch_id:'varejo'}),/nao confirmado/);assert.equal(calls,1);assert.equal(h.current.suppliers.length,0);
});
test('deleting a collaborator revokes access through the existing mutation and keeps the record',async()=>{
 const employee={id:'employee',user_id:'owner',name:'Funcionário',role:'vendedor',commission_rate:0,phone:null,email:'funcionario@example.test',active:true,branch_id:null,blocked_modules:['pdv']};
 const calls=[];let fail=true;
 const h=await harness({readResult:(table,fallback)=>table==='partner_salespeople'?{data:[employee],error:null}:fallback,
  rpc:async(name,args)=>{calls.push({name,args});return fail?{data:null,error:{message:'Falha ao salvar'}}:{data:{...employee,active:false},error:null};}});
 await act(async()=>{await assert.rejects(h.current.deleteSalesperson(employee.id,'admin','1234'),error=>error.message==='Falha ao salvar');});
 assert.equal(h.current.salespeople[0].active,true);
 fail=false;
 await act(async()=>h.current.deleteSalesperson(employee.id,'admin','1234'));
 assert.equal(calls[1].name,'execute_partner_salesperson_mutation');
 assert.equal(calls[1].args.p_salesperson_id,employee.id);
 assert.equal(calls[1].args.p_is_active,false);
 assert.equal(calls[1].args.p_operator_id,'admin');
 assert.equal(h.current.salespeople.length,1);
 assert.equal(h.current.salespeople[0].active,false);
 assert.equal(h.current.salespeople[0].blocked_modules[0],'pdv');
});

test('collaborator access stays unchanged until an inactive record from the correct company is confirmed',async()=>{
 const employee={id:'employee-confirmation',user_id:'owner',name:'Funcionário',role:'vendedor',active:true,branch_id:null};
 let reply=null;
 const h=await harness({resourceScope:'configuracoes',readResult:(table,fallback)=>table==='partner_salespeople'?{data:[employee],error:null}:fallback,rpc:async()=>({data:reply,error:null})});
 for(const invalid of [null,employee.id,[],[{...employee,active:false},{...employee,active:false}],{...employee,active:true},{...employee,user_id:'other',active:false},{...employee,id:'another',active:false}]){
  reply=invalid;
  await act(async()=>assert.rejects(h.current.deleteSalesperson(employee.id),/não confirmou a desativação/));
  assert.equal(h.current.salespeople[0].active,true);
 }
 reply=[{...employee,active:false}];await act(async()=>h.current.deleteSalesperson(employee.id));
 assert.equal(h.current.salespeople[0].active,false);
});
test('delivery saves through checked API without requiring global sales cache and preserves error code',async()=>{
 const calls=[];let fail=false;
 const row={id:'delivery-sale',user_id:'owner',branch_id:'branch',delivery_revision:2,delivery_status:'em_rota'};
 const h=await harness({resourceScope:'entregas',rpc:async(name,args)=>{calls.push([name,args]);return fail?{error:{code:'40001',message:'Entrega atualizada'}}:{data:row,error:null};}});
 const op={requestId:randomUUID(),branchId:'branch',expectedRevision:1,patch:{status:'em_rota'}};
 await act(async()=>{assert.equal((await h.current.updateDelivery(row.id,op)).delivery_revision,2);});
 assert.equal(calls[0][0],'mutate_partner_delivery_checked');assert.equal(calls[0][1].p_request_id,op.requestId);assert.equal(calls[0][1].p_expected_revision,1);
 assert(!h.queries.includes('partner_sales'));assert(!h.queries.includes('partner_customers'));
 fail=true;await act(async()=>{await assert.rejects(h.current.updateDelivery(row.id,op),error=>error.code==='40001');});
});
test('RMA photo retry repeats the same storage path and checks the metadata confirmation',async()=>{
 const paths=[];let fail=true;
 const rma={id:'rma-photos',user_id:'owner',branch_id:'branch',attachments:[]};
 const h=await harness({resourceScope:'rma',readResult:(table,fallback)=>table==='rma_requests_v2'?{data:[rma],error:null}:fallback,
  storageClient:{from:bucket=>({upload:async(path)=>{assert.equal(bucket,'rma-attachments');paths.push(path);return {error:null};}})},
  rpc:async(name,args)=>{assert.equal(name,'add_partner_rma_attachment');return fail?{error:{message:'Vinculo indisponivel'}}:{data:{...rma,attachments:[{kind:args.p_kind,name:args.p_name,path:args.p_path}]},error:null};},
 });
 const files=[{id:'photo-id',kind:'defect',file:{name:'Peça.png',type:'image/png',size:100}}];
 await act(async()=>{await assert.rejects(h.current.addRmaPhotos(rma.id,files),error=>error.message==='Vinculo indisponivel');});
 fail=false;await act(async()=>h.current.addRmaPhotos(rma.id,files));
 assert.deepEqual(paths,['owner/rma-photos/photo-id-Pe_a.png','owner/rma-photos/photo-id-Pe_a.png']);
 assert.equal(h.current.rmas[0].attachments.length,1);
});
test('product photo updates preserve an omitted image and honor explicit removal',async()=>{
 const calls=[];
 const product={id:'photo-product',user_id:'owner',branch_id:'branch',name:'Produto',image_url:'https://storage.test/photo.png',cost_price:10,sale_price:20,wholesale_price:15,stock:2,min_stock:1};
 const h=await harness({readResult:(table,fallback)=>table==='partner_products'?{data:Array.isArray(fallback.data)?[product]:product,error:null}:fallback,rpc:async(name,args)=>{calls.push([name,args]);if(args.p_image_url!==undefined)product.image_url=args.p_image_url;return {data:{...product,barcode:args.p_barcode,sku:args.p_sku},error:null};}});
 await act(async()=>h.current.updateProduct(product.id,{name:'Produto atualizado'}));
 assert.equal(calls.findLast(call=>call[0]==='save_partner_product_profile')[1].p_image_url,product.image_url);
 await act(async()=>h.current.updateProduct(product.id,{image_url:null}));
 assert.equal(calls.findLast(call=>call[0]==='save_partner_product_profile')[1].p_image_url,null);
 assert.equal(h.current.products.find(item=>item.id===product.id).image_url,null);
});
test('product creation and editing only publish data after server confirmation',async()=>{
 const product={user_id:'owner',branch_id:'branch',name:'Produto novo',sku:null,barcode:null,cost_price:1,sale_price:2,wholesale_price:0,stock:3,min_stock:0};
 let reply=null;
 const h=await harness({resourceScope:'cadastros:produtos',rpc:async()=>({data:reply,error:null})});
 await act(async()=>assert.rejects(h.current.addProduct(product),/servidor não confirmou/));
 assert.equal(h.current.products.length,0);
 reply={...product,id:'created-product',name:'Nome confirmado no banco',ncm:'12345678'};
 await act(async()=>h.current.addProduct(product));
 assert.equal(h.current.products[0].id,'created-product');
 assert.equal(h.current.products[0].name,'Nome confirmado no banco');
 assert.equal(h.current.products[0].ncm,'12345678');
 const before=h.current.products[0];
 reply='wrong-product';
 await act(async()=>assert.rejects(h.current.updateProduct('created-product',{name:'Alterado'}),/não confirmou o produto/));
 assert.equal(h.current.products[0],before);
});
test('product duplicate check queries only the authenticated company and selected branch',async()=>{
 const products=[
  {id:'same',user_id:'owner',branch_id:'branch-a',name:'Produto  Á 1'},
  {id:'other-branch',user_id:'owner',branch_id:'branch-b',name:'Produto A 1'},
  {id:'other-company',user_id:'other',branch_id:'branch-a',name:'Produto A 1'},
 ];
 const h=await harness({initialProducts:products,resourceScope:'cadastros:produtos'});
 const matches=await h.current.findProductDuplicates('produto a 1','branch-a');
 assert.deepEqual([...matches].map(product=>product.id),['same']);
 const query=h.queryFilters.find(item=>item.table==='partner_products'&&item.filters.some(([column])=>column==='branch_id'));
 assert.deepEqual(query.filters.filter(([column])=>column==='user_id'||column==='branch_id'),[['user_id','owner'],['branch_id','branch-a']]);
});
test('product directory loads every page after login',async()=>{
 const products=Array.from({length:501},(_,index)=>({id:`product-${index}`,user_id:'owner',branch_id:'branch',name:`Product ${index}`}));
 const h=await harness({initialProducts:products,resourceScope:'cadastros:produtos'});
 assert.equal(h.current.products.length,501);
});
test('changing branch refreshes product data and a failed read preserves known products with an error',async()=>{
 const product={id:'product-a',user_id:'owner',branch_id:'branch-a',name:'Produto',stock:1};
 let products=[product],fail=false,productReads=0;
 const h=await harness({initialProducts:[product],branchId:'branch-a',resourceScope:'cadastros:produtos',readResult:(table,fallback)=>{
  if(table==='partner_products'&&Array.isArray(fallback.data)){
   productReads++;
   return fail?{data:null,error:{message:'Falha de leitura dos produtos'}}:{data:products,error:null};
  }
  return fallback;
 }});
 const initialReads=productReads;
 products=[{...product,branch_id:'branch-b',stock:4}];
 await h.setBranchId('branch-b');
 await act(async()=>new Promise(resolve=>setImmediate(resolve)));
 assert.ok(productReads>initialReads);
 assert.equal(h.current.products[0].stock,4);
 fail=true;
 await act(async()=>{assert.equal(await h.current.loadData(true,['products']),false);});
 assert.equal(h.current.products[0].stock,4);
 assert.match(h.current.syncError,/Falha de leitura dos produtos/);
});
test('product reconnect refreshes the directory and owner receives changes from other branches',async()=>{
 const first={id:'product',user_id:'owner',branch_id:'branch-a',name:'Produto',stock:1};
 let serverProducts=[first];
 const h=await harness({initialProducts:[first],branchId:'branch-a',resourceScope:'cadastros:produtos',readResult:(table,fallback,_mutation,query)=>{
  if(table==='partner_products'&&Array.isArray(fallback.data))return {data:serverProducts.slice(query.first,query.last+1),error:null};
  return fallback;
 }});
 await act(async()=>h.status('SUBSCRIBED'));
 const otherBranch={...first,branch_id:'branch-b',name:'Produto atualizado',stock:5};
 act(()=>h.emit('partner_products','UPDATE',otherBranch));
 assert.equal(h.current.products[0].name,'Produto atualizado');
 serverProducts=[otherBranch];
 await act(async()=>{
  h.status('CHANNEL_ERROR');
  h.status('SUBSCRIBED');
  h.flushTimers();
  await new Promise(resolve=>setImmediate(resolve));
 });
 assert.equal(h.current.products[0].stock,5);
});
test('older product reads cannot overwrite a newer Realtime product update',async()=>{
 const oldProduct={id:'product',user_id:'owner',branch_id:'branch-a',name:'Nome antigo',stock:1};
 let delay=false,release,reached;
 const waiting=new Promise(resolve=>{reached=resolve;});
 const h=await harness({initialProducts:[oldProduct],branchId:'branch-a',resourceScope:'cadastros:produtos',readResult:(table,fallback)=>{
  if(delay&&table==='partner_products'&&Array.isArray(fallback.data))return new Promise(resolve=>{release=()=>resolve(fallback);reached();});
  return fallback;
 }});
 await act(async()=>{
  h.status('SUBSCRIBED');
  delay=true;
  const refresh=h.current.loadData(true,['products']);
  await waiting;
  h.emit('partner_products','UPDATE',{...oldProduct,name:'Nome confirmado',stock:4});
  release();
  await refresh;
 });
 assert.equal(h.current.products[0].name,'Nome confirmado');
 assert.equal(h.current.products[0].stock,4);
});
test('product barcode is sent independently and partial updates preserve it until explicit clearing',async()=>{
 const calls=[];const product={id:'codes-product',user_id:'owner',branch_id:'branch',name:'Produto',sku:'INTERNO-42',barcode:'0012345678905',cost_price:10,sale_price:20,wholesale_price:15,stock:2,min_stock:1};
 const h=await harness({readResult:(table,fallback)=>table==='partner_products'?{data:[product],error:null}:fallback,rpc:async(name,args)=>{calls.push(args);return {data:{...product,barcode:args.p_barcode,sku:args.p_sku},error:null};}});
 await act(async()=>h.current.updateProduct(product.id,{name:'Outro nome'}));
 assert.equal(calls.at(-1).p_sku,'INTERNO-42');assert.equal(calls.at(-1).p_barcode,'0012345678905');
 await act(async()=>h.current.updateProduct(product.id,{barcode:'0098765432109'}));
 assert.equal(calls.at(-1).p_sku,'INTERNO-42');assert.equal(calls.at(-1).p_barcode,'0098765432109');
 assert.equal(h.current.products[0].barcode,'0098765432109');
 await act(async()=>h.current.updateProduct(product.id,{barcode:null}));
 assert.equal(calls.at(-1).p_barcode,null);assert.equal(h.current.products[0].barcode,null);
 await act(async()=>h.current.addProduct({...product,id:undefined,barcode:'0012345678905'}));
 assert.equal(calls.at(-1).p_sku,'INTERNO-42');assert.equal(calls.at(-1).p_barcode,'0012345678905');
});
test('photo saving uses the server row and refuses mismatched URLs and malformed confirmations',async()=>{
 const product={id:'photo-check',user_id:'owner',branch_id:'branch',name:'Produto',image_url:'https://storage.test/old.jpg',stock:2,min_stock:1,cost_price:10,sale_price:20};
 let reply={...product};
 const h=await harness({initialProducts:[product],rpc:async()=>({data:reply,error:null})});
 await act(async()=>assert.rejects(h.current.updateProduct(product.id,{image_url:'https://storage.test/new.jpg'}),/confirmar a foto/));
 assert.equal(h.current.products[0].image_url,product.image_url);
 reply={...product,id:'another-product'};
 await act(async()=>assert.rejects(h.current.updateProduct(product.id,{image_url:'https://storage.test/new.jpg'}),/não confirmou o produto/));
 reply={...product,image_url:'https://storage.test/new.jpg'};
 await act(async()=>h.current.updateProduct(product.id,{image_url:reply.image_url}));
 assert.equal(h.current.products[0].image_url,reply.image_url);
});

test('product fiscal edits send an explicit patch and only show the persisted tax fields',async()=>{
 const product={id:'tax-product',user_id:'owner',branch_id:'branch',name:'Produto',ncm:'12345678',icms_rate:18};
 const calls=[];
 const h=await harness({initialProducts:[product],rpc:async(name,args)=>{calls.push({name,args});return {data:{...product,ncm:null,icms_rate:0},error:null};}});
 await act(async()=>h.current.updateProduct(product.id,{ncm:null,icms_rate:0}));
 assert.equal(calls[0].name,'save_partner_product_profile');
 assert.equal(JSON.stringify(calls[0].args.p_fiscal),JSON.stringify({ncm:null,icms_rate:0}));
 assert.equal(h.current.products[0].ncm,null);assert.equal(h.current.products[0].icms_rate,0);
 await act(async()=>h.current.updateProduct(product.id,{barcode:'00123'}));
 assert.equal(JSON.stringify(calls[1].args.p_fiscal),'{}');
});

test('service warranty updates existing settings directly and only publishes a confirmed saved term',async()=>{
 const text='Garantia do serviço\nCondições de atendimento';const writes=[];let fail=false,mismatch=false;
 const h=await harness({readResult:(table,fallback,mutation)=>{
  if(table!=='store_settings_v2'||!mutation)return fallback;
  writes.push(mutation);return fail?{error:{message:'Falha de conexão'}}:{data:{id:'settings',user_id:'owner',service_warranty_terms:mismatch?'antigo':text,logo_url:'logo-salva'},error:null};
 }});
 await act(async()=>h.current.updateStoreSettings({service_warranty_terms:text}));
 assert.equal(writes[0].type,'update');assert.deepEqual(Object.keys(writes[0].value),['service_warranty_terms']);assert.equal(h.current.settings.service_warranty_terms,text);
 fail=true;await act(async()=>assert.rejects(h.current.updateStoreSettings({service_warranty_terms:'Novo texto'}),error=>error.message==='Falha de conexão'));
 assert.equal(h.current.settings.service_warranty_terms,text);
 fail=false;mismatch=true;await act(async()=>assert.rejects(h.current.updateStoreSettings({service_warranty_terms:'Novo texto'}),/confirmar o termo/));
 assert.equal(h.current.settings.service_warranty_terms,text);
});
test('first settings save falls back to an owner-scoped insert and confirms the returned row',async()=>{
 const writes=[];
 const h=await harness({readResult:(table,fallback,mutation)=>{
  if(table!=='store_settings_v2'||!mutation)return fallback;
  writes.push(mutation);return mutation.type==='update'?{data:null,error:null}:{data:{id:'settings',...mutation.value},error:null};
 }});
 await act(async()=>h.current.updateStoreSettings({service_warranty_terms:'Primeiro termo'}));
 assert.deepEqual(writes.map(value=>value.type),['update','upsert']);assert.equal(writes[1].value.user_id,'owner');assert.equal(h.current.settings.service_warranty_terms,'Primeiro termo');
});
afterEach(async()=>{if(renderer) await act(async()=>renderer.unmount());renderer=null;});
async function harness({initialSales=[],initialInvoices=[],initialCustomers=[],initialProducts=[],rpc,values=new Map(),readResult,branchId=null,resourceScope=null,identity: suppliedIdentity,storageClient}={}) {
  const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const identity=suppliedIdentity??{authUserId:'owner',companyUserId:'owner',salespersonId:null,branchId:null,role:'administrador'};
  const initial={partner_sales:initialSales,partner_invoices:initialInvoices,partner_customers:initialCustomers,partner_products:initialProducts};
  const queries=[];
  const queryFilters=[];
  let activeScope=resourceScope;
  let activeBranchId=branchId;
  const channels=[];
  const intervals=[];
  const timeouts=new Map();
  let timerId=0;
  const client={rpc,storage:storageClient,auth:{getSession:async()=>({data:{session:{user:{id:identity.authUserId}}},error:null})},from(table){
    queries.push(table); let first=0,last=499; let mutation; const filters=[];queryFilters.push({table,filters});
    const q={select(){return q;},eq(column,value){filters.push([column,value]);return q;},gte(){return q;},order(){return q;},limit(){return q;},range(from,to){first=from;last=to;return q;},
      update(value){mutation={type:'update',value};return q;},upsert(value){mutation={type:'upsert',value};return q;},
      maybeSingle(){return Promise.resolve(readResult?.(table,{data:null,error:null},mutation,{filters,first,last})??{data:null,error:null});},
      single(){return Promise.resolve(readResult?.(table,{data:null,error:null},mutation,{filters,first,last})??{data:null,error:null});},
      then(resolve,reject){const fallback={data:[...(initial[table]??[])].slice(first,last+1),error:null};return Promise.resolve(readResult?.(table,fallback,mutation,{filters,first,last})??fallback).then(resolve,reject);}};
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
  function Probe(){current=hookModule.exports.usePartnerData(identity,activeBranchId,activeScope);return null;}
  await act(async()=>{renderer=TestRenderer.create(React.createElement(Probe));});
  return {get current(){return current;},values,queries,queryFilters,
    async setScope(scope){activeScope=scope;await act(async()=>renderer.update(React.createElement(Probe)));},
    async setBranchId(id){activeBranchId=id;await act(async()=>renderer.update(React.createElement(Probe)));},
    emit(table,eventType,record,old={}){for(const channel of channels.filter(channel=>!channel.removed))for(const {filter,handler} of channel.handlers)if(filter.table===table&&filter.event===eventType)handler({eventType,new:record,old});},
    status(status){channels.findLast(channel=>channel.name.startsWith('partner-sync-')&&!channel.removed)?.status?.(status);},
    tick(){for(const callback of intervals)callback();},
    flushTimers(){for(const [id,callback] of [...timeouts]){timeouts.delete(id);callback();}},
  };
}
const payload=()=>({customer_id:'customer',customer_name:'Cliente',items:[{product_id:'physical',name:'Produto',quantity:1,unit_price:100}],total:100,branch_id:'branch',salesperson_id:null,customer_type:'varejo',delivery_type:'balcao',payment_method:'pix'});
const snapshot=(overrides={})=>({credits:[{customer_id:'customer',allow_credit:true,credit_limit:1000,used:0,available:1000}],products:[],movements:[],sales:[],invoices:[],...overrides});

test('open-order action keeps authenticated operator and supervisor credentials separate and updates only after confirmation',async()=>{
 const pre={...payload(),id:'pre-open',user_id:'owner',status:'pre_venda',payment_status:'pendente'};
 let fail=true;const calls=[];
 const h=await harness({initialSales:[pre],rpc:async(name,args)=>{calls.push({name,args});return fail?{error:{message:'PIN incorreto'}}:{data:args.p_sale_id,error:null};}});
 await act(async()=>assert.rejects(h.current.mutateOpenOrder(pre.id,'cancel',null,null,'manager','9876'),/PIN incorreto/));
 assert.equal(h.current.sales[0].status,'pre_venda');
 fail=false;await act(async()=>h.current.mutateOpenOrder(pre.id,'cancel',null,null,'manager','9876'));
 assert.ok(calls.every(call=>call.name==='mutate_partner_open_order'&&call.args.p_salesperson_id===null&&call.args.p_pin===null&&call.args.p_supervisor_id==='manager'&&call.args.p_supervisor_pin==='9876'));
 assert.equal(h.current.sales[0].status,'cancelada');assert.equal(h.current.sales[0].payment_status,'cancelado');
});
test('open-order hook serializes delete and cancel and refuses an unconfirmed response',async()=>{
 const pre={...payload(),id:'pre-open',user_id:'owner',status:'pre_venda'};let release;
 const h=await harness({initialSales:[pre],rpc:()=>new Promise(resolve=>{release=resolve;})});
 let first;await act(async()=>{first=h.current.mutateOpenOrder(pre.id,'delete');await assert.rejects(h.current.mutateOpenOrder(pre.id,'cancel'),/Aguarde/);});
 await act(async()=>{release({data:'wrong-id',error:null});await assert.rejects(first,/não confirmado/);});assert.equal(h.current.sales.length,1);
});

test('supervised checkout persists its cash destination and recovers it with the same sale ID',async()=>{
 let fail=true;const calls=[];
 const h=await harness({rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='supervised_execute_partner_sale_mutation')return fail?{error:{code:'08006',message:'Conexão perdida'}}:{data:args.p_sale_id,error:null};
  return {data:snapshot(),error:null};
 }});
 await act(async()=>assert.rejects(h.current.createSale({...payload(),cash_session_id:'employee-cash'}),/mesmo ID/));
 assert.equal(h.current.pendingSale.cash_session_id,'employee-cash');
 await act(async()=>assert.rejects(h.current.createSale({...payload(),cash_session_id:'different-cash'}),/resultado pendente/));
 fail=false;await act(async()=>h.current.retryPendingSale());
 const mutations=calls.filter(c=>c.name==='supervised_execute_partner_sale_mutation');
 assert.equal(mutations.length,2);assert.equal(mutations[0].args.p_sale_id,mutations[1].args.p_sale_id);
 assert.ok(mutations.every(c=>c.args.p_cash_session_id==='employee-cash'&&c.args.p_salesperson_id===null&&c.args.p_pin===null));
 assert.equal(h.current.pendingSale,null);
});

test('manager finalizes a pre-sale into explicitly selected cash and preserves its commercial salesperson',async()=>{
 const pre={...payload(),id:'pre',user_id:'owner',status:'pre_venda',salesperson_id:'seller'};let mutation;
 const h=await harness({initialSales:[pre],rpc:async(name,args)=>{
  if(name==='supervised_execute_partner_sale_mutation'){mutation=args;return {data:'pre',error:null};}
  return {data:snapshot({sales:[{...pre,status:'concluida'}]}),error:null};
 }});
 await act(async()=>h.current.finalizePreSale('pre','pix',null,null,undefined,'employee-cash'));
 assert.equal(mutation.p_cash_session_id,'employee-cash');assert.equal(mutation.p_commercial_salesperson_id,'seller');
 assert.equal(mutation.p_salesperson_id,null);assert.equal(mutation.p_status,'concluida');
});

test('shared customer credit updates use the selected branch context without changing the shared customer',async()=>{
  let request;
  const h=await harness({branchId:'branch',initialCustomers:[{id:'customer',user_id:'owner',name:'Cliente',branch_id:null,credit_limit:0,allow_credit:false}],rpc:async(name,args)=>{request={name,...args};return {data:{id:'customer',user_id:'owner',branch_id:null,...args.p_fields},error:null};}});
  await act(async()=>{await h.current.updateCustomer('customer',{credit_limit:500,allow_credit:true});});
  assert.equal(request.p_branch_id,'branch');
  assert.equal(request.name,'update_partner_customer_profile');
  assert.equal(request.p_fields.credit_limit,500);
  assert.equal(request.p_fields.allow_credit,true);
  assert.equal(h.current.customers.find(c=>c.id==='customer').branch_id,null);
});

test('customer credit updates retain the customer branch when another branch is selected',async()=>{
  let request;
  const h=await harness({branchId:'selected-branch',initialCustomers:[{id:'customer',user_id:'owner',name:'Cliente',branch_id:'customer-branch',credit_limit:0,allow_credit:false}],rpc:async(name,args)=>{request=args;return {data:{id:'customer',user_id:'owner',branch_id:'customer-branch',...args.p_fields},error:null};}});
  await act(async()=>{await h.current.updateCustomer('customer',{credit_limit:200});});
  assert.equal(request.p_branch_id,'customer-branch');
});

test('customer profile sends extended fields and explicit nulls, uses the confirmed row, and retains photo path on retry',async()=>{
 const initial={id:'customer',user_id:'owner',name:'Cliente',branch_id:'branch',notes:'Antiga',photo_url:null};
 const paths=[];let request,fail=true;
 const h=await harness({initialCustomers:[initial],storageClient:{from:bucket=>({upload:async(path)=>{assert.equal(bucket,'customer-photos');paths.push(path);return {error:null};}})},rpc:async(name,args)=>{
  assert.equal(name,'update_partner_customer_profile');request=args;
  return fail?{error:{message:'Resposta perdida'}}:{data:{...initial,...args.p_fields,name:'Nome confirmado'},error:null};
 }});
 const file={name:'foto.png',type:'image/png',size:100};
 const fields={name:'Nome digitado',trade_name:'Fantasia',zip_code:'12345678',phone_commercial_1:'11999999999',notes:null,photo_file:file};
 await act(async()=>{await assert.rejects(h.current.updateCustomer(initial.id,fields),error=>error.message==='Resposta perdida');});
 assert.equal(h.current.customers[0].name,'Cliente');
 fail=false;await act(async()=>h.current.updateCustomer(initial.id,fields));
 assert.equal(paths.length,2);assert.equal(paths[0],paths[1]);
 assert.equal(request.p_fields.notes,null);assert.equal(request.p_fields.zip_code,'12345678');assert.equal(request.p_fields.photo_file,undefined);
 assert.equal(h.current.customers[0].name,'Nome confirmado');assert.equal(h.current.customers[0].trade_name,'Fantasia');
 await act(async()=>h.current.updateCustomer(initial.id,{remove_photo:true}));
 assert.equal(request.p_fields.photo_url,null);assert.equal(h.current.customers[0].photo_url,null);
});

test('customer upload failure does not call the profile mutation or show unconfirmed changes',async()=>{
 let calls=0;
 const h=await harness({initialCustomers:[{id:'customer',user_id:'owner',name:'Cliente',branch_id:'branch'}],storageClient:{from:()=>({upload:async()=>({error:{message:'Upload indisponível'}})})},rpc:async()=>{calls++;return {error:null};}});
 await act(async()=>{await assert.rejects(h.current.updateCustomer('customer',{trade_name:'Alterado',photo_file:{type:'image/png',size:100}}),error=>error.message==='Upload indisponível');});
 assert.equal(calls,0);assert.equal(h.current.customers[0].trade_name,undefined);
});

test('a delayed full refresh cannot reopen a sale after a newer PDV snapshot',async()=>{
  const pre={...payload(),id:'pre',user_id:'owner',status:'pre_venda'};
  let delayed=false,release,reached;
  const waiting=new Promise(resolve=>{reached=resolve;});
  const h=await harness({initialSales:[pre],readResult(table,fallback){
    if(delayed&&table==='partner_suppliers')return new Promise(resolve=>{release=()=>resolve(fallback);reached();});
  },rpc:async()=>({data:snapshot({sales:[{...pre,status:'concluida'}]}),error:null})});
  delayed=true;
  await act(async()=>{
    const refresh=h.current.synchronize();await waiting;
    await h.current.refreshPdv('branch');
    release();await refresh;
  });
  assert.equal(h.current.sales[0].status,'concluida');
});

test('a failed secondary query preserves its collection while still updating sales',async()=>{
  const pre={...payload(),id:'pre',user_id:'owner',status:'pre_venda'};
  const rows=[pre];let fail=false;
  const h=await harness({initialSales:rows,initialInvoices:[{id:'invoice',branch_id:'branch',amount:100}],readResult(table){
    if(fail&&table==='partner_invoices')return {data:null,error:{message:'Invoice read failed'}};
  }});
  rows[0]={...pre,status:'concluida'};fail=true;
  await act(async()=>h.current.synchronize());
  assert.equal(h.current.sales[0].status,'concluida');
  assert.equal(h.current.invoices[0].id,'invoice');
  assert.equal(h.current.error,null);
  assert.match(h.current.syncError,/preservados/);
});

test('a local checkout supersedes an older pending PDV read',async()=>{
  const pre={...payload(),id:'pre',user_id:'owner',status:'pre_venda'};
  let calls=0,release;
  const h=await harness({initialSales:[pre],rpc:async(name,args)=>{
    if(name==='execute_partner_sale_mutation')return {data:args.p_sale_id,error:null};
    if(++calls===1)return new Promise(resolve=>{release=()=>resolve({data:snapshot({sales:[pre]}),error:null});});
    return {data:snapshot({sales:[{...pre,status:'concluida'}]}),error:null};
  }});
  await act(async()=>{
    const old=h.current.refreshPdv('branch');
    await h.current.finalizePreSale('pre','pix');
    release();await old;
  });
  assert.equal(h.current.sales[0].status,'concluida');
});

test('Realtime updates one authorized row and healthy subscriptions avoid historical polling',async()=>{
  const pre={...payload(),id:'pre',user_id:'owner',status:'pre_venda'};let calls=0;
  const h=await harness({initialSales:[pre],branchId:'branch',rpc:async()=>{calls++;return {data:snapshot({sales:[pre]}),error:null};}});
  await act(async()=>{h.status('SUBSCRIBED');h.flushTimers();});
  assert.equal(calls,1);
  await act(async()=>{h.tick();h.flushTimers();});
  assert.equal(calls,1);
  act(()=>h.emit('partner_sales','UPDATE',{...pre,status:'concluida'}));
  assert.equal(h.current.sales[0].status,'concluida');
  act(()=>h.emit('partner_sales','UPDATE',pre));
  assert.equal(h.current.sales[0].status,'concluida');
  act(()=>h.emit('partner_sales','UPDATE',{...pre,user_id:'foreign',status:'cancelada'}));
  assert.equal(h.current.sales[0].status,'concluida');
  act(()=>h.emit('partner_sales','UPDATE',{...pre,branch_id:'other',status:'cancelada'}));
  assert.equal(h.current.sales[0].status,'concluida');
  await act(async()=>{h.status('CHANNEL_ERROR');h.tick();h.flushTimers();});
  assert.equal(calls,2);
});

test('Realtime supersedes a delayed full snapshot and deletes only known scoped rows',async()=>{
  const pre={...payload(),id:'pre',user_id:'owner',status:'pre_venda'};
  let delayed=false,release,reached;
  const waiting=new Promise(resolve=>{reached=resolve;});
  const h=await harness({initialSales:[pre],branchId:'branch',readResult(table,fallback){
    if(delayed&&table==='service_order_photos')return new Promise(resolve=>{release=()=>resolve(fallback);reached();});
  }});
  delayed=true;
  await act(async()=>{
    const refresh=h.current.synchronize();await waiting;
    h.emit('partner_sales','UPDATE',{...pre,status:'concluida'});
    release();await refresh;
  });
  assert.equal(h.current.sales[0].status,'concluida');
  act(()=>h.emit('partner_sales','DELETE',{}, {id:'unknown'}));
  assert.equal(h.current.sales.length,1);
  act(()=>h.emit('partner_sales','DELETE',{}, {id:'pre'}));
  assert.equal(h.current.sales.length,0);
});

test('employee sessions retain authorized branch reconciliation when RLS filters Realtime records',async()=>{
  let calls=0;
  const h=await harness({branchId:'branch',identity:{authUserId:'worker',companyUserId:'owner',salespersonId:'worker-id',branchId:'branch',role:'caixa'},rpc:async(name,args)=>{
    assert.equal(name,'get_partner_pdv_snapshot');assert.equal(args.p_branch_id,'branch');calls++;
    return {data:snapshot(),error:null};
  }});
  await act(async()=>{h.status('SUBSCRIBED');h.flushTimers();});
  assert.equal(calls,1);
  await act(async()=>{h.tick();h.flushTimers();});
  assert.equal(calls,2);
  await act(async()=>h.current.synchronize());
  assert.equal(calls,3);
});

test('background synchronization updates a sale completed on another device without loading the panel', async()=>{
  const sales=[{id:'sale',branch_id:'branch',status:'pre_venda',items:[],total:100}];
  const h=await harness({initialSales:sales});
  assert.equal(h.current.sales[0].status,'pre_venda');
  sales[0]={...sales[0],status:'concluida'};
  let syncing;
  await act(async()=>{
    syncing=h.current.synchronize();
    assert.equal(h.current.loading,false);
    await syncing;
  });
  assert.equal(h.current.sales[0].status,'concluida');
  assert.equal(h.current.syncing,false);
  assert.equal(h.current.syncError,null);
  assert.ok(h.current.lastSyncedAt);
});

test('rescued checkout saves all edited quote fields before finalizing the same sale and cash', async () => {
  const original = { ...payload(), id: 'rescued', user_id: 'owner', status: 'pre_venda', origin: 'pdv', payment_method: null, salesperson_id: 'seller', imei: 'trace' };
  const edits = { ...original, customer_id: 'new-customer', customer_name: 'Outro cliente',
    items: [{ ...original.items[0], quantity: 2 }], total: 200, freight_fee: 15, delivery_type: 'entrega' };
  const mutations = [];
  let persisted = original;
  const h = await harness({ initialSales: [original], rpc: async (name, args) => {
    if (name.includes('execute_partner_sale_mutation')) {
      mutations.push(args);
      persisted = { ...persisted, ...edits, status: args.p_status, payment_method: args.p_payment_method };
      return { data: original.id, error: null };
    }
    return { data: snapshot({ sales: [persisted] }), error: null };
  } });
  await act(async () => h.current.finalizePreSale(original.id, 'pix', 'manager', '1234', [], 'cash', edits));
  assert.equal(mutations.length, 2);
  assert.deepEqual(mutations.map(row => row.p_status), ['pre_venda', 'concluida']);
  for (const row of mutations) {
    assert.equal(row.p_sale_id, original.id);
    assert.equal(row.p_customer_id, 'new-customer');
    assert.equal(row.p_total, 200);
    assert.equal(row.p_freight_fee, 15);
    assert.equal(row.p_delivery_type, 'entrega');
    assert.equal(row.p_imei, 'trace');
    assert.equal(row.p_commercial_salesperson_id, 'seller');
  }
  assert.equal(mutations[1].p_cash_session_id, 'cash');
  assert.equal(h.current.sales.length, 1);
  assert.equal(h.current.sales[0].status, 'concluida');
});

test('rescued checkout never finalizes an unconfirmed edit and releases its submission lock', async () => {
  const original = { ...payload(), id: 'rescued-failure', user_id: 'owner', status: 'pre_venda', origin: 'pdv', payment_method: null };
  let attempts = 0;
  const h = await harness({ initialSales: [original], rpc: async (name, args) => {
    if (name === 'execute_partner_sale_mutation') {
      attempts++;
      assert.equal(args.p_status, 'pre_venda');
      return { data: null, error: null };
    }
    return { data: snapshot({ sales: [original] }), error: null };
  } });
  for (let i = 0; i < 2; i++) await act(async () => assert.rejects(h.current.finalizePreSale(original.id, 'pix', null, null, [], null, { ...original, customer_name: 'Editado' }), /não confirmou a edição/));
  assert.equal(attempts, 2);
  assert.equal(h.current.sales[0].status, 'pre_venda');
});

test('unchanged rescued quote finalizes without repricing its negotiated items', async () => {
  const original = { ...payload(), id: 'negotiated', user_id: 'owner', status: 'pre_venda', origin: 'pdv', payment_method: null, salesperson_id: null };
  const mutations = [];
  const h = await harness({ initialSales: [original], rpc: async (name, args) => {
    if (name === 'execute_partner_sale_mutation') { mutations.push(args); return { data: original.id, error: null }; }
    return { data: snapshot({ sales: [original] }), error: null };
  } });
  await act(async () => h.current.finalizePreSale(original.id, 'pix', null, null, [], null, original));
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].p_status, 'concluida');
});

test('rescued checkout blocks duplicate submissions and retains confirmed edits when payment fails', async () => {
  const original = { ...payload(), id: 'edited-pending', user_id: 'owner', status: 'pre_venda', origin: 'pdv', payment_method: null };
  const edits = { ...original, customer_name: 'Cliente editado', freight_fee: 7 };
  let release;
  const mutations = [];
  const h = await harness({ initialSales: [original], rpc: async (name, args) => {
    if (name === 'execute_partner_sale_mutation') {
      mutations.push(args);
      if (args.p_status === 'pre_venda') await new Promise(resolve => { release = resolve; });
      return args.p_status === 'pre_venda' ? { data: original.id, error: null } : { error: { message: 'Caixa fechado' } };
    }
    return { data: snapshot({ sales: [original] }), error: null };
  } });
  let pending;
  await act(async () => { pending = h.current.finalizePreSale(original.id, 'pix', null, null, [], null, edits).catch(error => error); });
  await assert.rejects(h.current.finalizePreSale(original.id, 'pix', null, null, [], null, edits), /Aguarde/);
  await act(async () => { release(); assert.match((await pending).message, /Caixa fechado/); });
  assert.equal(mutations.length, 2);
  assert.equal(h.current.sales[0].status, 'pre_venda');
  assert.equal(h.current.sales[0].customer_name, 'Cliente editado');
  assert.equal(h.current.sales[0].freight_fee, 7);
});

test('editing pre-sale retains its ID and metadata while replacing items and total',async()=>{
  const original={...payload(),id:'existing-order',user_id:'owner',status:'pre_venda',origin:'pdv',payment_method:null,imei:'trace',serial_number:null};
  const items=[{...original.items[0],quantity:3}];
  let mutation;
  const h=await harness({initialSales:[original],rpc:async(name,args)=>{
    if(name==='execute_partner_sale_mutation') {mutation=args; return {data:args.p_sale_id,error:null};}
    return {data:snapshot({sales:[{...original,items,total:300}]}),error:null};
  }});
  await act(async()=>{await h.current.updatePreSaleItems(original.id,items);});
  assert.equal(mutation.p_sale_id,original.id);
  assert.equal(mutation.p_total,300);
  assert.equal(mutation.p_status,'pre_venda');
  assert.equal(mutation.p_imei,'trace');
  assert.deepEqual(mutation.p_items,items);
  assert.equal(h.current.sales.length,1);
  assert.equal(h.current.sales[0].total,300);
  await act(async()=>{await assert.rejects(h.current.updatePreSaleItems(original.id,[]),/pelo menos um/);});
});

test('saved rescued corrections update the same pending quote atomically without a cash session or checkout',async()=>{
 const original={...payload(),id:'saved-rescued',user_id:'owner',status:'pre_venda',origin:'pdv',payment_status:'pendente',payment_method:'pix',imei:'trace',serial_number:null};
 const edits={...original,customer_name:'Cliente corrigido',items:[{...original.items[0],quantity:3}],total:999,freight_fee:25,delivery_type:'entrega',payment_method:'misto'};
 let mutation;const h=await harness({initialSales:[original],rpc:async(name,args)=>{
  if(name==='execute_partner_sale_mutation'){mutation=args;return {data:original.id,error:null};}
  return {data:snapshot({sales:[{...original,...edits,total:300,payment_method:'pix'}]}),error:null};
 }});
 await act(async()=>h.current.updatePreSale(original.id,edits));
 assert.equal(mutation.p_sale_id,original.id);assert.equal(mutation.p_status,'pre_venda');assert.equal(mutation.p_total,300);
 assert.equal(mutation.p_freight_fee,25);assert.equal(mutation.p_customer_name,'Cliente corrigido');assert.equal(mutation.p_imei,'trace');
 assert.equal(mutation.p_payment_method,'pix');assert.equal('p_cash_session_id' in mutation,false);
 assert.equal(h.current.sales.length,1);assert.equal(h.current.sales[0].status,'pre_venda');assert.equal(h.current.sales[0].total,300);
});
test('failed save retains the persisted quote and rejects a branch change',async()=>{
 const original={...payload(),id:'rescued-fail',user_id:'owner',status:'pre_venda',origin:'pdv',payment_status:'pendente'};
 const h=await harness({initialSales:[original],rpc:async()=>({error:{message:'Estoque insuficiente'}})});
 await act(async()=>assert.rejects(h.current.updatePreSale(original.id,{...original,items:[{...original.items[0],quantity:2}]}),/Estoque insuficiente/));
 assert.equal(h.current.sales[0].total,original.total);
 await act(async()=>assert.rejects(h.current.updatePreSale(original.id,{...original,branch_id:'foreign'}),/outra filial/));
});

test('receipt frontend declares exact remaining cents for full payment',async()=>{
  let received;
  const h=await harness({initialInvoices:[{id:'invoice',user_id:'owner',amount:0.3,paid_amount:0.1,status:'parcial'}],rpc:async(name,args)=>{
    assert.equal(name,'record_partner_invoice_payment_once');received=args.p_amount;
    return {data:args.p_invoice_id,error:null};
  }});
  await act(async()=>{await h.current.payInvoice('invoice');});
  assert.equal(received,0.2);
});

test('recebimento com resposta perdida reutiliza identificador após remontar a tela',async()=>{
  const values=new Map(),requests=[];
  const initialInvoices=[{id:'invoice',user_id:'owner',amount:100,paid_amount:0,status:'aberta'}];
  let fail=true;
  const rpc=async(name,args)=>{assert.equal(name,'record_partner_invoice_payment_once');requests.push(args);return fail ? {data:null,error:{message:'Resposta perdida'}} : {data:args.p_invoice_id,error:null};};
  let h=await harness({initialInvoices,values,rpc});
  await act(async()=>{await assert.rejects(h.current.payInvoice('invoice',20),/Resposta perdida/);});
  await act(async()=>renderer.unmount());renderer=null;fail=false;
  h=await harness({initialInvoices,values,rpc});
  await act(async()=>{await h.current.payInvoice('invoice',20);});
  assert.equal(requests.length,2);assert.equal(requests[0].p_request_id,requests[1].p_request_id);
  assert.equal([...values.keys()].filter(k=>k.startsWith('distrihub-invoice-payment:')).length,0);
});

test('paid invoice recovery reaches the server with the original amount and UUID after reload',async()=>{
 const values=new Map(),calls=[];let fail=true;
 const invoice={id:'fully-paid',user_id:'owner',amount:100,paid_amount:0,status:'aberta'};
 const rpc=async(name,args)=>{calls.push([name,args]);return fail?{error:{message:'Resposta perdida'}}:{data:args.p_invoice_id,error:null};};
 let h=await harness({initialInvoices:[invoice],values,rpc});
 await act(async()=>assert.rejects(h.current.payInvoice(invoice.id,100),/Resposta perdida/));
 await act(async()=>renderer.unmount());renderer=null;fail=false;
 h=await harness({initialInvoices:[{...invoice,paid_amount:100,status:'paga'}],values,rpc});
 assert.equal(h.current.financialRecoveries.length,1);
 await act(async()=>h.current.financialRecoveries[0].run());
 assert.equal(calls.length,2);assert.equal(calls[0][1].p_request_id,calls[1][1].p_request_id);assert.equal(calls[1][1].p_amount,100);assert.equal(h.current.financialRecoveries.length,0);
});

test('RMA credit retry survives remount, locks changed data and confirms without another application ID',async()=>{
 const values=new Map(),calls=[];let fail=true;
 const rpc=async(name,args)=>{calls.push([name,args]);return fail?{error:{message:'Resposta perdida'}}:{data:args.p_application_id,error:null};};
 let h=await harness({values,rpc});
 await act(async()=>assert.rejects(h.current.applyRmaCredit('rma','invoice',20,'original-id'),/Resposta perdida/));
 await act(async()=>renderer.unmount());renderer=null;
 h=await harness({values,rpc});
 await act(async()=>assert.rejects(h.current.applyRmaCredit('rma','invoice',30,'new-id'),/sem confirmação/));assert.equal(calls.length,1);
 fail=false;await act(async()=>h.current.financialRecoveries[0].run());
 assert.equal(calls[1][1].p_application_id,'original-id');assert.equal(calls[1][1].p_amount,20);assert.equal(h.current.financialRecoveries.length,0);
});

test('pre-sale uncertain response survives remount and reuses UUID and payload without credentials',async()=>{
  const requests=[];let fail=true;
  const rpc=async(name,args)=>{
    if(name!=='execute_partner_sale_mutation') return {data:snapshot(),error:null};
    requests.push(args);
    return fail ? {data:null,error:{message:'Lost response'}} : {data:args.p_sale_id,error:null};
  };
  let h=await harness({rpc});
  await act(async()=>{await assert.rejects(h.current.createPreSale({...payload(),jwt:'synthetic-secret'},null,'synthetic-pin'),/mesmo ID/);});
  const values=h.values;
  assert.ok(![...values.values()].join('').includes('synthetic-'));
  await act(async()=>renderer.unmount());renderer=null;
  h=await harness({rpc,values});
  await act(async()=>{await assert.rejects(h.current.createPreSale({...payload(),total:101}),/resultado pendente/);});
  assert.equal(requests.length,1);
  fail=false;
  await act(async()=>{await h.current.createPreSale(payload());});
  assert.equal(requests[1].p_sale_id,requests[0].p_sale_id);
  assert.equal(JSON.stringify(requests[1].p_items),JSON.stringify(requests[0].p_items));
  assert.equal(requests[1].p_status,'pre_venda');
  assert.equal(h.values.size,0);
  await act(async()=>{await h.current.createPreSale(payload());});
  assert.notEqual(requests[2].p_sale_id,requests[0].p_sale_id);
});

test('pre-sale definitive first rejection releases attempt; uncertain retry rejection retains it',async()=>{
  let error={code:'P0001',message:'Invalid price'};
  const h=await harness({rpc:async()=>({data:null,error})});
  await act(async()=>{await assert.rejects(h.current.createPreSale(payload()),/Invalid price/);});
  assert.equal(h.values.size,0);
  error={code:'08006',message:'Connection lost'};
  await act(async()=>{await assert.rejects(h.current.createPreSale(payload()),/mesmo ID/);});
  const saved=[...h.values.values()][0];
  error={code:'P0001',message:'Invalid price'};
  await act(async()=>{await assert.rejects(h.current.createPreSale(payload()),/mesmo ID/);});
  assert.equal([...h.values.values()][0],saved);
});

test('pre-sale double submission is blocked and recovery retains pre-sale status',async()=>{
  let release;const requests=[];
  const h=await harness({rpc:async(name,args)=>{
    if(name!=='execute_partner_sale_mutation')return {data:snapshot(),error:null};
    requests.push(args);
    if(requests.length===1) {await new Promise(resolve=>{release=resolve;});return {data:null,error:{message:'Lost response'}};}
    return {data:args.p_sale_id,error:null};
  }});
  await act(async()=>{
    const first=assert.rejects(h.current.createPreSale(payload()),/mesmo ID/);
    await assert.rejects(h.current.createPreSale(payload()),/Aguarde/);
    release();await first;
  });
  await act(async()=>{await h.current.retryPendingSale();});
  assert.equal(requests.length,2);
  assert.equal(requests[0].p_sale_id,requests[1].p_sale_id);
  assert.equal(requests[1].p_status,'pre_venda');
  assert.equal(requests[1].p_payment_method,'pix');
  assert.equal(h.values.size,0);
});

test('confirmed RPC + failed reconciliation resolves success and does not retain a retry',async()=>{
  let writes=0;
  const h=await harness({rpc:async(name,args)=>{
    if(name==='execute_partner_sale_mutation'){writes++;return {data:args.p_sale_id,error:null};}
    return {data:null,error:{message:'Network unavailable'}};
  }});
  let saved;
  await act(async()=>{saved=await h.current.createSale(payload());});
  assert.equal(writes,1);assert.equal(h.current.sales[0].id,saved.id);
  assert.equal(h.current.pendingSale,null);assert.equal(h.values.size,0);
  assert.match(h.current.pdvSyncWarning,/Operação confirmada/);
});
test('lost mutation response keeps ID; changed cart is blocked; recovery reuses ID',async()=>{
  const ids=[];let fail=true;
  const h=await harness({rpc:async(name,args)=>{
    if(name==='execute_partner_sale_mutation'){
      ids.push(args.p_sale_id);
      return fail?{data:null,error:{message:'Failed to fetch',code:''}}:{data:args.p_sale_id,error:null};
    }
    return {data:snapshot(),error:null};
  }});
  await act(async()=>{await assert.rejects(h.current.createSale(payload()),/mesmo ID/);});
  const pending=h.current.pendingSale.id;
  await act(async()=>{await assert.rejects(h.current.createSale({...payload(),total:200}),/resultado pendente/);});
  assert.equal(ids.length,1);
  fail=false;
  await act(async()=>{await h.current.retryPendingSale();});
  assert.deepEqual(ids,[pending,pending]);assert.equal(h.current.pendingSale,null);
});
test('recovery with another authorizer retains a null commercial seller and the original ID',async()=>{
  const requests=[];
  const h=await harness({rpc:async(name,args)=>{
    if(name==='execute_partner_sale_mutation'){
      requests.push(args);
      return requests.length===1?{data:null,error:{message:'Failed to fetch'}}:{data:args.p_sale_id,error:null};
    }
    return {data:snapshot(),error:null};
  }});
  await act(async()=>{await assert.rejects(h.current.createSale(payload()),/mesmo ID/);});
  await act(async()=>{await h.current.retryPendingSale('manager','synthetic-test-pin');});
  assert.equal(requests[1].p_sale_id,requests[0].p_sale_id);
  assert.equal(requests[1].p_commercial_salesperson_id,null);
  assert.equal(requests[1].p_salesperson_id,'manager');
  assert.equal(h.current.pendingSale,null);
});

test('first PostgreSQL rejection releases the failed attempt and does not claim success',async()=>{
  const h=await harness({rpc:async()=>({data:null,error:{code:'P0001',message:'Estoque insuficiente'}})});
  await act(async()=>{await assert.rejects(h.current.createSale(payload()),/Estoque insuficiente/);});
  assert.equal(h.values.size,0);assert.equal(h.current.sales.length,0);assert.equal(h.current.pendingSale,null);
});
test('database connection error is an uncertain outcome and retains the pending ID',async()=>{
  const h=await harness({rpc:async()=>({data:null,error:{code:'08006',message:'Connection failure'}})});
  await act(async()=>{await assert.rejects(h.current.createSale(payload()),/mesmo ID/);});
  assert.ok(h.current.pendingSale?.id);assert.equal(h.values.size,1);
});
test('double click is blocked synchronously while the first mutation is awaiting its response',async()=>{
  let release;let writes=0;
  const h=await harness({rpc:async(name,args)=>{
    if(name==='execute_partner_sale_mutation'){
      writes++;
      await new Promise(resolve=>{release=resolve;});
      return {data:args.p_sale_id,error:null};
    }
    return {data:snapshot(),error:null};
  }});
  await act(async()=>{
    const first=h.current.createSale(payload());
    await assert.rejects(h.current.createSale(payload()),/Aguarde/);
    release();await first;
  });
  assert.equal(writes,1);
});
test('billed pre-sale reconciles invoice/credit/stock; never creates a local service movement',async()=>{
  const pre={...payload(),id:'pre',user_id:'owner',status:'pre_venda',payment_method:null,origin:'pdv',created_at:new Date().toISOString(),items:[{product_id:'service',name:'Servico',quantity:1,unit_price:100}]};
  let finished=false;let writes=0;
  const h=await harness({initialSales:[pre],rpc:async(name)=>{
    if(name==='execute_partner_sale_mutation'){finished=true;writes++;return {data:pre.id,error:null};}
    return {error:null,data:snapshot({
      products:[{id:'service',branch_id:'branch',stock:0,is_service:true}],
      sales:[{...pre,status:finished?'concluida':'pre_venda',payment_method:finished?'faturado':null}],
      invoices:finished?[{id:'invoice',sale_id:pre.id,branch_id:'branch',amount:100,status:'aberta'}]:[],
      credits:[{customer_id:'customer',allow_credit:true,credit_limit:1000,used:finished?100:0,available:finished?900:1000}],
    })};
  }});
  await act(async()=>{await h.current.finalizePreSale(pre.id,'faturado');});
  assert.equal(writes,1);assert.equal(h.current.invoices[0].id,'invoice');
  assert.equal(h.current.pdvCredits[0].available,900);assert.equal(h.current.products[0].stock,0);
  assert.equal(h.current.movements.length,0);
});
test('billed pre-sale UX rejects absent customer',async()=>{
  let writes=0;
  const pre={...payload(),id:'pre',status:'pre_venda',customer_id:null};
  const h=await harness({initialSales:[pre],rpc:async(name)=>{
    if(name==='execute_partner_sale_mutation'){writes++;return {data:'pre',error:null};}
    return {data:snapshot(),error:null};
  }});
  await act(async()=>{await assert.rejects(h.current.finalizePreSale('pre','faturado'),/Selecione um cliente/);});
  assert.equal(writes,0);
});
test('billed pre-sale UX rejects insufficient authorized credit before mutation',async()=>{
  let writes=0;
  const pre={...payload(),id:'pre',status:'pre_venda'};
  const h=await harness({initialSales:[pre],rpc:async(name)=>{
    if(name==='execute_partner_sale_mutation'){writes++;return {data:'pre',error:null};}
    return {data:snapshot({credits:[{customer_id:'customer',allow_credit:true,available:50}]}),error:null};
  }});
  await act(async()=>{await assert.rejects(h.current.finalizePreSale('pre','faturado'),/insuficiente/);});
  assert.equal(writes,0);
});

test('on-demand product screen makes seven reads and skips histories, finance and OS',async()=>{
  const h=await harness({resourceScope:'cadastros:produtos',rpc:async()=>({data:null,error:null})});
  assert.equal(h.queries.length,7);
  assert.equal(h.current.resourcesReady,true);
  for(const table of ['partner_sales','partner_invoices','service_orders','service_order_items','service_order_photos','partner_audit_logs','partner_customers'])assert.equal(h.queries.includes(table),false,table);
  const initialCount=h.queries.length;
  await h.setScope('configuracoes');assert.equal(h.queries.length,initialCount);
  await h.setScope('cadastros:produtos');assert.equal(h.queries.length,initialCount);
});
test('reports retrieve every sales/invoice page on demand and never replace other loaded collections with empty data',async()=>{
  const sales=Array.from({length:1203},(_,i)=>({id:'sale-'+i,user_id:'owner',branch_id:'branch',status:'concluida',total:10,items:[]}));
  const invoices=Array.from({length:1002},(_,i)=>({id:'invoice-'+i,user_id:'owner',branch_id:'branch',amount:20,status:'aberta'}));
  const h=await harness({resourceScope:'cadastros:produtos',initialSales:sales,initialInvoices:invoices,rpc:async()=>({data:null,error:null}),readResult:(table,fallback)=>table==='partner_products'?{data:[{id:'product',user_id:'owner',branch_id:'branch',name:'Product',stock:1}],error:null}:fallback});
  assert.equal(h.queries.includes('partner_sales'),false);
  await h.setScope('relatorios');
  assert.equal(h.current.sales.length,1203);assert.equal(h.current.sales.reduce((sum,row)=>sum+row.total,0),12030);
  assert.equal(h.current.invoices.length,1002);assert.ok(h.queries.filter(t=>t==='partner_sales').length>=3);
  await h.setScope('suporte');assert.equal(h.current.products.length,1);assert.equal(h.current.sales.length,1203);
  const previous=h.queries.length;await h.setScope('relatorios');assert.equal(h.queries.length,previous);
});
test('a failed required finance collection remains unready and can be retried without declaring empty totals complete',async()=>{
  let fail=true;
  const h=await harness({resourceScope:'financeiro',rpc:async()=>({data:null,error:null}),readResult:(table,fallback)=>table==='partner_invoices'&&fail?{data:null,error:{message:'unavailable'}}:fallback});
  assert.equal(h.current.resourcesReady,false);assert.match(h.current.syncError,/atualizados/);
  fail=false;await act(async()=>h.current.synchronize());assert.equal(h.current.resourcesReady,true);
});
test('confirmed stock replenishment refreshes one product and avoids unrelated table reloads',async()=>{
  let stock=10;
  const product=()=>({id:'product',user_id:'owner',branch_id:'branch',name:'Product',stock,cost_price:4,is_service:false});
  const h=await harness({resourceScope:'cadastros:produtos',rpc:async(name)=>{assert.equal(name,'execute_partner_stock_replenishment_once');stock=12;return{data:{new_stock:12},error:null};},readResult:(table,fallback)=>table==='partner_products'?{data:Array.isArray(fallback.data)?[product()]:product(),error:null}:fallback});
  const initial=h.queries.length;
  await act(async()=>h.current.replenishStock('product','branch',2));
  assert.equal(h.queries.length-initial,1);assert.equal(h.queries.at(-1),'partner_products');assert.equal(h.current.products[0].stock,12);
});

test('lazy finance refresh preserves employee-authorized invoice snapshots instead of narrower table rows',async()=>{
  const identity={authUserId:'employee-auth',companyUserId:'company',salespersonId:'employee',branchId:'branch',role:'gerente'};
  const invoice={id:'authorized-invoice',user_id:'company',branch_id:'branch',amount:100,status:'aberta'};
  let reads=0;
  const h=await harness({identity,branchId:'branch',resourceScope:'pdv',rpc:async name=>{assert.equal(name,'get_partner_pdv_snapshot');reads++;return{data:snapshot({invoices:[invoice]}),error:null};}});
  await act(async()=>h.current.refreshPdv('branch'));await h.setScope('financeiro');assert.equal(h.current.invoices[0].id,'authorized-invoice');
  await act(async()=>h.current.loadData(true));assert.equal(h.current.invoices[0].id,'authorized-invoice');assert.equal(reads,2);
  assert.equal(h.queries.includes('partner_invoices'),false);
});

test('collection cache deduplicates in-flight reads and never shares them between identity scopes',async()=>{
  const exports={};vm.runInNewContext(compile(syncSource),{exports,AbortController,setTimeout,clearTimeout});const cache=new exports.PartnerLoadCache();cache.reset('first');let oldResolve,newResolve,calls=0;
  const first=cache.read('products',()=>{calls++;return new Promise(resolve=>{oldResolve=resolve;});});
  assert.equal(cache.read('products',()=>{throw Error('Duplicate read');}),first);
  await Promise.resolve();assert.equal(calls,1);cache.reset('second');
  const second=cache.read('products',()=>{calls++;return new Promise(resolve=>{newResolve=resolve;});});await Promise.resolve();
  oldResolve('old');await first;assert.equal(cache.read('products',()=>{throw Error('New scope request was removed');}),second);
  newResolve('new');assert.equal(await second,'new');assert.equal(calls,2);
  cache.mark('products');assert.equal(cache.needs('products'),false);assert.equal(cache.needs('products',Date.now()+31000),true);
  cache.reset('third');assert.equal(cache.has('products'),false);
});

test('a stalled data request times out, releases the shared read and permits a fresh retry',async()=>{
 const timers=new Map();let id=0;
 const exports={};vm.runInNewContext(compile(syncSource),{exports,AbortController,setTimeout(callback){timers.set(++id,callback);return id;},clearTimeout(key){timers.delete(key);}});
 const cache=new exports.PartnerLoadCache();cache.reset('owner');let oldResolve;
 const stalled=cache.read('invoices',()=>new Promise(resolve=>{oldResolve=resolve;}));
 const failure=assert.rejects(stalled,/demorou demais/);
 await Promise.resolve();for(const callback of [...timers.values()])callback();await failure;
 assert.equal(await cache.read('invoices',async()=> 'fresh'),'fresh');
 oldResolve('late');await Promise.resolve();assert.equal(timers.size,0);
});

test('a stalled screen shows an error and retry loads its resources instead of waiting forever',async()=>{
 let stalled=true;
 const h=await harness({resourceScope:'configuracoes',rpc:async()=>({data:null,error:null}),readResult:(table,fallback)=>stalled&&table==='partner_invoices'?new Promise(()=>{}):fallback});
 await h.setScope('financeiro');assert.equal(h.current.loading,true);
 await act(async()=>h.flushTimers());
 assert.equal(h.current.loading,false);assert.equal(h.current.resourcesReady,false);assert.match(h.current.error,/demorou demais/);
 stalled=false;await act(async()=>h.current.loadData(false,undefined,false));
 assert.equal(h.current.loading,false);assert.equal(h.current.resourcesReady,true);
});

test('a slow module read remains reusable after navigating away and does not need to be fetched twice',async()=>{
 let release;
 const h=await harness({resourceScope:'configuracoes',rpc:async()=>({data:null,error:null}),readResult:(table,fallback)=>table==='partner_invoices'?new Promise(resolve=>{release=resolve;}):fallback});
 await h.setScope('financeiro');assert.equal(h.current.loading,true);
 await h.setScope('cadastros:produtos');assert.equal(h.current.resourcesReady,true);
 await act(async()=>release({data:[],error:null}));
 const count=h.queries.length;await h.setScope('financeiro');
 assert.equal(h.current.resourcesReady,true);assert.equal(h.current.loading,false);
 assert.equal(h.queries.length,count);
});

test('returning to cached products immediately releases the previous modules loading state while revalidating',async()=>{
 let hold=false,releaseProducts,releaseInvoices;
 const h=await harness({resourceScope:'cadastros:produtos',rpc:async()=>({data:null,error:null}),readResult:(table,fallback)=>hold&&table==='partner_invoices'?new Promise(resolve=>{releaseInvoices=resolve;}):hold&&table==='partner_products'?new Promise(resolve=>{releaseProducts=resolve;}):fallback});
 const originalNow=Date.now;const now=Date.now();Date.now=()=>now+31000;
 try {
  hold=true;await h.setScope('financeiro');assert.equal(h.current.loading,true);
  await h.setScope('cadastros:produtos');assert.equal(h.current.resourcesReady,true);assert.equal(h.current.loading,false);
 } finally {
  Date.now=originalNow;
  await act(async()=>{releaseProducts?.({data:[],error:null});releaseInvoices?.({data:[],error:null});});
 }
});

 test('returning to an expired cached module preserves its data without blocking navigation',async()=>{
  let pending=false,resolveRead;
  const h=await harness({resourceScope:'cadastros:produtos',rpc:async()=>({data:null,error:null}),readResult:(table,fallback)=>table==='partner_products'?(pending?new Promise(resolve=>{resolveRead=resolve;}):{data:[{id:'product',user_id:'owner',stock:1}],error:null}):fallback});
  await h.setScope('suporte');
  // Explicit invalidation mimics the thirty-second cache expiry without a real delay.
  // The production cache class and hook share the VM Date implementation.
  const originalNow=Date.now;const now=Date.now();Date.now=()=>now+31000;
  try{
   pending=true;await h.setScope('cadastros:produtos');
   assert.equal(h.current.loading,false);assert.equal(h.current.resourcesReady,true);assert.equal(h.current.products[0].stock,1);
   await act(async()=>resolveRead({data:[{id:'product',user_id:'owner',stock:2}],error:null}));
   assert.equal(h.current.products[0].stock,2);
  }finally{Date.now=originalNow;}
 });
 test('open orders load without waiting for invoices or RMA and finance still loads its own resources',async()=>{
  const h=await harness({resourceScope:'pedidos',initialSales:[{id:'open-order',user_id:'owner',status:'pre_venda',branch_id:'branch',items:[]}],rpc:async()=>({data:null,error:null})});
  assert.equal(h.current.resourcesReady,true);
  assert.equal(h.current.sales[0].id,'open-order');
  for(const table of ['partner_invoices','rma_requests_v2','partner_rma_credit_applications'])assert.equal(h.queries.includes(table),false,table+' should not delay open orders');
  await h.setScope('financeiro');
  assert.equal(h.current.resourcesReady,true);
  for(const table of ['partner_invoices','rma_requests_v2','partner_rma_credit_applications'])assert.equal(h.queries.includes(table),true,table+' must still load for finance');
 });

 test('explicit data prefetch loads only the destination resources and the subsequent tab uses them without another query',async()=>{
  const h=await harness({resourceScope:'cadastros:produtos',initialCustomers:[{id:'customer',user_id:'owner',name:'Customer'}],rpc:async()=>({data:null,error:null})});
  await act(async()=>h.current.prefetchModule('pedidos'));
  assert.equal(h.current.loading,false);assert.equal(h.current.customers.length,1);
  const reads=h.queries.length;await h.setScope('pedidos');
  assert.equal(h.queries.length,reads);assert.equal(h.current.resourcesReady,true);
 });

test('history hook separates supervisor approval, validates branch and changes state only after confirmation',async()=>{
 const sold={...payload(),id:'history-sale',user_id:'owner',status:'concluida'};const calls=[];let fail=true;
 const h=await harness({initialSales:[sold],rpc:async(name,args)=>{
  calls.push({name,args});if(name==='get_partner_pdv_snapshot')return {data:snapshot({sales:[{...sold,status:'cancelada'}]}),error:null};
  return fail?{error:{message:'PIN incorreto'}}:{data:args.p_sale_id,error:null};
 }});
 await act(async()=>assert.rejects(h.current.cancelHistorySale(sold.id,'other-branch',null,null,'manager','9876'),/filial/));assert.equal(calls.length,0);
 await act(async()=>assert.rejects(h.current.cancelHistorySale(sold.id,'branch',null,null,'manager','9876'),/PIN incorreto/));assert.equal(h.current.sales[0].status,'concluida');
 fail=false;await act(async()=>h.current.cancelHistorySale(sold.id,'branch',null,null,'manager','9876'));
 const mutation=calls.find(c=>c.name==='cancel_partner_history_sale');assert.equal(mutation.args.p_salesperson_id,null);assert.equal(mutation.args.p_supervisor_id,'manager');assert.equal(mutation.args.p_supervisor_pin,'9876');
 assert.equal(h.current.sales[0].status,'cancelada');
});
test('history hook serializes requests and rejects an unconfirmed sale ID',async()=>{
 const sold={...payload(),id:'history-sale',user_id:'owner',status:'concluida'};let release;
 const h=await harness({initialSales:[sold],rpc:()=>new Promise(resolve=>{release=resolve;})});
 let pending;await act(async()=>{pending=h.current.cancelHistorySale(sold.id,'branch');await assert.rejects(h.current.cancelHistorySale(sold.id,'branch'),/Aguarde/);});
 await act(async()=>{release({data:'other-sale',error:null});await assert.rejects(pending,/não confirmado/);});assert.equal(h.current.sales[0].status,'concluida');
});

