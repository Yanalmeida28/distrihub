// Regression tests: real checkout components and real persisted drafts, synthetic data.
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require=createRequire(new URL('./package.json',import.meta.url));
const TestRenderer=require('react-test-renderer');
const { act }=TestRenderer;
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
const storage=new Map();
const durableValues=new Map();
const localStorage={getItem:key=>durableValues.get(key)??null,setItem:(key,value)=>durableValues.set(key,value),removeItem:key=>durableValues.delete(key),get length(){return durableValues.size;},key:index=>[...durableValues.keys()][index]??null};
const navigator={onLine:true};
const networkListeners=new Map();
const window={sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key),get length(){return storage.size;},key:index=>[...storage.keys()][index]??null},setTimeout:()=>1,clearTimeout(){},open:()=>null};
Object.assign(window,{localStorage,addEventListener(event,callback){if(!networkListeners.has(event))networkListeners.set(event,new Set());networkListeners.get(event).add(callback);},removeEventListener(event,callback){networkListeners.get(event)?.delete(callback);}});
const drafts={};
vm.runInNewContext(compile(await readFile(new URL('../../src/hooks/useSessionDraft.tsx',import.meta.url),'utf8')),{exports:drafts,window,console,Error,require});
const helpers={};
vm.runInNewContext(compile(await readFile(new URL('../../src/lib/pdv.ts',import.meta.url),'utf8')),{exports:helpers,Error});
const components={};
vm.runInNewContext(compile(await readFile(new URL('../../src/components/partner/PdvModule.tsx',import.meta.url),'utf8')+'\nexports.Checkout=PdvCheckout;'),{exports:components,window,navigator,console,Error,setTimeout:()=>1,require(name){
 if(name==='../../hooks/useSessionDraft')return drafts;
 if(name==='../../lib/pdv')return helpers;
 if(name==='../../lib/salePrint')return {printSale(){},directReceiptEnabled:()=>false};
 if(name==='../../utils')return {money:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})};
 if(name==='./PreSaleCheckout')return {};
 if(name==='./SplitPaymentFields')return {SplitPaymentFields:()=>null};
 if(name==='./SalePriceInput')return {SalePriceInput:()=>null};
 return require(name);
}});
let view;
afterEach(async()=>{if(view)await act(async()=>view.unmount());view=null;navigator.onLine=true;});
const product={id:'product',name:'Produto A',sku:'A',stock:10,branch_id:'branch',sale_price:100,wholesale_price:80};
const base={products:[product],customers:[],salespeople:[],credits:[],sales:[],selectedBranchId:'branch',segment:'assistencia',canCheckout:true,canEditPrice:false,onCreatePreSale:async()=>{},onFinalizePreSale:async()=>{},onCancelSale:async()=>{},onDeleteSale:async()=>{},onPullToPdv(){}};
const wrapped=(component,props,scope,key='before')=>React.createElement(drafts.SessionDraftProvider,{scope},React.createElement(component,{...props,key}));
const add=async()=>act(async()=>view.root.findAllByType('button').find(node=>node.props.className==='pdv-product-card').props.onClick());

test('offline PDV keeps cart editable but refuses checkout and saved orders until the network returns',async()=>{
 const scope='offline-connectivity:company:workspace:branch';let created=0,orders=0;
 navigator.onLine=false;
 await act(async()=>{view=TestRenderer.create(wrapped(components.PdvModule,{...base,currentRole:'gerente',onCreatePreSale:async()=>{orders++;},onCreateSale:async sale=>{created++;return {...sale,id:'confirmed-id'};}},scope));});
 await add();
 const checkout=view.root.findByProps({className:'module-cancel-btn pdv-checkout-btn'});
 assert.equal(checkout.props.disabled,true);
 await act(async()=>checkout.props.onClick());
 await act(async()=>view.root.findByProps({className:'module-cancel-btn pdv-checkout-btn pdv-save-order-btn'}).props.onClick());
 assert.equal(created,0);assert.equal(orders,0);
 assert.match(JSON.stringify(view.toJSON()),/Sem internet/);
 assert.match(storage.get('distrihub:draft:'+scope+':pdv:branch:checkout:cart'),/product/);
 await act(async()=>{navigator.onLine=true;for(const callback of networkListeners.get('online')??[])callback();});
 assert.equal(view.root.findByProps({className:'module-cancel-btn pdv-checkout-btn'}).props.disabled,false);
 await act(async()=>view.root.findByProps({className:'module-cancel-btn pdv-checkout-btn'}).props.onClick());
 assert.equal(created,1);
 assert.equal(new helpers.PdvCartBackupStore(localStorage,scope+':pdv:branch').list().length,0);
});

