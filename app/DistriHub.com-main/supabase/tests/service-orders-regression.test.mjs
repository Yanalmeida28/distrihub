import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require=createRequire(import.meta.url);
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
const moduleSource=compile(await readFile(new URL('../../src/components/partner/ServiceOrdersModule.tsx',import.meta.url),'utf8'));
const detailSource=compile(await readFile(new URL('../../src/components/partner/ServiceOrderDetails.tsx',import.meta.url),'utf8'));
const printSource=compile(await readFile(new URL('../../src/lib/serviceOrderPrint.ts',import.meta.url),'utf8'));
const checklist={};vm.runInNewContext(compile(await readFile(new URL('../../src/lib/serviceChecklist.ts',import.meta.url),'utf8')),{exports:checklist});
const service={};vm.runInNewContext(compile(await readFile(new URL('../../src/lib/serviceOrders.ts',import.meta.url),'utf8')),{exports:service,Error});
const attempt={};vm.runInNewContext(compile(await readFile(new URL('../../src/lib/operationAttempts.ts',import.meta.url),'utf8')),{exports:attempt,crypto:{randomUUID}});
const orderA={id:'order-a',user_id:'owner',branch_id:'branch-a',customer_id:'client-a',customer_name:'Cliente A',equipment_type:'Equipamento A',equipment_identification:'A',status:'em_andamento',approval_status:'aprovado',technician_name:'Técnico A',total:100};
const orderB={...orderA,id:'order-b',customer_id:'client-b',customer_name:'Cliente B',equipment_type:'Equipamento B',status:'aberta',approval_status:'aguardando_aprovacao',technician_name:''};
const props={userId:'owner',authUserId:'owner',segment:'assistencia',branches:[{id:'branch-a',name:'Filial A'},{id:'branch-b',name:'Filial B'}],selectedBranchId:'branch-a',customers:[],products:[]};
let view;afterEach(async()=>{if(view)await act(async()=>view.unmount());view=null;});
const rendered=()=>JSON.stringify(view.toJSON());
const button=text=>view.root.findAllByType('button').find(n=>n.children.some(child=>typeof child==='string'&&child.trim()===text));
const save=()=>view.root.findAllByType('button').find(n=>n.props.onClick?.name==='saveOrder');
const cancelForm=()=>view.root.findByProps({'aria-label':'Cancelamento da OS'}).findByType('form');
test('list exposes cancellation and confirms only after the reason and server confirmation',async()=>{
 const order={...orderA,equipment_type:'Celular'};
 const h=await harness({orders:[order],rpc:(name)=>name==='update_service_order_workflow_checked'?{data:{...order,status:'cancelada'},error:null}:undefined});
 await act(async()=>button('Cancelar OS').props.onClick());
 assert.match(rendered(),/Confirmar cancelamento da OS/);assert.equal(h.calls.length,0);
 await act(async()=>view.root.findByProps({'aria-label':'Saída: Touch'}).props.onChange({target:{value:'Funcionando'}}));
 await act(async()=>view.root.findByProps({'aria-label':'Motivo do cancelamento da OS'}).props.onChange({target:{value:'Cliente desistiu do reparo'}}));
 await act(async()=>cancelForm().props.onSubmit({preventDefault(){}}));
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].args.p_status,'cancelada');
 assert.equal(h.calls[0].args.p_customer_id,order.customer_id);assert.equal(h.calls[0].args.p_clear_customer,false);
 assert.equal(h.calls[0].args.p_reason,'Cliente desistiu do reparo');
 assert.match(rendered(),/OS cancelada/);assert.equal(button('Cancelar OS'),undefined);
});
test('cancellation requires a reason and keeps financial rejection visible with the draft intact',async()=>{
 const h=await harness({detail:orderA,rpc:()=>({error:{message:'Há recebimentos vinculados. Concilie o financeiro antes de cancelar.'}})});
 await act(async()=>button('Cancelar OS').props.onClick());
 await act(async()=>cancelForm().props.onSubmit({preventDefault(){}}));
 assert.equal(h.calls.length,0);assert.match(rendered(),/pelo menos 5/);
 await act(async()=>view.root.findByProps({'aria-label':'Motivo do cancelamento da OS'}).props.onChange({target:{value:'Cliente desistiu'}}));
 await act(async()=>cancelForm().props.onSubmit({preventDefault(){}}));
 assert.match(rendered(),/Concilie o financeiro/);assert.equal(view.root.findByProps({'aria-label':'Motivo do cancelamento da OS'}).props.value,'Cliente desistiu');
 assert.doesNotMatch(rendered(),/OS cancelada\./);
});
test('duplicate cancellation submits send once and unconfirmed responses never show success',async()=>{
 let complete;const h=await harness({detail:orderA,rpc:()=>new Promise(resolve=>{complete=resolve;})});
 await act(async()=>button('Cancelar OS').props.onClick());
 await act(async()=>view.root.findByProps({'aria-label':'Motivo do cancelamento da OS'}).props.onChange({target:{value:'Cliente desistiu'}}));
 const submit=cancelForm().props.onSubmit;let pending;
 await act(async()=>{pending=submit({preventDefault(){}});submit({preventDefault(){}});});
 assert.equal(h.calls.length,1);
 await act(async()=>{complete({data:{...orderA,status:'aberta'},error:null});await pending;});
 assert.match(rendered(),/Cancelamento não confirmado/);assert.ok(button('Confirmar cancelamento da OS'));
});
test('saved photo removal requires confirmation and keeps the image after a server failure',async()=>{
 const photo={id:'photo-front',service_order_id:orderA.id,user_id:'owner',photo_type:'entrada',label:'Frente',storage_path:'old.webp'};
 let photos=[photo],fail=true;const changes=[];
 await harness({detail:orderA,read:args=>args.table==='service_order_photos'?{data:photos,error:null}:undefined,serviceOverrides:{changeServicePhoto:async(...args)=>{changes.push(args);if(fail)throw Error('Falha ao remover');photos=[];}}});
 assert.match(rendered(),/Entrada/);
 await act(async()=>view.root.findByProps({'aria-label':'Remover foto: Frente'}).props.onClick());
 assert.equal(changes.length,0);assert.ok(button('Confirmar remoção'));
 await act(async()=>button('Manter foto').props.onClick());assert.equal(button('Confirmar remoção'),undefined);
 await act(async()=>view.root.findByProps({'aria-label':'Remover foto: Frente'}).props.onClick());
 await act(async()=>button('Confirmar remoção').props.onClick());
 assert.match(rendered(),/Falha ao remover/);assert.equal(view.root.findAllByType('img').length,1);
 fail=false;await act(async()=>button('Confirmar remoção').props.onClick());
 assert.equal(view.root.findAllByType('img').length,0);assert.match(rendered(),/Foto removida da OS/);
 assert.equal(changes[1][1].id,photo.id);
});

