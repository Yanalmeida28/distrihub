import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require=createRequire(import.meta.url);
const exports={};
const draftInitialValues=new Map();
const clipboard={read:async()=>[]};
const source=await readFile(new URL('../../src/components/partner/CadastrosModule.tsx',import.meta.url),'utf8');
vm.runInNewContext(ts.transpileModule(source+'\nexports.CustomerProfile=CustomerProfileModal; exports.Customers=CustomersSubTab;',{
  compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020},
}).outputText,{exports,Error,File,navigator:{clipboard},document:{body:{}},window:{alert(){},innerWidth:1024,innerHeight:768},require(name){
  if(name==='react-dom')return {createPortal:children=>children};
  if(name==='../../utils')return {money:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),formatCpf:v=>v??'',formatCnpj:v=>v??'',normalizeDocument:v=>v??''};
  if(name==='../../lib/productNames')return {normalizeProductName:value=>String(value??'')};
  if(name==='../../hooks/useSessionDraft')return { useSessionDraftState: (key, initial) => React.useState(draftInitialValues.has(key)?draftInitialValues.get(key):initial) };
  if(name==='./ImportExportModule')return {ExportButtons:()=>null};
  if(name==='./ProductProfitPreview')return {ProductProfitPreview:()=>null};
  if(name==='./ProductPhotoField')return {ProductPhotoField:()=>null};
  if(name==='./ProductLabelModal')return {ProductLabelModal:()=>null};
  if(name==='./CustomerPhoto')return {CustomerPhoto:props=>React.createElement('photo-preview',props),CustomerPhotoViewer:props=>React.createElement('photo-viewer',props)};
  if(name==='../../lib/cadastroXml')return {};
  if(name==='../../lib/saleReturns')return {};
  return require(name);
}});
let renderer;
afterEach(async()=>{if(renderer)await act(async()=>renderer.unmount());renderer=null;draftInitialValues.clear();});
const customer={id:'customer',name:'Cliente',user_id:'owner',branch_id:null,person_type:'PF',customer_type:'varejo',credit_limit:0,allow_credit:false};