test('closing the tab preserves a recoverable cart, never silently submits it, and confirmation removes the backup',async()=>{
 const scope='closed-tab:company:workspace:branch';let created=0;
 const props={...base,currentRole:'gerente',onCreateSale:async sale=>{created++;return {...sale,id:'confirmed-after-recovery'};}};
 await act(async()=>{view=TestRenderer.create(wrapped(components.PdvModule,props,scope));});await add();
 await act(async()=>view.unmount());view=null;
 for(const key of [...storage.keys()].filter(key=>key.includes(scope)))storage.delete(key);
 // A fresh module represents a closed JS runtime, not merely a React remount.
 const fresh={};vm.runInNewContext(compile(await readFile(new URL('../../src/hooks/useSessionDraft.tsx',import.meta.url),'utf8')),{exports:fresh,window,console,Error,require});Object.assign(drafts,fresh);
 await act(async()=>{view=TestRenderer.create(wrapped(components.PdvModule,props,scope));});
 assert.equal(created,0);
 const recover=view.root.findAllByType('button').find(button=>button.children.includes('Recuperar carrinho'));
 assert(recover);
 await act(async()=>recover.props.onClick());
 assert.match(storage.get('distrihub:draft:'+scope+':pdv:branch:checkout:cart'),/product/);
 assert.equal(created,0);
 await act(async()=>view.root.findByProps({className:'module-cancel-btn pdv-checkout-btn'}).props.onClick());
 assert.equal(created,1);assert.equal(new helpers.PdvCartBackupStore(localStorage,scope+':pdv:branch').list().length,0);
});
test('operator switch preserves PDV tab and cart while updating price permission',async()=>{
 const scope='operator-switch:company:workspace:branch';
 const screen=(operator,role)=>wrapped(components.PdvModule,{...base,currentRole:role,activeSalespersonId:operator,canEditPrice:role==='gerente'},scope);
 await act(async()=>{view=TestRenderer.create(screen('manager','gerente'));});
 await act(async()=>view.root.findByProps({'aria-label':'Buscar produto por nome, SKU ou código de barras'}).props.onChange({target:{value:'Produto'}}));
 await add();
 assert.match(storage.get('distrihub:draft:'+scope+':pdv:branch:checkout:cart'),/product/);
 await act(async()=>view.update(screen('cashier','caixa')));
 assert.match(storage.get('distrihub:draft:'+scope+':pdv:branch:checkout:cart'),/product/);
 assert.equal(view.root.findAll(node=>typeof node.type==='function'&&node.type.name==='PdvCheckout')[0].props.canEditPrice,false);
 await act(async()=>view.update(screen('manager','gerente')));
 assert.match(storage.get('distrihub:draft:'+scope+':pdv:branch:checkout:cart'),/product/);
});

test('rescue uses the full checkout, preserves the other cart and finalizes the original sale', async () => {
 const scope = 'editable-rescue';
 const sale = { id: 'pre-original', status: 'pre_venda', sale_number: 7, branch_id: 'branch',
   customer_id: null, customer_name: 'Cliente', customer_type: 'varejo', delivery_type: 'balcao',
   items: [{ product_id: 'product', name: 'Produto A', quantity: 2, unit_price: 100 }], total: 200 };
 let created = 0, consumed = 0, finalized;
 const props = { ...base, currentRole: 'gerente', onCreateSale: async () => { created++; },
   onConsumePreSale: () => { consumed++; }, onFinalizePreSale: async (...args) => { finalized = args; } };
 await act(async () => { view = TestRenderer.create(wrapped(components.PdvModule, props, scope)); });
 await add();
 await act(async () => view.update(wrapped(components.PdvModule, { ...props, preSaleToCheckout: sale }, scope)));
 const checkout = view.root.findAll(node => typeof node.type === 'function' && node.type.name === 'PdvCheckout').find(node => node.props.rescuedSale);
 assert.ok(checkout);
 assert.ok(checkout.findByProps({ 'aria-label': 'Buscar produto por nome, SKU ou código de barras' }));
 assert.ok(checkout.findByProps({ 'aria-label': 'Tipo de atendimento da venda' }));
 await act(async () => checkout.findByProps({ 'aria-label': 'Aumentar quantidade de Produto A' }).props.onClick());
 await act(async () => checkout.findByProps({ className: 'module-cancel-btn pdv-checkout-btn' }).props.onClick());
 assert.equal(finalized[0], sale.id);
 assert.equal(finalized[3].items[0].quantity, 3);
 assert.equal(created, 0);
 assert.equal(consumed, 1);
 const normal = view.root.findAll(node => typeof node.type === 'function' && node.type.name === 'PdvCheckout');
 assert.equal(normal.length, 1);
 assert.equal(JSON.parse(storage.get('distrihub:draft:' + scope + ':pdv:branch:checkout:cart'))[0].quantity, 1);
});

