import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
import { PGlite } from '@electric-sql/pglite';
const require = createRequire(import.meta.url);
const cnpjLib = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../src/lib/cnpjLookup.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports:cnpjLib,Error,AbortSignal,Response});
const company='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';

test('cadastro: proprietário e super admin compartilham dados, funcionários só consultam, conflitos e campos inválidos são bloqueados', async () => {
  const db=new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
      CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.admin',true),'false')='true' $$;
      CREATE FUNCTION resolve_partner_pdv_operator(uuid,text,uuid) RETURNS TABLE(company_id uuid,salesperson_id uuid) LANGUAGE sql AS $$
        SELECT coalesce(nullif(current_setting('test.company',true),'')::uuid,auth.uid()),nullif(current_setting('test.staff',true),'')::uuid $$;
      CREATE TABLE partner_profiles(id uuid PRIMARY KEY,business_name text,document text);
      INSERT INTO partner_profiles VALUES('${company}','Empresa sintética','11222333000181'),('${other}','Outra','00000000000000');`);
    await db.exec(readFileSync(new URL('../migrations/20261113162605_company_registration_shared.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('../migrations/20261113165125_company_document_atomic_save.sql',import.meta.url),'utf8'));
    const login=id=>db.query("SELECT set_config('test.uid',$1,false)",[id??'']);
    const get=id=>db.query('SELECT get_company_registration($1) AS s',[id]).then(r=>r.rows[0].s);
    const save=(id,value,expected={})=>db.query('SELECT save_company_registration($1,$2,$3) AS s',[id,value,expected]).then(r=>r.rows[0].s);
    const data={legal_name:'Empresa nova',address:'Rua sintética',address_number:'12',city:'Manaus',state:'am',zip_code:'69000-000',tax_regime:'1'};
    await assert.rejects(get(company),/Sessão/); await assert.rejects(save(company,data),/Sessão/);
    await login(other); await assert.rejects(get(company),/autorizada/); await assert.rejects(save(company,data),/proprietário/);
    await login(company);
    for(const change of [{token:'secret'},{state:'XX'},{zip_code:'123'},{tax_regime:'9'},{address:{}},{legal_name:''}]) {
      await assert.rejects(save(company,{...data,...change}));
    }
    let saved=await save(company,data);
    assert.equal(saved.business_name,'Empresa nova'); assert.equal(saved.registration.zip_code,'69000000'); assert.equal(saved.registration.state,'AM');
    assert.equal((await get(company)).registration.address,'Rua sintética');
    await assert.rejects(save(company,{...data,city:'Outra'},{}),/alterado/);
    await db.exec(`SELECT set_config('test.uid','${other}',false),set_config('test.company','${company}',false),set_config('test.staff','${other}',false)`);
    assert.equal((await get(company)).registration.address,'Rua sintética');
    await assert.rejects(save(company,data,saved.registration),/proprietário/);
    await db.exec("SELECT set_config('test.admin','true',false)");
    saved=await save(company,{...saved.registration,address:'Endereço revisado'},saved.registration);
    assert.equal(saved.registration.address,'Endereço revisado');
    const atomic = (document,expected) => db.query('SELECT save_company_registration_with_document($1,$2,$3,$4,$5) AS s',
      [company,{...saved.registration,address:'Endereço atômico'},saved.registration,document,expected]);
    await assert.rejects(atomic('123','11222333000181'),/CPF/);
    await assert.rejects(atomic('59334368000138','11222333000181'),/CNPJ inválido/);
    await assert.rejects(atomic('59334368000139','documento antigo'),/Documento alterado/);
    assert.equal((await get(company)).registration.address,'Endereço revisado');
    assert.equal((await atomic('59334368000139','11222333000181')).rows[0].s.document,'59334368000139');
    assert.equal((await get(other)).registration.address,undefined);
    await db.exec('SET ROLE anon'); await assert.rejects(get(company),/permission denied/); await assert.rejects(save(company,data),/permission denied/);
  } finally { await db.close(); }
});

function component(rpc,lookup = async()=>{throw new Error('Consulta não esperada');}) {
  const exports={}; const events=new EventTarget();
  const window={addEventListener:(...args)=>events.addEventListener(...args),removeEventListener:(...args)=>events.removeEventListener(...args),dispatchEvent:event=>events.dispatchEvent(event)};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../src/components/CompanyRegistration.tsx',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020},
  }).outputText,{exports,window,Event,Error,require:name=>name==='../lib/supabase'?{supabase:{rpc}}:name==='../lib/cnpjLookup'?{...cnpjLib,lookupCnpj:lookup}:require(name)});
  return exports.CompanyRegistration;
}
const snapshot={business_name:'Empresa sintética',document:'11222333000181',registration:{address:'Rua salva',state:'AM'}};

test('cadastro: fiscal consulta o mesmo registro sem inputs nem ações de gravação',async()=>{
  const calls=[]; const Component=component(async(...args)=>{calls.push(args);return {data:snapshot,error:null};});
  let renderer; await act(async()=>{renderer=Renderer.create(React.createElement(Component,{companyId:company,readOnly:true}));});
  assert.match(JSON.stringify(renderer.toJSON()),/Rua salva/); assert.equal(renderer.root.findAllByType('input').length,0);
  assert.equal(renderer.root.findAllByType('button').length,0); assert.equal(calls[0][0],'get_company_registration');
  await act(async()=>renderer.unmount());
});

test('cadastro: salva com controle de versão, impede clique duplicado e preserva rascunho em conflito',async()=>{
  let submit, calls=0;
  const Component=component(async(name)=>name==='get_company_registration'?{data:snapshot,error:null}:(calls++,new Promise(resolve=>{submit=resolve;})));
  let renderer; await act(async()=>{renderer=Renderer.create(React.createElement(Component,{companyId:company}));});
  const address=renderer.root.findAllByType('input').find(node=>node.props.value==='Rua salva');
  await act(async()=>address.props.onChange({target:{value:'Rua editada'}}));
  act(()=>{const form=renderer.root.findByType('form');form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});});
  assert.equal(calls,1);
  await act(async()=>submit({data:null,error:{code:'40001',message:'conflito'}}));
  assert.match(JSON.stringify(renderer.toJSON()),/outra tela/);
  assert.ok(renderer.root.findAllByType('input').some(node=>node.props.value==='Rua editada'));
  await act(async()=>renderer.unmount());
});

test('cadastro: a confirmação salva é compartilhada com a consulta fiscal',async()=>{
  let current=structuredClone(snapshot),args;
  const Component=component(async(name,input)=>{
    if(name==='save_company_registration_with_document') {
      args=input; current={...current,registration:input.p_registration};
    }
    return {data:current,error:null};
  });
  let editor,viewer;
  await act(async()=>{
    editor=Renderer.create(React.createElement(Component,{companyId:company}));
    viewer=Renderer.create(React.createElement(Component,{companyId:company,readOnly:true}));
  });
  await act(async()=>editor.root.findAllByType('input').find(node=>node.props.value==='Rua salva').props.onChange({target:{value:'Endereço compartilhado'}}));
  await act(async()=>editor.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(args.p_company_id,company); assert.equal(args.p_expected_registration.address,'Rua salva');
  assert.match(JSON.stringify(viewer.toJSON()),/Endereço compartilhado/);
  assert.match(JSON.stringify(editor.toJSON()),/Cadastro da empresa salvo/);
  await act(async()=>{editor.unmount();viewer.unmount();});
});

test('CNPJ: consulta valida documento, restringe campos e nunca deduz regime ou inscrições',async()=>{
  let url,options;
  const result=await cnpjLib.lookupCnpj('59.334.368/0001-39',async(...args)=>{
    [url,options]=args;
    return new Response(JSON.stringify({cnpj:'59334368000139',razao_social:'Empresa teste',logradouro:'DA PAZ',descricao_tipo_de_logradouro:'RUA',cep:'69000-000',
      opcao_pelo_simples:true,opcao_pelo_mei:false,qsa:[{nome_socio:'Não importar'}],inscricao_estadual:'Não importar'}));
  });
  assert.equal(url,'https://brasilapi.com.br/api/cnpj/v1/59334368000139'); assert.equal(options.credentials,'omit');
  assert.equal(result.address,'RUA DA PAZ'); assert.equal(result.zip_code,'69000000');
  assert.equal(result.tax_regime,undefined); assert.equal(result.state_registration,undefined); assert.equal(result.qsa,undefined);
  await assert.rejects(cnpjLib.lookupCnpj('00000000000000',()=>{throw Error('Não deve consultar');}),/válido/);
  await assert.rejects(cnpjLib.lookupCnpj('59334368000139',async()=>new Response('{}',{status:429})),/Limite/);
  await assert.rejects(cnpjLib.lookupCnpj('59334368000139',async()=>new Response(JSON.stringify({cnpj:'outro',razao_social:'Errada'}))),/outro CNPJ/);
  await assert.rejects(cnpjLib.lookupCnpj('59334368000139',async()=>{throw Error('timeout');}),/indisponível/);
});

test('CNPJ: mostra sugestões sem salvar nem sobrescrever, preenchimento de vazios preserva as inscrições',async()=>{
  let writes=0;
  const Component=component(async(name)=>{if(name!=='get_company_registration')writes++;return {data:{...snapshot,registration:{address:'Rua salva',state_registration:'123'}},error:null};},
    async()=>({legal_name:'Razão consultada',address:'Rua consultada',city:'Manaus'}));
  let r; await act(async()=>{r=Renderer.create(React.createElement(Component,{companyId:company}));});
  const input=()=>r.root.findByProps({'aria-label':'CNPJ / CPF da empresa'});
  await act(async()=>input().props.onChange({target:{value:'59334368000139'}}));
  await act(async()=>input().props.onBlur());
  assert.equal(writes,0); assert.ok(r.root.findAllByType('input').some(i=>i.props.value==='Rua salva'));
  await act(async()=>r.root.findAllByType('button').find(b=>b.children.includes('Preencher apenas campos vazios')).props.onClick());
  assert.ok(r.root.findAllByType('input').some(i=>i.props.value==='Rua salva'));
  assert.ok(r.root.findAllByType('input').some(i=>i.props.value==='123'));
  assert.ok(r.root.findAllByType('input').some(i=>i.props.value==='Manaus')); assert.equal(writes,0);
  await act(async()=>r.unmount());
});

test('CNPJ: uma consulta por vez e resposta antiga é ignorada após mudar o documento',async()=>{
  let finish,calls=0;
  const Component=component(async()=>({data:snapshot,error:null}),async()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
  let r;await act(async()=>{r=Renderer.create(React.createElement(Component,{companyId:company}));});
  const input=()=>r.root.findByProps({'aria-label':'CNPJ / CPF da empresa'});
  await act(async()=>input().props.onChange({target:{value:'59334368000139'}}));
  act(()=>{input().props.onBlur();input().props.onBlur();}); assert.equal(calls,1);
  await act(async()=>input().props.onChange({target:{value:'11222333000181'}}));
  await act(async()=>finish({legal_name:'Resposta antiga'}));
  assert.doesNotMatch(JSON.stringify(r.toJSON()),/Resposta antiga/);
  await act(async()=>r.unmount());
});
