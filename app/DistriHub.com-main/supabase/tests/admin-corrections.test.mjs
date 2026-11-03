import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require=createRequire(import.meta.url),NativeDate=Date;
class FixedDate extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-15T15:00:00Z']));}static now(){return new NativeDate('2026-10-15T15:00:00Z').getTime();}}
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
function harness(client={}){
 const cache=new Map(),timers=new Set();
 const load=name=>{
  if(cache.has(name))return cache.get(name);const exports={};cache.set(name,exports);
  const url=new URL('../../src/'+name,import.meta.url);let source=readFileSync(url,'utf8');if(name.endsWith('/AdminModule.tsx'))source+='\nexport {ExecutiveDashboard, AdminFinancialSummary};';
  vm.runInNewContext(compile(source),{exports,Error,Intl,Date:FixedDate,console,window:{setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn)},localStorage:{setItem(){}},require:dep=>{
   if(['react','react/jsx-runtime','lucide-react'].includes(dep))return require(dep);
   if(dep.endsWith('/supabase'))return {supabase:client};if(dep.endsWith('/useDeviceHeartbeat'))return {deviceIdentity:()=>({id:'browser',name:'Terminal',nameKey:'name'})};
   if(dep==='xlsx')return {};
   if(dep.endsWith('/utils'))return {money:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})};
   if(dep.endsWith('/reportMetrics'))return {legacyCostSalesCount:()=>0};if(dep.endsWith('/useStagnantStock'))return {useStagnantStock:()=>({count:0})};
   if(dep.endsWith('/usePayables'))return {usePayables:()=>({accounts:[],loading:false,error:'',recoveries:[]})};
   if(name.endsWith('/AdminModule.tsx')&&dep.startsWith('./'))return new Proxy({},{get:()=>()=>null});
   const path=new URL(dep,url).pathname.split('/src/')[1];return load(path+(/(?:Module|Panel|Tools)$/.test(dep)?'.tsx':'.ts'));
  }});return exports;
 };
 return {load,timers};
}
const base={sales:[],products:[],movements:[],salespeople:[],customers:[],branches:[],branchFilter:'',onBranchChange(){}};
const sale={id:'sale',user_id:'owner',branch_id:'A',customer_id:'customer',customer_name:'Cliente',items:[],status:'concluida',total:100,payment_method:'dinheiro',created_at:'2026-08-01T12:00:00Z',completed_at:'2026-10-15T12:00:00Z'};
const pills=r=>r.root.findAll(node=>typeof node.props.className==='string'&&node.props.className.startsWith('period-pill'));

test('administrators can reach data exports while staff cannot retain an open export page after revocation', async()=>{
 const {AdminModule}=harness().load('components/partner/AdminModule.tsx');
 const props={...base,userId:'owner',ownerView:false,allowedModules:['configuracoes'],canImportExport:true};
 let r;await act(async()=>{r=Renderer.create(React.createElement(AdminModule,props));});
 const settingsSection=r.root.findAll(node=>node.props.className?.startsWith?.('admin-sidebar-section-header'))[1];
 await act(async()=>settingsSection.props.onClick());
 const item=r.root.findAllByType('button').find(button=>button.children.filter(child=>typeof child==='string').join('').includes('Exportar Dados'));
 assert.ok(item);
 await act(async()=>item.props.onClick());
 assert.equal(r.root.findAllByProps({role:'alert'}).length,0);
 await act(async()=>r.update(React.createElement(AdminModule,{...props,canImportExport:false})));
 assert.equal(r.root.findAllByProps({role:'alert'}).length,1);
 assert.doesNotMatch(JSON.stringify(r.toJSON()),/Exportar Dados/);
 await act(async()=>r.unmount());
});

test('Admin periods include the full Sao Paulo civil day, reject invalid ranges and compare complete days',()=>{
 const helpers=harness().load('lib/adminDashboard.ts');const range=helpers.getAdminPeriodRange('custom','2026-10-15','2026-10-15');
 assert.equal(range.start.toISOString(),'2026-10-15T03:00:00.000Z');assert.equal(range.end.toISOString(),'2026-10-16T03:00:00.000Z');assert.equal(range.prevStart.toISOString(),'2026-10-14T03:00:00.000Z');
 assert(new Date('2026-10-16T02:59:59.999Z')<range.end);assert(new Date('2026-10-15T01:00:00Z')<range.start);
 for(const [a,b]of [['2026-10-20','2026-10-01'],['2026-02-30','2026-03-01'],['','2026-10-15']])assert(helpers.getAdminPeriodRange('custom',a,b).error);
 assert.equal(helpers.getAdminPeriodRange('mes').end.toISOString(),'2026-11-01T03:00:00.000Z');
 assert.equal(helpers.getAdminPeriodRange('hoje',undefined,undefined,new Date('2026-10-15T01:00:00Z')).start.toISOString(),'2026-10-14T03:00:00.000Z');
});

