import assert from 'node:assert/strict';
import { test,afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
import { personalizationHelpers } from './fixtures/personalization_helpers.mjs';
const require=createRequire(import.meta.url);
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
const theme={};
vm.runInNewContext(compile(await readFile(new URL('../../src/lib/storeTheme.ts',import.meta.url),'utf8')),{exports:theme});
const source=compile(await readFile(new URL('../../src/components/PublicCatalogPage.tsx',import.meta.url),'utf8'));
let renderer;
// Controllable timers so the 300 ms search debounce is exercised deterministically.
let timers=new Map(),timerId=0;
const fakeWindow={setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>{timers.delete(id);}};
const flushTimers=async()=>{const due=[...timers.values()];timers.clear();await act(async()=>{due.forEach(timer=>timer.fn());});};
afterEach(async()=>{timers.clear();if(renderer)await act(async()=>renderer.unmount());renderer=null;});
function component(rpc){
  const exports={};
  vm.runInNewContext(source,{exports,Error,window:fakeWindow,require(name){
    if(name==='../lib/supabase')return {supabase:{rpc},isSupabaseConfigured:true};
    if(name==='../lib/personalization')return personalizationHelpers;
    if(name==='../lib/storeTheme')return theme;
    if(name==='./PublicCatalogCheckout')return {PublicCatalogCheckout:()=>null};
    return require(name);
  }});
  return exports.PublicCatalogPage;
}
test('catalog personalization controls welcome text, stock, SKU and contact without reloading after branch resolution',async()=>{
  const calls=[];
  const Component=component(async(name,args)=>{calls.push({name,args});return {error:null,data:{
    settings:{catalog_enabled:true,catalog_slug:'loja',primary_color:'#2563eb',nav_color:'#0f2747',catalog_preferences:{welcome_message:'Bem-vindo à loja!',show_stock:false,show_sku:false,whatsapp_phone:'11999999999'}},
    profile:{business_name:'Loja'},branch:{id:'branch',name:'Centro'},branches:[],selected_branch_id:'branch',total:1,next_offset:null,products:[{id:'p',branch_id:'branch',name:'Produto',sale_price:100,stock:10,sku:'ABC123'}],
  }};});
  await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{slug:'loja',branchSlug:'Centro'}));});
  const output=JSON.stringify(renderer.toJSON());
  assert.ok(output.includes('Bem-vindo à loja!'));
  assert.ok(!output.includes('10 em estoque'));
  assert.ok(!output.includes('ABC123'));
  assert.ok(renderer.root.findAllByType('a').some(link=>link.props.href==='https://wa.me/5511999999999'));
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'read_public_catalog_page');
  assert.equal(calls[0].args.p_branch_slug,'Centro');
});

test('public cart never exposes or derives its quantity limit from inventory', async () => {
  const Component = component(async () => ({ error: null, data: page([
    { id: 'hidden', branch_id: 'a', name: 'Hidden stock', sale_price: 10, available: true },
    { id: 'shown', branch_id: 'a', name: 'Shown stock', sale_price: 10, stock: 2, available: true },
    { id: 'unavailable', branch_id: 'a', name: 'Unavailable', sale_price: 10, available: false },
  ], { settings: { catalog_slug: 'loja', catalog_preferences: { show_stock: false, show_sku: false } } }) }));
  await act(async () => { renderer = TestRenderer.create(React.createElement(Component, { slug: 'loja' })); });
  const checkout = () => renderer.root.findAll(node => typeof node.type === 'function' && Array.isArray(node.props.cart))[0].props;
  const add = renderer.root.findAllByType('button').filter(b => b.children.some(child => typeof child === 'string' && child.includes('Adicionar ao pedido')));
  assert.equal(add[0].props.disabled, false);
  assert.equal(add[2].props.disabled, true);
  await act(async () => { add[0].props.onClick(); add[0].props.onClick(); add[1].props.onClick(); });
  assert.equal(checkout().cart.find(item => item.id === 'hidden').quantity, 2);
  await act(async () => { checkout().onQuantity('hidden', 12); checkout().onQuantity('shown', 12); });
  assert.equal(checkout().cart.find(item => item.id === 'hidden').quantity, 12);
  assert.equal(checkout().cart.find(item => item.id === 'hidden').stock, undefined);
  assert.equal(Object.hasOwn(checkout().cart.find(item => item.id === 'shown'), 'stock'), false);
  assert.equal(checkout().cart.find(item => item.id === 'shown').quantity, 12);
  await act(async () => checkout().onQuantity('hidden', 0));
  assert.ok(!checkout().cart.some(item => item.id === 'hidden'));
});

function page(products, overrides={}) {
  return {settings:{catalog_slug:'loja'},profile:{business_name:'Loja'},branch:null,
    branches:[{id:'a',name:'Centro'},{id:'b',name:'Bairro'}],selected_branch_id:'a',
    products,total:products.length,next_offset:null,...overrides};
}
const product=(id,branch='a')=>({id,branch_id:branch,name:id,sale_price:10,stock:2});

