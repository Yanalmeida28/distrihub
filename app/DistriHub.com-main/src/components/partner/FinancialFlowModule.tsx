import { useEffect, useState } from 'react';
import type { PartnerBranch, PartnerInvoice, PartnerSale, StockMovement } from '../../types';
import type { PayableAccount } from '../../lib/accounts';
import { actualFinancialFlow, projectedFinancialFlow, localDate } from '../../lib/financialFlow';
import { getAdminPeriodRange, shiftAdminDay } from '../../lib/adminDashboard';
import { useFinancialMovements } from '../../hooks/useFinancialMovements';
import { financialStatement } from '../../lib/financialStatement';
import { money } from '../../utils';

type Props = { timeZone?: string; isActive?: boolean; userId?: string; branchId: string; branches?: PartnerBranch[]; onBranchChange?: (id: string) => void; invoices: PartnerInvoice[]; payables: PayableAccount[]; sales: PartnerSale[]; movements: StockMovement[]; payablesUnavailable: boolean };
type Mode = 'realizado' | 'previsto';
type Period = 'today' | '7' | '30' | 'custom';
const PAGE_SIZE = 20;
const dayLabel = (day: string) => day.split('-').reverse().join('/');

export function FinancialFlowModule({ timeZone, userId, branchId, branches = [], onBranchChange, invoices, payables, sales, movements, payablesUnavailable, isActive = true }: Props) {
  const today = localDate(new Date().toISOString(), timeZone);
  const [mode, setMode] = useState<Mode>('realizado');
  const [period, setPeriod] = useState<Period>('30');
  const [customStart, setCustomStart] = useState(() => shiftAdminDay(today, -29));
  const [customEnd, setCustomEnd] = useState(today);
  const [page, setPage] = useState(1);
  const days = period === '7' ? 7 : period === 'today' ? 1 : 30;
  const start = period === 'custom' ? customStart : mode === 'realizado' ? shiftAdminDay(today, -(days - 1)) : today;
  const end = period === 'custom' ? customEnd : mode === 'realizado' ? today : shiftAdminDay(today, days - 1);
  const inScope = (row: { user_id: string; branch_id?: string | null }) => (!userId || row.user_id === userId) && (!branchId || row.branch_id === branchId);
  const scopedInvoices = invoices.filter(inScope), scopedPayables = payables.filter(inScope);
  const { receipts, payments, refunds, loading, error, reload } = useFinancialMovements(userId, branchId, scopedInvoices, scopedPayables, isActive);
  const records = mode === 'realizado'
    ? actualFinancialFlow(sales.filter(inScope), movements.filter(inScope), receipts, payments, scopedPayables, scopedInvoices, refunds)
    : projectedFinancialFlow(scopedInvoices, scopedPayables);
  const rangeError = getAdminPeriodRange('custom', start, end, new Date(), timeZone).error;
  const statement = financialStatement(records, start, end, mode, timeZone);
  const unavailable = loading || Boolean(error) || payablesUnavailable || Boolean(rangeError);
  const pages = Math.max(1, Math.ceil(statement.rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const visible = statement.rows.slice(offset, offset + PAGE_SIZE);
  useEffect(() => { setPage(1); }, [mode, period, start, end, branchId, userId, timeZone]);
  useEffect(() => { setPage(value => Math.min(value, pages)); }, [pages]);
  const branchOptions = branches.filter(branch => branch.user_id === userId);
  const branchName = branchId ? branchOptions.find(branch => branch.id === branchId)?.name ?? 'Filial selecionada' : 'Todas as filiais';
  const projected = mode === 'previsto';
  const movementDate = (row: (typeof visible)[number]) => <time dateTime={row.date!}>{dayLabel(row.day)}{!/^\d{4}-\d{2}-\d{2}$/.test(row.date!) && <> · {new Date(row.date!).toLocaleTimeString('pt-BR', { timeZone: timeZone ?? 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}</>}</time>;

  return <section className="module-card financial-flow" aria-label="Fluxo Financeiro">
    <div className="financial-flow-heading"><h4 className="report-section-title">Fluxo Financeiro</h4><span>{branchName}</span></div>
    <div className="financial-flow-toolbar">
      <div className="subtab-bar" aria-label="Modo do fluxo">{(['realizado', 'previsto'] as const).map(value => <button key={value} type="button" className={`subtab ${mode === value ? 'active' : ''}`} aria-pressed={mode === value} onClick={() => { if (value !== mode) { setMode(value); setPeriod('30'); } }}>{value === 'realizado' ? 'Realizado' : 'Previsto'}</button>)}</div>
      {onBranchChange && <label>Filial<select value={branchId} onChange={e => onBranchChange(e.target.value)}><option value="">Todas as filiais</option>{branchOptions.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
      <label>Período<select value={period} onChange={e => { if (e.target.value === 'custom') { setCustomStart(start); setCustomEnd(end); } setPeriod(e.target.value as Period); }}>
        {!projected && <option value="today">Hoje</option>}<option value="7">{projected ? 'Próximos 7 dias' : 'Últimos 7 dias'}</option><option value="30">{projected ? 'Próximos 30 dias' : 'Últimos 30 dias'}</option><option value="custom">Personalizado</option>
      </select></label>
      {period === 'custom' && <><label>De<input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} /></label><label>Até<input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} /></label></>}
      <button type="button" className="rma-advance-btn" disabled={loading} onClick={reload}>Atualizar</button>
    </div>
    <p className="financial-flow-context">{dayLabel(start)} a {dayLabel(end)} · {projected ? 'Projeção por vencimentos pendentes; não representa dinheiro recebido ou pago.' : 'Movimentos registrados; não representa saldo bancário ou fechamento do caixa.'}</p>
    {loading && <p role="status">Carregando movimentações…</p>}
    {error && <p role="alert">{error}</p>}
    {payablesUnavailable && <p role="alert">Contas a Pagar indisponíveis. Aguarde ou atualize a consulta para obter o resultado completo.</p>}
    {rangeError && <p role="alert">{rangeError}</p>}
    <div className="report-cards financial-flow-totals" aria-label={projected ? 'Totais projetados do período' : 'Totais do período'}>
      <div className="report-card"><small>{projected ? 'Entradas previstas' : 'Entradas'}</small><strong>{unavailable ? 'Indisponível' : money.format(statement.incoming)}</strong></div>
      <div className="report-card"><small>{projected ? 'Saídas previstas' : 'Saídas'}</small><strong>{unavailable ? 'Indisponível' : money.format(statement.outgoing)}</strong></div>
      <div className="report-card"><small>{projected ? 'Resultado projetado' : 'Resultado'}</small><strong>{unavailable ? 'Indisponível' : money.format(statement.result)}</strong></div>
    </div>
    {!unavailable && statement.undated.length > 0 && <p role="status">{statement.undated.length} registro(s) sem data comprovada, com valor líquido de {money.format(statement.undated.reduce((sum, r) => sum + r.amount, 0))}, ficaram fora do filtro por período. Recebimentos antigos continuam considerados no saldo dos clientes.</p>}
    {unavailable ? <p role="status">Consulta incompleta ou período inválido.</p> : !statement.rows.length ? <p>Nenhuma movimentação neste período.</p> : <>
      <div className="stock-table-wrap financial-flow-desktop"><table className="rma-table"><thead><tr><th>Data</th><th>Descrição</th><th>{projected ? 'Entrada prevista' : 'Entrada'}</th><th>{projected ? 'Saída prevista' : 'Saída'}</th><th>{projected ? 'Acumulado projetado' : 'Acumulado do período'}</th></tr></thead>
        <tbody>{visible.map(row => <tr key={row.id} data-movement-id={row.id}><td>{movementDate(row)}</td><td>{row.description}</td><td>{row.amount >= 0 ? money.format(row.amount) : '—'}</td><td>{row.amount < 0 ? money.format(-row.amount) : '—'}</td><td>{money.format(row.running)}</td></tr>)}</tbody>
      </table></div>
      <ul className="financial-flow-mobile" aria-label="Movimentos financeiros">{visible.map(row => <li key={row.id} data-movement-id={row.id}>
        <div className="financial-flow-mobile-line"><strong>{row.description}</strong><span>{row.amount >= 0 ? 'Entrada' : 'Saída'}{projected ? ' prevista' : ''}<b>{money.format(Math.abs(row.amount))}</b></span></div>
        <div className="financial-flow-mobile-detail">{movementDate(row)}<details key={`${mode}:${row.id}`}><summary>Ver acumulado</summary><p>{projected ? 'Acumulado projetado' : 'Acumulado do período'}: <strong>{money.format(row.running)}</strong></p></details></div>
      </li>)}</ul>
      <nav className="financial-flow-pagination" aria-label="Paginação do extrato">
        <span role="status" aria-live="polite">{offset + 1}–{offset + visible.length} de {statement.rows.length} movimentos</span>
        <div><button type="button" className="rma-advance-btn" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><button type="button" className="rma-advance-btn" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Próxima</button></div>
      </nav>
    </>}
  </section>;
}
