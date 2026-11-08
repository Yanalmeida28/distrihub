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
const cash={};vm.runInNewContext(compile(await readFile(new URL('../../src/lib/cashRegister.ts',import.meta.url),'utf8')),{exports:cash,Intl,Date});
const overview = {};
vm.runInNewContext(compile(await readFile(new URL('../../src/components/partner/CashOverview.tsx', import.meta.url), 'utf8')), {
 exports: overview, Date, require: name => name === '../../lib/cashRegister' ? cash
  : name === '../../utils' ? { money: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }) } : require(name),
});
const pdv={};vm.runInNewContext(compile(await readFile(new URL('../../src/lib/pdv.ts',import.meta.url),'utf8')),{exports:pdv,Error});
const sync={};vm.runInNewContext(compile(await readFile(new URL('../../src/lib/partnerSync.ts',import.meta.url),'utf8')),{exports:sync,AbortController,setTimeout,clearTimeout});
const source=compile(await readFile(new URL('../../src/components/partner/CashRegisterModule.tsx',import.meta.url),'utf8'));
let renderer;
afterEach(async()=>{if(renderer)await act(async()=>renderer.unmount());renderer=null;});
const ownerSession={id:randomUUID(),branch_id:'branch',actor_key:'owner',operator_name:'Proprietário',opened_at:new Date().toISOString(),closed_at:null,opening_amount:100};
const employeeSession={...ownerSession,id:randomUUID(),actor_key:'employee',operator_name:'Funcionário'};
const base={branchId:'branch',branchName:'Filial A',scopeKey:'owner:branch',sales:[],operatorId:null,operatorPin:null,salespeople:[]};
async function harness({snapshot={actor_key:'owner',sessions:[],movements:[],sales:[],can_manage:true,can_view_overview:true},rpc,storage:providedStorage,props={}}={}){
 const values=new Map();const storage=providedStorage??{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const calls=[],listeners=new Map();
 const events={addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);},dispatchEvent(event){listeners.get(event.type)?.forEach(fn=>fn());}};
 const exports={};
 vm.runInNewContext(source,{exports,Error,Event,Date,crypto:{randomUUID},sessionStorage:storage,window:events,document:{...events,visibilityState:'visible'},require(name){
  if(name==='../../lib/supabase')return {supabase:{rpc:async(name,args)=>{calls.push({name,args});return rpc?.(name,args)??{data:snapshot,error:null};}}};
  if(name==='../../lib/cashRegister')return cash;
  if(name==='./CashOverview')return overview;
  if(name==='../../lib/pdv')return pdv;
  if(name==='../../lib/partnerSync')return sync;
  if(name==='../../utils')return {money:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})};
  return require(name);
 }});
 let currentProps={...base,...props};
 function Consumer(){const [session,setSession]=React.useState(null);return React.createElement(exports.CashRegisterModule,{...currentProps,managedSessionId:session?.id??null,onManageSession:setSession});}
 await act(async()=>{renderer=TestRenderer.create(React.createElement(Consumer));});
 return {values,calls,events,update:async changes=>{currentProps={...currentProps,...changes};await act(async()=>renderer.update(React.createElement(Consumer)));}};
}
const rendered=()=>JSON.stringify(renderer.toJSON());
const button=text=>renderer.root.findAllByType('button').find(n=>n.children.includes(text));
const submit=form=>form.props.onSubmit({preventDefault(){}});