test('Dashboard uses completion dates, covers every long-range sale and hides invalid results/exports',async()=>{
 const {ExecutiveDashboard}=harness().load('components/partner/AdminModule.tsx');let r;
 await act(async()=>{r=Renderer.create(React.createElement(ExecutiveDashboard,{...base,canExport:true,sales:[sale]}));});
 const revenue=()=>r.root.findAllByProps({className:'report-card admin-kpi-card'})[0].findByType('strong').children.join('');assert.match(revenue(),/100,00/);
 await act(async()=>pills(r)[4].props.onClick());let dates=r.root.findAllByType('input').filter(n=>n.props.type==='date');
 await act(async()=>dates[0].props.onChange({target:{value:'2026-01-01'}}));await act(async()=>dates[1].props.onChange({target:{value:'2026-10-15'}}));
 const chart=r.root.findAll(node=>typeof node.type==='function'&&node.type.name==='DailyRevenueChart')[0];assert(chart.props.data.length<=90);assert.equal(chart.props.data.reduce((sum,day)=>sum+day.gross,0),100);
 await act(async()=>dates[0].props.onChange({target:{value:'2026-10-20'}}));assert.equal(r.root.findAllByProps({role:'alert'}).length,1);assert(r.root.findAllByType('button').filter(n=>n.props.className==='admin-export-btn').every(n=>n.props.disabled));await act(async()=>r.unmount());
});

test('CRM inactivity and lifetime value do not change when a buyer from yesterday is outside Today',async()=>{
 const {ExecutiveDashboard}=harness().load('components/partner/AdminModule.tsx');let r;
 await act(async()=>{r=Renderer.create(React.createElement(ExecutiveDashboard,{...base,customers:[{id:'customer',name:'Cliente'}],sales:[{...sale,completed_at:'2026-10-14T12:00:00Z'}]}));});
 const values=()=>r.root.findByProps({className:'report-cards admin-crm-metrics'}).findAllByType('strong').map(node=>node.children.join(''));
 assert.match(values()[0],/100,00/);assert.equal(values()[2],'0');await act(async()=>pills(r)[0].props.onClick());assert.match(values()[0],/100,00/);assert.equal(values()[2],'0');await act(async()=>r.unmount());
});

test('Admin filters internal navigation and immediately revokes a section when permission changes',async()=>{
 const {AdminModule}=harness().load('components/partner/AdminModule.tsx');let r;const props={...base,userId:'owner',ownerView:false,allowedModules:['cadastros']};
 await act(async()=>{r=Renderer.create(React.createElement(AdminModule,props));});let sections=r.root.findAll(node=>node.props.className?.startsWith?.('admin-sidebar-section-header'));assert.equal(sections.length,2);
 await act(async()=>sections[1].props.onClick());await act(async()=>r.update(React.createElement(AdminModule,{...props,allowedModules:[]})));assert.equal(r.root.findAllByProps({role:'alert'}).length,1);assert.equal(r.root.findAllByProps({className:'admin-financial-summary'}).length,0);await act(async()=>r.unmount());
});

test('authorized staff can open settings while owner-only administration stays hidden and permissions revoke immediately',async()=>{
 const {AdminModule}=harness().load('components/partner/AdminModule.tsx');
 const props={...base,userId:'owner',ownerView:false,allowedModules:['configuracoes'],renderSettings:()=>React.createElement('div',{'data-settings':true},'Device settings')};
 let r;await act(async()=>{r=Renderer.create(React.createElement(AdminModule,props));});
 try {
  const sections=r.root.findAll(node=>node.props.className?.startsWith?.('admin-sidebar-section-header'));
  assert.equal(sections.length,2);
  await act(async()=>sections[1].props.onClick());
  const buttons=r.root.findAllByType('button');
  const item=buttons.find(b=>JSON.stringify(b.children.filter(c=>typeof c==='string')).includes('Dados do'));
  assert.ok(item);
  assert.doesNotMatch(JSON.stringify(r.toJSON()),/Usuários e permissões|Exportar Dados|Dispositivos\/Terminais/);
  await act(async()=>item.props.onClick());
  assert.equal(r.root.findAllByProps({'data-settings':true}).length,1);
  await act(async()=>r.update(React.createElement(AdminModule,{...props,allowedModules:[]})));
  assert.equal(r.root.findAllByProps({'data-settings':true}).length,0);
 } finally {await act(async()=>r.unmount());}
});

