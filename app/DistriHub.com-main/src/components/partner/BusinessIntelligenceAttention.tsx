import type { buildBusinessIntelligence } from '../../lib/businessIntelligence';
import { money } from '../../utils';

type Props = {
  model: ReturnType<typeof buildBusinessIntelligence>;
  branchName: string;
  onNavigate: (section: 'relatorios' | 'financeiro', target?: 'pagar' | 'receber' | 'sem-giro' | 'inativos' | 'sem-compras') => void;
};
const amount = (value: number | null) => value === null || !Number.isFinite(value) ? 'Dados insuficientes' : money.format(value);
const day = (value: string) => value.split('-').reverse().join('/');

// Presentation only: values and branch/company scope come from the existing model.
export function BusinessIntelligenceAttention({ model, branchName, onNavigate }: Props) {
  const knownStock = model.stagnant.items.filter(row => row.costKnown && Number.isFinite(row.tiedUpCapital));
  const unknownStock = model.stagnant.items.filter(row => !row.costKnown || !Number.isFinite(row.tiedUpCapital));
  const bars = [...knownStock].sort((a, b) => b.tiedUpCapital - a.tiedUpCapital || a.product.id.localeCompare(b.product.id)).slice(0, 5);
  const maximum = bars[0]?.tiedUpCapital || 1;
  // A completed empty account list means no registered overdue accounts; it does
  // not change the forecast's warning about unregistered operating expenses.
  const outgoing = model.forecast.expenseData ? model.forecast.overdueOutgoing : model.overdue.outgoing.length === 0 ? 0 : null;
  const incoming = model.forecast.overdueIncoming;
  const noOverdue = incoming === 0 && outgoing === 0 && model.forecast.undated === 0;
  const hasOverdue = incoming > 0 || (outgoing ?? 0) > 0;

  return <section className="bi-section bi-attention-today" aria-labelledby="bi-attention">
    <div className="bi-section-heading"><div>
      <span className="bi-context-tag bi-context-today">SITUAÇÃO ATUAL · {day(model.today)}</span>
      <h4 id="bi-attention">O que precisa da sua atenção hoje</h4>
      <p>{branchName} · Independente do período histórico selecionado.</p>
    </div></div>
    {noOverdue && <div className="bi-overdue-clear" role="status">
      <strong>Nenhuma conta vencida</strong><span>Nos registros consultados · A receber: {amount(incoming)} · A pagar: {amount(outgoing)}</span>
      <div className="bi-attention-actions">
        <button type="button" className="rma-advance-btn" aria-label="Abrir vencidas a receber" onClick={() => onNavigate('financeiro', 'receber')}>A receber</button>
        <button type="button" className="rma-advance-btn" aria-label="Abrir vencidas a pagar" onClick={() => onNavigate('financeiro', 'pagar')}>A pagar</button>
      </div>
    </div>}
    <div className="bi-attention-grid">
      {!noOverdue && <article className={`module-card bi-attention-card ${hasOverdue ? 'bi-attention-danger' : 'bi-attention-incomplete'}`} aria-labelledby="bi-overdue-title">
        <h5 id="bi-overdue-title">Contas vencidas{hasOverdue ? ' com saldo em aberto' : ' — dados incompletos'}</h5>
        {model.forecast.undated > 0 && <p className="bi-attention-warning" role="note">Posição parcial: {model.forecast.undated} título(s) sem vencimento válido. Não é possível confirmar ausência de vencidos.</p>}
        {(['incoming', 'outgoing'] as const).map(kind => <section className="bi-overdue-side" key={kind} aria-label={kind === 'incoming' ? 'Vencidos a receber' : 'Vencidos a pagar'}>
          <h6>{kind === 'incoming' ? 'A receber' : 'A pagar'}</h6>
          <strong className={model.overdue[kind].length ? 'bi-attention-amount' : ''}>{amount(kind === 'incoming' ? incoming : outgoing)}</strong>
          <small>{model.overdue[kind].length} conta(s) · saldo após pagamentos parciais</small>
          {model.overdue[kind].length > 0 && <ul>{model.overdue[kind].slice(0, 3).map(row => <li key={row.id}>{row.name} · {day(row.due)} · {amount(row.balance)}</li>)}</ul>}
          <button type="button" className="rma-advance-btn" onClick={() => onNavigate('financeiro', kind === 'incoming' ? 'receber' : 'pagar')}>Abrir vencidas {kind === 'incoming' ? 'a receber' : 'a pagar'}</button>
        </section>)}
        <small>Contas canceladas excluídas.</small>
      </article>}
      <article className="module-card bi-attention-card bi-attention-stock" aria-labelledby="bi-stock-title">
        <h5 id="bi-stock-title">Estoque sem giro hoje</h5>
        <strong className="bi-attention-amount">{knownStock.length || model.stagnant.count === 0 ? amount(model.stagnant.totalValue) : 'Custo desconhecido'}</strong>
        <p><strong>{model.stagnant.count} produto(s)</strong> · capital estimado parado</p>
        {unknownStock.length > 0 ? <p className="bi-attention-warning">Total parcial: inclui apenas {knownStock.length} produto(s) com estimativa disponível. {unknownStock.length} com custo desconhecido ou sem estimativa utilizável.</p> : <small>Estimativa com base nos custos cadastrados.</small>}
        {bars.length > 0 ? <figure className="bi-stock-chart">
          <figcaption>Até cinco produtos com maior capital estimado</figcaption>
          <ol className="bi-stock-bars">{bars.map(row => <li key={row.product.id}>
            <div className="bi-stock-bar-label"><span>{row.product.name}</span><strong>{amount(row.tiedUpCapital)}</strong></div>
            <div className="bi-stock-bar-track" aria-hidden="true"><span style={{ width: `${row.tiedUpCapital / maximum * 100}%` }} /></div>
            <small>{row.product.stock} un. · {row.daysWithoutTurnover} dias sem giro{row.unitCost === 0 ? ' · custo zero: conferir cadastro' : ''}</small>
          </li>)}</ol>
        </figure> : <p>{model.stagnant.count ? 'Sem estimativas de custo disponíveis para o gráfico.' : 'Nenhum produto sem giro nos registros consultados.'}</p>}
        {unknownStock.length > 0 && <details className="bi-stock-unknown"><summary>Conferir produtos com custo desconhecido</summary><ul>{unknownStock.slice(0, 5).map(row => <li key={row.product.id}>{row.product.name} · {row.product.stock} un. · {row.daysWithoutTurnover} dias sem giro · Custo desconhecido</li>)}</ul>{unknownStock.length > 5 && <p>Confira os demais produtos no relatório.</p>}</details>}
        <button type="button" className="rma-advance-btn" onClick={() => onNavigate('relatorios', 'sem-giro')}>Ver produtos</button>
      </article>
      <article className="module-card bi-attention-card bi-attention-crm" aria-labelledby="bi-crm-title">
        <h5 id="bi-crm-title">Clientes · CRM</h5>
        <section><h6>Sem comprar há 90 dias</h6><strong className="bi-crm-count">{model.inactiveCount}</strong><p>Clientes que já compraram e deixaram de comprar nesta seleção.</p><button type="button" className="rma-advance-btn" onClick={() => onNavigate('relatorios', 'inativos')}>Abrir clientes inativos no CRM</button></section>
        <section><h6>Sem compras registradas</h6><strong className="bi-crm-count">{model.neverPurchased}</strong><p>Separados dos clientes que deixaram de comprar.</p><button type="button" className="rma-advance-btn" onClick={() => onNavigate('relatorios', 'sem-compras')}>Abrir clientes sem compras</button></section>
      </article>
    </div>
  </section>;
}
