import {useEffect,useState} from 'react';
import {BookOpen,Search,ArrowLeft,ArrowRight} from 'lucide-react';
import type {SaasPlanId} from '../../lib/saas';
import {filterHelpGuides,helpPlanFeatures,helpPlanNames,helpPlanDescriptions,helpResourcesFor} from '../../lib/helpGuides';
import {planCatalog} from '../../lib/planCatalog';
import './HelpModule.css';

type Props={planId?:SaasPlanId;features?:string[];plans?:{id:SaasPlanId;features:string[]}[];focusModule?:string;allowedModules:string[];onNavigate:(module:string)=>void;onBack:()=>void};
export function HelpModule({planId,features,plans,focusModule,allowedModules,onNavigate,onBack}:Props){
 const [viewPlan,setViewPlan]=useState<SaasPlanId>(planId??'basico');
 const [search,setSearch]=useState('');
 useEffect(()=>{if(planId)setViewPlan(planId);},[planId]);
 const available=viewPlan===planId && features ? features : plans?.find(plan=>plan.id===viewPlan)?.features??helpPlanFeatures[viewPlan];
 const guides=filterHelpGuides(available,search);
 const plan=planCatalog[viewPlan];
 const overview=helpPlanDescriptions[viewPlan];
 const resources=helpResourcesFor(available);
 return <section className="help-center" aria-labelledby="help-title">
  <header className="help-header">
   <div><p className="help-eyebrow">GUIA DO DISTRiHUB</p><h2 id="help-title"><BookOpen size={25}/> Como usar o app</h2><p>Passo a passo para trabalhar com segurança, da entrada no app à impressão da etiqueta.</p></div>
   <button type="button" className="rma-advance-btn" onClick={onBack}><ArrowLeft size={16}/> Voltar ao app</button>
  </header>
  <div className="help-controls">
   <label>Guias por plano<select aria-label="Plano dos guias de ajuda" value={viewPlan} onChange={event=>setViewPlan(event.target.value as SaasPlanId)}>
    {Object.entries(helpPlanNames).map(([id,name])=><option key={id} value={id}>{name}{id===planId?' · Plano da conta':''}</option>)}
   </select></label>
   <label><span><Search size={15}/> O que você quer fazer?</span><input type="search" aria-label="Buscar na ajuda" placeholder="Ex.: etiqueta, PIN, abrir caixa, devolução…" value={search} onChange={event=>setSearch(event.target.value)}/></label>
  </div>
  <div className="help-plan-note">
   <strong>Você está consultando o guia {helpPlanNames[viewPlan]}.</strong>
   <p>{overview.purpose}</p>
   <small>Consultar outro plano não altera sua assinatura. As telas e ações disponíveis também dependem da função, da filial e das permissões do operador.</small>
   {!planId&&<p>Confirme seu acesso para identificar o plano da conta. Enquanto isso, você pode consultar os guias sem visualizar dados da loja.</p>}
  </div>
  {!search.trim()&&<section className="help-plan-overview" aria-label={'Recursos e limites do plano '+helpPlanNames[viewPlan]}>
   <h3>Entenda o plano {helpPlanNames[viewPlan]}</h3>
   <dl className="help-plan-limits">
    <div><dt>Filiais incluídas</dt><dd>{plan.branches} {plan.branches===1?'filial':'filiais'}</dd></div>
    <div><dt>Dispositivos simultâneos</dt><dd>{plan.devices} por filial</dd></div>
    <div><dt>Relatórios neste guia</dt><dd>{available.includes('relatorios_avancados')?'Simples e avançados':available.includes('relatorios')?'Simples':'Sem recurso de relatórios liberado'}</dd></div>
   </dl>
   <p className="help-limit-note">Estes são os limites padrão do plano. Adicionais, cortesias e condições da sua conta são conferidos pelo proprietário em Configurações → Assinatura DistriHub. Dispositivos são acessos simultâneos por filial, não a quantidade de colaboradores cadastrados.</p>
   {viewPlan==='enterprise'&&<p className="help-tip">Filiais adicionais: {new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(plan.extraBranchPrice)} por filial/mês. A solicitação é analisada pelo Super Admin; os adicionais pagos são liberados após aprovação, autorização da assinatura e confirmação do pagamento correspondente.</p>}
   <details className="help-plan-details" open><summary>O que está incluído neste guia</summary>
    {resources.length?<ul className="help-resource-list">{resources.map(resource=><li key={resource.title}><strong>{resource.title}</strong><span>{resource.text}</span></li>)}</ul>:<p>Não há recursos operacionais liberados para esta conta no momento. O proprietário deve conferir a assinatura e as permissões.</p>}
   </details>
   <details className="help-plan-details"><summary>Por onde começar no {helpPlanNames[viewPlan]}</summary><ol>{overview.start.map(step=><li key={step}>{step}</li>)}</ol><p>Este roteiro descreve o uso padrão do plano. Confirme os recursos liberados na lista acima antes de iniciar.</p></details>
   <p className="help-tip">Um recurso incluído no plano pode exigir permissão do operador. Consultar os guias de outro plano não libera telas nem muda sua assinatura. Para dados de várias filiais e ações exclusivas, use o acesso autorizado do proprietário.</p>
  </section>}
  <p className="help-results" role="status">{guides.length} {guides.length===1?'guia encontrado':'guias encontrados'}</p>
  <div className="help-guides">
   {guides.map(guide=>{
    const destination=guide.id==='proprietario'?(viewPlan==='basico'?'cadastros':'administrativo'):guide.module;
    const canNavigate=destination&&allowedModules.includes(destination)&&(viewPlan===planId);
    return <details className="help-guide" key={viewPlan+':'+guide.id} open={Boolean(search.trim())||Boolean(focusModule&&(guide.module===focusModule||guide.id===focusModule))}>
     <summary><span><strong>{guide.title}</strong><small>{guide.summary}</small></span><span className="help-guide-toggle" aria-hidden="true">+</span></summary>
     <div className="help-guide-body"><ol>{guide.steps.map((step,index)=><li key={index}>{step}</li>)}</ol>
      {guide.note&&<p className="help-tip">{guide.note}</p>}
      {canNavigate&&<button type="button" className="rma-advance-btn" onClick={()=>onNavigate(destination!)} aria-label={'Abrir '+guide.title+' no app'}>Abrir no app <ArrowRight size={15}/></button>}
     </div>
    </details>;
   })}
  </div>
  {!guides.length&&<div className="module-card"><h3>Nenhum guia encontrado</h3><p>Tente outro termo ou consulte os guias de outro plano.</p><button type="button" className="rma-advance-btn" onClick={()=>setSearch('')}>Limpar busca</button></div>}
  <footer className="help-footer"><strong>Não encontrou o que precisa?</strong><p>Procure o proprietário para ajustes de acesso. Para dúvidas de funcionamento, use o Suporte quando estiver autorizado. Nunca envie senhas nem PINs.</p></footer>
 </section>;
}
