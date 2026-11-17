import { useEffect, useRef, useState } from 'react';
import type { PartnerSale } from '../../types';
import { adminSaleDate, businessTimeZone } from '../../lib/adminDashboard';
import { salePaymentDescription } from '../../lib/pdv';
import { money } from '../../utils';

type Props = { sales: PartnerSale[]; timeZone?: string };
const PAGE_SIZE = 5;

export function ReportSalesBreakdown({ sales, timeZone }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(sales.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const visible = expanded ? sales.slice(offset, offset + PAGE_SIZE) : [];
  const scroll = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setPage(value => Math.min(value, pages)); }, [pages]);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; }, [currentPage]);

  function date(sale: PartnerSale) {
    const value = new Date(timeZone ? adminSaleDate(sale) : sale.created_at);
    const valid = Number.isFinite(value.getTime());
    return <time dateTime={valid ? value.toISOString() : undefined}>{valid
      ? value.toLocaleString('pt-BR', timeZone ? { timeZone: businessTimeZone(timeZone) } : undefined)
      : 'Data não informada'}</time>;
  }

  return <details className="report-sales-breakdown" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><span>Conferir vendas <span className="report-sales-count">{sales.length}</span></span><span className="report-sales-action">{expanded ? 'Recolher' : 'Ver lista'}</span></summary>
    {expanded && <>
      <p className="report-sales-note">Os totais consideram todas as vendas filtradas.</p>
      {sales.length === 0 ? <p role="status">Nenhuma venda no período selecionado.</p> : <>
        <div className="report-sales-scroll" ref={scroll} role="region" aria-label="Conferência das vendas do relatório" tabIndex={0}>
          <table className="rma-table report-sales-table" aria-label="Vendas da página">
            <thead><tr><th scope="col">Venda</th><th scope="col">Data</th><th scope="col">Cliente</th><th scope="col">Pagamento</th><th scope="col">Total</th></tr></thead>
            <tbody>{visible.map(sale => <tr key={sale.id}><td>#{sale.id.slice(0, 8)}</td><td>{date(sale)}</td><td>{sale.customer_name}</td><td>{salePaymentDescription(sale)}</td><td>{money.format(sale.total)}</td></tr>)}</tbody>
          </table>
          <ol className="report-sales-mobile" aria-label="Vendas da página no celular" start={offset + 1}>
            {visible.map(sale => <li key={sale.id}>
              <strong className="report-sale-customer">{sale.customer_name || 'Cliente não informado'}</strong>
              <strong className="report-sale-total">{money.format(sale.total)}</strong>
              {date(sale)}
              <small>#{sale.id.slice(0, 8)} · {salePaymentDescription(sale)}</small>
            </li>)}
          </ol>
        </div>
        <nav className="financial-flow-pagination" aria-label="Paginação das vendas do relatório">
          <span role="status" aria-live="polite">{offset + 1}–{offset + visible.length} de {sales.length} vendas</span>
          <div>
            <button type="button" className="rma-advance-btn" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button>
            <button type="button" className="rma-advance-btn" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Próxima</button>
          </div>
        </nav>
      </>}
    </>}
  </details>;
}