test('customer history requests its data on demand, not while opening the directory',async()=>{
 let requests=0;
 await act(async()=>{renderer=TestRenderer.create(React.createElement(exports.Customers,{customers:[customer],branches:[],sales:[],salespeople:[],rmaRequests:[],onAdd:async()=>{},onUpdate:async()=>{},onDelete:async()=>{},onLoadCustomer:async()=>customer,onRequestHistory:()=>{requests++;}}));});
 assert.equal(requests,0);
 const actions=renderer.root.findByProps({'aria-label':'Ações de Cliente'});
 await act(async()=>actions.props.onClick({currentTarget:{getBoundingClientRect:()=>({left:0,right:300,top:100,bottom:140})}}));
 const history=renderer.root.findAllByType('button').find(b=>b.children.some(c=>typeof c==='string'&&c.includes('Histórico de Compras')));
 await act(async()=>history.props.onClick());assert.equal(requests,1);
});
test('customer actions open and close the enlarged saved photo without entering edit or saving',async()=>{
 let writes=0;
 const full={...customer,photo_url:'owner/customer/photo.png'};
 await act(async()=>{renderer=TestRenderer.create(React.createElement(exports.Customers,{customers:[customer],branches:[],sales:[],salespeople:[],rmaRequests:[],onAdd:async()=>{writes++;},onUpdate:async()=>{writes++;},onDelete:async()=>{},onLoadCustomer:async()=>full}));});
 await act(async()=>renderer.root.findByProps({'aria-label':'Visualizar foto de Cliente'}).props.onClick());
 assert.equal(renderer.root.findByType('photo-viewer').props.path,full.photo_url);
 assert.equal(renderer.root.findAllByType('form').length,0);
 assert.equal(writes,0);
 await act(async()=>renderer.root.findByType('photo-viewer').props.onClose());
 assert.equal(renderer.root.findAllByType('photo-viewer').length,0);
});
test('camera exposes only paste/remove, previews the pasted photo and saves it',async()=>{
 let saved;
 await open(async(id,updates)=>{saved=updates;});
 const picker=()=>renderer.root.findByProps({'aria-label':'Opções da foto do cliente'});
 assert.equal(renderer.root.findAllByProps({type:'file'}).length,0);
 assert.equal(renderer.root.findAllByProps({role:'menu'}).length,0);
 await act(async()=>picker().props.onClick());
 assert.equal(renderer.root.findAllByProps({role:'menuitem'}).length,2);
 const file=new File(['photo'],'foto.png',{type:'image/png'});
 clipboard.read=async()=>[{types:['image/png'],getType:async()=>file}];
 await act(async()=>renderer.root.findAllByProps({role:'menuitem'}).find(node=>node.children.includes('Colar foto')).props.onClick());
 const pasted=renderer.root.findByType('photo-preview').props.file;
 assert.equal(pasted.type,'image/png');
 assert.equal(pasted.size,file.size);
 assert.equal(renderer.root.findAllByProps({role:'menu'}).length,0);
 await act(async()=>picker().props.onClick());
 await act(async()=>picker().props.onClick());
 await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.equal(saved.photo_file,pasted);
});
test('invalid photos show a useful error and retain the current photo',async()=>{
 await open(async()=>{});
 const avatar=renderer.root.findByProps({className:'customer-avatar'});
 await act(async()=>avatar.props.onPaste({preventDefault(){},clipboardData:{files:[{type:'image/png',size:3*1024*1024}]}}));
 assert.equal(renderer.root.findByType('photo-preview').props.file,null);
 assert.ok(renderer.root.findAllByType('p').some(p=>p.children.join('').includes('até 2 MB')));
});
test('camera pastes with the keyboard and removes the preview without submitting the form',async()=>{
 let saved;
 await open(async(id,updates)=>{saved=updates;});
 const file=new File(['photo'],'foto.png',{type:'image/png'});
 await act(async()=>renderer.root.findByProps({className:'customer-avatar'}).props.onPaste({preventDefault(){},clipboardData:{files:[file]}}));
 assert.equal(renderer.root.findByType('photo-preview').props.file,file);
 await act(async()=>renderer.root.findByProps({'aria-label':'Opções da foto do cliente'}).props.onClick());
 await act(async()=>renderer.root.findAllByProps({role:'menuitem'}).find(node=>node.children.includes('Remover foto')).props.onClick());
 assert.equal(renderer.root.findByType('photo-preview').props.removed,true);
 assert.equal(saved,undefined);
 await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.equal(saved.remove_photo,true);
 assert.equal(saved.photo_file,null);
});
test('clipboard permission failure displays a paste alternative and keeps the dialog open',async()=>{
 await open(async()=>{});
 clipboard.read=async()=>{const error=new Error('denied');error.name='NotAllowedError';throw error;};
 await act(async()=>renderer.root.findByProps({'aria-label':'Opções da foto do cliente'}).props.onClick());
 await act(async()=>renderer.root.findAllByProps({role:'menuitem'}).find(node=>node.children.includes('Colar foto')).props.onClick());
 assert.ok(renderer.root.findAllByType('p').some(node=>node.children.join('').includes('Ctrl+V')));
 assert.equal(renderer.root.findByType('photo-preview').props.file,null);
});
async function open(onUpdate,onClose=()=>{}){
  await act(async()=>{renderer=TestRenderer.create(React.createElement(exports.CustomerProfile,{customer,sales:[],salespeople:[],rmaRequests:[],onUpdate,onClose}));});
  await act(async()=>renderer.root.findAllByType('button').find(b=>b.children.includes('Dados Financeiros')).props.onClick());
}
test('customer credit input can be cleared and saves a numeric limit with billed sales enabled',async()=>{
  let saved,closed=false;
  await open(async(id,updates)=>{saved={id,...updates};},()=>{closed=true;});
  const input=()=>renderer.root.findByProps({'aria-label':'Limite de crédito (R$)'});
  await act(async()=>input().props.onChange({target:{value:''}}));
  assert.equal(input().props.value,'');
  await act(async()=>input().props.onChange({target:{value:'1500.25'}}));
  await act(async()=>renderer.root.findByProps({'aria-label':'Permitir venda faturada'}).props.onChange({target:{value:'sim'}}));
  await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(saved.credit_limit,1500.25);
  assert.equal(saved.allow_credit,true);
  assert.equal(saved.branch_id,null);
  assert.equal(closed,true);
});
test('a failed customer credit save keeps the limit visible for retry and does not close the dialog',async()=>{
  let closed=false;
  await open(async()=>{throw new Error('Falha temporária');},()=>{closed=true;});
  await act(async()=>renderer.root.findByProps({'aria-label':'Limite de crédito (R$)'}).props.onChange({target:{value:'500'}}));
  await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(renderer.root.findByProps({'aria-label':'Limite de crédito (R$)'}).props.value,'500');
  assert.equal(closed,false);
  assert.ok(renderer.root.findAllByType('p').some(p=>p.children.includes('Falha temporária')));
});