test('owner sees all open cash registers and opens an employee report without changing operator or operating session', async () => {
 const movement=(session,method,amount,kind='venda')=>({id:randomUUID(),session_id:session.id,kind,payment_method:method,amount,created_at:new Date().toISOString(),reason:'Teste'});
 const h=await harness({snapshot:{actor_key:'owner',can_manage:true,can_view_overview:true,sessions:[ownerSession,employeeSession],movements:[movement(ownerSession,'dinheiro',20),movement(ownerSession,'dinheiro',5,'sangria'),movement(employeeSession,'pix',50),movement(employeeSession,'cartao',30)],sales:[]}});
 const section=renderer.root.findByProps({'aria-label':'Visão geral dos caixas'});
 const text=JSON.stringify(section.toJSON?.()??renderer.toJSON());
 assert.match(text,/Funcionário/);assert.match(text,/Proprietário/);
 assert.ok(section.findAllByType('strong').some(node=>node.children.join('').replace(/\s/g,'')==='R$215,00'));
 const report=section.findAllByType('tr').find(row=>row.findAllByType('td').some(cell=>cell.children.includes('Funcionário')));
 await act(async()=>report.findByType('button').props.onClick());
 const selects=renderer.root.findAllByType('select');
 assert.ok(selects.some(select=>select.props.value===employeeSession.id));
 assert.equal(renderer.root.findByProps({'aria-label':'Caixa para operar'}).props.value,'');
 assert.equal(h.calls.some(call=>call.name.includes('mutate')||call.name.includes('refund')),false);
 assert.ok(h.calls.every(call=>call.args.p_salesperson_id===null));
});

test('cash background refresh preserves mounted overview, filters and report instead of collapsing the page',async()=>{
 let release,reads=0;
 const snapshot={actor_key:'owner',sessions:[ownerSession],movements:[],sales:[],can_manage:true,can_view_overview:true};
 const h=await harness({rpc:()=>++reads===1?{data:snapshot,error:null}:new Promise(resolve=>{release=resolve;})});
 const overviewNode=renderer.root.findByProps({'aria-label':'Visão geral dos caixas'});
 const search=renderer.root.findByProps({'aria-label':'Buscar operador nos caixas'});
 await act(async()=>search.props.onChange({target:{value:'Proprietário'}}));
 const form=renderer.root.findAllByType('form')[0];
 await act(async()=>h.events.dispatchEvent(new Event('focus')));
 assert.equal(renderer.root.findByProps({'aria-label':'Visão geral dos caixas'}),overviewNode);
 assert.equal(renderer.root.findAllByType('form')[0],form);
 assert.equal(renderer.root.findByProps({'aria-label':'Buscar operador nos caixas'}).props.value,'Proprietário');
 assert.doesNotMatch(rendered(),/Carregando caixa/);
 assert.equal(renderer.root.findByProps({'aria-label':'Caixa para operar'}).props.disabled,true);
 await act(async()=>release({data:snapshot,error:null}));
 assert.equal(renderer.root.findByProps({'aria-label':'Visão geral dos caixas'}),overviewNode);
 assert.equal(renderer.root.findByProps({'aria-label':'Buscar operador nos caixas'}).props.value,'Proprietário');
});

