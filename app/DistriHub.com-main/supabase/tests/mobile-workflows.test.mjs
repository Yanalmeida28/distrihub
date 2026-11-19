import assert from 'node:assert/strict';
import {test} from 'node:test';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import {intelligenceHarness,payable} from './fixtures/business_intelligence_helpers.mjs';
const {AccountsModule}=intelligenceHarness().load('components/partner/AccountsModule.tsx');
test('collapsing mobile account filters retains values and totals, shows active counts and keeps invalid dates visible',async()=>{
 let view;try{
  await act(async()=>{view=Renderer.create(React.createElement(AccountsModule,{kind:'pagar',branchId:'A',invoices:[],branches:[{id:'A',name:'Centro'}],suppliers:[],payables:{accounts:[payable({branch_id:'A',category:'aluguel',amount:100})],loading:false,error:''}}));});
  const toggle=()=>view.root.findByProps({className:'rma-advance-btn mobile-filters-toggle'});
  const totals=()=>JSON.stringify(view.root.findByProps({className:'report-cards financial-accounts-totals'}).findAllByType('strong').map(n=>n.children));
  const before=totals();assert.equal(toggle().props['aria-expanded'],false);
  const id=toggle().props['aria-controls'];assert.ok(view.root.findByProps({id}));
  await act(async()=>toggle().props.onClick());assert.equal(toggle().props['aria-expanded'],true);assert.equal(totals(),before);
  await act(async()=>view.root.findByProps({'aria-label':'Vencimento de'}).props.onChange({target:{value:'2026-11-30'}}));
  await act(async()=>view.root.findByProps({'aria-label':'Vencimento até'}).props.onChange({target:{value:'2026-11-01'}}));
  await act(async()=>toggle().props.onClick());assert.equal(toggle().props['aria-expanded'],false);
  assert.match(JSON.stringify(toggle().children[0].children),/2 ativos/);
  assert.equal(view.root.findByProps({'aria-label':'Vencimento de'}).props.value,'2026-11-30');
  assert.ok(view.root.findAllByProps({role:'alert'}).some(n=>JSON.stringify(n.children).includes('data inicial')));
 }finally{if(view)await act(async()=>view.unmount());}
});
