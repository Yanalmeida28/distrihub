import { useMemo, useState } from 'react';
import { cashTotals, type CashMovement, type CashSession } from '../../lib/cashRegister';
import { money } from '../../utils';

type Props = {
  branchId: string;
  branchName: string;
  sessions: CashSession[];
  movements: CashMovement[];
  onViewReport: (sessionId: string) => void;
};

export function CashOverview({ branchId, branchName, sessions, movements, onViewReport }: Props) {
  const [status, setStatus] = useState('abertos');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const grouped = new Map<string, CashMovement[]>();
    for (const movement of movements) {
      const group = grouped.get(movement.session_id) ?? [];
      group.push(movement); grouped.set(movement.session_id, group);
    }
    return sessions.filter(session => session.branch_id === branchId).map(session => {
      const totals = session.closed_at && session.closing_totals ? session.closing_totals : cashTotals(grouped.get(session.id) ?? []);
      const expected = session.closed_at && session.expected_amount != null
        ? Number(session.expected_amount) : (Math.round(Number(session.opening_amount) * 100) + Math.round(Number(totals.dinheiro ?? 0) * 100)) / 100;
      return { session, totals, expected };
    }).sort((a, b) => b.session.opened_at.localeCompare(a.session.opened_at) || b.session.id.localeCompare(a.session.id));
  }, [branchId, sessions, movements]);
  const open = rows.filter(row => !row.session.closed_at);
  const filtered = rows.filter(({ session }) =>
    (status === 'todos' || (status === 'abertos' ? !session.closed_at : Boolean(session.closed_at))) &&
    session.operator_name.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')));
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const currentPage = Math.min(page, pages - 1);
  if (rows.some(row => row.session.history_complete === false)) return <section className="cash-card"><p role="alert">O resumo dos caixas está incompleto. Atualize os dados antes de conferir os saldos.</p></section>;
  return <section className="cash-card cash-overview" aria-label="Visão geral dos caixas">
    <h4>Visão geral dos caixas · {branchName}</h4>
    <p>Acompanhe os caixas da filial sem trocar de operador. Um caixa pode reunir vendas de vários colaboradores; o relatório identifica quem finalizou cada venda.</p>
    <div className="cash-summary">
      <div><small>Caixas abertos</small><strong>{open.length}</strong></div>
      <div><small>Dinheiro esperado nos caixas abertos</small><strong>{money.format(open.reduce((sum, row) => sum + Math.round(row.expected * 100), 0) / 100)}</strong></div>
      <div><small>Caixas fechados no histórico</small><strong>{rows.length - open.length}</strong></div>
    </div>
    <div className="cash-fields">
      <label>Situação<select aria-label="Situação dos caixas" value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}><option value="abertos">Abertos</option><option value="fechados">Fechados</option><option value="todos">Todos</option></select></label>
      <label>Operador<input aria-label="Buscar operador nos caixas" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="Buscar pelo nome" /></label>
    </div>
    <div className="stock-table-wrap cash-overview-wrap"><table className="rma-table cash-overview-table"><thead><tr><th>Operador</th><th>Abertura</th><th>Situação</th><th>Dinheiro esperado</th><th>PIX líquido</th><th>Cartão líquido</th><th>Faturado a receber</th><th>Diferença no fechamento</th><th>Relatório</th></tr></thead><tbody>
      {filtered.slice(currentPage * 25, (currentPage + 1) * 25).map(({ session, totals, expected }) => <tr key={session.id}>
        <td data-label="Operador" className="cash-overview-operator">{session.operator_name}</td><td data-label="Abertura">{new Date(session.opened_at).toLocaleString('pt-BR')}</td><td data-label="Situação">{session.closed_at ? 'Fechado' : 'Aberto'}</td>
        <td data-label="Dinheiro esperado">{money.format(expected)}</td><td data-label="PIX líquido">{money.format(totals.pix ?? 0)}</td><td data-label="Cartão líquido">{money.format(totals.cartao ?? 0)}</td><td data-label="Faturado a receber">{money.format(totals.faturado ?? 0)}</td>
        <td data-label="Diferença no fechamento">{session.closed_at && session.difference != null ? money.format(Number(session.difference)) : '—'}</td>
        <td data-label="Relatório" className="cash-overview-actions"><button type="button" className="rma-advance-btn" onClick={() => onViewReport(session.id)}>Ver relatório</button></td>
      </tr>)}
      {!filtered.length && <tr><td colSpan={9} className="empty-row">Nenhum caixa encontrado para estes filtros.</td></tr>}
    </tbody></table></div>
    <p>Dinheiro esperado inclui troco inicial, vendas em dinheiro, suprimentos, sangrias e devoluções. PIX, cartão e faturado não compõem o dinheiro físico.</p>
    {pages > 1 && <div className="cash-fields"><button type="button" className="rma-advance-btn" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Página anterior</button><span>Página {currentPage + 1} de {pages}</span><button type="button" className="rma-advance-btn" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}>Próxima página</button></div>}
  </section>;
}