test('rescued pre-sale saves corrections on its original ID without finalization and preserves the normal cart',async()=>{
 const scope='save-rescued-quote';let finalized=0,created=0,consumed=0,saves=0,saved,release;
 const sale={id:'save-original',status:'pre_venda',sale_number:8,branch_id:'branch',customer_id:null,customer_name:'Cliente',customer_type:'varejo',delivery_type:'balcao',items:[{product_id:'product',name:'Produto A',quantity:2,unit_price:100}],total:200};
 const props={...base,currentRole:'gerente',onCreateSale:async()=>{created++;},onFinalizePreSale:async()=>{finalized++;},onConsumePreSale:()=>{consumed++;},onUpdatePreSale:async(id,edits)=>{saves++;saved={id,edits};await new Promise(resolve=>{release=resolve;});}};
 await act(async()=>{view=TestRenderer.create(wrapped(components.PdvModule,props,scope));});await add();
 await act(async()=>view.update(wrapped(components.PdvModule,{...props,preSaleToCheckout:sale},scope)));
 const checkout=()=>view.root.findAll(node=>typeof node.type==='function'&&node.type.name==='PdvCheckout').find(node=>node.props.rescuedSale);
 await act(async()=>checkout().findByProps({'aria-label':'Aumentar quantidade de Produto A'}).props.onClick());
 const save=checkout().findByProps({className:'module-submit-btn pdv-save-presale-btn'}).props.onClick;
 await act(async()=>{save();save();});assert.equal(saves,1);assert.equal(saved.id,sale.id);assert.equal(saved.edits.items[0].quantity,3);assert.equal(saved.edits.total,300);
 assert.equal(checkout().findByType('fieldset').props.disabled,true);
 assert.equal(checkout().findByProps({className:'module-submit-btn pdv-save-presale-btn'}).props.disabled,true);
 await act(async()=>release());
 assert.equal(finalized,0);assert.equal(created,0);assert.equal(consumed,1);
 assert.match(JSON.stringify(view.toJSON()),/Pré-venda atualizada/);
 assert.equal(JSON.parse(storage.get('distrihub:draft:'+scope+':pdv:branch:checkout:cart'))[0].quantity,1);
 assert.equal([...storage.keys()].some(key=>key.includes(':rescued:save-original:checkout:cart')),false);
});

test('failed rescued pre-sale save retains corrections and never consumes or finalizes the order',async()=>{
 const sale={id:'save-rejected',status:'pre_venda',branch_id:'branch',customer_id:null,customer_name:'Cliente',customer_type:'varejo',delivery_type:'balcao',items:[{product_id:'product',name:'Produto A',quantity:2,unit_price:100}],total:200};
 let consumed=0,finalized=0;
 const props={...base,currentRole:'gerente',preSaleToCheckout:sale,onConsumePreSale:()=>{consumed++;},onFinalizePreSale:async()=>{finalized++;},onUpdatePreSale:async()=>{throw new Error('Sem permissão para alterar o preço');}};
 await act(async()=>{view=TestRenderer.create(wrapped(components.PdvModule,props,'save-rejected'));});
 const checkout=()=>view.root.findAll(node=>typeof node.type==='function'&&node.type.name==='PdvCheckout').find(node=>node.props.rescuedSale);
 await act(async()=>checkout().findByProps({'aria-label':'Aumentar quantidade de Produto A'}).props.onClick());
 await act(async()=>checkout().findByProps({className:'module-submit-btn pdv-save-presale-btn'}).props.onClick());
 assert.match(JSON.stringify(view.toJSON()),/Sem permissão/);assert.doesNotMatch(JSON.stringify(view.toJSON()),/Pré-venda atualizada/);
 assert.equal(consumed,0);assert.equal(finalized,0);assert.equal(checkout().findByType('fieldset').props.disabled,false);
 assert.ok([...storage.entries()].some(([key,value])=>key.includes(':rescued:save-rejected:checkout:cart')&&JSON.parse(value)[0].quantity===3));
});

