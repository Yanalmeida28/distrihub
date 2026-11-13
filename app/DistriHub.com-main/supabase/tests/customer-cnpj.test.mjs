import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require=createRequire(import.meta.url);
const cnpj='59334368000139';
function setup(lookup) {
  const exports={},timers=new Map();let timer=0;
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../src/components/partner/CustomerCnpjLookup.tsx',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020},
  }).outputText,{exports,Error,window:{setTimeout:cb=>{timers.set(++timer,cb);return timer;},clearTimeout:id=>timers.delete(id)},require:name=>
    name==='../../lib/cnpjLookup'?{numericCnpj:s=>s.replace(/\D/g,''),canLookupCnpj:s=>s===cnpj,lookupCnpj:lookup}:require(name)});
  return {Component:exports.CustomerCnpjLookup,flush:async()=>act(async()=>{for(const callback of timers.values())callback();timers.clear();})};
}
const result={legal_name:'Empresa consultada',trade_name:'Fantasia',address:'Rua teste',address_number:'10',complement:'Sala 1',neighborhood:'Centro',city:'Manaus',state:'AM',zip_code:'69000000'};

test('cliente CNPJ: consulta não salva, prévia aplica dados completos somente após ação explícita',async()=>{
  let applied;const {Component,flush}=setup(async()=>result);let r;
  await act(async()=>{r=Renderer.create(React.createElement(Component,{document:cnpj,onApply:(...args)=>{applied=args;}}));});
  await flush();assert.equal(applied,undefined);assert.match(JSON.stringify(r.toJSON()),/Empresa consultada/);
  await act(async()=>r.root.findAllByType('button').find(b=>b.children.includes('Preencher apenas campos vazios')).props.onClick());
  assert.equal(applied[1],false);assert.equal(applied[0].name,result.legal_name);assert.equal(applied[0].trade_name,result.trade_name);
  assert.equal(applied[0].address_number,'10');assert.equal(applied[0].zip_code,'69000000');
  for(const key of ['branch_id','credit_limit','allow_credit','state_registration','simples_nacional'])assert.equal(applied[0][key],undefined);
  await act(async()=>r.unmount());
});

test('cliente CNPJ: cadastro rápido mantém número, complemento, UF e CEP no endereço disponível',async()=>{
  let applied;const {Component,flush}=setup(async()=>result);let r;
  await act(async()=>{r=Renderer.create(React.createElement(Component,{document:cnpj,basic:true,onApply:(...args)=>{applied=args;}}));});
  await flush();await act(async()=>r.root.findAllByType('button').find(b=>b.children.includes('Substituir campos consultados')).props.onClick());
  assert.equal(applied[1],true);assert.equal(applied[0].address,'Rua teste, 10, Sala 1, AM, 69000000');assert.equal(applied[0].city,'Manaus');
  await act(async()=>r.unmount());
});

test('cliente CNPJ: CPF não consulta e resposta antiga não aparece ao trocar documento',async()=>{
  let calls=0,finish;const {Component,flush}=setup(async()=>{calls++;return new Promise(resolve=>{finish=resolve;});});let r;
  const props={onApply:()=>assert.fail('Não deve aplicar')};
  await act(async()=>{r=Renderer.create(React.createElement(Component,{...props,document:'52998224725'}));});
  await flush();assert.equal(calls,0);
  await act(async()=>r.update(React.createElement(Component,{...props,document:cnpj})));await flush();assert.equal(calls,1);
  await act(async()=>r.update(React.createElement(Component,{...props,document:'52998224725'})));
  await act(async()=>finish(result));assert.equal(r.toJSON(),null);
  await act(async()=>r.unmount());
});

test('cliente CNPJ: falha na consulta não disponibiliza preenchimento e permite tentar novamente',async()=>{
  const {Component,flush}=setup(async()=>{throw new Error('Consulta indisponível');});let r;
  await act(async()=>{r=Renderer.create(React.createElement(Component,{document:cnpj,onApply:()=>assert.fail('Não deve aplicar')}));});
  await flush();assert.match(JSON.stringify(r.toJSON()),/Consulta indisponível/);
  assert.equal(r.root.findAllByType('button').length,1);await act(async()=>r.unmount());
});