test('catalog appends server pages and sends branch and search filters with a reset offset',async()=>{
  const calls=[];
  const Component=component(async(name,args)=>{
    calls.push({name,...args});
    const data=args.p_search ? page([product('Encontrado','b')],{selected_branch_id:'b'})
      : args.p_branch_id==='b' ? page([product('Bairro','b')],{selected_branch_id:'b'})
      : args.p_offset ? page([product('Segundo')],{total:2})
      : page([product('Primeiro')],{total:2,next_offset:48});
    return {error:null,data};
  });
  await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{slug:'loja'}));});
  const checkout=()=>renderer.root.findAll(node=>typeof node.type==='function'&&Array.isArray(node.props.cart))[0].props;
  await act(async()=>renderer.root.findAllByType('button').find(b=>b.children.some(child=>typeof child==='string'&&child.includes('Adicionar ao pedido'))).props.onClick());
  assert.equal(checkout().cart.length,1);
  await act(async()=>renderer.root.findAllByType('button').find(b=>b.children.includes('Carregar mais produtos')).props.onClick());
  let output=JSON.stringify(renderer.toJSON());
  assert.ok(output.includes('Primeiro')&&output.includes('Segundo'));
  assert.equal(calls.at(-1).p_offset,48);
  assert.equal(checkout().cart.length,1);
  await act(async()=>renderer.root.findByType('select').props.onChange({target:{value:'b'}}));
  assert.equal(checkout().cart.length,0);
  assert.equal(calls.at(-1).p_branch_id,'b');
  assert.equal(calls.at(-1).p_offset,0);
  output=JSON.stringify(renderer.toJSON());
  assert.ok(!output.includes('Primeiro')&&!output.includes('Segundo'));
  const requestsBeforeTyping=calls.length;
  await act(async()=>renderer.root.findByProps({type:'search'}).props.onChange({target:{value:'Encontrado'}}));
  assert.equal(calls.length,requestsBeforeTyping,'typing alone must not query');
  assert.ok([...timers.values()].every(timer=>timer.ms===300));
  await flushTimers();
  assert.equal(calls.at(-1).p_search,'Encontrado');
  assert.equal(calls.at(-1).p_branch_id,'b');
  assert.equal(calls.at(-1).p_offset,0);
  assert.ok(JSON.stringify(renderer.toJSON()).includes('Encontrado'));
});

test('a late page from the previous branch is ignored and a failed page can be retried',async()=>{
  let finishOld,attempts=0;
  const Component=component(async(name,args)=>{
    if(args.p_branch_id==='b')return {error:null,data:page([product('Atual','b')],{selected_branch_id:'b'})};
    if(args.p_offset){
      attempts++;
      if(attempts===1)return {data:null,error:{message:'Falha temporária'}};
      return new Promise(resolve=>{finishOld=resolve;});
    }
    return {error:null,data:page([product('Inicial')],{total:2,next_offset:48})};
  });
  await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{slug:'loja'}));});
  await act(async()=>renderer.root.findAllByType('button').find(b=>b.children.includes('Carregar mais produtos')).props.onClick());
  assert.ok(JSON.stringify(renderer.toJSON()).includes('Inicial'));
  assert.ok(JSON.stringify(renderer.toJSON()).includes('Falha temporária'));
  await act(async()=>renderer.root.findAllByType('button').find(b=>b.children.includes('Tentar novamente')).props.onClick());
  assert.equal(attempts,2);
  await act(async()=>renderer.root.findByType('select').props.onChange({target:{value:'b'}}));
  await act(async()=>finishOld({error:null,data:page([product('Antigo')])}));
  const output=JSON.stringify(renderer.toJSON());
  assert.ok(output.includes('Atual'));
  assert.ok(!output.includes('Antigo')&&!output.includes('Inicial'));
});
test('a disabled or unknown catalog displays an unavailable message',async()=>{
  const Component=component(async()=>({data:null,error:null}));
  await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{slug:'disabled'}));});
  assert.ok(JSON.stringify(renderer.toJSON()).includes('Este catálogo está indisponível'));
  assert.equal(renderer.root.findAllByType('a').length,0);
});

test('navigating to an unavailable store clears the previous store details',async()=>{
  const Component=component(async(name,args)=>({error:null,data:args.p_slug==='loja' ? page([product('Loja anterior')]) : null}));
  await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{slug:'loja'}));});
  assert.ok(JSON.stringify(renderer.toJSON()).includes('Loja anterior'));
  await act(async()=>renderer.update(React.createElement(Component,{slug:'desativada'})));
  const output=JSON.stringify(renderer.toJSON());
  assert.ok(output.includes('Este catálogo está indisponível'));
  assert.ok(!output.includes('Loja anterior'));
  assert.equal(renderer.root.findAllByType('select').length,0);
});

 test('catalog displays availability only and disables ordering unavailable products', async () => {
  const Component = component(async () => ({error:null, data:page([
    {id:'a',name:'Available item',sale_price:10,available:true,stock:9876},
    {id:'b',name:'Unavailable item',sale_price:10,available:false,stock:0}
  ])}));
  await act(async () => { renderer = TestRenderer.create(React.createElement(Component,{slug:'loja'})); });
  const output = JSON.stringify(renderer.toJSON());
  assert.ok(output.includes('Dispon\u00edvel'));
  assert.ok(output.includes('Indispon\u00edvel'));
  assert.ok(!output.includes('9876'));
  assert.ok(!output.includes('em estoque'));
  const buttons = renderer.root.findAllByType('button').filter(b=>b.children.includes(' Adicionar ao pedido'));
  assert.equal(buttons.length,2);
  assert.equal(buttons[0].props.disabled,false);
  assert.equal(buttons[1].props.disabled,true);
});

test('a direct branch link stays fixed without a branch selector', async () => {
  const calls=[];
  const Component=component(async(name,args)=>{calls.push(args);return {error:null,data:page([product('Item da filial')],{branch:{id:'a',name:'Centro'},selected_branch_id:'a'})};});
  await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,{slug:'loja',branchSlug:'Centro'}));});
  assert.equal(calls[0].p_branch_slug,'Centro');
  assert.equal(renderer.root.findAllByType('select').length,0);
  const checkout=renderer.root.findAll(node=>typeof node.type==='function'&&Array.isArray(node.props.cart))[0].props;
  assert.equal(checkout.branchId,'a');
  assert.equal(checkout.branchSlug,'Centro');
});
