import { intelligenceHarness } from './fixtures/business_intelligence_helpers.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
import { pdvHelpers } from './fixtures/pdv_helpers.mjs';
import { personalizationHelpers } from './fixtures/personalization_helpers.mjs';

const sale = { id:'sale', customer_name:'Cliente', customer_id:'customer', branch_id:'branch', salesperson_id:null,
  items:[{product_id:'product',name:'Peça',quantity:1,unit_price:100}], total:100, freight_fee:15,
  payment_method:'pix', status:'concluida', created_at:new Date().toISOString() };
const currency = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
test('split payment revenue excludes freight and retry cannot change the allocated payments',()=>{
  const mixed={...sale,payment_method:'misto',payment_splits:[{method:'dinheiro',amount:50},{method:'pix',amount:65}]};
  assert.equal(pdvHelpers.splitPaymentError(115,mixed.payment_splits),null);
  const revenue=pdvHelpers.saleRevenuePayments(mixed);
  assert.equal(revenue.reduce((sum,payment)=>sum+Math.round(payment.amount*100),0),10000);
  assert.equal(revenue[0].amount,43.48); assert.equal(revenue[1].amount,56.52);
  const values=new Map();
  const store=new pdvHelpers.PdvSaleAttemptStore({getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},'split');
  store.begin(mixed);
  assert.deepEqual(JSON.parse(JSON.stringify(store.read().payment_splits)),mixed.payment_splits);
  assert.throws(()=>store.begin({...mixed,payment_splits:[{method:'dinheiro',amount:40},{method:'pix',amount:75}]}),/resultado pendente/);
});

test('split payment receipt and sharing state the exact cash and PIX amounts',async()=>{
  const mixed={...sale,payment_method:'misto',payment_splits:[{method:'dinheiro',amount:50},{method:'pix',amount:65}]};
  function element(tag){return {tag,children:[],style:{},append(...nodes){this.children.push(...nodes);},textContent:''};}
  const document={head:element('head'),body:element('body'),documentElement:{},createElement:element,images:[]};
  const print=await load('salePrint',{open:()=>({document,requestAnimationFrame(){},focus(){},print(){}})});
  print.printSale(mixed,'receipt');
  function texts(node){return [node.textContent,...node.children.flatMap(texts)];}
  const expected=`Pagamento: Dinheiro: ${currency.format(50)} + PIX: ${currency.format(65)}`;
  assert.ok(texts(document.body).includes(expected));
  const share=await load('saleShare');
  assert.ok(decodeURIComponent(share.saleShareUrl(mixed,'whatsapp',{name:'Cliente',phone:'11999999999'})).includes(expected));
});
async function load(name, window, directPrint, document) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(await readFile(new URL(`../../src/lib/${name}.ts`,import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
  }).outputText,{exports,window,document,require(name){
    if(name==='./directPrint')return directPrint ?? {printerPreferences:()=>null,sendReceipt:async()=>{}};
    if(name==='./adminDashboard')return intelligenceHarness().load('lib/adminDashboard.ts');
    if(name==='./pdv')return pdvHelpers;
    if(name==='./personalization')return personalizationHelpers;
    if(name==='../utils')return {money:currency};
    throw Error(name);
  }});
  return exports;
}

test('return credit source survives a reload, cannot change on retry, and is identified on the receipt',async()=>{
 const credited={...sale,rma_credit_id:'rma-50',payment_method:'misto',payment_splits:[{method:'credito_rma',amount:50},{method:'pix',amount:65}]};
 const values=new Map();const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 new pdvHelpers.PdvSaleAttemptStore(storage,'credit').begin(credited);
 const reloaded=new pdvHelpers.PdvSaleAttemptStore(storage,'credit');
 assert.equal(reloaded.read().rma_credit_id,'rma-50');
 assert.throws(()=>reloaded.begin({...credited,rma_credit_id:'another-credit'}),/resultado pendente/);
 function element(tag){return {tag,children:[],style:{},append(...nodes){this.children.push(...nodes);},textContent:''};}
 const document={head:element('head'),body:element('body'),documentElement:{},createElement:element,images:[]};
 const print=await load('salePrint',{open:()=>({document,requestAnimationFrame(){},focus(){},print(){}})});
 print.printSale(credited,'receipt');
 const texts=node=>[node.textContent,...node.children.flatMap(texts)];
 assert.ok(texts(document.body).includes(`Pagamento: Crédito de devolução: ${currency.format(50)} + PIX: ${currency.format(65)}`));
});

