import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require=createRequire(import.meta.url);
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
const pdv={},filters={},editor={},mod={};
let quoteCalls=[]; let quoteFailure=null; let quotePending=null;
vm.runInNewContext(compile(await readFile(new URL('../../src/lib/pdv.ts',import.meta.url),'utf8')),{exports:pdv});
vm.runInNewContext(compile(await readFile(new URL('../../src/lib/openOrderFilters.ts',import.meta.url),'utf8')),{exports:filters,Intl,Date});
let directEmail=false, emailPending=null; const emailCalls=[];
const load=name=>{
 if(name==='../../lib/orderEmail')return {get directOrderEmailEnabled(){return directEmail;},sendOrderQuoteEmail:async id=>{emailCalls.push(id);if(emailPending)await emailPending;return 'Aceito pelo serviço de e-mail';}};
 if(name==='../../lib/pdv')return pdv;
 if(name==='../../lib/openOrderFilters')return filters;
 if(name==='../../utils')return {money:{format:String}};
 if(name==='./SaleActionsMenu')return {SaleActionsMenu:props=>React.createElement('sale-actions',props)};
 if(name==='./OpenOrderItemsEditor')return editor;
 if(name==='./SplitPaymentFields')return {SplitPaymentFields:()=>null};
 if(name==='./SalePriceInput')return {SalePriceInput:()=>null};
 if(name==='../../lib/salePrint'||name==='../../lib/saleShare')return {};
 if(name==='../../lib/orderQuotePdf')return {downloadOrderQuotePdf:async(...args)=>{quoteCalls.push(args);if(quotePending)await quotePending;if(quoteFailure)throw quoteFailure;}};
 return require(name);
};
vm.runInNewContext(compile(await readFile(new URL('../../src/components/partner/OpenOrderItemsEditor.tsx',import.meta.url),'utf8')),{exports:editor,require:load});
vm.runInNewContext(compile(await readFile(new URL('../../src/components/partner/OpenOrdersModule.tsx',import.meta.url),'utf8')),{exports:mod,Date,Error,require:load});
const sale={id:'order-one',user_id:'owner',branch_id:'branch',customer_id:'customer',customer_name:'Cliente A',status:'pre_venda',payment_status:'pendente',online_payment:false,total:100,freight_fee:15,items:[{product_id:'product',name:'Produto',quantity:1,unit_price:100}],created_at:'2026-10-14T15:00:00Z',payment_method:'pix'};
const product={id:'product',branch_id:'branch',name:'Produto',sale_price:100,wholesale_price:90,stock:10};
const base={canEditPrice:false,products:[product],sales:[sale],customers:[],salespeople:[],currentRole:'administrador',onUpdateItems:async()=>{},onUpdateCustomer:async()=>{},onFinalizePreSale:async()=>{},onCancelSale:async()=>{},onDeleteSale:async()=>{}};
let view;afterEach(async()=>{if(view)await act(async()=>view.unmount());view=null;});
const mount=async(props={})=>act(async()=>{view=TestRenderer.create(React.createElement(mod.OpenOrdersModule,{...base,...props}));});
const button=text=>view.root.findAllByType('button').find(node=>node.children.some(child=>typeof child==='string'&&child.trim()===text));
const rendered=()=>JSON.stringify(view.toJSON());

test('download do orçamento usa o pedido e cliente vinculados sem finalizar ou imprimir',async()=>{
 quoteCalls=[];quoteFailure=null;quotePending=null;let finalized=0;
 await mount({customers:[{id:'customer',name:'Cliente A',email:'a@example.com'}],onFinalizePreSale:async()=>{finalized++;}});
 await act(async()=>view.root.findByType('sale-actions').props.onDownloadQuote());
 assert.equal(quoteCalls.length,1);assert.equal(quoteCalls[0][0].id,sale.id);assert.equal(quoteCalls[0][1].customer.email,'a@example.com');
 assert.equal(finalized,0);assert.match(rendered(),/Download do orçamento iniciado/);
});
test('download duplicado é bloqueado e falha oferece nova tentativa sem mensagem de sucesso',async()=>{
 quoteCalls=[];quoteFailure=new Error('Falha ao gerar PDF');let release;quotePending=new Promise(resolve=>{release=resolve;});
 await mount();const download=view.root.findByType('sale-actions').props.onDownloadQuote;
 await act(async()=>{download();download();});assert.equal(quoteCalls.length,1);
 await act(async()=>release());assert.match(rendered(),/Falha ao gerar PDF/);assert.doesNotMatch(rendered(),/Download do orçamento iniciado/);
 assert.equal(typeof view.root.findByType('sale-actions').props.onDownloadQuote,'function');quoteFailure=null;quotePending=null;
});

