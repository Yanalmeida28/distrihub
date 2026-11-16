import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require=createRequire(import.meta.url);
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
function environment(client={}){
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),key:i=>[...values.keys()][i]??null,get length(){return values.size;}};
 const cache=new Map();
 const load=name=>{
  if(cache.has(name))return cache.get(name);
  const exports={};cache.set(name,exports);
  const url=new URL('../../src/'+name,import.meta.url);
  vm.runInNewContext(compile(readFileSync(url,'utf8')),{exports,Error,Date,Intl,console,crypto:{randomUUID},window:{localStorage:storage},require:dep=>{
   if(dep==='react'||dep==='react/jsx-runtime'||dep==='lucide-react')return require(dep);
   if(dep.endsWith('/supabase'))return {supabase:client};
   if(dep.endsWith('/utils'))return {money:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'})};
   if(dep==='./InvoiceReceipts')return {InvoiceReceipts:()=>null};
   const target=new URL(dep,url),ext=existsSync(new URL(target.href+'.ts'))?'.ts':'.tsx';
   const path=target.pathname.split('/src/')[1]+ext;return load(path);
  }});return exports;
 };
 return {load,values,storage};
}
const invoice={id:'invoice',user_id:'owner',branch_id:'A',customer_id:'customer',customer_name:'Cliente',number:'001',amount:100,paid_amount:0,status:'aberta',due_date:'2026-10-20'};
const payable={id:'payable',user_id:'owner',branch_id:'A',description:'Aluguel',creditor_name:'Credor',amount:100,paid_amount:0,status:'aberta',due_date:'2026-10-20'};
const button=(r,label)=>r.root.findAllByType('button').find(node=>node.children.join('')===label);

test('paid accounts can be edited or excluded only after review, with reason and archive filter',async()=>{
 const e=environment(),Component=e.load('components/partner/AccountsModule.tsx').AccountsModule,calls=[];let r;
 const paid={...payable,paid_amount:100,status:'paga',revision:2};
 const props={kind:'pagar',invoices:[],payables:{accounts:[paid],loading:false,error:'',update:async(...args)=>calls.push(['edit',...args]),remove:async(...args)=>calls.push(['delete',...args])},branches:[{id:'A',name:'Centro'}],suppliers:[],branchId:'A'};
 try{
  await act(async()=>{r=Renderer.create(React.createElement(Component,props));});
  await act(async()=>button(r,'Pagas').props.onClick());
  await act(async()=>button(r,'Editar conta').props.onClick());
  await act(async()=>r.root.findByProps({'aria-label':'Editar valor da conta'}).props.onChange({target:{value:'99'}}));
  await act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(calls.length,0);
  await act(async()=>r.root.findByProps({'aria-label':'Editar valor da conta'}).props.onChange({target:{value:'100'}}));
  await act(async()=>r.root.findByProps({'aria-label':'Editar descrição da conta'}).props.onChange({target:{value:'Nome corrigido'}}));
  await act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(calls[0][0],'edit');assert.equal(calls[0][2].description,'Nome corrigido');assert.equal(calls[0][3],2);
  await act(async()=>button(r,'Excluir conta').props.onClick());assert.equal(calls.length,1);
  assert.match(JSON.stringify(r.toJSON()),/não devolve dinheiro/);
  await act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(calls.length,1);
  await act(async()=>r.root.findByProps({'aria-label':'Motivo da exclusão'}).props.onChange({target:{value:'Conta duplicada'}}));
  await act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(calls[1][0],'delete');assert.equal(calls[1][2],'Conta duplicada');
  await act(async()=>r.update(React.createElement(Component,{...props,payables:{...props.payables,accounts:[{...paid,status:'cancelada',deleted_at:'2026-11-14T15:00:00Z',deletion_reason:'Conta duplicada'}]}})));
  assert.equal(r.root.findAllByType('button').filter(node=>node.children.join('')==='Editar conta').length,0);
  await act(async()=>button(r,'Excluídas').props.onClick());assert.match(JSON.stringify(r.toJSON()),/Conta duplicada/);
  assert.equal(r.root.findAllByType('button').filter(node=>node.children.join('')==='Excluir conta').length,0);
 }finally{if(r)await act(async()=>r.unmount());}
});

