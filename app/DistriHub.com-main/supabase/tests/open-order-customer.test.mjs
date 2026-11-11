import { splitPaymentComponent } from './fixtures/split_payment_component.mjs';
import assert from 'node:assert/strict';
import { pdvHelpers } from './fixtures/pdv_helpers.mjs';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import TestRenderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(await readFile(new URL('../../src/components/partner/OpenOrdersModule.tsx', import.meta.url),'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020},
}).outputText,{
  exports:module.exports,
  require(name) {
    if(name==='../../lib/orderQuotePdf') return {prepareOrderQuoteLogo:async()=>{}};
    if(name==='./SplitPaymentFields') return splitPaymentComponent;
    if(name==='react')return React;
    if(name==='react/jsx-runtime')return jsx;
    if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});
    if(name==='../../utils')return {money:{format:String}};
    if(name==='../../lib/pdv')return pdvHelpers;
    if(name==='./SaleActionsMenu')return {SaleActionsMenu:props=>React.createElement('sale-actions',props)};
    return {};
  },
});
const sale={id:'order-one',user_id:'owner',branch_id:'branch',customer_id:'old',customer_name:'Antigo',status:'pre_venda',payment_status:'pendente',online_payment:false,total:100,items:[],created_at:'2026-10-07T12:00:00Z'};
const customers=[{id:'old',name:'Antigo',branch_id:null},{id:'new',name:'Novo',branch_id:'branch'},{id:'foreign',name:'Outra filial',branch_id:'other'}];
const button=(view,label)=>view.root.findAllByType('button').find(node=>node.children.includes(label));
test('customer selector filters branch, blocks duplicate saves and keeps the dialog open on server rejection',async()=>{
  const calls=[]; let reject;
  let view;
  await act(async()=>{view=TestRenderer.create(React.createElement(module.exports.OpenOrdersModule,{
    canEditPrice:false,products:[],sales:[sale],customers,salespeople:[],currentRole:'caixa',
    onUpdateCustomer:(...args)=>{calls.push(args);return new Promise((resolve,fail)=>{reject=fail;});},
  }));});
  try{
    assert.equal(button(view,'Alterar cliente'),undefined);
    act(()=>view.root.findByType('sale-actions').props.onChangeCustomer());
    const select=view.root.findByProps({value:'old'});
    assert.equal(select.findAllByType('option').some(option=>option.props.value==='foreign'),false);
    act(()=>select.props.onChange({target:{value:'new'}}));
    act(()=>{button(view,'Salvar cliente').props.onClick();button(view,'Salvar cliente').props.onClick();});
    assert.deepEqual(calls,[['order-one','new']]);
    assert.equal(button(view,'Cancelar').props.disabled,true);
    await act(async()=>reject(new Error('Pedido já finalizado')));
    assert.equal(view.root.findByProps({role:'alert'}).children.join(''),'Pedido já finalizado');
    assert.equal(button(view,'Salvar cliente').props.disabled,false);
    assert.equal(view.root.findByProps({role:'dialog'}).props['aria-modal'],'true');
  }finally{act(()=>view.unmount());}
});
test('customer change is shown for unpaid open orders and hidden for paid orders and logistics operators',()=>{
  for(const [status,payment_status,currentRole,expected] of [['aberta','pendente','vendedor',true],['pre_venda','pago','caixa',false],['pre_venda','pendente','logistica',false]]){
    let view;
    act(()=>{view=TestRenderer.create(React.createElement(module.exports.OpenOrdersModule,{canEditPrice:false,products:[],sales:[{...sale,status,payment_status}],customers,salespeople:[],currentRole}));});
    try{assert.equal(Boolean(view.root.findByType('sale-actions').props.onChangeCustomer),expected);}
    finally{act(()=>view.unmount());}
  }
});