test('business date filter includes all of the Sao Paulo day and excludes adjoining days independent of browser zone',()=>{
 for(const date of ['2026-10-14T03:00:00Z','2026-10-15T02:59:59.999Z','2026-10-14T15:00:00Z'])assert.equal(filters.orderMatchesDate(date,'2026-10-14','2026-10-14'),true);
 for(const date of ['2026-10-14T02:59:59.999Z','2026-10-15T03:00:00Z','invalid'])assert.equal(filters.orderMatchesDate(date,'2026-10-14','2026-10-14'),false);
});
test('actual filter retains today midday and rejects inverted range visibly',async()=>{
 await mount({sales:[sale,{...sale,id:'older',created_at:'2026-10-13T15:00:00Z'}]});await act(async()=>{const dates=view.root.findAllByProps({type:'date'});dates[0].props.onChange({target:{value:'2026-10-14'}});dates[1].props.onChange({target:{value:'2026-10-14'}});});
 await act(async()=>button('Pesquisar').props.onClick());assert.equal(view.root.findAllByType('sale-actions').length,1);
 await act(async()=>view.root.findAllByProps({type:'date'})[0].props.onChange({target:{value:'2026-10-15'}}));await act(async()=>button('Pesquisar').props.onClick());assert.match(rendered(),/data inicial deve ser/);
 await act(async()=>button('Limpar período').props.onClick());
 assert.ok(view.root.findAllByProps({type:'date'}).every(input=>input.props.value===''));
 assert.equal(view.root.findAllByType('sale-actions').length,2);
 assert.doesNotMatch(rendered(),/data inicial deve ser/);
});
test('owner can self-authorize without registered supervisors or a PIN',async()=>{
 const calls=[];await mount({onCancelSale:async(...args)=>calls.push(args)});await act(async()=>view.root.findByType('sale-actions').props.onCancel());
 assert.equal(button('Cancelar Pedido').props.disabled,false);assert.equal(view.root.findAllByProps({type:'password'}).length,0);
 await act(async()=>button('Cancelar Pedido').props.onClick());assert.deepEqual(calls,[['order-one',undefined,undefined]]);assert.match(rendered(),/cancelado/);
});
test('cashier supplies supervisor separately, duplicate cancel/delete calls are blocked synchronously, fields and close are locked',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});const calls=[];
 await mount({currentRole:'caixa',salespeople:[{id:'manager',name:'Gerente',role:'gerente',branch_id:'branch',is_active:true}],onCancelSale:async(...args)=>{calls.push(args);await pending;},onDeleteSale:async()=>{throw new Error('must not delete');}});
 await act(async()=>view.root.findByType('sale-actions').props.onCancel());await act(async()=>view.root.findByProps({type:'password'}).props.onChange({target:{value:'9876'}}));
 const cancel=button('Cancelar Pedido').props.onClick,remove=button('Apagar').props.onClick;let first;
 await act(async()=>{first=cancel();cancel();remove();});assert.deepEqual(calls,[['order-one','manager','9876']]);assert.equal(view.root.findByProps({type:'password'}).props.disabled,true);
 await act(async()=>view.root.findByProps({className:'modal-header'}).findByType('button').props.onClick());assert.equal(view.root.findAllByProps({className:'modal-backdrop'}).length,1);
 await act(async()=>{release();await first;});assert.equal(view.root.findAllByProps({className:'modal-backdrop'}).length,0);
});
test('replacing the authorized list clears old modal; inactive screen also clears dialog',async()=>{
 await mount();await act(async()=>button('Finalizar').props.onClick());
 await act(async()=>view.update(React.createElement(mod.OpenOrdersModule,{...base,sales:[{...sale,id:'other',branch_id:'other'}]})));assert.equal(button('Confirmar Venda'),undefined);
 await act(async()=>button('Finalizar').props.onClick());
 await act(async()=>view.update(React.createElement(mod.OpenOrdersModule,{...base,isActive:false})));assert.equal(button('Confirmar Venda'),undefined);
});
test('finalization cannot be closed or replaced while pending; payment and row actions lock and confirmation remains visible',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});let calls=0;
 await mount({sales:[sale,{...sale,id:'order-two'}],onFinalizePreSale:async()=>{calls++;await pending;}});await act(async()=>button('Finalizar').props.onClick());
 const confirm=button('Confirmar Venda').props.onClick;let first;await act(async()=>{first=confirm();confirm();});assert.equal(calls,1);
 const modal=view.root.findByProps({className:'modal-content'});assert.equal(modal.findByType('select').props.disabled,true);
 await act(async()=>view.root.findByProps({className:'modal-backdrop'}).props.onClick());assert.ok(button('Finalizando...'));
 await act(async()=>{release();await first;});assert.match(rendered(),/ORDER-ON.*finalizado/);assert.equal(button('Confirmar Venda'),undefined);
});
test('late failure from unmounted order view cannot contaminate a fresh branch view',async()=>{
 let reject;const pending=new Promise((_resolve,fail)=>{reject=fail;});await mount({onCancelSale:()=>pending});await act(async()=>view.root.findByType('sale-actions').props.onCancel());
 let action;await act(async()=>{action=button('Cancelar Pedido').props.onClick();});await act(async()=>view.unmount());
 await mount({sales:[{...sale,id:'new',branch_id:'branch-b'}]});await act(async()=>{reject(new Error('Erro antigo'));await action;});assert.doesNotMatch(rendered(),/Erro antigo/);
});
test('item editor separates merchandise and freight and displays the exact charged total',async()=>{
 await act(async()=>{view=TestRenderer.create(React.createElement(editor.OpenOrderItemsEditor,{canEditPrice:false,sale,products:[product],onSave:async()=>{},onClose(){}}));});
 assert.equal(view.root.findByProps({className:'pdv-total-bar'}).findByType('strong').children.join(''),'115');assert.match(rendered(),/Subtotal:/);assert.match(rendered(),/Frete:/);
});

test('direct quote email submits only the saved ID and blocks double click while sending',async()=>{
 directEmail=true;emailCalls.length=0;let release;emailPending=new Promise(resolve=>{release=resolve;});
 try {
  await mount();
  const actions=()=>view.root.findByType('sale-actions').props;
  await act(async()=>{actions().onEmail();actions().onEmail();});
  assert.deepEqual(emailCalls,['order-one']);
  assert.ok(rendered().includes('Enviando'));
  await act(async()=>{release();await emailPending;});
  assert.ok(rendered().includes('Aceito pelo servi\u00e7o de e-mail'));
 } finally {directEmail=false;emailPending=null;}
});