test('management recovery preserves the correction and stale revision proof clears a pending request',async()=>{
 const requests=[];let mode='lost',current,r;
 const client={auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},rpc:async(name,args)=>{requests.push([name,args]);return mode==='lost'?{error:{message:'Resposta perdida'}}:mode==='stale'?{error:{code:'40001',message:'A conta mudou'}}:{data:'payable',error:null};},from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,range:async()=>({data:[{...payable,revision:4}],error:null})};return q;}};
 const e=environment(client),usePayables=e.load('hooks/usePayables.ts').usePayables;
 function Probe(){current=usePayables('owner');return null;}
 try{
  await act(async()=>{r=Renderer.create(React.createElement(Probe));});
  const patch={description:'Corrigido',creditor_name:'Credor',supplier_id:null,category:'outros',amount:100,due_date:'2026-10-20',purchased_on:null,payment_method:'pix',payment_method_detail:null};
  await act(async()=>assert.rejects(current.update('payable',patch,3,'edit-token'),/Resposta perdida/));
  await act(async()=>r.unmount());await act(async()=>{r=Renderer.create(React.createElement(Probe));});
  await act(async()=>assert.rejects(current.update('payable',{...patch,amount:200},3,'new-token'),/sem confirmação/));
  mode='ok';await act(async()=>current.recoveries[0].run());assert.equal(requests[1][1].p_request_id,'edit-token');assert.equal(requests[1][1].p_action,'edit');
  mode='lost';await act(async()=>assert.rejects(current.remove('payable','Duplicada',3,'delete-token'),/Resposta perdida/));
  mode='stale';await act(async()=>assert.rejects(current.recoveries[0].run(),/mudou/));assert.equal(current.recoveries.length,0);assert.equal(current.accounts[0].revision,4);
 }finally{if(r)await act(async()=>r.unmount());}
});

test('purchase form saves purchase date, credit method and revised installment dates without creating a duplicate total account',async()=>{
 const e=environment(),Component=e.load('components/partner/AccountsModule.tsx').AccountsModule,saved=[];let r;
 try{
  await act(async()=>{r=Renderer.create(React.createElement(Component,{kind:'pagar',invoices:[],payables:{accounts:[],loading:false,error:'',create:async account=>saved.push(account)},branches:[{id:'A',name:'Centro'}],suppliers:[{id:'supplier',name:'Credor'}],branchId:'A'}));});
  await act(async()=>button(r,'Nova conta a pagar').props.onClick());
  const change=async(label,value)=>act(async()=>r.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
  await act(async()=>r.root.findAllByType('label').find(label=>label.children[0]==='Descrição').findByType('input').props.onChange({target:{value:'Compra parcelada'}}));
  await act(async()=>r.root.findAllByType('select').find(select=>select.findAllByType('option').some(option=>option.props.value==='supplier')).props.onChange({target:{value:'supplier'}}));
  await act(async()=>r.root.findByProps({inputMode:'decimal'}).props.onChange({target:{value:'100,00'}}));
  await change('Tipo de despesa','variable');
  await change('Data da compra','2025-01-15');await change('Forma de pagamento da conta','cartao_credito');
  await change('Condição de pagamento','parcelado');await change('Quantidade de parcelas','3');await change('Vencimento','2025-01-31');
  await change('Vencimento da parcela 2','2025-03-05');
  await act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(saved.length,1);const account=saved[0];
  assert.equal(account.purchased_on,'2025-01-15');assert.equal(account.payment_method,'cartao_credito');assert.equal(account.amount,100);
  assert.deepEqual(Array.from(account.installments,item=>item.amount),[33.34,33.33,33.33]);
  assert.deepEqual(Array.from(account.installments,item=>item.due_date),['2025-01-31','2025-03-05','2025-03-31']);
  assert.equal(new Set(account.installments.map(item=>item.id)).size,3);
 }finally{if(r)await act(async()=>r.unmount());}
});

test('purchase recovery retains every installment and payment recovery retains the actual method',async()=>{
 const requests=[];let fail=true,current,r;
 const client={auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},rpc:async(name,args)=>{requests.push([name,args]);return fail?{error:{message:'Resposta perdida'}}:{data:args.p_purchase_id??args.p_payable_id,error:null};},from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,range:async()=>({data:[payable],error:null})};return q;}};
 const e=environment(client),usePayables=e.load('hooks/usePayables.ts').usePayables;
 function Probe(){current=usePayables('owner');return null;}
 try{
  await act(async()=>{r=Renderer.create(React.createElement(Probe));});
  const account={branch_id:'A',supplier_id:null,description:'Compra',creditor_name:'Credor',category:'outros',amount:20,due_date:'2025-10-15',purchased_on:'2025-10-01',payment_method:'cartao_credito',payment_method_detail:null,installments:[{id:'one',amount:10,due_date:'2025-10-15'},{id:'two',amount:10,due_date:'2025-11-15'}]};
  await act(async()=>assert.rejects(current.create(account,'purchase-token'),/Resposta perdida/));
  await act(async()=>r.unmount());await act(async()=>{r=Renderer.create(React.createElement(Probe));});
  await act(async()=>assert.rejects(current.create({...account,purchased_on:'2025-10-02'},'new'),/sem confirmação/));
  fail=false;await act(async()=>current.recoveries[0].run());
  assert.equal(requests[1][0],'create_partner_payable_purchase');assert.deepEqual(JSON.parse(JSON.stringify(requests[1][1])),JSON.parse(JSON.stringify(requests[0][1])));
  fail=true;await act(async()=>assert.rejects(current.pay('payable',10,'payment-token','2025-10-15','pix'),/Resposta perdida/));
  await act(async()=>assert.rejects(current.pay('payable',10,'new','2025-10-15','cartao_debito'),/sem confirmação/));
  fail=false;await act(async()=>current.recoveries[0].run());
  assert.equal(requests.at(-1)[0],'record_partner_payable_payment_details');assert.equal(requests.at(-1)[1].p_payment_method,'pix');assert.equal(requests.at(-1)[1].p_payment_id,'payment-token');
 }finally{if(r)await act(async()=>r.unmount());}
});

