import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowUpRight, Calculator, CalendarDays, Lightbulb, ShieldCheck, Sparkles } from 'lucide-react';
import type { PartnerBranch, PartnerCustomer, PartnerInvoice, PartnerProduct, PartnerSale, RmaRequest, StockMovement } from '../../types';
import { money } from '../../utils';
import { useFinancialMovements } from '../../hooks/useFinancialMovements';
import type { PayableAccount } from '../../lib/accounts';
import { buildBusinessIntelligence, intelligenceScope, simulateBusinessGoal } from '../../lib/businessIntelligence';
import type { BusinessInput } from '../../lib/businessIntelligence';
import { adminBusinessDay } from '../../lib/adminDashboard';
import { BreakEvenPanel } from './BreakEvenPanel';

type Props = {
  companyId: string; branchId: string; branches: PartnerBranch[]; isActive: boolean;
  dataReady: boolean; dataError?: string | null; lastSyncedAt?: Date | null;
  sales: PartnerSale[]; products: PartnerProduct[]; customers: PartnerCustomer[]; movements: StockMovement[];
  invoices: PartnerInvoice[]; payables: PayableAccount[]; payablesLoading: boolean; payablesError: string;
  rmas?: RmaRequest[];
  onRefreshPayables?: () => Promise<boolean>;
  onBranchChange: (id: string) => void; onNavigate: (section: 'relatorios' | 'financeiro', target?: 'pagar' | 'receber' | 'sem-giro' | 'inativos' | 'sem-compras') => void;
  timeZone?: string;
  now?: Date;
};

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="report-card admin-kpi-card bi-kpi"><small>{label}</small><strong>{value}</strong><small>{note}</small></div>;
}
const amount = (value: number | null) => value === null || !Number.isFinite(value) ? 'Dados insuficientes' : money.format(value);
const dayLabel = (day: string) => day.split('-').reverse().join('/');
const expenseLabels: Record<string, string> = { fornecedor: 'Fornecedores / compras', aluguel: 'Aluguel', energia: 'Energia', salarios: 'Salários', impostos: 'Impostos', outros: 'Outros' };

