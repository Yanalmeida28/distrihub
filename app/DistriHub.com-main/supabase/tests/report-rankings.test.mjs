import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
import { intelligenceHarness, sale, product } from './fixtures/business_intelligence_helpers.mjs';
const require=createRequire(import.meta.url),h=intelligenceHarness();
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../src/components/partner/ReportsModule.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText,{exports,Date,Intl,require(name){
 if(name==='../../utils')return {money:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})};
 if(name==='../../hooks/useStagnantStock')return {useStagnantStock:()=>({items:[],count:0})};
 if(name==='./ReportSalesBreakdown')return h.load('components/partner/ReportSalesBreakdown.tsx');
 if(name==='./CrmWorkspace')return {CrmWorkspace:()=>null};
 if(name.startsWith('../../lib/'))return h.load('lib/'+name.split('/').at(-1)+'.ts');
 return require(name);
}});
const now=new Date().toISOString();
const products=Array.from({length:12},(_,i)=>product({id:'service-'+i,name:'Service '+i,is_service:true}));
const customers=Array.from({length:12},(_,i)=>({id:'customer-'+i,name:'Customer '+i}));
const sales=products.map((p,i)=>sale({id:'sale-'+i,created_at:now,completed_at:now,customer_id:customers[i].id,customer_name:customers[i].name,total:(i+1)*100,items:[{product_id:p.id,quantity:1,unit_price:(i+1)*100}]}));
const invalid=[sale({id:'cancelled',customer_id:'bad',status:'cancelada',created_at:now,completed_at:now,total:99999,items:[{product_id:'bad',quantity:1,unit_price:99999}]}),sale({id:'old',customer_id:'old',created_at:'2000-01-01T12:00:00Z',completed_at:'2000-01-01T12:00:00Z',total:99999,items:[{product_id:'old',quantity:1,unit_price:99999}]})];
const props={sales:[...sales,...invalid],products:[...products,product({id:'bad',name:'Cancelled service',is_service:true}),product({id:'old',name:'Old service',is_service:true})],customers:[...customers,{id:'bad',name:'Cancelled customer'},{id:'old',name:'Old customer'}],salespeople:[]};
const names=(r,index=0)=>r.root.findAllByProps({className:'ranking-list'})[index].findAllByProps({className:'ranking-item'}).map(item=>item.findByType('strong').children.join(''));
test('customer report lists the ten largest customers and respects its existing period and customer filters',async()=>{
 let r;try{
  await act(async()=>{r=Renderer.create(React.createElement(exports.ReportsModule,{...props,initialTab:'crm'}));});
  assert.deepEqual(names(r),Array.from({length:10},(_,i)=>'Customer '+(11-i)));
  assert.match(JSON.stringify(r.toJSON()),/Top 10 Clientes/);
  await act(async()=>r.root.findByProps({'aria-label':'Filtrar cliente no relat\u00f3rio'}).props.onChange({target:{value:'customer-4'}}));
  assert.deepEqual(names(r),['Customer 4']);
  await act(async()=>r.update(React.createElement(exports.ReportsModule,{...props,initialTab:'crm',sales:[]})));assert.deepEqual(names(r),[]);
 }finally{if(r)await act(async()=>r.unmount());}
});
test('service report lists ten services by revenue without mixing products or cancelled and old sales',async()=>{
 let r;try{
  await act(async()=>{r=Renderer.create(React.createElement(exports.ReportsModule,{...props,products:[...props.products,product({id:'physical',name:'Physical product',is_service:false})],sales:[...props.sales,sale({id:'physical-sale',created_at:now,completed_at:now,total:50000,items:[{product_id:'physical',quantity:1,unit_price:50000}]})]}));});
  assert.deepEqual(names(r,1),Array.from({length:10},(_,i)=>'Service '+(11-i)));
  assert.match(JSON.stringify(r.toJSON()),/Top 10 Servi/);
  await act(async()=>r.root.findByProps({'aria-label':'Filtrar produto no relat\u00f3rio'}).props.onChange({target:{value:'service-4'}}));assert.deepEqual(names(r,1),['Service 4']);
  await act(async()=>r.update(React.createElement(exports.ReportsModule,{...props,sales:[]})));assert.deepEqual(names(r,1),[]);
 }finally{if(r)await act(async()=>r.unmount());}
});