test('payment starts with the planned method and records the actual method without changing the purchase',async()=>{
 const e=environment(),Component=e.load('components/partner/AccountsModule.tsx').AccountsModule,saved=[];let r;
 const account={...payable,payment_method:'cartao_credito',purchased_on:'2025-10-01',installment_number:1,installment_count:3,purchase_total:300};
 try{
  await act(async()=>{r=Renderer.create(React.createElement(Component,{kind:'pagar',invoices:[],payables:{accounts:[account],loading:false,error:'',pay:async(...args)=>saved.push(args)},branches:[],suppliers:[],branchId:'A'}));});
  assert.match(JSON.stringify(r.toJSON()),/01\/10\/2025/);
  await act(async()=>button(r,'Registrar pagamento').props.onClick());
  const method=r.root.findByProps({'aria-label':'Forma deste pagamento'});
  assert.equal(method.props.value,'cartao_credito');
  await act(async()=>method.props.onChange({target:{value:'pix'}}));
  await act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(saved.length,1);assert.equal(saved[0][4],'pix');assert.equal(account.payment_method,'cartao_credito');
 }finally{if(r)await act(async()=>r.unmount());}
});

test('payment form uses the selected actual date and refuses invalid or future dates before saving',async()=>{
 const e=environment(),Component=e.load('components/partner/AccountsModule.tsx').AccountsModule,saved=[];let r;
 try {
  await act(async()=>{r=Renderer.create(React.createElement(Component,{kind:'pagar',invoices:[],payables:{accounts:[payable],loading:false,error:'',pay:async(...args)=>saved.push(args)},branches:[],suppliers:[],branchId:'A'}));});
  await act(async()=>button(r,'Registrar pagamento').props.onClick());
  const date=()=>r.root.findByProps({'aria-label':'Data do pagamento'});
  const confirm=()=>r.root.findByType('form').props.onSubmit({preventDefault(){}});
  for(const value of ['', '2026-02-30','9999-12-31']){
   await act(async()=>date().props.onChange({target:{value}}));await act(async()=>confirm());assert.equal(saved.length,0);
  }
  await act(async()=>date().props.onChange({target:{value:'2025-10-15'}}));
  await act(async()=>confirm());
  assert.equal(saved.length,1);assert.equal(saved[0][0],'payable');assert.equal(saved[0][1],100);assert.equal(saved[0][3],'2025-10-15');
 }finally{if(r)await act(async()=>r.unmount());}
});

