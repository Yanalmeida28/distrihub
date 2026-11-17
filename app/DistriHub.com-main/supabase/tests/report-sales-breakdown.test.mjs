import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { intelligenceHarness, sale } from './fixtures/business_intelligence_helpers.mjs';
const {ReportSalesBreakdown}=intelligenceHarness().load('components/partner/ReportSalesBreakdown.tsx');
const records=Array.from({length:23},(_,i)=>sale({id:'sale-'+String(i).padStart(4,'0'),customer_name:'Customer '+i,completed_at:'2026-11-18T03:30:00Z',created_at:'2026-11-18T03:30:00Z'}));
const expand=async r=>act(async()=>r.root.findByType('details').props.onToggle({currentTarget:{open:true}}));
const rows=r=>r.root.findByProps({'aria-label':'Vendas da página'}).findByType('tbody').findAllByType('tr');
const button=(r,label)=>r.root.findAllByType('button').find(b=>b.children.join('')===label);
const status=r=>r.root.findByProps({'aria-live':'polite'}).children.join('');
test('report sales are lazy while closed and paginate in bounded groups without duplicating records',async()=>{
 let r;try{
  await act(async()=>{r=Renderer.create(React.createElement(ReportSalesBreakdown,{sales:records,timeZone:'America/Manaus'}));});
  assert.equal(r.root.findByType('details').props.open,undefined);assert.equal(r.root.findAllByType('table').length,0);assert.equal(r.root.findAllByType('li').length,0);
  await expand(r);assert.equal(rows(r).length,10);assert.equal(r.root.findAllByType('li').length,10);assert.match(status(r),/1–10 de 23/);assert.equal(button(r,'Anterior').props.disabled,true);
  const first=rows(r).map(row=>row.findAllByType('td')[0].children.join(''));
  assert.match(JSON.stringify(rows(r)[0].findAllByType('time')[0].children),/17\/11\/2026/);
  await act(async()=>button(r,'Próxima').props.onClick());assert.match(status(r),/11–20 de 23/);assert.equal(rows(r).length,10);
  assert.equal(rows(r).some(row=>first.includes(row.findAllByType('td')[0].children.join(''))),false);
  await act(async()=>button(r,'Próxima').props.onClick());assert.match(status(r),/21–23 de 23/);assert.equal(rows(r).length,3);assert.equal(button(r,'Próxima').props.disabled,true);
  await act(async()=>button(r,'Anterior').props.onClick());assert.match(status(r),/11–20 de 23/);
  await act(async()=>r.root.findByType('details').props.onToggle({currentTarget:{open:false}}));assert.equal(r.root.findAllByType('table').length,0);
 }finally{if(r)await act(async()=>r.unmount());}
});
test('shrinking data clamps the page permanently, and empty data does not produce a false range',async()=>{
 let r;try{
  await act(async()=>{r=Renderer.create(React.createElement(ReportSalesBreakdown,{sales:records}));});await expand(r);
  await act(async()=>button(r,'Próxima').props.onClick());await act(async()=>button(r,'Próxima').props.onClick());
  await act(async()=>r.update(React.createElement(ReportSalesBreakdown,{sales:records.slice(0,3)})));assert.match(status(r),/1–3 de 3/);
  await act(async()=>r.update(React.createElement(ReportSalesBreakdown,{sales:records})));assert.match(status(r),/1–10 de 23/);
  await act(async()=>r.update(React.createElement(ReportSalesBreakdown,{sales:[]})));assert.equal(r.root.findAllByType('table').length,0);assert.equal(r.root.findAllByType('nav').length,0);assert.match(JSON.stringify(r.toJSON()),/Nenhuma venda/);
 }finally{if(r)await act(async()=>r.unmount());}
});