test('cash coalesces simultaneous focus/visibility reads without duplicating RPC',async()=>{
 let release,reads=0;
 const snapshot={actor_key:'owner',sessions:[],movements:[],sales:[],can_manage:true,can_view_overview:true};
 const h=await harness({rpc:()=>{reads++;return reads===1?{data:snapshot,error:null}:new Promise(resolve=>{release=resolve;});}});
 await act(async()=>{h.events.dispatchEvent(new Event('focus'));h.events.dispatchEvent(new Event('focus'));h.events.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(reads,2);assert(release);
 await act(async()=>release({data:snapshot,error:null}));
 assert.doesNotMatch(rendered(),/Carregando caixa/);
});

test('cash-changed starts a fresh read even while an earlier focus read is pending',async()=>{
 let reads=0;const pending=[];
 const snapshot={actor_key:'owner',sessions:[],movements:[],sales:[],can_manage:true,can_view_overview:true};
 const h=await harness({rpc:()=>{reads++;return reads===1?{data:snapshot,error:null}:new Promise(resolve=>pending.push(resolve));}});
 await act(async()=>h.events.dispatchEvent(new Event('focus')));assert.equal(reads,2);
 await act(async()=>h.events.dispatchEvent(new Event('distrihub:cash-changed')));assert.equal(reads,3);
 await act(async()=>pending[1]({data:snapshot,error:null}));
 await act(async()=>pending[0]({data:{...snapshot,actor_key:'old-context'},error:null}));
 assert.doesNotMatch(rendered(),/Carregando caixa/);
});

test('overview filters branch, preserves closed snapshots and pages results without counting closed cash as open money', async () => {
 const closed={...employeeSession,id:'closed',closed_at:'2026-10-29T16:00:00Z',expected_amount:190,difference:-10,closing_totals:{dinheiro:90,pix:70,cartao:40,faturado:25}};
 const foreign={...ownerSession,id:'foreign',branch_id:'foreign',operator_name:'Outra filial',opening_amount:9000};
 const sessions=[...Array.from({length:30},(_,index)=>({...employeeSession,id:`open-${index}`,operator_name:`Equipe ${index}`,opening_amount:10})),closed,foreign];
 await act(async()=>{renderer=TestRenderer.create(React.createElement(overview.CashOverview,{branchId:'branch',branchName:'Filial A',sessions,movements:[{session_id:'closed',kind:'venda',payment_method:'dinheiro',amount:9999}],onViewReport(){}}));});
 assert.equal(renderer.root.findAllByType('tbody')[0].findAllByType('tr').length,25);
 assert.doesNotMatch(rendered(),/Outra filial/);
 assert.ok(renderer.root.findAllByType('strong').some(node=>node.children.join('').replace(/\s/g,'')==='R$300,00'));
 await act(async()=>button('Próxima página').props.onClick());
 assert.equal(renderer.root.findAllByType('tbody')[0].findAllByType('tr').length,5);
 await act(async()=>renderer.root.findByProps({'aria-label':'Situação dos caixas'}).props.onChange({target:{value:'fechados'}}));
 const cells=renderer.root.findAllByType('tbody')[0].findAllByType('td').map(node=>node.children.filter(child=>typeof child==='string').join('').replace(/\s/g,''));
 assert.ok(cells.includes('R$190,00'));assert.ok(cells.includes('R$70,00'));assert.ok(cells.includes('-R$10,00'));
 assert.ok(!cells.includes('R$9.999,00'));
 await act(async()=>renderer.root.findByProps({'aria-label':'Buscar operador nos caixas'}).props.onChange({target:{value:'inexistente'}}));
 assert.match(rendered(),/Nenhum caixa encontrado/);
});

test('ordinary employees never receive the management overview, and failed reads do not show stale overview balances', async () => {
 await harness({snapshot:{actor_key:'employee',sessions:[employeeSession],movements:[],sales:[],can_manage:false},props:{operatorId:'employee',operatorPin:'1234'}});
 assert.equal(renderer.root.findAllByProps({'aria-label':'Visão geral dos caixas'}).length,0);
 await act(async()=>renderer.unmount());renderer=null;
 let failed=false;
 const h=await harness({snapshot:{actor_key:'owner',sessions:[ownerSession],movements:[],sales:[],can_manage:true,can_view_overview:true},rpc:()=>failed?{data:null,error:{message:'Leitura indisponível'}}:undefined});
 assert.equal(renderer.root.findAllByProps({'aria-label':'Visão geral dos caixas'}).length,1);
 failed=true;
 await act(async()=>h.events.dispatchEvent(new Event('focus')));
 assert.equal(renderer.root.findAllByProps({'aria-label':'Visão geral dos caixas'}).length,0);
});

test('operational management does not grant overview',async()=>{
 const h=await harness({snapshot:{actor_key:'manager',can_manage:true,can_view_overview:false,sessions:[],movements:[],sales:[]},props:{operatorId:'manager',operatorPin:'9876'}});
 assert.equal(renderer.root.findAllByType(overview.CashOverview).length,0);
 await act(async()=>h.events.dispatchEvent(new Event('focus')));
 assert.equal(renderer.root.findAllByType(overview.CashOverview).length,0);
});

test('missing overview flag denies dashboard even if legacy management is granted',async()=>{
 await harness({snapshot:{actor_key:'owner',can_manage:true,sessions:[],movements:[],sales:[]}});
 assert.equal(renderer.root.findAllByType(overview.CashOverview).length,0);
});

test('overview permission revocation removes dashboard after server refresh',async()=>{
 let allowed=true;
 const h=await harness({rpc:()=>({data:{actor_key:'owner',can_manage:true,can_view_overview:allowed,sessions:[],movements:[],sales:[]},error:null})});
 assert.equal(renderer.root.findAllByType(overview.CashOverview).length,1);
 allowed=false;await act(async()=>h.events.dispatchEvent(new Event('focus')));
 assert.equal(renderer.root.findAllByType(overview.CashOverview).length,0);
});

test('uncertain cash attempt is released only after definitive rejection and locked server reconciliation says absent',async()=>{
 let retry=false;
 const h=await harness({rpc:(name)=>name==='read_partner_cash_register'?undefined:name==='resolve_partner_cash_request'?{data:false,error:null}:{data:null,error:retry?{code:'P0001',message:'Já existe um caixa'}:{code:'08006',message:'Conexão perdida'}}});
 await act(async()=>submit(renderer.root.findByType('form')));assert.equal(h.values.size,1);
 assert.equal(button('Abrir caixa').props.disabled,true);
 retry=true;await act(async()=>button('Confirmar operação pendente').props.onClick());
 assert.equal(h.values.size,0);assert.match(rendered(),/pendência foi liberada/);
 assert.ok(h.calls.some(call=>call.name==='resolve_partner_cash_request'));
});

test('confirmed reconciliation clears pending without repeating the cash mutation with a new UUID',async()=>{
 let retry=false;
 const h=await harness({rpc:name=>name==='read_partner_cash_register'?undefined:name==='resolve_partner_cash_request'?{data:true,error:null}:{error:retry?{code:'P0001',message:'Rejeição'}:{code:'08006',message:'Conexão perdida'}}});
 await act(async()=>submit(renderer.root.findByType('form')));retry=true;
 await act(async()=>button('Confirmar operação pendente').props.onClick());
 assert.equal(h.values.size,0);assert.match(rendered(),/Caixa aberto/);
 const mutations=h.calls.filter(call=>call.name==='mutate_partner_cash_register');assert.equal(mutations.length,2);assert.equal(mutations[0].args.p_request_id,mutations[1].args.p_request_id);
});

test('reconciliation failure retains the UUID and blocks new operations',async()=>{
 const h=await harness({rpc:name=>name==='read_partner_cash_register'?undefined:name==='resolve_partner_cash_request'?{error:{message:'Conciliação indisponível'}}:{error:{code:'08006',message:'Conexão perdida'}}});
 await act(async()=>submit(renderer.root.findByType('form')));const stored=[...h.values.values()][0];
 await act(async()=>button('Confirmar operação pendente').props.onClick());
 assert.equal([...h.values.values()][0],stored);assert.equal(button('Abrir caixa').props.disabled,true);
});

test('all operation fields reset on branch change and a late old-context failure is ignored',async()=>{
 let complete;
 const h=await harness({snapshot:{actor_key:'owner',sessions:[ownerSession],movements:[],can_manage:true,can_view_overview:true},rpc:name=>name==='mutate_partner_cash_register'?new Promise(resolve=>{complete=resolve;}):undefined});
 const movement=()=>renderer.root.findAllByType('form')[0];
 await act(async()=>{movement().findAllByType('input')[0].props.onChange({target:{value:'80'}});movement().findAllByType('input')[1].props.onChange({target:{value:'Retirada da filial A'}});});
 let pending;await act(async()=>{pending=submit(movement());});
 await h.update({branchId:'branch-b',scopeKey:'owner:branch-b',branchName:'Filial B'});
 assert.equal(movement().findAllByType('input')[0].props.value,'');assert.equal(movement().findAllByType('input')[1].props.value,'');
 await act(async()=>{complete({error:{code:'P0001',message:'Erro antigo da filial A'}});await pending;});
 assert.doesNotMatch(rendered(),/Erro antigo da filial A/);assert.equal(h.values.size,0);
});

test('cash refreshes after new sales and on activation, and inactive screen skips event reads',async()=>{
 const h=await harness({props:{isActive:false}});assert.equal(h.calls.length,0);
 await h.update({isActive:true});const first=h.calls.length;assert.ok(first>0);
 await h.update({sales:[{id:'new-sale'}]});assert.ok(h.calls.length>first);
 const beforeEvent=h.calls.length;await act(async()=>h.events.dispatchEvent(new Event('distrihub:cash-changed')));assert.ok(h.calls.length>beforeEvent);
 await h.update({isActive:false});const hidden=h.calls.length;await act(async()=>h.events.dispatchEvent(new Event('distrihub:cash-changed')));assert.equal(h.calls.length,hidden);
 await h.update({isActive:true});assert.ok(h.calls.length>hidden);
});

test('owner selects employee cash and closes using the supervised endpoint with the actual logged-in identity',async()=>{
 const h=await harness({snapshot:{actor_key:'owner',sessions:[employeeSession],movements:[],can_manage:true,can_view_overview:true},rpc:name=>name==='supervised_mutate_partner_cash_register'?{data:employeeSession.id,error:null}:undefined});
 await act(async()=>renderer.root.findByProps({'aria-label':'Caixa para operar'}).props.onChange({target:{value:employeeSession.id}}));
 const closing=renderer.root.findAllByType('form')[2];
 await act(async()=>closing.findAllByType('input')[0].props.onChange({target:{value:'100'}}));
 await act(async()=>submit(closing));
 const call=h.calls.find(call=>call.name==='supervised_mutate_partner_cash_register');
 assert.equal(call.args.p_session_id,employeeSession.id);assert.equal(call.args.p_salesperson_id,null);assert.equal(call.args.p_pin,null);
 assert.match(rendered(),/Caixa fechado/);
});

test('cash report shows employee sales returned by the cash RPC even if panel sales are empty',async()=>{
 const id=randomUUID();
 await harness({snapshot:{actor_key:'owner',sessions:[employeeSession],movements:[{id:randomUUID(),session_id:employeeSession.id,kind:'venda',payment_method:'pix',amount:50,sale_id:id,created_at:new Date().toISOString(),reason:'Venda',performed_by:'seller',performed_by_name:'Ana Vendedora'}],sales:[{id,sale_number:123,customer_name:'Cliente do funcionário',status:'concluida',total:50}],can_manage:true,can_view_overview:true}});
 assert.match(rendered(),/Cliente do funcionário/);assert.match(rendered(),/123/);
 assert.match(rendered(),/Finalizado por/);assert.match(rendered(),/Ana Vendedora/);
});

test('shared cashier history shows the finalizer without presenting partial movements as complete cash totals',async()=>{
 const id=randomUUID();
 await harness({snapshot:{actor_key:'owner',sessions:[{...employeeSession,history_complete:false}],movements:[{id:randomUUID(),session_id:employeeSession.id,kind:'venda',payment_method:'pix',amount:50,sale_id:id,created_at:new Date().toISOString(),reason:'Venda',performed_by_name:'Ana'}],sales:[{id,customer_name:'Cliente compartilhado',status:'concluida',total:50}],can_manage:false}});
 assert.match(rendered(),/Ana/);
 assert.match(rendered(),/finalizadas por você/);
 assert.equal(button('Imprimir relatório'),undefined);
 assert.equal(renderer.root.findAllByProps({className:'cash-summary'}).length,0);
});

test('storage access failure cannot leave cash locked in flight or send a financial request',async()=>{
 const h=await harness({storage:{getItem(){throw new Error('Armazenamento bloqueado');},setItem(){},removeItem(){}}});
 await act(async()=>submit(renderer.root.findByType('form')));
 assert.match(rendered(),/Armazenamento bloqueado/);assert.equal(h.calls.filter(call=>call.name==='mutate_partner_cash_register').length,0);
 assert.equal(button('Abrir caixa').props.disabled,false);
});