test('dated payment recovery preserves the date and token after lost response and rejects a changed date',async()=>{
 const requests=[];let fail=true,current,r;
 const client={auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},rpc:async(name,args)=>{requests.push([name,args]);return fail?{error:{message:'Resposta perdida'}}:{data:'payable',error:null};},from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,range:async()=>({data:[payable],error:null})};return q;}};
 const e=environment(client),usePayables=e.load('hooks/usePayables.ts').usePayables;
 function Probe(){current=usePayables('owner');return null;}
 try{
  await act(async()=>{r=Renderer.create(React.createElement(Probe));});
  await act(async()=>assert.rejects(current.pay('payable',20,'dated-token','2025-10-15'),/Resposta perdida/));
  await act(async()=>r.unmount());
  await act(async()=>{r=Renderer.create(React.createElement(Probe));});
  await act(async()=>assert.rejects(current.pay('payable',20,'new-token','2025-10-16'),/sem confirmação/));
  assert.equal(requests.length,1);
  fail=false;await act(async()=>current.recoveries[0].run());
  assert.equal(requests[1][0],'record_partner_payable_payment_dated');assert.equal(requests[1][1].p_payment_date,'2025-10-15');assert.equal(requests[1][1].p_payment_id,'dated-token');
  assert.equal(current.recoveries.length,0);
 }finally{if(r)await act(async()=>r.unmount());}
});

test('cash uses the actual payment date, while legacy payments preserve registration dates',()=>{
 const flow=environment().load('lib/financialFlow.ts');
 const rows=flow.actualFinancialFlow([],[],[],[
  {id:'retro',payable_id:'payable',amount:20,created_at:'2026-11-14T12:00:00Z',paid_at:'2026-10-31T15:00:00Z'},
  {id:'old',payable_id:'payable',amount:10,created_at:'2026-09-01T02:00:00Z',paid_at:null},
 ],[payable],[]);
 assert.equal(flow.localDate(rows[0].date),'2026-10-31');assert.equal(flow.localDate(rows[1].date),'2026-08-31');
 assert.equal(rows.reduce((sum,row)=>sum+row.amount,0),-30);
});

test('selecting a supplier preserves the chosen expense category and explicit inventory purchases remain separate', async () => {
 const e=environment(),Component=e.load('components/partner/AccountsModule.tsx').AccountsModule;
 let r;const saved=[];
 const props={kind:'pagar',invoices:[],payables:{accounts:[],loading:false,error:'',reload:async()=>{},pay:async()=>{},create:async account=>{saved.push(account);}},
  branches:[{id:'A',name:'Centro'}],suppliers:[{id:'utility',name:'Empresa fornecedora'}],branchId:'A'};
 try {
  await act(async()=>{r=Renderer.create(React.createElement(Component,props));});
  for(const category of ['energia','fornecedor']) {
   await act(async()=>button(r,'Nova conta a pagar').props.onClick());
   const option=value=>['fornecedor','aluguel','energia','salarios','impostos','outros','retirada'].includes(value)?r.root.findByProps({'aria-label':'Categoria da nova conta'}):r.root.findAllByType('select').find(select=>select.findAllByType('option').some(node=>node.props.value===value));
   await act(async()=>option('energia').props.onChange({target:{value:category}}));
   if(category!=='fornecedor') await act(async()=>r.root.findByProps({'aria-label':'Tipo de despesa'}).props.onChange({target:{value:'variable'}}));
   await act(async()=>option('utility').props.onChange({target:{value:'utility'}}));
   assert.equal(option('energia').props.value,category);
   const description=r.root.findAllByType('label').find(label=>label.children[0]==='Descrição').findByType('input');
   await act(async()=>description.props.onChange({target:{value:'Conta de teste'}}));
   await act(async()=>r.root.findByProps({inputMode:'decimal'}).props.onChange({target:{value:'30,00'}}));
   await act(async()=>r.root.findByProps({'aria-label':'Vencimento'}).props.onChange({target:{value:'2026-10-19'}}));
   await act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){}}));
   assert.equal(saved.at(-1).category,category);assert.equal(saved.at(-1).supplier_id,'utility');assert.equal(saved.at(-1).amount,30);
  }
  assert.equal(saved.length,2);
 } finally {if(r)await act(async()=>r.unmount());}
});