test('browser and direct receipts preserve saved text and identify the sale branch across units',async()=>{
  const branches=[{id:'wholesale',name:'Saunier Atacado',address:'Rua Atacado'}, {id:'retail',name:'Saunier Varejo',address:'Rua Varejo'}];
  for(const direct of [false,true])for(const branch of branches){
    function element(tag){return {tagName:tag.toUpperCase(),children:[],style:{},append(...nodes){this.children.push(...nodes);},textContent:''};}
    const document={head:element('head'),body:element('body'),documentElement:{},createElement:element,images:[]};
    document.implementation={createHTMLDocument:()=>document};
    let sent='';
    const print=await load('salePrint',{open:()=>({document,requestAnimationFrame(){},focus(){},print(){}})},
      {printerPreferences:()=>direct?{name:'test',width:'80',mode:'text'}:null,sendReceipt:async text=>{sent=text;}},document);
    await print.printSale({...sale,branch_id:branch.id},'receipt',{
      companyName:'Company account',companyAddress:'Wrong selected branch',branches,
      settings:{show_cnpj_on_receipt:true,receipt_footer_text:'Footer\nSecond line',personalization:{receipt:{header_text:'Custom header'}}},
    });
    const texts=node=>[node.textContent,...node.children.flatMap(texts)];
    const output=direct?sent:texts(document.body).join('\n');
    for(const expected of [branch.name,branch.address,'Custom header','Footer\nSecond line'])assert.ok(output.includes(expected),`${direct}: ${expected}`);
    assert.ok(!output.includes('Wrong selected branch'));
    assert.ok(!output.includes(branches.find(other=>other.id!==branch.id).address));
  }
});

test('unknown sale branch never falls back to another unit address',async()=>{
  function element(tag){return {children:[],style:{},append(...nodes){this.children.push(...nodes);},textContent:''};}
  const document={head:element('head'),body:element('body'),documentElement:{},createElement:element,images:[]};
  const print=await load('salePrint',{open:()=>({document,requestAnimationFrame(){},focus(){},print(){}})});
  print.printSale(sale,'receipt',{companyName:'Company',companyAddress:'Other unit address',branches:[],settings:{show_cnpj_on_receipt:true}});
  const texts=node=>[node.textContent,...node.children.flatMap(texts)];
  assert.ok(!texts(document.body).join('\n').includes('Other unit address'));
});

test('connected printers default to the personalized document without submitting a text job',async()=>{
  for(const mode of [undefined,'personalized','invalid']) {
    function element(tag){return {tagName:tag.toUpperCase(),children:[],style:{},append(...nodes){this.children.push(...nodes);},textContent:''};}
    const document={head:element('head'),body:element('body'),documentElement:{},createElement:element,images:[]};
    let opened=0, sent=0;
    const popup={document,requestAnimationFrame(){},focus(){},print(){}};
    const print=await load('salePrint',{open:()=>{opened++;return popup;}},
      {printerPreferences:()=>({name:'Connected thermal printer',width:'80',mode}),sendReceipt:async()=>{sent++;}});
    assert.equal(print.directReceiptEnabled(),false);
    print.printSale(sale,'receipt',{companyName:'Store',settings:{show_logo_on_receipt:true,logo_url:'data:image/png;base64,test',receipt_footer_text:'Footer',personalization:{receipt:{paper_width:'58',font_size:16,header_text:'Header'}}}});
    assert.equal(opened,1);assert.equal(sent,0);
    const css=document.head.children[0].textContent;
    assert.ok(css.includes('width: 50mm'));assert.ok(css.includes('font: 16px'));
    assert.ok(document.body.children[0].children.some(node=>node.tagName==='IMG'&&node.src==='data:image/png;base64,test'));
  }
});