test('confirmed recovery clears only the original checkout draft and cannot resubmit it',async()=>{
 let sale;
 const props={...base,isActive:true,hasPendingSale:false,onCreateSale:async value=>{sale=value;return {...value,id:'new-id'};}};
 await act(async()=>{view=TestRenderer.create(wrapped(components.Checkout,props,'audit-recovery'));});
 await act(async()=>view.root.findByProps({'aria-label':'Buscar produto por nome, SKU ou código de barras'}).props.onChange({target:{value:'Produto'}}));await add();
 storage.set('distrihub:draft:audit-recovery:presale:cart',JSON.stringify([{product_id:'unrelated'}]));
 drafts.clearConfirmedPdvDraft('audit-recovery','checkout');
 await act(async()=>view.update(wrapped(components.Checkout,props,'audit-recovery','after-confirmed-recovery')));
 assert.equal(view.root.findAllByProps({'aria-label':'Aumentar quantidade de Produto A'}).length,0);
 assert.match(storage.get('distrihub:draft:audit-recovery:presale:cart'),/unrelated/);
 await act(async()=>view.root.findByProps({className:'module-cancel-btn pdv-checkout-btn'}).props.onClick());
 assert.equal(sale,undefined);

});

test('Checkout applies the registered Premium table to the whole cart and blocks inactive customers',async()=>{
 const kind='Checkout';
 let submitted;
 const customers=[{id:'premium',name:'Cliente Premium',customer_type:'varejo',price_table:'premium',is_active:true},{id:'inactive',name:'Cliente Inativo',customer_type:'varejo',is_active:false}];
 const props={...base,products:[{...product,premium_price:140}],customers,isActive:true,onCreateSale:async value=>{submitted=value;return {...value,id:'sale'};}};
 await act(async()=>{view=TestRenderer.create(wrapped(components[kind],props,'premium-'+kind));});
 await act(async()=>view.root.findByProps({'aria-label':'Buscar produto por nome, SKU ou código de barras'}).props.onChange({target:{value:'Produto'}}));
 await add();
 const picker=()=>view.root.findAll(node=>typeof node.type==='function'&&node.type.name==='CustomerSearchPicker')[0];
 await act(async()=>picker().props.onSelect('premium'));
 assert.match(JSON.stringify(view.toJSON()),/140,00/);
 assert.match(JSON.stringify(view.toJSON()),/Tabela aplicada/);
 const input=()=>view.root.findAllByType('input').find(node=>node.props.id==='pdv-customer-search');
 await act(async()=>input().props.onChange({target:{value:'Inativo'}}));
 assert.equal(view.root.findAllByProps({role:'option'}).length,0);
 await act(async()=>picker().props.onSelect('premium'));
 await act(async()=>view.root.findByProps({className:'module-cancel-btn pdv-checkout-btn'}).props.onClick());
 assert.equal(submitted.items[0].unit_price,140);assert.equal(submitted.customer_type,'varejo');assert.equal(submitted.customer_id,'premium');assert.equal(submitted.draft_scope,'premium-'+kind);
});

test('Salvar pedido saves an open order without finalizing, clears the cart and opens Pedidos em aberto',async()=>{
 let saved,sold=false,opened=false;
 const props={...base,isActive:true,onCreateSale:async()=>{sold=true;},onCreatePreSale:async value=>{saved=value;return {...value,id:'pre'};},onOpenOrders:()=>{opened=true;}};
 await act(async()=>{view=TestRenderer.create(wrapped(components.Checkout,props,'save-order'));});
 await act(async()=>view.root.findByProps({'aria-label':'Buscar produto por nome, SKU ou código de barras'}).props.onChange({target:{value:'Produto'}}));
 await add();
 const button=view.root.findAllByType('button').find(node=>node.props.className?.includes('pdv-save-order-btn'));
 await act(async()=>button.props.onClick());
 assert.equal(saved.items[0].product_id,'product');assert.equal(saved.branch_id,'branch');assert.equal(saved.draft_scope,'save-order');
 assert.equal(sold,false);assert.equal(opened,true);
 assert.equal(view.root.findAllByProps({'aria-label':'Aumentar quantidade de Produto A'}).length,0);
});

test('Premium without a configured product price is blocked with a visible explanation',async()=>{
 const customers=[{id:'premium',name:'Premium',customer_type:'varejo',price_table:'premium'}];
 await act(async()=>{view=TestRenderer.create(wrapped(components.Checkout,{...base,customers},'missing-premium'));});
 await act(async()=>view.root.findByProps({'aria-label':'Buscar produto por nome, SKU ou código de barras'}).props.onChange({target:{value:'Produto'}}));
 await add();
 await act(async()=>view.root.findAll(node=>typeof node.type==='function'&&node.type.name==='CustomerSearchPicker')[0].props.onSelect('premium'));
 assert.match(JSON.stringify(view.toJSON()),/Defina um preço Premium/);
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/Tabela aplicada/);
});