export function BusinessIntelligenceModule(props: Props) {
  const { companyId, branchId, branches, isActive, dataReady, dataError, sales, products, customers, movements,
    invoices, rmas, payables, payablesLoading, payablesError, onRefreshPayables, onBranchChange, onNavigate, lastSyncedAt, now: suppliedNow, timeZone } = props;
  const [clock, setClock] = useState(() => new Date());
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [period, setPeriod] = useState<NonNullable<BusinessInput['period']>>('month');
  const [selectedMonth, setSelectedMonth] = useState(() => adminBusinessDay(suppliedNow ?? new Date(), timeZone).slice(0, 7));
  const [customStart, setCustomStart] = useState(() => adminBusinessDay(suppliedNow ?? new Date(), timeZone).slice(0, 7) + '-01');
  const [customEnd, setCustomEnd] = useState(() => adminBusinessDay(suppliedNow ?? new Date(), timeZone));
  const [fixed, setFixed] = useState('');
  const [contribution, setContribution] = useState('');
  const [desired, setDesired] = useState('');
  const [target, setTarget] = useState('');
  const now = suppliedNow ?? clock;
  const validBranch = !branchId || branches.some(branch => branch.user_id === companyId && branch.id === branchId);
  useEffect(() => { setFixed(''); setContribution(''); setDesired(''); setTarget(''); }, [companyId, branchId, isActive]);
  useEffect(() => {
    if (!isActive || suppliedNow) return;
    const refresh = () => setClock(new Date());
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [isActive, suppliedNow]);
  // Only authorized branch data reaches the shared ledger; do not start financial reads while base data is incomplete.
  const scopedInvoices = useMemo(() => intelligenceScope(invoices, companyId, branchId), [invoices, companyId, branchId]);
  const scopedPayables = useMemo(() => intelligenceScope(payables, companyId, branchId), [payables, companyId, branchId]);
  const ledger = useFinancialMovements(companyId, branchId, scopedInvoices, scopedPayables, isActive && validBranch && dataReady && !dataError && !payablesLoading && !payablesError);
  const reloadLedger = ledger.reload;
  const refreshPayables = useRef(onRefreshPayables);
  refreshPayables.current = onRefreshPayables;
  const activatedContext = useRef<string | null>(null);
  useEffect(() => {
    if (!isActive) { activatedContext.current = null; return; }
    if (!validBranch || !dataReady || dataError) return;
    const context = `${companyId}:${branchId}`;
    if (activatedContext.current !== context) {
      activatedContext.current = context;
      void refreshPayables.current?.();
    }
    const refresh = () => { void refreshPayables.current?.(); reloadLedger(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [companyId, branchId, isActive, validBranch, dataReady, dataError, reloadLedger]);
  const model = useMemo(() => buildBusinessIntelligence({ company: companyId, branch: branchId, timeZone, now, days, period, selectedMonth, customStart, customEnd, rmas,
    sales, products, customers, movements, invoices: scopedInvoices, payables: scopedPayables,
    receipts: ledger.receipts, payments: ledger.payments, refunds: ledger.refunds,
  }), [companyId, branchId, timeZone, now, days, period, selectedMonth, customStart, customEnd, rmas, sales, products, customers, movements, scopedInvoices, scopedPayables, ledger.receipts, ledger.payments, ledger.refunds]);
  const simulation = simulateBusinessGoal(fixed, contribution, desired, target, model.currentRevenue);
  const error = !validBranch ? 'A filial selecionada não pertence ao contexto disponível. Selecione uma filial válida.' : dataError || payablesError || ledger.error;
  const loading = !dataReady || payablesLoading || ledger.loading;
  const branchName = branchId ? branches.find(branch => branch.user_id === companyId && branch.id === branchId)?.name ?? 'Filial indisponível' : 'Todas as filiais';

  if (!isActive) return null;
  return <section className="bi-module" aria-label="Inteligência Empresarial">
    <header className="bi-hero">
      <div className="bi-hero-copy"><span className="bi-eyebrow"><Sparkles size={15} /> DECISÕES COM CONTEXTO</span>
        <h4>Inteligência Empresarial</h4><p>Entenda os números, reconheça os sinais e planeje os próximos passos.</p>
        <span className="bi-scope"><ShieldCheck size={14} /> Visão do proprietário · {branchName}</span>
      </div>
      <div className="bi-hero-note"><Lightbulb size={23} /><strong>Clareza antes da decisão</strong><span>Dados registrados, estimativas identificadas e nenhuma ação automática.</span></div>
    </header>
    <div className="admin-filter-bar bi-filters">
      <label>Período de análise<select value={period === 'closed' ? String(days) : period} onChange={event => {
        const value = event.target.value;
        if (value === '7' || value === '30' || value === '90') { setPeriod('closed'); setDays(Number(value) as 7 | 30 | 90); }
        else setPeriod(value as NonNullable<BusinessInput['period']>);
      }}><option value="month">Este mês até hoje</option><option value="previousMonth">Mês passado</option><option value="selectedMonth">Selecionar mês e ano</option><option value="custom">Período personalizado</option><option value="today">Hoje</option><option value="7">Últimos 7 dias encerrados</option><option value="30">Últimos 30 dias encerrados</option><option value="90">Últimos 90 dias encerrados</option></select></label>
      {period === 'selectedMonth' && <label>Mês e ano<input type="month" min="0001-01" max="9998-12" value={selectedMonth} onChange={event => setSelectedMonth(event.target.value)} /></label>}
      {period === 'custom' && <>
        <label>Data inicial<input type="date" value={customStart} onChange={event => setCustomStart(event.target.value)} /></label>
        <label>Data final<input type="date" value={customEnd} onChange={event => setCustomEnd(event.target.value)} /></label>
      </>}
      <label>Filial<select value={branchId} onChange={event => onBranchChange(event.target.value)}><option value="">Visão consolidada</option>{branches.filter(branch => branch.user_id === companyId).map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <button type="button" className="rma-advance-btn" disabled={loading} onClick={() => { ledger.reload(); void onRefreshPayables?.(); }}>Atualizar financeiro</button>
      {!model.periodError && <div className="bi-period"><CalendarDays size={15} /><span>{dayLabel(model.first)} a {dayLabel(model.last)}<small>{timeZone ?? 'America/Sao_Paulo'} · previsão a partir de {dayLabel(model.today)}</small></span></div>}
    </div>
    {model.periodError ? <p className="module-card" role="alert">{model.periodError}</p>
      : error ? <div className="module-card bi-notice" role="alert"><AlertTriangle size={20} /><div><strong>Análise indisponível</strong><p>{error}</p><p>Os valores não serão tratados como zero. Atualize a base no painel para tentar novamente.</p>{ledger.error && <button type="button" className="rma-advance-btn" onClick={ledger.reload}>Tentar novamente os movimentos</button>}</div></div>
      : loading ? <p className="module-card" role="status">Conferindo dados e movimentos financeiros antes de apresentar o diagnóstico…</p>
      : <>
        <section className="bi-section" aria-labelledby="bi-attention">
          <div className="bi-section-heading"><AlertTriangle size={19} /><div><h4 id="bi-attention">O que precisa da sua atenção</h4><p>Situação de hoje, {dayLabel(model.today)} · {branchName}. Independente do período histórico selecionado.</p></div></div>
          <div className="bi-forecast-grid">
            {(['incoming', 'outgoing'] as const).map(kind => <article className="module-card" key={kind}><h5>Contas vencidas — {kind === 'incoming' ? 'a receber' : 'a pagar'}</h5>
              <strong>{model.overdue[kind].length} conta(s) · {amount(kind === 'incoming' ? model.forecast.overdueIncoming : model.forecast.overdueOutgoing)}</strong>
              <p>Saldo em aberto após pagamentos parciais; canceladas excluídas.</p>
              <ul>{model.overdue[kind].slice(0,3).map(row => <li key={row.id}>{row.name} · {dayLabel(row.due)} · {amount(row.balance)}</li>)}</ul>
              <button className="rma-advance-btn" onClick={() => onNavigate('financeiro', kind === 'incoming' ? 'receber' : 'pagar')}>Abrir vencidas {kind === 'incoming' ? 'a receber' : 'a pagar'}</button>
            </article>)}
            <article className="module-card"><h5>Estoque sem giro hoje</h5><strong>{model.stagnant.count} produto(s) · {amount(model.stagnant.totalValue)} em capital estimado conhecido</strong>
              <ul>{[...model.stagnant.items].sort((a,b) => b.tiedUpCapital - a.tiedUpCapital).slice(0,5).map(row => <li key={row.product.id}>{row.product.name} · {row.product.stock} un. · {row.daysWithoutTurnover} dias · {row.costKnown ? amount(row.tiedUpCapital) : 'Custo desconhecido'}{row.costKnown && row.unitCost === 0 ? ' · custo zero: conferir cadastro' : ''}</li>)}</ul>
              {model.stagnant.items.some(row => !row.costKnown) && <p>Valor parcial: há produtos com custo desconhecido.</p>}
              <button className="rma-advance-btn" onClick={() => onNavigate('relatorios', 'sem-giro')}>Abrir relatório Sem giro</button></article>
            <article className="module-card"><h5>Clientes inativos hoje</h5><p>{model.inactiveCount} sem comprar há 90 dias · {model.neverPurchased} sem compras registradas nesta seleção.</p>
              <button className="rma-advance-btn" onClick={() => onNavigate('relatorios', 'inativos')}>Abrir clientes inativos no CRM</button>{' '}
              <button className="rma-advance-btn" onClick={() => onNavigate('relatorios', 'sem-compras')}>Abrir clientes sem compras</button></article>
          </div>
        </section>
        <section className="bi-section" aria-labelledby="bi-comparison"><h4 id="bi-comparison">Comparação de faturamento</h4>
          <p>{dayLabel(model.comparison.first)} a {dayLabel(model.comparison.last)} versus {dayLabel(model.comparison.previousFirst)} a {dayLabel(model.comparison.previousLast)}{model.comparison.cutoff ? ' · mesmo horário de corte: ' + model.comparison.cutoff : ' · dias encerrados'}</p>
          {model.growth === null ? <p>Histórico insuficiente. A comparação exige cobertura desde o início da referência e pelo menos cinco vendas anteriores com valores utilizáveis.</p> : <><p>{amount(model.comparisonRevenue)} versus {amount(model.previousRevenue)} · {model.growth.toFixed(1)}%</p>
            <p>Maiores contribuições observadas à redução em reais. Os registros não comprovam a causa da variação.</p>
            <h5>Produtos</h5>{model.productAnalysisPartial && <p>Análise por produto parcial: os itens não reconciliam com o valor das vendas.</p>}
            <ul>{model.productReductions.map(row => <li key={row.id}>{row.name} · redução de {amount(row.reduction)}</li>)}</ul>
            {!branchId && <><h5>Filiais</h5><ul>{model.branchReductions.map(row => <li key={row.id}>{branches.find(b => b.user_id === companyId && b.id === row.id)?.name ?? 'Sem filial identificada'} · redução de {amount(row.reduction)}</li>)}</ul></>}
          </>}
        </section>
        <section aria-labelledby="bi-result" className="bi-section">
          <div className="bi-section-heading"><Activity size={19} /><div><h4 id="bi-result">Resultado após despesas</h4><p>Vendas, devoluções, custos e despesas cadastradas no período selecionado.</p></div></div>
          <div className={`module-card bi-result-status bi-result-${model.result.status}`} role="status">
            <strong>{model.result.status === 'profit' ? 'Lucro estimado nos registros' : model.result.status === 'loss' ? 'Prejuízo estimado nos registros' : model.result.status === 'balanced' ? 'Resultado estimado em equilíbrio' : 'Resultado incompleto'}</strong>
            <span>{amount(model.result.result)}</span>
            <p>Estimativa gerencial após as despesas cadastradas, usando o vencimento como referência. Não é uma DRE contábil por competência nem comprova que todos os gastos foram informados.</p>
          </div>
          <div className="report-cards bi-kpi-grid">
            <Kpi label="Receita após créditos e reembolsos" value={amount(model.result.netRevenue)} note="Deduzidos na data do registro da devolução financeira; uso posterior do crédito não deduz novamente" />
            <Kpi label="Despesas registradas do período" value={amount(model.result.expenses)} note={`${model.result.expenseCount} conta(s), pelo valor integral e vencimento, incluindo abertas e parcialmente pagas`} />
            <Kpi label="Margem após despesas cadastradas" value={model.result.margin === null ? 'Dados insuficientes' : `${model.result.margin.toFixed(1)}%`} note="Resultado estimado dividido pela receita após créditos e reembolsos" />
            <Kpi label="Movimento de caixa do período" value={amount(model.cashResult)} note="Entradas menos pagamentos e reembolsos registrados; inclui compras e frete, não é lucro nem saldo bancário" />
          </div>
          <details className="module-card bi-calculation" open>
            <summary>Como o resultado foi calculado</summary>
            <dl>
              <div><dt>Vendas concluídas, sem frete de repasse</dt><dd>{amount(model.currentRevenue)}</dd></div>
              <div><dt>(−) Créditos e reembolsos de devoluções</dt><dd>{amount(model.result.returns)}</dd></div>
              <div><dt>(−) Custo dos produtos e serviços vendidos</dt><dd>{amount(model.quality.cost)}</dd></div>
              <div><dt>(+) Custo recuperado em mercadorias reintegradas</dt><dd>{amount(model.result.restoredCost)}</dd></div>
              <div><dt>(−) Despesas cadastradas por vencimento</dt><dd>{amount(model.result.expenses)}</dd></div>
              <div className="bi-calculation-total"><dt>Resultado estimado após despesas</dt><dd>{amount(model.result.result)}</dd></div>
            </dl>
            <p>Pagamento parcial ou quitação não desconta a despesa novamente. Compras de estoque entram no resultado pelo custo das mercadorias vendidas.</p>
            <p>Compras / fornecedores no período: <strong>{amount(model.result.purchases)}</strong> ({model.result.purchaseCount} conta(s)), separadas da dedução de despesas para evitar duplicidade com o custo das vendas. A categoria Fornecedor é tratada como compra de mercadorias; serviços e outros gastos devem ser cadastrados na categoria de despesa correspondente.</p>
          </details>
          {model.result.categories.length > 0 && <div className="module-card bi-quality"><strong>Despesas consideradas no resultado</strong><div className="bi-inline-stats">{model.result.categories.map(row => <span key={row.category}>{expenseLabels[row.category] ?? row.category}: <strong>{amount(row.amount)}</strong> · {row.count} conta(s)</span>)}</div><p>Valores integrais das contas com vencimento no período, independentemente da data em que foram pagas.</p></div>}
          <div className="module-card bi-quality"><strong>O que precisa ser conferido</strong><ul>
            {!model.result.hasExpenseRecords && <li>Nenhuma despesa operacional cadastrada nesta seleção. Compras de fornecedores, sozinhas, não comprovam despesa operacional zero.</li>}
            {model.result.hasExpenseRecords && model.result.expenseCount === 0 && <li>Não há despesas operacionais com vencimento no período. Confira se o cadastro deste período está completo antes de interpretar o resultado.</li>}
            {model.result.undatedExpenses > 0 && <li>{model.result.undatedExpenses} conta(s) sem vencimento válido impedem atribuir todas as despesas ao período.</li>}
            {model.result.invalidExpenses > 0 && <li>{model.result.invalidExpenses} conta(s) com valor ou categoria inválidos impedem concluir o resultado.</li>}
            {!model.result.returnsKnown && <li>Devoluções indisponíveis ou incompletas: {model.result.invalidReturns} registro(s) sem data, vínculo, quantidade ou custo utilizável. O resultado permanece indisponível até a conferência.</li>}
            {model.result.estimatedReturnCosts > 0 && <li>{model.result.estimatedReturnCosts} reintegração(ões) usam custo atual por falta de custo histórico.</li>}
            {model.missingCashHistory > 0 && <li>{model.missingCashHistory} conta(s) têm valores liquidados que não conferem com o histórico financeiro. O movimento de caixa fica indisponível; os valores não foram inventados ou distribuídos entre datas.</li>}
            {(model.undatedMovements > 0 || model.invalidCashAmounts > 0) && <li>Existem movimentos sem data ou valor utilizável. O movimento de caixa fica indisponível.</li>}
            <li>Impostos, taxas, salários e demais gastos entram somente quando cadastrados. Vencimento é uma aproximação temporal: uma despesa pode pertencer a outra competência.</li>
            <li>Custos históricos ausentes usam o cadastro atual com os avisos abaixo. Nenhuma premissa do simulador é tratada como despesa efetivamente registrada.</li>
          </ul></div>
          <button type="button" className="rma-advance-btn" onClick={() => onNavigate('financeiro')}>Conferir Contas a Pagar <ArrowUpRight size={14} /></button>
        </section>

        <section aria-labelledby="bi-health" className="bi-section"><div className="bi-section-heading"><Activity size={19} /><div><h4 id="bi-health">Saúde do negócio</h4><p>Faturamento, lucro bruto e recebimentos; a apuração após despesas está no quadro acima.</p></div></div>
          <div className="report-cards bi-kpi-grid">
            <Kpi label="Faturamento registrado" value={amount(model.currentRevenue)} note={`${model.salesCount} vendas concluídas · sem frete para repasse`} />
            <Kpi label="Lucro bruto estimado" value={amount(model.profit)} note="Faturamento menos CMV; antes de despesas, taxas e tributos" />
            <Kpi label="Margem bruta estimada" value={model.margin === null ? 'Dados insuficientes' : `${model.margin.toFixed(1)}%`} note="Não é margem líquida nem margem de contribuição" />
            <Kpi label="Pagamentos de contas registrados" value={amount(model.paid)} note={model.paid === null ? 'Despesas não cadastradas não significam despesa zero' : 'Saídas por data de pagamento; não somadas ao CMV'} />
          </div>
          <div className="bi-inline-stats"><span>A receber: <strong>{amount(model.receivable)}</strong></span><span>A pagar: <strong>{amount(model.payable)}</strong></span><span>Entradas registradas no período: <strong>{amount(model.received)}</strong></span><span>Reembolsos: <strong>{amount(model.refunded)}</strong></span></div>
          {model.expenseCategories.length > 0 && <div className="module-card bi-quality"><strong>Pagamentos de contas por categoria</strong><div className="bi-inline-stats">{model.expenseCategories.map(row => <span key={row.category}>{expenseLabels[row.category] ?? row.category}: <strong>{amount(row.amount)}</strong></span>)}</div><p>Compras a fornecedores são saídas de caixa; não são deduzidas novamente do lucro bruto que já considera o CMV.</p></div>}
          <div className="module-card bi-quality"><strong>Qualidade e limites dos dados</strong><ul>
            <li>{model.quality.estimatedSales} venda(s) do período usam custo atual por falta de custo histórico completo. Ter custo hoje não comprova o custo na data da venda.</li>
            <li>{model.quality.unknown} ocorrência(s) sem custo ou itens utilizáveis. Se houver lacunas, lucro e margem ficam indisponíveis.</li>
            <li>{model.zeroCostProducts} produto(s) físico(s) desta seleção têm custo cadastrado zero; {model.quality.zeroCostLines} linha(s) de vendas usam custo zero. Zero pode ser intencional: confira o cadastro.</li>
            <li>{model.forecast.expenseData ? 'Somente contas e pagamentos registrados estão incluídos; isso não comprova que todas as despesas foram cadastradas.' : 'Nenhuma conta a pagar ativa cadastrada nesta seleção. Despesas e saídas futuras estão incompletas.'}</li>
            <li>{model.legacyDateSales} venda(s) do histórico usam data de criação por falta de conclusão comprovada. {model.undatedMovements} movimento(s) sem data ficaram fora da análise temporal.</li>
          </ul><p>Devoluções e créditos não equivalem automaticamente a saída de dinheiro. O lucro bruto acima não é um resultado líquido ajustado por todas as devoluções, despesas ou custos de mão de obra.</p></div>
        </section>

        <section aria-labelledby="bi-alerts" className="bi-section"><div className="bi-section-heading"><AlertTriangle size={19} /><div><h4 id="bi-alerts">Alertas inteligentes</h4><p>Regras explícitas, sem IA externa: queda de vendas ≥ 20%, margem ≥ 5 p.p., vencidos, sem giro e inatividade.</p></div></div>
          {!model.comparisonReady && <p className="bi-hint">{model.last >= model.today ? 'Histórico insuficiente para comparar este período.' : 'Comparação de vendas e margem inconclusiva: exige histórico desde o início da referência e pelo menos cinco vendas no período anterior. Ausência de histórico não será tratada como vendas zero.'}</p>}
          {model.growth !== null && <p className="bi-hint">Faturamento: {model.growth.toFixed(1)}% no intervalo comum indicado na comparação. Quedas de margem usam custos estimados quando não há custo original.</p>}
          <div className="bi-alert-grid">{model.alerts.map(alert => <article key={alert.id} className={`module-card bi-alert bi-alert-${alert.severity}`}><span className="bi-tag">{alert.severity === 'critical' ? 'Prioridade' : 'Atenção'}</span><h5>{alert.title}{['overdue', 'stock', 'customers'].includes(alert.id) ? ' (hoje)' : ''}</h5><p>{alert.detail}</p><p>{alert.action}</p><button type="button" className="rma-advance-btn" onClick={() => onNavigate(alert.target, alert.id === 'stock' ? 'sem-giro' : alert.id === 'customers' ? 'inativos' : alert.id === 'overdue' ? 'receber' : undefined)}>Abrir {alert.target === 'financeiro' ? 'Financeiro' : 'Relatórios'} <ArrowUpRight size={14} /></button></article>)}</div>
          {!model.alerts.length && <p className="module-card">Nenhum alerta acionado pelos dados disponíveis. Isso não certifica a saúde financeira da empresa.</p>}
          <p className="bi-hint">Clientes inativos: 90 dias sem compra concluída {branchId ? 'nesta filial' : 'na empresa'}. {model.neverPurchased} cliente(s) sem compras registradas foram separados da inatividade.</p>
        </section>

        <BreakEvenPanel companyId={companyId} branchId={branchId} model={model} />
        <section aria-labelledby="bi-goals" className="module-card bi-simulator"><div className="bi-section-heading"><Calculator size={19} /><div><h4 id="bi-goals">Simulação livre de metas e ponto de equilíbrio</h4><p>Simulação temporária para comparar outros cenários. Não salva metas nem altera suas contas.</p></div></div>
          <div className="bi-input-grid"><label>Gastos fixos do período (R$)<input inputMode="decimal" autoComplete="off" value={fixed} onChange={event => setFixed(event.target.value)} placeholder="Informe, inclusive se zero" /></label>
            <label>Margem de contribuição (%)<input inputMode="decimal" autoComplete="off" value={contribution} onChange={event => setContribution(event.target.value)} placeholder="Após custos e despesas variáveis" /></label>
            <label>Resultado operacional desejado (R$)<input inputMode="decimal" autoComplete="off" value={desired} onChange={event => setDesired(event.target.value)} placeholder="Informe zero para apenas equilibrar" /></label>
            <label>Meta de faturamento (R$, opcional)<input inputMode="decimal" autoComplete="off" value={target} onChange={event => setTarget(event.target.value)} placeholder="Meta adicional do cenário" /></label></div>
          <p className="bi-hint">Margem de contribuição = receita menos custos e despesas variáveis, em percentual da receita. Informe taxas e tributos nas suas premissas; a margem bruta não será usada automaticamente.</p>
          {simulation.result ? <div className="report-cards bi-simulation-results" aria-live="polite"><Kpi label="Ponto de equilíbrio simulado" value={amount(simulation.result.breakEven)} note="Gastos fixos ÷ margem de contribuição" /><Kpi label="Faturamento para resultado desejado" value={amount(simulation.result.requiredRevenue)} note="(Gastos fixos + resultado desejado) ÷ margem" /><Kpi label="Falta para a meta do cenário" value={amount(simulation.result.remaining)} note={`Objetivo considerado: ${amount(simulation.result.objective)}`} /></div> : <p className="bi-hint" role="status">{simulation.error}</p>}
          <button type="button" className="rma-advance-btn" onClick={() => { setFixed(''); setContribution(''); setDesired(''); setTarget(''); }}>Limpar simulação</button><small className="bi-disclaimer">Premissas e resultados são temporários. São apagados ao sair da aba ou trocar empresa, filial ou operador.</small>
        </section>

        <section aria-labelledby="bi-forecast" className="bi-section"><div className="bi-section-heading"><CalendarDays size={19} /><div><h4 id="bi-forecast">Previsão de caixa</h4><p>Vencimentos cadastrados; não garantem recebimento, não incluem vendas futuras e não representam saldo bancário.</p></div></div>
          <div className="bi-forecast-grid">{model.forecast.windows.map(window => <article key={window.days} className="module-card bi-forecast"><span className="bi-eyebrow">PRÓXIMOS {window.days} DIAS</span><h5>Até {dayLabel(window.end)}</h5><dl><div><dt>Entradas previstas</dt><dd>{amount(window.incoming)}</dd></div><div><dt>Saídas previstas</dt><dd>{amount(window.outgoing)}</dd></div><div className="bi-forecast-total"><dt>Variação projetada</dt><dd>{amount(window.change)}</dd></div></dl></article>)}</div>
          <p className="bi-hint">Vencidos separados: {amount(model.forecast.overdueIncoming)} a receber e {amount(model.forecast.overdueOutgoing)} a pagar. Não se presume quitação hoje. {model.forecast.undated} título(s) sem vencimento válido ficaram fora das janelas.</p>
        </section>

        <section aria-labelledby="bi-diagnosis" className="module-card bi-diagnosis"><div className="bi-section-heading"><Lightbulb size={20} /><div><h4 id="bi-diagnosis">Diagnóstico automático</h4><p>Orientações baseadas apenas nos registros desta seleção.</p></div></div><ol>
          {!model.result.hasExpenseRecords && <li>Cadastre e confira suas despesas em Contas a Pagar para completar a apuração após despesas.</li>}
          {model.result.status === 'incomplete' && <li>Confira as pendências no quadro Resultado após despesas. Dados ausentes não serão considerados como zero.</li>}
          {(model.quality.estimatedSales > 0 || model.zeroCostProducts > 0 || model.quality.zeroCostLines > 0 || model.quality.unknown > 0) && <li>Revise os custos sinalizados. Para vendas antigas, o preço de custo atual é uma aproximação; não reescreva o histórico para eliminar o aviso.</li>}
          {model.alerts.map(alert => <li key={alert.id}><strong>{alert.title}:</strong> {alert.action}</li>)}
          {!model.comparisonReady && <li>Acompanhe períodos completos e confirme a cobertura do histórico antes de concluir tendência de crescimento ou queda.</li>}
          <li>Use o simulador com gastos fixos e margem de contribuição conferidos. Custos não cadastrados, tributos e mão de obra podem mudar o resultado.</li>
        </ol><small className="bi-disclaimer">Nenhuma recomendação modifica preços, estoque, cobranças ou cadastros. {lastSyncedAt ? `Base sincronizada em ${lastSyncedAt.toLocaleString('pt-BR', { timeZone: timeZone ?? 'America/Sao_Paulo' })}.` : 'Horário de sincronização não informado.'}</small></section>
      </>}
  </section>;
}