test('personalization preview uses the receipt renderer without printing even in text mode',async()=>{
  function element(tag){return {tagName:tag.toUpperCase(),children:[],style:{},append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];},textContent:''};}
  const document={head:element('head'),body:element('body'),documentElement:{},createElement:element,images:[]};
  let sent=0,printed=0,opened=0;
  const frame={document,requestAnimationFrame(){printed++;},print(){printed++;},focus(){}};
  const print=await load('salePrint',{open(){opened++;return frame;}},
    {printerPreferences:()=>({name:'Printer',width:'80',mode:'text'}),sendReceipt:async()=>{sent++;}});
  assert.equal(print.directReceiptEnabled(),true);
  await print.printSale(sale,'receipt',{settings:{receipt_footer_text:'Saved footer'}},frame,{previewOnly:true});
  assert.equal(sent,0);assert.equal(printed,0);assert.equal(opened,0);
  const texts=node=>[node.textContent,...node.children.flatMap(texts)];
  assert.ok(texts(document.body).includes('Saved footer'));
  assert.ok(!document.body.children.some(node=>node.tagName==='BUTTON'));
});
test('freight is charged in exact cents, remains in a pending retry and changes its immutable request key',()=>{
  assert.equal(pdvHelpers.saleChargeTotal(sale),115);
  assert.equal(pdvHelpers.saleChargeTotal({total:0.1,freight_fee:0.2}),0.3);
  assert.equal(pdvHelpers.saleChargeTotal({total:100}),100);
  const values=new Map();
  const store=new pdvHelpers.PdvSaleAttemptStore({getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},'test');
  store.begin(sale);
  assert.equal(store.read().freight_fee,15);
  assert.throws(()=>store.begin({...sale,freight_fee:20}),/resultado pendente/);
});
test('printed and shared receipts show merchandise subtotal, freight and full charge',async()=>{
  function element(tag){return {tag,children:[],style:{},append(...nodes){this.children.push(...nodes);},textContent:''};}
  const document={head:element('head'),body:element('body'),documentElement:{},createElement:element,images:[]};
  const popup={document,requestAnimationFrame(){},focus(){},print(){}};
  const print=await load('salePrint',{open:()=>popup});
  print.printSale(sale,'receipt');
  function texts(node){return [node.textContent,...node.children.flatMap(texts)];}
  const output=texts(document.body);
  assert.ok(output.includes(`Frete terceirizado: ${currency.format(15)}`));
  assert.ok(output.includes(`Subtotal produtos/serviços: ${currency.format(100)}`));
  assert.ok(output.includes(`TOTAL: ${currency.format(115)}`));
  const share=await load('saleShare');
  const message=decodeURIComponent(share.saleShareUrl(sale,'whatsapp',{name:'Cliente',phone:'11999999999'}));
  assert.ok(message.includes(`Frete terceirizado: ${currency.format(15)}`));
  assert.ok(message.includes(`Total: ${currency.format(115)}`));
});
test('revenue CSV separates freight from merchandise revenue',async()=>{
  const metrics=await load('reportMetrics');
  const csv=metrics.buildSalesCsv([sale]);
  assert.ok(csv.includes('Frete terceirizado'));
  assert.ok(csv.includes('"100.00";"15.00";"115.00"'));
});

test('receipt preferences apply to actual printing without removing freight or total',async()=>{
  function element(tag){return {tag,children:[],style:{},append(...nodes){this.children.push(...nodes);},textContent:''};}
  const document={head:element('head'),body:element('body'),documentElement:{},createElement:element,images:[]};
  const print=await load('salePrint',{open:()=>({document,requestAnimationFrame(){},focus(){},print(){}})});
  print.printSale(sale,'receipt',{settings:{personalization:{receipt:{paper_width:'58',font_size:14,header_text:'Obrigado!',show_phone:false,show_address:false,show_document:true,show_salesperson:false}}},customer:{document:'12345678900',phone:'11999999999',address:'Rua exemplo'},salespersonName:'Vendedor exemplo'});
  const texts=node=>[node.textContent,...node.children.flatMap(texts)];
  const output=texts(document.body).join('\n');
  assert.ok(document.head.children[0].textContent.includes('width: 50mm'));
  assert.ok(document.head.children[0].textContent.includes('font: 14px'));
  assert.ok(output.includes('Obrigado!'));
  assert.ok(output.includes('CPF/CNPJ do cliente: 12345678900'));
  assert.ok(!output.includes('Telefone:'));
  assert.ok(!output.includes('Endereço:'));
  assert.ok(!output.includes('Colaborador:'));
  assert.ok(output.includes(`TOTAL: ${currency.format(115)}`));
  assert.ok(output.includes('Frete terceirizado:'));
});

test('malformed preferences and phone input fall back to safe choices',()=>{
  const receipt=personalizationHelpers.receiptPreferences({paper_width:'0; color:red',font_size:'999px',show_phone:'false'});
  assert.equal(receipt.paper_width,'80');
  assert.equal(receipt.font_size,12);
  assert.equal(receipt.show_phone,true);
  assert.equal(personalizationHelpers.panelStyle({corners:'invalid'})['--dh-radius'],'12px');
  assert.equal(personalizationHelpers.catalogWhatsappUrl('javascript:alert(1)'),null);
  assert.equal(personalizationHelpers.catalogWhatsappUrl('(11) 99999-9999'),'https://wa.me/5511999999999');
});
