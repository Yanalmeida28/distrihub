import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';
import Renderer,{act} from 'react-test-renderer';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require=createRequire(import.meta.url);
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
const guides={};
vm.runInNewContext(compile(await readFile(new URL('../../src/lib/helpGuides.ts',import.meta.url),'utf8')),{exports:guides});
const catalog={};
vm.runInNewContext(compile(await readFile(new URL('../../src/lib/planCatalog.ts',import.meta.url),'utf8')),{exports:catalog});
const components={};
vm.runInNewContext(compile(await readFile(new URL('../../src/components/partner/HelpModule.tsx',import.meta.url),'utf8')),{
 exports:components,require:name=>name.endsWith('/helpGuides')?guides:name.endsWith('/planCatalog')?catalog:name.endsWith('.css')?{}:require(name),
});
test('each plan includes its own guides, Basic includes service orders and advanced modules stay in paid tiers',()=>{
 const ids=plan=>guides.filterHelpGuides(guides.helpPlanFeatures[plan],'').map(g=>g.id);
 assert.ok(ids('basico').includes('os'));
 assert.ok(!ids('profissional').includes('marca-enterprise'));
 assert.ok(ids('enterprise').includes('marca-enterprise'));
 for(const id of ['financeiro','estoque','rma','fiscal','entregas']){assert.ok(!ids('basico').includes(id));assert.ok(ids('profissional').includes(id));assert.ok(ids('enterprise').includes(id));}
 for(const plan of ['basico','profissional','enterprise']){assert.ok(ids(plan).includes('etiquetas'));assert.ok(ids(plan).includes('acesso'));}
 assert.ok(guides.filterHelpGuides(guides.helpPlanFeatures.basico,'codigo de barras').some(g=>g.id==='etiquetas'));
 assert.equal(guides.filterHelpGuides(guides.helpPlanFeatures.basico,'xyz-not-found').length,0);
 assert.equal(new Set(guides.helpGuides.map(g=>g.id)).size,guides.helpGuides.length);
});

test('financial instructions require every related feature and searches find retroactive and monthly guides',()=>{
 const ids=features=>guides.filterHelpGuides(features,'').map(guide=>guide.id);
 assert.ok(!ids(guides.helpPlanFeatures.basico).includes('data-pagamento'));
 for(const plan of ['profissional','enterprise']){
  assert.ok(ids(guides.helpPlanFeatures[plan]).includes('data-pagamento'));
  assert.ok(ids(guides.helpPlanFeatures[plan]).includes('inteligencia-mensal'));
  assert.ok(guides.filterHelpGuides(guides.helpPlanFeatures[plan],'retroativo').some(guide=>guide.id==='despesa-retroativa'));
  assert.ok(guides.filterHelpGuides(guides.helpPlanFeatures[plan],'mes e ano').some(guide=>guide.id==='inteligencia-mensal'));
 }
 assert.ok(!ids(['financeiro','relatorios']).includes('inteligencia-mensal'));
 assert.ok(!ids(['administrativo','financeiro']).includes('inteligencia-mensal'));
 assert.ok(!guides.helpResourcesFor(['financeiro','relatorios']).some(resource=>resource.title==='Inteligência Empresarial'));
 assert.ok(guides.helpResourcesFor(guides.helpPlanFeatures.profissional).some(resource=>resource.title==='Inteligência Empresarial'));
});

test('plan explanations show their standard limits and only list the effective features in the resource cards',async()=>{
 let r;
 const props={planId:'basico',features:guides.helpPlanFeatures.basico,allowedModules:[],onNavigate(){throw Error('unexpected navigation');},onBack(){}};
 try{
  await act(async()=>{r=Renderer.create(React.createElement(components.HelpModule,props));});
  const text=node=>typeof node==='string'?node:(node?.children??[]).map(text).join('');
  const output=()=>text(r.toJSON());
  const resources=()=>r.root.findByProps({className:'help-resource-list'}).findAllByType('strong').map(node=>node.children.join('')).join(' ');
  assert.match(output(),/1 filial/);assert.match(output(),/3 por filial/);assert.doesNotMatch(resources(),/Inteligência Empresarial|Fiscal/);
  await act(async()=>r.root.findByProps({'aria-label':'Plano dos guias de ajuda'}).props.onChange({target:{value:'profissional'}}));
  assert.match(output(),/3 filiais/);assert.match(output(),/5 por filial/);assert.match(resources(),/Inteligência Empresarial|Fiscal/);
  await act(async()=>r.root.findByProps({'aria-label':'Plano dos guias de ajuda'}).props.onChange({target:{value:'enterprise'}}));
  assert.match(output(),/5 filiais/);assert.match(output(),/8 por filial/);assert.match(output(),/39,90/);assert.match(resources(),/Aba Personalização/);
  await act(async()=>r.update(React.createElement(components.HelpModule,{...props,planId:'profissional',features:['cadastros']})));
  assert.doesNotMatch(resources(),/Financeiro|Fiscal|Inteligência Empresarial/);
  await act(async()=>r.update(React.createElement(components.HelpModule,{...props,planId:'profissional',features:[]})));
  assert.match(output(),/Não há recursos operacionais liberados/);
 }finally{if(r)await act(async()=>r.unmount());}
});
test('help respects effective account features and navigation permissions while allowing read-only plan previews',async()=>{
 const calls=[];let r;
 const props={planId:'profissional',features:['cadastros','caixa','configuracoes'],allowedModules:['cadastros'],onNavigate:id=>calls.push(id),onBack(){}};
 await act(async()=>{r=Renderer.create(React.createElement(components.HelpModule,props));});
 try {
  assert.doesNotMatch(JSON.stringify(r.toJSON()),/Acompanhar contas e recebimentos/);
  const action=r.root.findAllByType('button').find(b=>b.props['aria-label']==='Abrir Imprimir etiquetas com QR ou código de barras no app');
  assert.ok(action);await act(async()=>action.props.onClick());assert.deepEqual(calls,['cadastros']);
  assert.equal(r.root.findAllByProps({'aria-label':'Abrir Abrir, acompanhar e fechar o caixa no app'}).length,0);
  await act(async()=>r.root.findByProps({'aria-label':'Plano dos guias de ajuda'}).props.onChange({target:{value:'enterprise'}}));
  assert.match(JSON.stringify(r.toJSON()),/Acompanhar contas e recebimentos/);
  assert.equal(r.root.findAllByType('button').filter(b=>b.props['aria-label']?.endsWith(' no app')).length,0);
  await act(async()=>r.root.findByProps({'aria-label':'Buscar na ajuda'}).props.onChange({target:{value:'xyz-not-found'}}));
  assert.equal(r.root.findAllByProps({className:'help-guide'}).length,0);
  assert.match(JSON.stringify(r.toJSON()),/Nenhum guia encontrado/);
  await act(async()=>r.update(React.createElement(components.HelpModule,{...props,planId:undefined,features:undefined,allowedModules:[]})));
  assert.equal(r.root.findAllByType('button').filter(b=>b.props['aria-label']?.endsWith(' no app')).length,0);
 }finally{await act(async()=>r.unmount());}
});