test('staff settings expose printer controls without account, password, billing or branch management controls',async()=>{
 const exports={};
 vm.runInNewContext(compile(readFileSync(new URL('../../src/components/partner/SettingsModule.tsx',import.meta.url),'utf8')),{
  exports,require:dep=>{
   if(['react','react/jsx-runtime','lucide-react'].includes(dep))return require(dep);
   if(dep.endsWith('/PrinterSettings'))return {PrinterSettings:()=>React.createElement('div',{'data-printer':true})};
   if(dep.endsWith('/useSaasSubscription'))return {useSaasSubscription:()=>({subscription:null})};
   if(dep.endsWith('/planCatalog'))return {planCatalog:{basico:{price:0},profissional:{price:0},enterprise:{price:0}}};
   return {};
  },
 });
 let r;await act(async()=>{r=Renderer.create(React.createElement(exports.SettingsModule,{
  canManageAccount:false,canManageOwnerPassword:true,user:{email:'owner@example.test'},profile:{id:'company'},
  onProfileUpdate:()=>{throw Error('Unexpected profile change');},branchManagement:React.createElement('div',{'data-branches':true}),
 }));});
 try {
  assert.equal(r.root.findAllByProps({'data-printer':true}).length,1);
  assert.equal(r.root.findAllByProps({'data-branches':true}).length,0);
  assert.equal(r.root.findAllByType('input').length,0);
  assert.equal(r.root.findAllByType('button').length,0);
  assert.doesNotMatch(JSON.stringify(r.toJSON()),/owner@example.test|Upgrade Plano|Alterar senha de login/);
 } finally {await act(async()=>r.unmount());}
});

test('executive movements include freight and refund, exclude foreign branches, and fail closed on ledger errors',async()=>{
 let fail=false;
 const client={auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},from:table=>{const q={select:()=>q,eq:()=>q,order:()=>q,range:async()=>table==='rma_requests_v2'?(fail?{data:null,error:{message:'Ledger unavailable'}}:{data:[{id:'rma',user_id:'owner',branch_id:'A',refund_amount:40,refund_request_id:'refund',refunded_at:'2026-10-15'},{id:'foreign',user_id:'owner',branch_id:'B',refund_amount:90}],error:null}):{data:[],error:null}};return q;}};
 const {AdminFinancialSummary}=harness(client).load('components/partner/AdminModule.tsx');let r;
 const props={...base,userId:'owner',branchFilter:'A',sales:[{...sale,freight_fee:15}],invoices:[],payables:[],payablesUnavailable:false};
 await act(async()=>{r=Renderer.create(React.createElement(AdminFinancialSummary,props));});const cash=()=>r.root.findAllByProps({className:'report-card admin-kpi-card'})[4].findByType('strong').children.join('');assert.match(cash(),/75,00/);
 fail=true;await act(async()=>r.update(React.createElement(AdminFinancialSummary,{...props,invoices:[]})));assert.equal(cash(),'Indisponível');assert.match(JSON.stringify(r.toJSON()),/Ledger unavailable/);await act(async()=>r.unmount());
});

test('terminal list discards old branch replies, distinguishes load errors and stops hidden polling',async()=>{
 const pending=[];const client={from(){const q={select:()=>q,eq:()=>q,order:()=>q,range:()=>q,then:(resolve,reject)=>new Promise(done=>pending.push(done)).then(resolve,reject)};return q;}};
 const e=harness(client),{AdminDeviceRegistry}=e.load('components/partner/AdminSettingsTools.tsx');let r;
 const props={userId:'owner',branchId:'A',branches:[]};await act(async()=>{r=Renderer.create(React.createElement(AdminDeviceRegistry,props));});await act(async()=>r.update(React.createElement(AdminDeviceRegistry,{...props,branchId:'B'})));
 await act(async()=>pending[1]({data:[{id:'B',name:'Terminal B',last_seen:'2026-10-15T15:00:00Z'}],error:null}));await act(async()=>pending[0]({data:[{id:'A',name:'Terminal A',last_seen:'2026-10-15T15:00:00Z'}],error:null}));assert.match(JSON.stringify(r.toJSON()),/Terminal B/);assert.doesNotMatch(JSON.stringify(r.toJSON()),/Terminal A/);
 await act(async()=>r.update(React.createElement(AdminDeviceRegistry,{...props,branchId:'B',isActive:false})));assert.equal(e.timers.size,0);await act(async()=>r.update(React.createElement(AdminDeviceRegistry,{...props,branchId:'B'})));await act(async()=>pending[2]({data:null,error:{message:'Read failed'}}));assert.match(JSON.stringify(r.toJSON()),/Read failed/);assert.doesNotMatch(JSON.stringify(r.toJSON()),/Nenhum terminal registrado/);await act(async()=>r.unmount());
});