test('photo replacement uses the selected image and retains the current image if preparation fails',async()=>{
 const photo={id:'photo-front',service_order_id:orderA.id,user_id:'owner',photo_type:'entry',label:'Frente',storage_path:'old.webp'};
 let fail=true;const changes=[];
 await harness({detail:orderA,read:args=>args.table==='service_order_photos'?{data:[photo],error:null}:undefined,serviceOverrides:{compressServicePhoto:async file=>{if(fail)throw Error('Imagem inválida');return {...file,prepared:true};},changeServicePhoto:async(...args)=>{changes.push(args);}}});
 const pick=()=>view.root.findByProps({'aria-label':'Trocar foto: Frente'});
 const event={target:{files:[{name:'nova.jpg'}],value:'selected'}};
 await act(async()=>pick().props.onChange(event));assert.equal(event.target.value,'');
 assert.match(rendered(),/Imagem inválida/);assert.equal(changes.length,0);assert.equal(view.root.findAllByType('img').length,1);
 fail=false;await act(async()=>pick().props.onChange({target:{files:[{name:'nova.jpg'}],value:'selected'}}));
 assert.equal(changes[0][1].id,photo.id);assert.equal(changes[0][2].prepared,true);assert.match(rendered(),/Foto substituída/);
});

test('cancelled orders disable saved photo changes',async()=>{
 await harness({detail:{...orderA,status:'cancelada'},read:args=>args.table==='service_order_photos'?{data:[{id:'photo',photo_type:'entry',label:'Frente',storage_path:'old.webp'}],error:null}:undefined});
 assert.equal(view.root.findByProps({'aria-label':'Trocar foto: Frente'}).props.disabled,true);
 assert.equal(view.root.findByProps({'aria-label':'Remover foto: Frente'}).props.disabled,true);
});