test('Financeiro uses civil due date, excludes cancelled balances and resets another branch draft',async()=>{
 const oldTZ=process.env.TZ;process.env.TZ='America/Sao_Paulo';
 const e=environment(),Component=e.load('components/partner/FinancialModule.tsx').FinancialModule;let r;
 const props={invoices:[invoice],creditLimit:1000,creditUsed:100,onPayInvoice:async()=>{}};
 try{
  await act(async()=>{r=Renderer.create(React.createElement(Component,props));});assert.match(JSON.stringify(r.toJSON()),/20\/10\/2026/);
  await act(async()=>button(r,'Amortizar').props.onClick());assert.equal(r.root.findAllByType('form').length,1);
  await act(async()=>r.update(React.createElement(Component,{...props,invoices:[{...invoice,id:'B',branch_id:'B'}]})));assert.equal(r.root.findAllByType('form').length,0);
  await act(async()=>r.update(React.createElement(Component,{...props,invoices:[{...invoice,status:'cancelada'}]})));
  const cells=r.root.findAllByType('tr')[1].findAllByType('td');assert.match(cells[4].children.join(''),/0,00/);assert.doesNotMatch(cells[4].children.join(''),/100,00/);
 }finally{if(r)await act(async()=>r.unmount());if(oldTZ===undefined)delete process.env.TZ;else process.env.TZ=oldTZ;}
});

test('financial persistence isolates actors, discovers legacy receipts and rejects changed requests',()=>{
 const e=environment(),{InvoicePaymentAttempts,FinancialOperationAttempts}=e.load('lib/invoicePayments.ts');
 e.storage.setItem('distrihub-invoice-payment:owner:owner:legacy',JSON.stringify({token:'legacy-token',amount:100}));
 const receipts=new InvoicePaymentAttempts(e.storage);assert.equal(receipts.list('owner:owner')[0].invoiceId,'legacy');assert.equal(receipts.list('employee:owner').length,0);
 const store=new FinancialOperationAttempts(e.storage),payload={kind:'rma-credit',rmaId:'rma',invoiceId:'invoice',amount:20};
 assert.equal(store.get('owner:owner',payload,'first').token,'first');assert.equal(store.get('owner:owner',payload,'second').token,'first');assert.throws(()=>store.get('owner:owner',{...payload,amount:30},'second'),/sem confirmação/);assert.equal(store.pending('other:other','rma-credit'),null);
 store.confirm('owner:owner','rma-credit');assert.equal(store.pending('owner:owner','rma-credit'),null);
});

test('payables refuse unconfirmed replies, preserve the exact request and never call server if storage fails',async()=>{
 let calls=0,confirmed=false;const client={auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},rpc:async()=>{calls++;return {data:confirmed?'payable':null,error:null};},from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,range:async()=>({data:[payable],error:null})};return q;}};
 const e=environment(client),usePayables=e.load('hooks/usePayables.ts').usePayables;let current,r;
 function Probe(){current=usePayables('owner');return null;}
 await act(async()=>{r=Renderer.create(React.createElement(Probe));});await act(async()=>assert.rejects(current.pay('payable',20,'first'),/não confirmou/));assert.equal(current.recoveries.length,1);
 confirmed=true;await act(async()=>current.recoveries[0].run());assert.equal(current.recoveries.length,0);
 const originalSet=e.storage.setItem;e.storage.setItem=()=>{throw new Error('Storage indisponível');};await act(async()=>assert.rejects(current.pay('payable',20,'second'),/Storage indisponível/));assert.equal(calls,2);e.storage.setItem=originalSet;await act(async()=>r.unmount());
});