const physical=Array.from({length:12},(_,i)=>product({id:'physical-'+i,name:'Product '+i,is_service:false,cost_price:(i+1)*5,sale_price:100}));
const physicalSales=physical.map((p,i)=>sale({id:'physical-sale-'+i,created_at:now,completed_at:now,total:(i+1)*100,items:[{product_id:p.id,quantity:i+1,unit_price:100}]}));
const productProps={...props,customers:[],products:[...physical,product({id:'service-extra',name:'Distractor service',is_service:true,sale_price:100000,cost_price:0})],sales:[...physicalSales,sale({id:'service-extra',created_at:now,completed_at:now,total:100000,items:[{product_id:'service-extra',quantity:100000,unit_price:100}]}),sale({id:'cancelled-physical',created_at:now,completed_at:now,status:'cancelada',total:99999,items:[{product_id:'physical-0',quantity:99999,unit_price:100}]}),sale({id:'old-physical',created_at:'2000-01-01T12:00:00Z',completed_at:'2000-01-01T12:00:00Z',total:99999,items:[{product_id:'physical-0',quantity:99999,unit_price:100}]})]};
test('products show the top ten by revenue and retain the product and period filters',async()=>{
 let r;try{
  await act(async()=>{r=Renderer.create(React.createElement(exports.ReportsModule,productProps));});
  assert.deepEqual(names(r),Array.from({length:10},(_,i)=>'Product '+(11-i)));
  assert.match(JSON.stringify(r.toJSON()),/Top 10 Produtos/);
  await act(async()=>r.root.findByProps({'aria-label':'Filtrar produto no relat\u00f3rio'}).props.onChange({target:{value:'physical-4'}}));assert.deepEqual(names(r),['Product 4']);
  await act(async()=>r.update(React.createElement(exports.ReportsModule,{...productProps,sales:[]})));assert.deepEqual(names(r),[]);
 }finally{if(r)await act(async()=>r.unmount());}
});
test('stock lists ten physical products by quantity and ten by margin using their existing distinct orderings',async()=>{
 let r;try{
  await act(async()=>{r=Renderer.create(React.createElement(exports.ReportsModule,{...productProps,initialTab:'estoque'}));});
  assert.deepEqual(names(r),Array.from({length:10},(_,i)=>'Product '+(11-i)));
  const marginTable=r.root.findAllByType('table').find(table=>table.findAllByType('th').some(th=>th.children.join('')==='Margem'));
  const rows=marginTable.findByType('tbody').findAllByType('tr');assert.equal(rows.length,10);
  assert.deepEqual(rows.map(row=>row.findByType('strong').children.join('')),Array.from({length:10},(_,i)=>'Product '+i));
  await act(async()=>r.update(React.createElement(exports.ReportsModule,{...productProps,initialTab:'estoque',products:[physical[0]],sales:[physicalSales[0]]})));assert.deepEqual(names(r),['Product 0']);
 }finally{if(r)await act(async()=>r.unmount());}
});

test('paging the report breakdown does not change totals and scope or filter changes reset the drill-down',async()=>{
 const breakdownSales=Array.from({length:25},(_,i)=>sale({id:'row-'+String(i).padStart(5,'0'),created_at:now,completed_at:now,customer_id:'customer-'+(i%2),total:100,items:[{product_id:'p',quantity:1,unit_price:100}]}));
 const config={...props,companyUserId:'company',branchId:'A',sales:breakdownSales,products:[product()],customers:customers.slice(0,2)};let r;
 const open=()=>act(async()=>r.root.findByProps({className:'report-sales-breakdown'}).props.onToggle({currentTarget:{open:true}}));
 const values=()=>r.root.findAllByProps({className:'report-card'}).map(card=>card.findAllByType('strong').map(node=>node.children.filter(v=>typeof v==='string').join('')).join('|'));
 try{
  await act(async()=>{r=Renderer.create(React.createElement(exports.ReportsModule,config));});const totals=values();await open();
  const next=r.root.findAllByType('button').find(b=>b.children.join('')==='Próxima');await act(async()=>next.props.onClick());assert.deepEqual(values(),totals);assert.match(r.root.findByProps({'aria-live':'polite'}).children.join(''),/6–10 de 25/);
  await act(async()=>r.root.findByProps({'aria-label':'Filtrar cliente no relat\u00f3rio'}).props.onChange({target:{value:'customer-0'}}));assert.equal(r.root.findAllByProps({'aria-label':'Vendas da página'}).length,0);await open();assert.match(r.root.findByProps({'aria-live':'polite'}).children.join(''),/1–5 de 13/);
  await act(async()=>r.update(React.createElement(exports.ReportsModule,{...config,branchId:'B',sales:[{...breakdownSales[0],id:'branch-B',branch_id:'B'}]})));assert.equal(r.root.findAllByProps({'aria-label':'Vendas da página'}).length,0);await open();assert.match(r.root.findByProps({'aria-live':'polite'}).children.join(''),/1–1 de 1/);
 }finally{if(r)await act(async()=>r.unmount());}
});

test('embedded reports omit duplicate navigation while standalone reports retain all five options',async()=>{
 let r;try{
  await act(async()=>{r=Renderer.create(React.createElement(exports.ReportsModule,{...props,initialTab:'financeiro',showNavigation:false}));});
  assert.equal(r.root.findAllByProps({className:'subtab-bar'}).length,0);
  assert.ok(r.root.findAllByType('h4').some(heading=>heading.children.join('').includes('Visão Anual')));
  await act(async()=>r.update(React.createElement(exports.ReportsModule,{...props,initialTab:'financeiro'})));
  const navigation=r.root.findByProps({className:'subtab-bar'});assert.equal(navigation.findAllByType('button').length,5);
  await act(async()=>navigation.findAllByType('button').find(button=>button.children.includes('CRM')).props.onClick());
  assert.match(JSON.stringify(r.toJSON()),/Top 10 Clientes/);
 }finally{if(r)await act(async()=>r.unmount());}
});