async function openCustomerForm({branches,selectedBranchId='',onAdd=async()=>{}}) {
  await act(async()=>{renderer=TestRenderer.create(React.createElement(exports.Customers,{
    branches,selectedBranchId,customers:[],sales:[],salespeople:[],rmaRequests:[],onAdd,onUpdate:async()=>{},onDelete:async()=>{},onLoadCustomer:async()=>customer,
  }));});
  await act(async()=>renderer.root.findAllByType('button').find(button=>button.children.some(child=>typeof child==='string'&&child.includes('Novo Cliente'))).props.onClick());
  await act(async()=>renderer.root.findAllByType('label').find(label=>label.children.includes('Nome Completo / Razão Social')).findByType('input').props.onChange({target:{value:'Cliente novo'}}));
}
const saveCustomer=async()=>act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));

test('cadastro consolidado seleciona a única filial e salva o cliente com ela',async()=>{
  let saved;
  await openCustomerForm({branches:[{id:'branch',name:'Matriz'}],onAdd:async payload=>{saved=payload;}});
  assert.equal(renderer.root.findByProps({'aria-label':'Filial do cliente'}).props.value,'branch');
  await saveCustomer();
  assert.equal(saved.branch_id,'branch');assert.equal(saved.name,'Cliente novo');
  assert.equal(renderer.root.findAllByType('form').length,0);
});

test('cadastro com várias filiais preserva os dados e permite escolher a filial dentro do formulário',async()=>{
  let saved;
  await openCustomerForm({branches:[{id:'a',name:'Centro'},{id:'b',name:'Norte'}],onAdd:async payload=>{saved=payload;}});
  await saveCustomer();
  assert.equal(saved,undefined);
  assert.match(renderer.root.findByProps({role:'alert'}).children.join(''),/filial do cliente/);
  assert.equal(renderer.root.findAllByType('label').find(label=>label.children.includes('Nome Completo / Razão Social')).findByType('input').props.value,'Cliente novo');
  await act(async()=>renderer.root.findByProps({'aria-label':'Filial do cliente'}).props.onChange({target:{value:'b'}}));
  await saveCustomer();assert.equal(saved.branch_id,'b');
});

test('filial ativa permanece fixa no formulário de novo cliente',async()=>{
  let saved;
  await openCustomerForm({branches:[{id:'a',name:'Centro'},{id:'b',name:'Norte'}],selectedBranchId:'a',onAdd:async payload=>{saved=payload;}});
  assert.equal(renderer.root.findByProps({'aria-label':'Filial do cliente'}).props.disabled,true);
  await saveCustomer();assert.equal(saved.branch_id,'a');
});

test('sem filial cadastrada não envia cliente e mostra onde cadastrar uma filial',async()=>{
  let calls=0;
  await openCustomerForm({branches:[],onAdd:async()=>{calls++;}});
  await saveCustomer();assert.equal(calls,0);
  assert.match(renderer.root.findByProps({role:'alert'}).children.join(''),/Configurações/);
  assert.equal(renderer.root.findAllByType('form').length,1);
});

test('edição restaurada de cliente compartilhado salva sem filial e não cria outro cliente',async()=>{
  draftInitialValues.set('customers:show-form',true);
  draftInitialValues.set('customers:editing-id','customer');
  draftInitialValues.set('customers:name','Cliente atualizado');
  let saved;
  await act(async()=>{renderer=TestRenderer.create(React.createElement(exports.Customers,{
    branches:[{id:'a',name:'Centro'},{id:'b',name:'Norte'}],selectedBranchId:'',customers:[customer],sales:[],salespeople:[],rmaRequests:[],
    onAdd:async()=>assert.fail('Não deve criar outro cliente'),onUpdate:async(id,payload)=>{saved={id,...payload};},onDelete:async()=>{},onLoadCustomer:async()=>customer,
  }));});
  await saveCustomer();
  assert.equal(saved.id,'customer');assert.equal(saved.branch_id,null);assert.equal(saved.name,'Cliente atualizado');
  assert.equal(renderer.root.findAllByType('form').length,0);
});