test('Accounts closes branch drafts, ignores late failure and blocks duplicate recovery clicks',async()=>{
 const e=environment(),Component=e.load('components/partner/AccountsModule.tsx').AccountsModule;let r,finish,calls=0;
 const props={kind:'pagar',invoices:[],payables:{accounts:[payable],loading:false,error:'',reload:async()=>{},create:async()=>{},pay:()=>new Promise((_resolve,reject)=>finish=reject)},branches:[{id:'A',name:'A'},{id:'B',name:'B'}],suppliers:[],branchId:'A'};
 await act(async()=>{r=Renderer.create(React.createElement(Component,props));});await act(async()=>button(r,'Nova conta a pagar').props.onClick());
 await act(async()=>r.update(React.createElement(Component,{...props,branchId:'B'})));assert.equal(r.root.findAllByType('form').length,0);
 await act(async()=>r.update(React.createElement(Component,props)));await act(async()=>button(r,'Registrar pagamento').props.onClick());let pending;
 act(()=>{pending=r.root.findByType('form').props.onSubmit({preventDefault(){}});});await act(async()=>r.update(React.createElement(Component,{...props,branchId:'B'})));await act(async()=>{finish(new Error('Late failure'));await pending;});assert.equal(r.root.findAllByProps({role:'alert'}).length,0);
 const action={id:'recover',label:'Recuperar operação',run:()=>{calls++;return new Promise(resolve=>finish=resolve);}};
 await act(async()=>r.update(React.createElement(Component,{...props,recoveries:[action]})));const recover=button(r,'Recuperar operação');act(()=>{recover.props.onClick();recover.props.onClick();});assert.equal(calls,1);await act(async()=>finish());await act(async()=>r.unmount());
});

test('payables recover exact persisted creation/payment after remount and refresh failure cannot invent failure',async()=>{
 let first=true,readFails=false;const requests=[];
 const client={auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},rpc:async(name,args)=>{requests.push([name,args]);if(first){first=false;return {error:{message:'Resposta perdida'}};}return {data:name==='create_partner_payable'?args.p_id:args.p_payable_id,error:null};},from:()=>{
  const q={select:()=>q,eq:()=>q,order:()=>q,range:async()=>readFails?{data:null,error:{message:'Consulta indisponível'}}:{data:[payable],error:null}};return q;
 }};
 const e=environment(client),usePayables=e.load('hooks/usePayables.ts').usePayables;let current,r;
 function Probe(){current=usePayables('owner');return null;}
 await act(async()=>{r=Renderer.create(React.createElement(Probe));});await act(async()=>assert.rejects(current.pay('payable',20,'original-token'),/Resposta perdida/));await act(async()=>r.unmount());
 await act(async()=>{r=Renderer.create(React.createElement(Probe));});assert.equal(current.recoveries.length,1);
 await act(async()=>assert.rejects(current.pay('payable',30,'new-token'),/sem confirmação/));assert.equal(requests.length,1);
 readFails=true;await act(async()=>current.recoveries[0].run());assert.equal(requests[1][1].p_payment_id,'original-token');assert.equal(current.recoveries.length,0);assert.match(current.error,/Consulta indisponível/);
 readFails=false;first=true;const account={branch_id:'A',supplier_id:null,description:'Conta',creditor_name:'Credor',category:'outros',amount:50,due_date:'2026-10-20'};
 await act(async()=>assert.rejects(current.create(account,'create-token'),/Resposta perdida/));await act(async()=>r.unmount());await act(async()=>{r=Renderer.create(React.createElement(Probe));});
 await act(async()=>current.recoveries[0].run());assert.equal(requests.at(-1)[1].p_id,'create-token');assert.equal(current.recoveries.length,0);await act(async()=>r.unmount());
});

test('refunds enter actual flow once at their server date and never enter projected flow',()=>{
 const e=environment(),flow=e.load('lib/financialFlow.ts');
 const sale={id:'sale',branch_id:'A',status:'concluida',total:100,payment_method:'dinheiro',created_at:'2026-10-15',customer_name:'Cliente'};
 const refund={id:'rma',user_id:'owner',branch_id:'A',refund_request_id:'refund',refund_amount:40,refunded_at:'2026-10-15T01:00:00Z'};
 const rows=flow.actualFinancialFlow([sale],[],[],[],[],[],[refund,{...refund}]);assert.equal(rows.length,2);assert.equal(rows.reduce((sum,row)=>sum+row.amount,0),60);assert.equal(rows[1].date,refund.refunded_at);assert.equal(flow.localDate(refund.refunded_at),'2026-10-14');assert.equal(flow.projectedFinancialFlow([],[]).length,0);
});