test('closed service orders do not offer cancellation',async()=>{
 const h=await harness({detail:{...orderA,status:'finalizada'}});assert.equal(button('Cancelar OS'),undefined);
 await h.update({order:{...orderA,id:'closed',status:'cancelada'}});assert.equal(button('Cancelar OS'),undefined);
});
test('list cancellation opens the confirmation even when the same OS details are already open',async()=>{
 await harness({orders:[orderA]});
 await act(async()=>button('Abrir OS').props.onClick());
 const listAction=view.root.findByProps({'aria-label':`Cancelar OS #${orderA.id.slice(0,8)}`});
 await act(async()=>listAction.props.onClick());
 assert.ok(cancelForm());
});
test('status selector cancellation also bypasses an incomplete exit checklist',async()=>{
 const order={...orderA,equipment_type:'Celular'};const h=await harness({detail:order});
 await act(async()=>view.root.findByProps({'aria-label':'Saída: Touch'}).props.onChange({target:{value:'Funcionando'}}));
 const status=view.root.findAllByType('select').find(field=>field.props.value==='em_andamento');
 await act(async()=>status.props.onChange({target:{value:'cancelada'}}));
 await act(async()=>view.root.findByType('textarea').props.onChange({target:{value:'Cliente desistiu do reparo'}}));
 await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].args.p_status,'cancelada');assert.equal(h.calls[0].args.p_reason,'Cliente desistiu do reparo');
});
async function harness({orders=[],read,rpc,invoice=null,blocked=false,values=new Map(),detail=null,customers=[],serviceOverrides={}}={}){
 const calls=[],queries=[];let lastCreate;let storageBlocked=blocked;
 const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const win={};Object.defineProperty(win,'localStorage',{get(){if(storageBlocked)throw new Error('Armazenamento bloqueado');return storage;}});
 const client={rpc:async(name,args)=>{
  calls.push({name,args});if(name==='create_service_order_once')lastCreate=args;
  const result=rpc?.(name,args);if(result!==undefined)return result;
  return {data:name==='create_service_order_once'?args.p_request_id:{...orderA,id:args.p_order_id,user_id:'owner',customer_id:args.p_clear_customer?null:args.p_customer_id},error:null};
 },from(table){const args={table};const q={select(){return q;},eq(k,v){args[k]=v;return q;},order(){return q;},
  single(){const manual=lastCreate?.p_payload.manual_customer;return Promise.resolve({data:{...orderA,id:args.id,branch_id:lastCreate?.p_payload.branch_id??'branch-a',customer_id:lastCreate?.p_payload.customer_id??null,customer_name:manual?.name??orderA.customer_name,customer_email:manual?.email??null,customer_address:manual?.address??null,customer_phone:manual?.phone??null},error:null});},
  maybeSingle(){return Promise.resolve({data:invoice?{id:invoice}:null,error:null});},
  then(done,fail){queries.push({...args});const result=read?.(args)??{data:table==='service_orders'?orders:[],error:null};return Promise.resolve(result).then(done,fail);}};return q;
 },storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'photo'},error:null})})}};
 const drafts={'service-order:open':true,'service-order:equipment-type':'Celular','service-order:identification':'Inicial','service-order:checklist':Object.fromEntries(checklist.checklistItems('Celular').map(([key])=>[key,'Não testado'])),'service-order:customer-acknowledged':true};
 const details={},module={},printing={};
 vm.runInNewContext(printSource,{exports:printing,require:()=>({money:{format:String}}),window:win});
 const load=name=>{
  if(name==='../../lib/supabase')return {supabase:client};
  if(name==='../../hooks/useSessionDraft')return {useSessionDraftState:(key,initial)=>React.useState(drafts[key]??initial)};
  if(name==='../../lib/serviceOrders')return {...service,...serviceOverrides};
  if(name==='../../lib/serviceChecklist')return checklist;
  if(name==='../../lib/serviceOrderPrint')return printing;
  if(name==='../../lib/operationAttempts')return {...attempt,pendingPhotos:async()=>[]};
  if(name==='./ServiceOrderDetails')return details;
  if(name==='../../utils')return {money:{format:String}};
  return require(name);
 };
 const globals={require:load,Date,Error,console,crypto:{randomUUID},window:win,URL:{createObjectURL:()=>'',revokeObjectURL(){}}};
 vm.runInNewContext(detailSource,{...globals,exports:details});vm.runInNewContext(moduleSource,{...globals,exports:module});
 let currentProps=detail?{order:detail,customers,onClose(){},onChanged(){}}:{...props,customers};
 const Component=detail?details.ServiceOrderDetails:module.ServiceOrdersModule;
 await act(async()=>{view=TestRenderer.create(React.createElement(Component,currentProps));});
 return {calls,queries,values,unblock(){storageBlocked=false;},update:async changes=>{currentProps={...currentProps,...changes};await act(async()=>view.update(React.createElement(Component,currentProps)));}};
}