test('flow loads every refund page, respects company/branch and reports missing refund data as unavailable',async()=>{
 let fail=false,currentRows=Array.from({length:500},(_,i)=>({id:'zero-'+i,user_id:'owner',branch_id:'A',refund_amount:0}));currentRows.push({id:'refund',user_id:'owner',branch_id:'A',refund_request_id:'request',refund_amount:40,refunded_at:'2026-10-15T12:00:00Z'});currentRows.push({id:'other',user_id:'owner',branch_id:'B',refund_amount:90,refunded_at:'2026-10-15T12:00:00Z'});
 const client={auth:{getUser:async()=>({data:{user:{id:'owner'}},error:null})},from:table=>{const q={select:()=>q,eq:()=>q,order:()=>q,range:async(first,last)=>table==='rma_requests_v2'?(fail?{data:null,error:{message:'Refund read failed'}}:{data:currentRows.slice(first,last+1),error:null}):{data:[],error:null}};return q;}};
 const e=environment(client),Component=e.load('components/partner/FinancialFlowModule.tsx').FinancialFlowModule;let r;
 const props={userId:'owner',branchId:'A',invoices:[],payables:[],movements:[],sales:[{id:'sale',user_id:'owner',branch_id:'A',status:'concluida',total:100,payment_method:'dinheiro',created_at:'2026-10-15',customer_name:'Cliente'}],payablesUnavailable:false};
 await act(async()=>{r=Renderer.create(React.createElement(Component,props));});await act(async()=>r.root.findByType('select').props.onChange({target:{value:'custom'}}));const dates=r.root.findAllByType('input');await act(async()=>dates[0].props.onChange({target:{value:'2026-10-01'}}));await act(async()=>dates[1].props.onChange({target:{value:'2026-10-31'}}));
 assert.match(JSON.stringify(r.toJSON()),/60,00/);assert.doesNotMatch(JSON.stringify(r.toJSON()),/90,00/);
 fail=true;await act(async()=>button(r,'Atualizar').props.onClick());assert.match(JSON.stringify(r.toJSON()),/Refund read failed/);assert.match(JSON.stringify(r.toJSON()),/Indisponível/);await act(async()=>r.unmount());
});

test('compact status filter separates archived accounts and keeps totals stable',async()=>{
 const e=environment(),Component=e.load('components/partner/AccountsModule.tsx').AccountsModule;let r;
 const props={kind:'pagar',invoices:[],payables:{accounts:[payable,{...payable,id:'paid',description:'Paid record',paid_amount:100,status:'paga'},{...payable,id:'deleted',description:'Archived record',status:'cancelada',deleted_at:'2026-11-14T15:00:00Z'}],loading:false,error:''},branches:[{id:'A',name:'Matriz'}],suppliers:[],branchId:'A'};
 try {
  await act(async()=>{r=Renderer.create(React.createElement(Component,props));});
  const menu=r.root.findByProps({className:'accounts-status-filter'});assert.equal(menu.props.open,undefined);
  assert.equal(r.root.findByProps({className:'report-cards financial-accounts-totals'}).findAllByType('strong').length,3);
  await act(async()=>button(r,'Todas').props.onClick());
  assert.match(JSON.stringify(r.root.findByType('summary').children),/Todas/);
  assert.doesNotMatch(JSON.stringify(r.toJSON()),/Archived record/);
  const totals=r.root.findByProps({className:'report-cards financial-accounts-totals'}).findAllByType('strong').map(node=>node.children.join(''));
  await act(async()=>button(r,'Excluídas').props.onClick());
  assert.match(JSON.stringify(r.toJSON()),/Archived record/);
  assert.match(JSON.stringify(r.toJSON()),/Exibindo contas/);
  assert.equal(button(r,'Excluídas').props['aria-pressed'],true);
  assert.deepEqual(r.root.findByProps({className:'report-cards financial-accounts-totals'}).findAllByType('strong').map(node=>node.children.join('')),totals);
  await act(async()=>r.update(React.createElement(Component,{...props,kind:'receber',invoices:[invoice]})));
  assert.equal(button(r,'Excluídas'),undefined);
 }finally{if(r)await act(async()=>r.unmount());}
});