test('late branch list response is discarded and inactive module performs no new reads',async()=>{
 const pending=[];const h=await harness({read:args=>args.table==='service_orders'?new Promise(resolve=>pending.push({args,resolve})):undefined});
 await h.update({selectedBranchId:'branch-b'});assert.equal(pending.length,2);
 await act(async()=>pending[1].resolve({data:[{...orderB,branch_id:'branch-b'}],error:null}));
 await act(async()=>pending[0].resolve({data:[orderA],error:null}));assert.match(rendered(),/Cliente B/);assert.doesNotMatch(rendered(),/Cliente A/);
 await h.update({isActive:false});assert.equal(pending.length,2);
});
test('no branch selection shows no service orders and does not query across branches',async()=>{
 const h=await harness({orders:[orderA]});
 assert.match(rendered(),/Cliente A/);
 await h.update({selectedBranchId:null});
 assert.doesNotMatch(rendered(),/Cliente A/);
 assert.deepEqual(h.queries.filter(query=>query.table==='service_orders').map(query=>query.branch_id),['branch-a']);
});
test('new OS shows the selected customer contact details and only offers customers for its branch',async()=>{
 const customer={id:'client-a',name:'Cliente A',email:'cliente@example.com',phone:'(11) 99999-0000',address:'Rua A',address_number:'42',neighborhood:'Centro',city:'São Paulo',state:'SP',zip_code:'01000-000'};
 const otherBranchCustomer={...customer,id:'client-b',name:'Cliente B',branch_id:'branch-b'};
 const h=await harness({customers:[{...customer,branch_id:'branch-a'},otherBranchCustomer]});
 const selector=view.root.findAllByType('select')[0];
 assert.deepEqual(selector.findAllByType('option').map(option=>option.children.join('')),['Sem cliente','Informar cliente manualmente','Cliente A']);
 await act(async()=>selector.props.onChange({target:{value:'client-a'}}));
 assert.match(rendered(),/Dados do cliente/);
 for(const value of ['cliente@example.com','Rua A, 42, Centro, São Paulo, SP, 01000-000','(11) 99999-0000'])assert.match(rendered(),new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});
test('OS details show contact details from the customer linked to the same branch',async()=>{
 const customer={id:'client-a',name:'Cliente A',email:'cliente@example.com',phone:'(11) 99999-0000',address:'Rua A',address_number:'42',neighborhood:'Centro',city:'São Paulo',state:'SP',zip_code:'01000-000',branch_id:'branch-a'};
 const otherBranchCustomer={...customer,id:'client-b',name:'Cliente B',email:'wrong@example.com',branch_id:'branch-b'};
 await harness({detail:orderA,customers:[customer,otherBranchCustomer]});
 const text=rendered();
 for(const value of ['Dados do cliente','cliente@example.com','Rua A, 42, Centro, São Paulo, SP, 01000-000','(11) 99999-0000'])assert.match(text,new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.doesNotMatch(text,/wrong@example\.com/);
});
test('manual customer can be entered, is saved to the OS and shown after creation',async()=>{
 const h=await harness();
 const selector=view.root.findAllByType('select')[0];
 await act(async()=>selector.props.onChange({target:{value:'__manual__'}}));
 const field=placeholder=>view.root.findAllByType('input').find(input=>input.props.autoComplete===placeholder);
 await act(async()=>field('name').props.onChange({target:{value:'Cliente sem cadastro'}}));
 await act(async()=>field('email').props.onChange({target:{value:'manual@example.com'}}));
 await act(async()=>field('street-address').props.onChange({target:{value:'Rua das Flores, 123'}}));
 await act(async()=>field('tel').props.onChange({target:{value:'(11) 98888-7777'}}));
 await act(async()=>save().props.onClick());
 const payload=h.calls.find(call=>call.name==='create_service_order_once').args.p_payload;
 assert.equal(payload.customer_id,null);
 assert.deepEqual({...payload.manual_customer},{name:'Cliente sem cadastro',email:'manual@example.com',address:'Rua das Flores, 123',phone:'(11) 98888-7777'});
 for(const value of ['Cliente sem cadastro','manual@example.com','Rua das Flores, 123','(11) 98888-7777'])assert.match(rendered(),new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('changing a manual OS to a registered customer never shows the former contact even before saving',async()=>{
 const manual={...orderA,customer_id:null,customer_name:'Cliente antigo',customer_email:'old@example.com',customer_phone:'Telefone antigo',customer_address:'Endereço antigo'};
 await harness({detail:manual,customers:[{id:'new-customer',name:'Cliente novo',branch_id:'branch-a'}]});
 assert.match(rendered(),/old@example.com/);
 await act(async()=>view.root.findAllByType('select')[0].props.onChange({target:{value:'new-customer'}}));
 assert.match(rendered(),/Cliente novo/);
 assert.doesNotMatch(rendered(),/old@example.com|Telefone antigo|Endereço antigo/);
});

test('registered OS never falls back to stale manual contact fields after reloading',async()=>{
 await harness({detail:{...orderA,customer_email:'stale@example.com',customer_phone:'Contato anterior',customer_address:'Endereço anterior'},customers:[{id:orderA.customer_id,name:'Cliente atual',branch_id:'branch-a'}]});
 assert.doesNotMatch(rendered(),/stale@example.com|Contato anterior|Endereço anterior/);
});
test('manual customer requires a name and validates provided email',async()=>{
 const h=await harness();
 await act(async()=>view.root.findAllByType('select')[0].props.onChange({target:{value:'__manual__'}}));
 const field=autocomplete=>view.root.findAllByType('input').find(input=>input.props.autoComplete===autocomplete);
 await act(async()=>field('email').props.onChange({target:{value:'bad-email'}}));
 await act(async()=>save().props.onClick());
 assert.equal(h.calls.filter(call=>call.name==='create_service_order_once').length,0);
 assert.match(rendered(),/Informe o nome do cliente/);
 await act(async()=>field('name').props.onChange({target:{value:'Cliente'}}));
 await act(async()=>save().props.onClick());
 assert.equal(h.calls.filter(call=>call.name==='create_service_order_once').length,0);
 assert.match(rendered(),/Informe um e-mail válido/);
});
test('list failure is visible, never announces confirmed empty data, and retry loads the orders',async()=>{
 let failed=true;const h=await harness({read:args=>args.table==='service_orders'?{data:failed?null:[orderA],error:failed?{message:'Falha de rede'}:null}:undefined});
 assert.match(rendered(),/Falha de rede/);assert.doesNotMatch(rendered(),/Nenhuma OS encontrada/);failed=false;
 await act(async()=>button('Tentar carregar OS novamente').props.onClick());assert.match(rendered(),/Cliente A/);assert.doesNotMatch(rendered(),/Falha de rede/);assert.equal(h.queries.length,2);
});
test('opening another OS resets every workflow field and sends only the new identity and values',async()=>{
 const h=await harness({detail:orderA});await h.update({order:orderB});
 await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
 const call=h.calls[0];assert.equal(call.name,'update_service_order_workflow_checked');assert.equal(call.args.p_order_id,'order-b');assert.equal(call.args.p_status,'aberta');assert.equal(call.args.p_approval,'aguardando_aprovacao');assert.equal(call.args.p_technician,'');assert.equal(call.args.p_customer_id,'client-b');
});
test('late workflow result does not change a newly opened OS or invoke its callback',async()=>{
 let complete;let changed=0;const h=await harness({detail:orderA,rpc:()=>new Promise(resolve=>{complete=resolve;})});await h.update({onChanged(){changed++;}});
 let request;await act(async()=>{request=view.root.findByType('form').props.onSubmit({preventDefault(){}});});await h.update({order:orderB});
 await act(async()=>{complete({data:orderA,error:null});await request;});assert.equal(changed,0);assert.doesNotMatch(rendered(),/Situação da OS salva/);assert.match(rendered(),/Equipamento B/);
});
test('billed OS locks customer selection; unfactored clearing sends the explicit flag',async()=>{
 const h=await harness({detail:orderA,invoice:'invoice-a'});assert.equal(view.root.findAllByType('select')[0].props.disabled,true);assert.match(rendered(),/OS faturada/);
 await h.update({order:orderB}); // Same invoice result remains billed; use a new instance for a genuinely unbilled order.
 await act(async()=>view.unmount());view=null;
 const clean=await harness({detail:orderA});await act(async()=>view.root.findAllByType('select')[0].props.onChange({target:{value:''}}));await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.equal(clean.calls[0].args.p_clear_customer,true);assert.equal(clean.calls[0].args.p_customer_id,null);
});
test('blocked browser storage releases the submission lock, preserves the form, and permits a safe retry',async()=>{
 const h=await harness({blocked:true});await act(async()=>save().props.onClick());assert.equal(save().props.disabled,false);assert.match(rendered(),/Armazenamento bloqueado/);assert.equal(h.calls.length,0);
 h.unblock();await act(async()=>save().props.onClick());assert.equal(h.calls.filter(c=>c.name==='create_service_order_once').length,1);assert.equal(h.values.size,0);
});

test('manual parts accept Brazilian prices, remain independent and reach the saved OS without a stock product',async()=>{
 const h=await harness();
 const change=async(label,value)=>act(async()=>view.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
 await change('Descrição da peça manual','Tela de terceiros');await change('Quantidade da peça manual','2');await change('Preço da peça manual','R$ 125,50');
 await act(async()=>button('Adicionar peça manual').props.onClick());
 await change('Descrição da peça manual','Conector externo');await change('Preço da peça manual','10,00');
 await act(async()=>button('Adicionar peça manual').props.onClick());
 assert.equal(view.root.findByProps({'aria-label':'Quantidade de Tela de terceiros'}).props.max,999);
 await change('Preço unitário de Tela de terceiros','130.50');
 assert.equal(view.root.findByProps({'aria-label':'Preço unitário de Conector externo'}).props.value,10);
 await act(async()=>save().props.onClick());
 const items=h.calls[0].args.p_payload.items;
 assert.equal(items.length,2);assert.equal(items[0].product_id,null);assert.equal(items[0].name,'Tela de terceiros');assert.equal(items[0].quantity,2);assert.equal(items[0].unit_price,130.5);
 assert.notEqual(items[0].manual_id,items[1].manual_id);
});

test('manual part removal does not remove other manual rows and unfinished or invalid values block saving',async()=>{
 const h=await harness();
 const change=async(label,value)=>act(async()=>view.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
 await change('Descrição da peça manual','Primeira');await change('Preço da peça manual','10,00');
 await act(async()=>save().props.onClick());assert.equal(h.calls.length,0);
 await act(async()=>button('Adicionar peça manual').props.onClick());
 await change('Descrição da peça manual','Segunda');await change('Preço da peça manual','-1');
 await act(async()=>button('Adicionar peça manual').props.onClick());assert.equal(view.root.findAllByProps({'aria-label':'Quantidade de Segunda'}).length,0);
 await change('Preço da peça manual','20');await act(async()=>button('Adicionar peça manual').props.onClick());
 await act(async()=>view.root.findByProps({'aria-label':'Remover Primeira'}).props.onClick());
 assert.equal(view.root.findAllByProps({'aria-label':'Quantidade de Primeira'}).length,0);assert.equal(view.root.findAllByProps({'aria-label':'Quantidade de Segunda'}).length,1);
 await act(async()=>save().props.onClick());assert.equal(h.calls[0].args.p_payload.items.length,1);assert.equal(h.calls[0].args.p_payload.items[0].name,'Segunda');
});

test('manual piece description and request identity survive a lost creation reply and remount',async()=>{
 const values=new Map();const h=await harness({values,rpc:(name)=>name==='create_service_order_once'?{error:{code:'08006',message:'Resposta perdida'}}:undefined});
 for(const [label,value] of [['Descrição da peça manual','Peça comprada'],['Preço da peça manual','1.234,56']])await act(async()=>view.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
 await act(async()=>button('Adicionar peça manual').props.onClick());await act(async()=>save().props.onClick());
 const original=h.calls[0].args;
 await act(async()=>view.unmount());view=null;
 const recovered=await harness({values});
 assert.equal(view.root.findByProps({'aria-label':'Preço unitário de Peça comprada'}).props.value,1234.56);
 await act(async()=>save().props.onClick());
 assert.equal(recovered.calls[0].args.p_request_id,original.p_request_id);assert.equal(JSON.stringify(recovered.calls[0].args.p_payload),JSON.stringify(original.p_payload));
});
test('creation locks the whole form synchronously, sends once, and uses the original immutable payload',async()=>{
 let complete;const h=await harness({rpc:(name,args)=>name==='create_service_order_once'?new Promise(resolve=>{complete=()=>resolve({data:args.p_request_id,error:null});}):undefined});
 const start=save().props.onClick;let request;await act(async()=>{request=start();start();});
 assert.equal(view.root.findByType('fieldset').props.disabled,true);assert.equal(h.calls.length,1);assert.equal(h.calls[0].args.p_payload.identification,'Inicial');
 await act(async()=>{complete();await request;});assert.equal(h.values.size,0);assert.match(rendered(),/Cliente A/);
});
test('uncertain creation retains the same ID and retries once without changing its payload',async()=>{
 let fail=true;const h=await harness({rpc:(name,args)=>name==='create_service_order_once'?(fail?{error:{code:'08006',message:'Conexão perdida'}}:{data:args.p_request_id,error:null}):undefined});
 await act(async()=>save().props.onClick());assert.equal(h.values.size,1);assert.match(rendered(),/Conexão perdida/);
 fail=false;await act(async()=>save().props.onClick());assert.equal(h.calls.length,2);assert.equal(h.calls[0].args.p_request_id,h.calls[1].args.p_request_id);assert.equal(JSON.stringify(h.calls[0].args.p_payload),JSON.stringify(h.calls[1].args.p_payload));assert.equal(h.values.size,0);
});
test('malformed pending storage is preserved for reconciliation and never creates an untracked OS',async()=>{
 const values=new Map([['distrihub-operation:owner:owner:branch-a:service-order','{invalid']]);const h=await harness({values});await act(async()=>save().props.onClick());assert.equal(h.calls.length,0);assert.equal(values.size,1);assert.equal(save().props.disabled,false);
});

test('a definitive warranty rejection releases an old pending draft and requires fresh acknowledgment',async()=>{
 let phase=0;
 const h=await harness({rpc:name=>name==='create_service_order_once'?(phase===0?{error:{code:'08006',message:'Resposta perdida'}}:phase===1?{error:{code:'22023',message:'O termo de garantia mudou'}}:undefined):undefined});
 await h.update({warrantyTerms:'Termo original'});
 const acknowledge=()=>view.root.findAllByType('label').find(label=>label.children.some(child=>typeof child==='string'&&child.includes('Cliente informado'))).findByType('input');
 await act(async()=>acknowledge().props.onChange({target:{checked:true}}));
 await act(async()=>save().props.onClick());assert.equal(h.values.size,1);
 await h.update({warrantyTerms:'Termo novo'});phase=1;
 await act(async()=>save().props.onClick());assert.equal(h.values.size,0);
 assert.equal(h.calls[0].args.p_request_id,h.calls[1].args.p_request_id);
 assert.equal(h.calls[1].args.p_payload.warranty_terms,'Termo original');
 phase=2;await act(async()=>save().props.onClick());assert.equal(h.calls.length,2);
 const ack=acknowledge();
 assert.equal(ack.props.checked,false);await act(async()=>ack.props.onChange({target:{checked:true}}));
 await act(async()=>save().props.onClick());assert.equal(h.calls.length,3);
 assert.notEqual(h.calls[2].args.p_request_id,h.calls[1].args.p_request_id);assert.equal(h.calls[2].args.p_payload.warranty_terms,'Termo novo');
});

test('entry checklist saves defects and not-applicable results, and refuses unanswered items',async()=>{
 const h=await harness();
 const change=async(label,value)=>act(async()=>view.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
 await change('Entrada: Touch','');await act(async()=>save().props.onClick());assert.equal(h.calls.length,0);
 await change('Entrada: Touch','Com defeito');await change('Entrada: Biometria / reconhecimento facial','Não se aplica');
 await act(async()=>save().props.onClick());
 assert.match(h.calls[0].args.p_payload.notes,/Touch: Com defeito/);
 assert.match(h.calls[0].args.p_payload.notes,/Biometria \/ reconhecimento facial: Não se aplica/);
 assert.match(h.calls[0].args.p_payload.notes,/Câmera traseira: Não testado/);
});

test('exit checklist is saved by the authorized workflow, restores separately, and blocks incomplete delivery',async()=>{
 const mobile={...orderA,equipment_type:'Celular'};
 const h=await harness({detail:mobile});
 const selects=view.root.findAllByType('select');
 const status=selects.find(node=>node.props.value==='em_andamento');
 await act(async()=>status.props.onChange({target:{value:'finalizada'}}));
 await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.equal(h.calls.length,0);assert.match(rendered(),/Complete o checklist/);
 await act(async()=>button('Marcar pendentes como não testados').props.onClick());
 await act(async()=>view.root.findByProps({'aria-label':'Saída: Touch'}).props.onChange({target:{value:'Funcionando'}}));
 await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.equal(h.calls[0].args.p_status,'finalizada');assert.match(h.calls[0].args.p_reason,/Touch: Funcionando/);
 assert.match(h.calls[0].args.p_reason,/Câmera traseira: Não testado/);
 await h.update({order:{...mobile,id:'other-os',approval_notes:h.calls[0].args.p_reason}});
 assert.equal(view.root.findByProps({'aria-label':'Saída: Touch'}).props.value,'Funcionando');
 const reason=view.root.findByType('textarea');assert.equal(reason.props.value,'');
});

test('OS list finds the registered number and filters by readable situation', async () => {
  const h = await harness({
    orders: [{ ...orderA, os_number: '00124', status: 'pronta' }, { ...orderB, os_number: '00125' }],
  });
  const rows = () => view.root.findAllByProps({ className: 'service-order-list-row' });
  const search = () => view.root.findByProps({ placeholder: 'Número, cliente ou equipamento' });
  const status = () => view.root.findByProps({ 'aria-label': 'Filtrar OS por situação' });
  assert.equal(rows().length, 2);
  await act(async () => search().props.onChange({ target: { value: 'OS #00124' } }));
  assert.equal(rows().length, 1);
  assert.deepEqual(rows()[0].findByProps({ className: 'service-order-status' }).children, ['Pronta']);
  await act(async () => status().props.onChange({ target: { value: 'aberta' } }));
  assert.equal(rows().length, 0);
  await act(async () => button('Limpar filtros').props.onClick());
  assert.equal(rows().length, 2);
  assert.equal(h.queries.length, 1);
});
