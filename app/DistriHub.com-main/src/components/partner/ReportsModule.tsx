import { saleRevenuePayments } from '../../lib/pdv';
import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, TrendingUp, TrendingDown, Package, Users, Cake, MessageCircle, DollarSign,
  ShoppingCart, Wrench, UserCheck, CreditCard, Banknote, Wallet, Trophy, Crown, Medal, Download,
} from 'lucide-react';
import type { PartnerSale, PartnerProduct, PartnerCustomer, PartnerSalesperson, SalespersonRole, StockMovement } from '../../types';
import { money } from '../../utils';
import {
  birthdayMonth,
  buildSalesCsv,
  completedSalesOnly,
  filterReportSales,
  getCostOfGoodsSold,
  legacyCostSalesCount,
  getItemRevenueByType,
  isServiceProductId,
  type SalesRange,
} from '../../lib/reportMetrics';
import {
  stagnantLevelLabels, type StagnantLevel,
} from '../../lib/stagnantStock';
import { useStagnantStock } from '../../hooks/useStagnantStock';
import { CrmWorkspace } from './CrmWorkspace';

type Props = {
  canExport?: boolean;
  isActive?: boolean;
  onDataScopeChange?: (tab: string) => void;
  companyUserId?: string | null;
  branchId?: string | null;
  invoices?: import('../../types').PartnerInvoice[];
  sales: PartnerSale[];
  products: PartnerProduct[];
  customers: PartnerCustomer[];
  salespeople: PartnerSalesperson[];
  initialTab?: ReportTab;
  movements?: StockMovement[];
};

type ReportTab = 'vendas' | 'financeiro' | 'estoque' | 'sem-giro' | 'crm';

function localDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function displayBirthday(birthday: string | null | undefined): string {
  if (!birthday) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(birthday);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR');
}

type CsvValue = string | number;

function downloadReportCsv(filename: string, rows: CsvValue[][]) {
  const cell = (value: CsvValue) => {
    let text = String(value);
    if (typeof value === 'string' && /^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const content = `\uFEFF${rows.map((row) => row.map(cell).join(';')).join('\r\n')}`;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}-${localDateInput(new Date())}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const roleLabels: Record<SalespersonRole, string> = {
  administrador: 'Administrador / Proprietário',
  gerente: 'Gerente',
  caixa: 'Caixa',
  vendedor: 'Vendedor / Balcão',
  tecnico: 'Técnico',
  atendente: 'Atendente',
  logistica: 'Logística / Entregador',
};

export function ReportsModule({ canExport = false, isActive = true, onDataScopeChange, sales, products, customers, salespeople, movements = [], companyUserId = null, branchId = null, invoices = [], initialTab = 'vendas' }: Props) {
  const [tab, setTab] = useState<ReportTab>(initialTab);
  const [range, setRange] = useState<SalesRange>('30d');
  const [startDate, setStartDate] = useState(() => localDateInput(new Date(Date.now() - 30 * 86_400_000)));
  const [endDate, setEndDate] = useState(() => localDateInput(new Date()));
  useEffect(() => { if (isActive) onDataScopeChange?.(tab); }, [tab, isActive, onDataScopeChange]);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [customerFilter, setCustomerFilter] = useState('');
  const [sellerFilter, setSellerFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');

  const tabs: { id: ReportTab; label: string; icon: typeof BarChart3 }[] = [
    { id: 'vendas', label: 'Vendas & Serviços', icon: BarChart3 },
    { id: 'financeiro', label: 'Financeiro & Métodos', icon: DollarSign },
    { id: 'estoque', label: 'Estoque', icon: Package },
    { id: 'sem-giro', label: 'Sem giro', icon: TrendingDown },
    { id: 'crm', label: 'CRM', icon: Users },
  ];

  const completedSales = useMemo(() => completedSalesOnly(sales), [sales]);
  const visibleSales = useMemo(
    () => filterReportSales(sales, range, startDate, endDate).filter(sale =>
      (!customerFilter || sale.customer_id === customerFilter) && (!sellerFilter || sale.salesperson_id === sellerFilter)
      && (!paymentFilter || sale.payment_method === paymentFilter) && (!productFilter || sale.items.some(item => item.product_id === productFilter))),
    [sales, range, startDate, endDate, customerFilter, sellerFilter, paymentFilter, productFilter],
  );

  function exportCsv() {
    if (!canExport) return;
    if (!visibleSales.length) {
      setRangeError('Não há vendas concluídas no período selecionado para exportar.');
      return;
    }
    setRangeError(null);
    const blob = new Blob([buildSalesCsv(visibleSales)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-vendas-${localDateInput(new Date())}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="panel-module">
      <div className="module-header">
        <span className="module-icon"><BarChart3 size={20} /></span>
        <div>
          <h3>Central de Relatórios Inteligente & CRM</h3>
          <p>Vendas, financeiro, estoque e relacionamento com clientes</p>
        </div>
      </div>

      <div className="subtab-bar" style={{ marginBottom: '12px' }}>
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`subtab ${tab === id ? 'active' : ''}`} onClick={() => { onDataScopeChange?.(id); setTab(id); setRangeError(null); }}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <div className="orders-filter-row" style={{ marginBottom: '18px', display: tab === 'sem-giro' ? 'none' : undefined }}>
        {(['30d', '90d', 'all', 'custom'] as const).map((option) => (
          <button
            key={option}
            className={`rma-advance-btn ${range === option ? 'active' : ''}`}
            onClick={() => { setRange(option); setRangeError(null); }}
            style={{ minWidth: '110px' }}
          >
            {option === '30d' ? '30 dias' : option === '90d' ? '90 dias' : option === 'all' ? 'Tudo' : 'Personalizado'}
          </button>
        ))}
        {range === 'custom' && (
          <>
            <label>De <input aria-label="Data inicial do relatório" type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setRangeError(null); }} /></label>
            <label>Até <input aria-label="Data final do relatório" type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setRangeError(null); }} min={startDate} /></label>
          </>
        )}
        {canExport && tab === 'vendas' && (
          <button type="button" className="module-action-btn" onClick={exportCsv}>
            <Download size={15} /> Exportar vendas CSV
          </button>
        )}
      </div>
      {(rangeError || (range === 'custom' && startDate > endDate)) && (
        <p className="otp-error-msg" role="alert">{rangeError ?? 'A data inicial deve ser anterior ou igual à data final.'}</p>
      )}

      <div className="subtab-content">
        {tab !== 'sem-giro' && <div className="orders-filter-row">
          <select aria-label="Filtrar cliente no relatório" value={customerFilter} onChange={e=>setCustomerFilter(e.target.value)}><option value="">Todos os clientes</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select aria-label="Filtrar vendedor no relatório" value={sellerFilter} onChange={e=>setSellerFilter(e.target.value)}><option value="">Todos os vendedores</option>{salespeople.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select aria-label="Filtrar pagamento no relatório" value={paymentFilter} onChange={e=>setPaymentFilter(e.target.value)}><option value="">Todos os pagamentos</option>{Array.from(new Set(completedSales.map(s=>s.payment_method).filter(Boolean))).map(method=><option key={method} value={method!}>{method}</option>)}</select>
          <select aria-label="Filtrar produto no relatório" value={productFilter} onChange={e=>setProductFilter(e.target.value)}><option value="">Todos os produtos</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <button type="button" onClick={()=>{setCustomerFilter('');setSellerFilter('');setPaymentFilter('');setProductFilter('');}}>Limpar filtros</button>
          {productFilter && <small>Totais das vendas que contêm o produto selecionado, incluindo os demais itens dessas vendas.</small>}
        </div>}
        {tab === 'vendas' && <SalesReport sales={visibleSales} products={products} salespeople={salespeople} />}
        {tab === 'financeiro' && <FinancialReport canExport={canExport} sales={visibleSales} allSales={completedSales} products={products} />}
        {tab === 'estoque' && <StockReport canExport={canExport} products={products} sales={visibleSales} />}
        {tab === 'sem-giro' && <StagnantStockReport canExport={canExport} isActive={isActive} products={products} sales={sales} movements={movements} />}
        {tab === 'crm' && <><CrmReport canExport={canExport} customers={customers} sales={visibleSales} /><CrmWorkspace customers={customers} sales={completedSales} invoices={invoices} salespeople={salespeople} companyUserId={companyUserId} branchId={branchId} /></>}
        {(tab === 'vendas' || tab === 'financeiro') && <details><summary>Vendas que compõem os totais ({visibleSales.length})</summary><div className="stock-table-wrap"><table className="rma-table"><thead><tr><th>Venda</th><th>Data</th><th>Cliente</th><th>Pagamento</th><th>Total</th></tr></thead><tbody>{visibleSales.map(s=><tr key={s.id}><td>#{s.id.slice(0,8)}</td><td>{new Date(s.created_at).toLocaleString('pt-BR')}</td><td>{s.customer_name}</td><td>{s.payment_method}</td><td>{money.format(s.total)}</td></tr>)}</tbody></table></div></details>}
      </div>
    </div>
  );
}

function SalesReport({ sales, products, salespeople }: { sales: PartnerSale[]; products: PartnerProduct[]; salespeople: PartnerSalesperson[] }) {
  const totalSales = sales.reduce((s, sale) => s + sale.total, 0);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const { productRevenue, serviceRevenue, productSalesCount, serviceSalesCount } = useMemo(
    () => getItemRevenueByType(sales, products),
    [sales, products],
  );

  const bySalesperson = useMemo(() => {
    const map: Record<string, number> = {};
    for (const sale of sales) {
      if (sale.salesperson_id) {
        map[sale.salesperson_id] = (map[sale.salesperson_id] ?? 0) + sale.total;
      }
    }
    return map;
  }, [sales]);

  const commissionBySalesperson = useMemo(() => {
    const map: Record<string, number> = {};
    for (const sale of sales) {
      if (sale.salesperson_id) {
        const sp = salespeople.find((s) => s.id === sale.salesperson_id);
        if (sp) {
          map[sale.salesperson_id] = (map[sale.salesperson_id] ?? 0) + sale.total * (sp.commission_rate / 100);
        }
      }
    }
    return map;
  }, [sales, salespeople]);

  const salespeopleWithSales = useMemo(
    () => salespeople.filter((sp) => Object.prototype.hasOwnProperty.call(bySalesperson, sp.id)),
    [salespeople, bySalesperson],
  );

  const unmatchedSales = useMemo(() => {
    const knownIds = new Set(salespeople.map((sp) => sp.id));
    const groups = new Map<string, { name: string; total: number }>();
    for (const sale of sales) {
      if (sale.salesperson_id && knownIds.has(sale.salesperson_id)) continue;
      const key = sale.salesperson_id || 'unassigned';
      const group = groups.get(key) ?? {
        name: sale.salesperson_id ? `Colaborador não encontrado (${sale.salesperson_id})` : 'Sem colaborador vinculado',
        total: 0,
      };
      group.total += sale.total;
      groups.set(key, group);
    }
    return Array.from(groups, ([id, group]) => ({ id, ...group }));
  }, [sales, salespeople]);

  const top5Products = useMemo(() => {
    const map: Record<string, { qty: number; revenue: number }> = {};
    for (const sale of sales) {
      for (const item of Array.isArray(sale.items) ? sale.items : []) {
        if (!isServiceProductId(item.product_id, productById)) {
          map[item.product_id] = {
            qty: (map[item.product_id]?.qty ?? 0) + item.quantity,
            revenue: (map[item.product_id]?.revenue ?? 0) + item.unit_price * item.quantity,
          };
        }
      }
    }
    return Object.entries(map).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);
  }, [sales, productById]);

  const top5Services = useMemo(() => {
    const map: Record<string, { qty: number; revenue: number }> = {};
    for (const sale of sales) {
      for (const item of Array.isArray(sale.items) ? sale.items : []) {
        if (isServiceProductId(item.product_id, productById)) {
          map[item.product_id] = {
            qty: (map[item.product_id]?.qty ?? 0) + item.quantity,
            revenue: (map[item.product_id]?.revenue ?? 0) + item.unit_price * item.quantity,
          };
        }
      }
    }
    return Object.entries(map).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);
  }, [sales, productById]);

  return (
    <div>
      <div className="report-cards">
        <div className="report-card">
          <small>Vendas Gerais</small>
          <strong>{money.format(totalSales)}</strong>
          <small>{sales.length} vendas</small>
        </div>
        <div className="report-card">
          <small><Package size={13} /> Vendas por Produto</small>
          <strong>{money.format(productRevenue)}</strong>
          <small>{productSalesCount} vendas com produtos</small>
        </div>
        <div className="report-card">
          <small><Wrench size={13} /> Vendas por Serviço</small>
          <strong>{money.format(serviceRevenue)}</strong>
          <small>{serviceSalesCount} vendas com serviços</small>
        </div>
        <div className="report-card">
          <small><ShoppingCart size={13} /> Produto + Serviço</small>
          <strong>{money.format(productRevenue + serviceRevenue)}</strong>
          <small>receita detalhada dos itens</small>
        </div>
      </div>

      <h4 className="report-section-title"><UserCheck size={16} /> Vendas por Colaborador</h4>
      <div className="stock-table-wrap">
        <table className="rma-table">
          <thead><tr><th>Colaborador</th><th>Função</th><th>Total Vendido</th><th>Comissão</th></tr></thead>
          <tbody>
            {salespeopleWithSales.length === 0 && unmatchedSales.length === 0 ? (
              <tr><td colSpan={4} className="empty-row">Nenhum colaborador com vendas registradas.</td></tr>
            ) : (
              salespeopleWithSales.map((sp) => (
                <tr key={sp.id}>
                  <td><strong>{sp.name}</strong></td>
                  <td>{roleLabels[sp.role] ?? sp.role}</td>
                  <td>{money.format(bySalesperson[sp.id] ?? 0)}</td>
                  <td>{money.format(commissionBySalesperson[sp.id] ?? 0)}</td>
                </tr>
              ))
            )}
            {unmatchedSales.map((group) => (
              <tr key={group.id}>
                <td><strong>{group.name}</strong></td>
                <td>Não informada</td>
                <td>{money.format(group.total)}</td>
                <td>—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ranking-grid">
        <div>
          <h4 className="report-section-title"><Trophy size={16} /> Top 5 Produtos</h4>
          <div className="ranking-list">
            {top5Products.length === 0 ? (
              <div className="empty-row" style={{ border: 'none' }}>Sem dados de produtos.</div>
            ) : (
              top5Products.map(([pid, data], i) => {
                const p = products.find((x) => x.id === pid);
                const icon = i === 0 ? <Crown size={16} /> : i === 1 ? <Medal size={16} /> : i === 2 ? <Medal size={16} /> : null;
                return (
                  <div key={pid} className="ranking-item">
                    <span className="ranking-pos">{icon ?? <span className="ranking-num">{i + 1}</span>}</span>
                    <div className="ranking-info">
                      <strong>{p?.name ?? '—'}</strong>
                      <small>{data.qty} un. • {money.format(data.revenue)}</small>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div>
          <h4 className="report-section-title"><Trophy size={16} /> Top 5 Serviços</h4>
          <div className="ranking-list">
            {top5Services.length === 0 ? (
              <div className="empty-row" style={{ border: 'none' }}>Sem dados de serviços.</div>
            ) : (
              top5Services.map(([sid, data], i) => {
                const p = products.find((x) => x.id === sid);
                const icon = i === 0 ? <Crown size={16} /> : i === 1 ? <Medal size={16} /> : i === 2 ? <Medal size={16} /> : null;
                return (
                  <div key={sid} className="ranking-item">
                    <span className="ranking-pos">{icon ?? <span className="ranking-num">{i + 1}</span>}</span>
                    <div className="ranking-info">
                      <strong>{p?.name ?? '—'}</strong>
                      <small>{data.qty} un. • {money.format(data.revenue)}</small>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FinancialReport({ canExport = false, sales, allSales, products }: { canExport?: boolean; sales: PartnerSale[]; allSales: PartnerSale[]; products: PartnerProduct[] }) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const thisMonth = allSales.filter((s) => new Date(s.created_at).getMonth() === currentMonth && new Date(s.created_at).getFullYear() === currentYear);
  const lastMonthDate = new Date(currentYear, currentMonth - 1);
  const lastMonth = allSales.filter((s) => new Date(s.created_at).getMonth() === lastMonthDate.getMonth() && new Date(s.created_at).getFullYear() === lastMonthDate.getFullYear());

  const thisTotal = thisMonth.reduce((s, x) => s + x.total, 0);
  const lastTotal = lastMonth.reduce((s, x) => s + x.total, 0);
  const growth = lastTotal > 0 ? ((thisTotal - lastTotal) / lastTotal) * 100 : 0;

  const byPayment = useMemo(() => {
    const map: Record<string, number> = {};
    for (const sale of sales) {
      for (const payment of saleRevenuePayments(sale)) {
        const method = payment.method.toLowerCase();
        const m = ['cartao', 'credito', 'debito'].includes(method) ? 'cartao' : method || 'outros';
        map[m] = (map[m] ?? 0) + payment.amount;
      }
    }
    return map;
  }, [sales]);

  const monthlyData = useMemo(() => {
    const months: { label: string; total: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - i);
      const monthSales = allSales.filter((s) => new Date(s.created_at).getMonth() === d.getMonth() && new Date(s.created_at).getFullYear() === d.getFullYear());
      months.push({ label: d.toLocaleDateString('pt-BR', { month: 'short' }), total: monthSales.reduce((sum, x) => sum + x.total, 0) });
    }
    return months;
  }, [allSales, currentYear, currentMonth]);

  const maxMonthly = Math.max(...monthlyData.map((m) => m.total), 1);

  const paymentTypes: { key: string; label: string; icon: typeof CreditCard; color: string }[] = [
    { key: 'pix', label: 'PIX', icon: CreditCard, color: '#5bbc87' },
    { key: 'cartao', label: 'Cartão', icon: CreditCard, color: '#55adf1' },
    { key: 'dinheiro', label: 'Dinheiro', icon: Banknote, color: '#5fd0d1' },
    { key: 'faturado', label: 'Crédito/B2B (Faturado)', icon: Wallet, color: '#a78bfa' },
    { key: 'rma', label: 'Crédito de RMA', icon: Wallet, color: '#dc8bc7' },
    { key: 'outros', label: 'Outros', icon: DollarSign, color: '#97aabc' },
  ];

  const totalRevenue = sales.reduce((s, x) => s + x.total, 0);
  const freightTotal = sales.reduce((sum, sale) => sum + (sale.freight_fee ?? 0), 0);
  const costOfGoodsSold = getCostOfGoodsSold(sales, products);
  const legacySales = legacyCostSalesCount(sales, products);
  const grossProfit = totalRevenue - costOfGoodsSold;
  const financialRows: CsvValue[][] = [
    ['Indicador', 'Valor', 'Percentual'],
    ['Receita do mês atual', thisTotal.toFixed(2), ''],
    ['Receita do mês anterior', lastTotal.toFixed(2), ''],
    ['Variação mensal', `${growth.toFixed(1)}%`, ''],
    ...monthlyData.map((month) => [`Receita mensal - ${month.label}`, month.total.toFixed(2), '']),
    ...paymentTypes.map(({ key, label }) => {
      const amount = byPayment[key] ?? 0;
      return [`Pagamento - ${label}`, amount.toFixed(2), totalRevenue > 0 ? `${((amount / totalRevenue) * 100).toFixed(1)}%` : '0.0%'];
    }),
    ['Receita bruta do período selecionado', totalRevenue.toFixed(2), ''],
    [legacySales ? 'CMV estimado (há vendas sem custo histórico)' : 'Custo dos produtos vendidos (CMV)', costOfGoodsSold.toFixed(2), ''],
    ['Vendas com custo histórico incompleto', legacySales, ''],
    ['Lucro bruto estimado', grossProfit.toFixed(2), ''],
    ['Fretes terceirizados (fora do faturamento)', freightTotal.toFixed(2), ''],
  ];

  return (
    <div>
      <div className="orders-filter-row" style={{ justifyContent: 'flex-end', marginBottom: '12px' }}>
        {canExport && <button type="button" className="module-action-btn" onClick={() => { if (canExport) downloadReportCsv('relatorio-financeiro', financialRows); }}>
          <Download size={15} /> Exportar relatório financeiro CSV
        </button>}
      </div>
      <p>Comparativo e histórico mensal: meses do calendário. Os demais totais seguem o período selecionado. Margens de vendas antigas sem custo histórico são estimadas.</p>
      <div className="report-cards">
        <div className="report-card">
          <small>Mês Atual</small>
          <strong>{money.format(thisTotal)}</strong>
        </div>
        <div className="report-card">
          <small>Mês Anterior</small>
          <strong>{money.format(lastTotal)}</strong>
        </div>
        <div className="report-card">
          <small>Comparativo</small>
          <strong className={growth >= 0 ? 'text-green' : 'text-red'}>
            {growth >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
            {growth >= 0 ? '+' : ''}{growth.toFixed(1)}%
          </strong>
        </div>
      </div>

      <h4 className="report-section-title">Visão Anual (12 meses)</h4>
      <p>Fretes terceirizados no período: <strong>{money.format(freightTotal)}</strong>. Valor para repasse, excluído da receita e das comissões.</p>
      <div className="bar-chart">
        {monthlyData.map((m, i) => (
          <div key={i} className="bar-col">
            <div className="bar-fill" style={{ height: `${(m.total / maxMonthly) * 100}%` }} />
            <small>{m.label}</small>
          </div>
        ))}
      </div>

      <h4 className="report-section-title">Tipos de Pagamento (Breakdown)</h4>
      <div className="payment-breakdown-grid">
        {paymentTypes.map(({ key, label, icon: Icon, color }) => {
          const total = byPayment[key] ?? 0;
          const pct = totalRevenue > 0 ? (total / totalRevenue) * 100 : 0;
          return (
            <div key={key} className="payment-breakdown-card">
              <div className="payment-breakdown-icon" style={{ color, background: `${color}1f` }}>
                <Icon size={20} />
              </div>
              <div className="payment-breakdown-info">
                <small>{label}</small>
                <strong>{money.format(total)}</strong>
                <div className="payment-breakdown-bar">
                  <div className="payment-breakdown-fill" style={{ width: `${pct}%`, background: color }} />
                </div>
                <small>{pct.toFixed(1)}% do total</small>
              </div>
            </div>
          );
        })}
      </div>

      <h4 className="report-section-title">Resultado simplificado do período</h4>
      <p>Estimativa antes de despesas operacionais e impostos; o custo considera apenas produtos com custo cadastrado.</p>
      {legacySales > 0 && <p role="status" className="admin-context-note">{legacySales} venda(s) sem custo histórico completo: o CMV e a margem dessas vendas usam o cadastro atual e são estimados.</p>}
      <div className="stock-table-wrap">
        <table className="rma-table">
          <thead><tr><th>Item</th><th>Valor</th></tr></thead>
          <tbody>
            <tr><td>Receita Bruta (vendas concluídas no período)</td><td>{money.format(totalRevenue)}</td></tr>
            <tr><td>Custo dos produtos vendidos (CMV)</td><td>{money.format(costOfGoodsSold)}</td></tr>
            <tr><td>Lucro bruto estimado (antes de despesas e impostos)</td><td>{money.format(grossProfit)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StagnantStockReport({ canExport = false, isActive = true, products, sales, movements }: { canExport?: boolean; isActive?: boolean; products: PartnerProduct[]; sales: PartnerSale[]; movements: StockMovement[] }) {
  const [level, setLevel] = useState<StagnantLevel | 'todos'>('todos');
  const [query, setQuery] = useState('');
  const summary = useStagnantStock(products, sales, movements, isActive);
  const term = query.trim().toLowerCase();
  const rows = summary.items.filter((item) =>
    (level === 'todos' || item.level === level)
    && (!term || item.product.name.toLowerCase().includes(term) || (item.product.sku ?? '').toLowerCase().includes(term)));
  const levelColor: Record<StagnantLevel, string> = { atencao: '#b7791f', alerta: '#dd6b20', critico: '#c53030' };
  const levelName: Record<StagnantLevel, string> = { atencao: 'Atenção', alerta: 'Alerta', critico: 'Crítico' };
  const stagnantRows: CsvValue[][] = [
    ['Produto', 'SKU', 'Estoque', 'Última venda', 'Última reposição', 'Dias sem giro', 'Custo unitário', 'Capital parado', 'Classificação'],
    ...rows.map(({ product, lastSaleAt, lastEntryAt, daysWithoutTurnover, unitCost, tiedUpCapital, level: itemLevel }) => [
      product.name,
      product.sku ?? '',
      product.stock,
      lastSaleAt ? new Date(lastSaleAt).toLocaleDateString('pt-BR') : 'Nunca vendeu',
      lastEntryAt ? new Date(lastEntryAt).toLocaleDateString('pt-BR') : '—',
      daysWithoutTurnover,
      unitCost.toFixed(2),
      tiedUpCapital.toFixed(2),
      levelName[itemLevel],
    ]),
  ];

  return (
    <div>
      <div className="orders-filter-row" style={{ justifyContent: 'flex-end', marginBottom: '12px' }}>
        {canExport && <button type="button" className="module-action-btn" onClick={() => { if (canExport) downloadReportCsv('relatorio-estoque-sem-giro', stagnantRows); }}>
          <Download size={15} /> Exportar produtos sem giro CSV
        </button>}
      </div>
      <div className="report-cards">
        <div className="report-card">
          <small>Produtos sem giro</small>
          <strong>{summary.count}</strong>
          <small>há 30+ dias</small>
        </div>
        <div className="report-card">
          <small>Unidades paradas</small>
          <strong>{summary.totalUnits}</strong>
        </div>
        <div className="report-card">
          <small>Capital parado (custo)</small>
          <strong>{money.format(summary.totalValue)}</strong>
        </div>
        <div className="report-card">
          <small>Produtos críticos</small>
          <strong className={summary.criticalCount > 0 ? 'text-red' : undefined}>{summary.criticalCount}</strong>
          <small>90+ dias</small>
        </div>
      </div>

      <div className="orders-filter-row" style={{ margin: '12px 0' }}>
        {(['todos', 'atencao', 'alerta', 'critico'] as const).map((option) => (
          <button
            key={option}
            className={`rma-advance-btn ${level === option ? 'active' : ''}`}
            onClick={() => setLevel(option)}
          >
            {option === 'todos' ? 'Todos' : stagnantLevelLabels[option]}
          </button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por nome ou SKU"
          aria-label="Buscar por nome ou SKU"
          style={{ minWidth: '200px' }}
        />
      </div>

      <div className="stock-table-wrap">
        <table className="rma-table">
          <thead>
            <tr><th>Produto</th><th>SKU</th><th>Estoque</th><th>Última venda</th><th>Última reposição</th><th>Dias sem giro</th><th>Custo unit.</th><th>Capital parado</th><th>Classificação</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="empty-row">Nenhum produto parado nesta seleção.</td></tr>
            ) : rows.map(({ product, lastSaleAt, lastEntryAt, daysWithoutTurnover, unitCost, tiedUpCapital, level: itemLevel }) => (
              <tr key={product.id}>
                <td><strong>{product.name}</strong></td>
                <td>{product.sku || '—'}</td>
                <td>{product.stock}</td>
                <td>{lastSaleAt ? new Date(lastSaleAt).toLocaleDateString('pt-BR') : 'Nunca vendeu'}</td>
                <td>{lastEntryAt ? new Date(lastEntryAt).toLocaleDateString('pt-BR') : '—'}</td>
                <td>{daysWithoutTurnover}</td>
                <td>{money.format(unitCost)}</td>
                <td>{money.format(tiedUpCapital)}</td>
                <td style={{ color: levelColor[itemLevel], fontWeight: 600 }}>{levelName[itemLevel]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StockReport({ canExport = false, products, sales }: { canExport?: boolean; products: PartnerProduct[]; sales: PartnerSale[] }) {
  const physicalProducts = useMemo(() => products.filter((product) => !product.is_service), [products]);
  const totalInvested = physicalProducts.reduce((s, p) => s + p.cost_price * p.stock, 0);
  const totalRetailValue = physicalProducts.reduce((s, p) => s + p.sale_price * p.stock, 0);
  const potentialGrossProfit = totalRetailValue - totalInvested;
  const physicalProductIds = useMemo(() => new Set(physicalProducts.map((product) => product.id)), [physicalProducts]);
  const soldQuantity = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const sale of sales) {
      for (const item of Array.isArray(sale.items) ? sale.items : []) {
        if (physicalProductIds.has(item.product_id)) {
          quantities.set(item.product_id, (quantities.get(item.product_id) ?? 0) + item.quantity);
        }
      }
    }
    return quantities;
  }, [sales, physicalProductIds]);
  const soldProductIds = new Set(sales.flatMap((sale) =>
    (Array.isArray(sale.items) ? sale.items : [])
      .filter((item) => physicalProductIds.has(item.product_id))
      .map((item) => item.product_id),
  ));
  const slowMovers = physicalProducts.filter((product) => product.stock > 0 && !soldProductIds.has(product.id));

  const topByQty = useMemo(() => {
    const map: Record<string, number> = {};
    for (const sale of sales) {
      for (const item of Array.isArray(sale.items) ? sale.items : []) {
        if (!physicalProductIds.has(item.product_id)) continue;
        map[item.product_id] = (map[item.product_id] ?? 0) + item.quantity;
      }
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [sales, physicalProductIds]);

  const topByMargin = useMemo(() => {
    return physicalProducts
      .map((p) => ({ product: p, margin: p.sale_price > 0 ? ((p.sale_price - p.cost_price) / p.sale_price) * 100 : 0 }))
      .sort((a, b) => b.margin - a.margin)
      .slice(0, 5);
  }, [physicalProducts]);
  const stockRows: CsvValue[][] = [
    ['Produto', 'SKU', 'Estoque atual', 'Estoque mínimo', 'Custo unitário', 'Valor investido', 'Preço de venda', 'Margem sobre venda (%)', 'Unidades vendidas no período'],
    ...physicalProducts.map((product) => [
      product.name,
      product.sku ?? '',
      product.stock,
      product.min_stock,
      Number(product.cost_price).toFixed(2),
      (Number(product.cost_price) * product.stock).toFixed(2),
      Number(product.sale_price).toFixed(2),
      product.sale_price > 0 ? (((product.sale_price - product.cost_price) / product.sale_price) * 100).toFixed(1) : '0.0',
      soldQuantity.get(product.id) ?? 0,
    ]),
  ];

  return (
    <div>
      <div className="orders-filter-row" style={{ justifyContent: 'flex-end', marginBottom: '12px' }}>
        {canExport && <button type="button" className="module-action-btn" onClick={() => { if (canExport) downloadReportCsv('relatorio-estoque', stockRows); }}>
          <Download size={15} /> Exportar estoque CSV
        </button>}
      </div>
      <div className="report-cards">
        <div className="report-card">
          <small>Valor total de custo</small>
          <strong>{money.format(totalInvested)}</strong>
        </div>
        <div className="report-card">
          <small>Valor total a varejo</small>
          <strong>{money.format(totalRetailValue)}</strong>
        </div>
        <div className="report-card">
          <small>Lucro bruto potencial</small>
          <strong>{money.format(potentialGrossProfit)}</strong>
          <small>Estimativa pelo preço de venda atual, antes de despesas, impostos e descontos.</small>
        </div>
        <div className="report-card">
          <small>Sem venda no período</small>
          <strong>{slowMovers.length}</strong>
          <small>produtos físicos com estoque</small>
        </div>
      </div>

      <h4 className="report-section-title"><Trophy size={16} /> Top 5 Produtos Mais Vendidos (Quantidade)</h4>
      <div className="ranking-list">
        {topByQty.length === 0 ? (
          <div className="empty-row" style={{ border: 'none' }}>Sem vendas registradas.</div>
        ) : (
          topByQty.map(([pid, qty], i) => {
            const p = products.find((x) => x.id === pid);
            const icon = i === 0 ? <Crown size={16} /> : i === 1 ? <Medal size={16} /> : i === 2 ? <Medal size={16} /> : null;
            return (
              <div key={pid} className="ranking-item">
                <span className="ranking-pos">{icon ?? <span className="ranking-num">{i + 1}</span>}</span>
                <div className="ranking-info">
                  <strong>{p?.name ?? '—'}</strong>
                  <small>{qty} unidades vendidas</small>
                </div>
              </div>
            );
          })
        )}
      </div>

      <h4 className="report-section-title">Top 5 Produtos por Margem %</h4>
      <div className="stock-table-wrap">
        <table className="rma-table">
          <thead><tr><th>Produto</th><th>Margem</th><th>Custo</th><th>Venda</th></tr></thead>
          <tbody>
            {topByMargin.map(({ product, margin }) => (
              <tr key={product.id}>
                <td><strong>{product.name}</strong></td>
                <td>{margin.toFixed(1)}%</td>
                <td>{money.format(product.cost_price)}</td>
                <td>{money.format(product.sale_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CrmReport({ canExport = false, customers, sales }: { canExport?: boolean; customers: PartnerCustomer[]; sales: PartnerSale[] }) {
  const now = new Date();
  const currentMonth = now.getMonth();

  const topCustomers = useMemo(() => {
    const map: Record<string, number> = {};
    for (const sale of sales) {
      if (sale.customer_id) {
        map[sale.customer_id] = (map[sale.customer_id] ?? 0) + sale.total;
      }
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [sales]);

  const birthdays = customers.filter((customer) => birthdayMonth(customer.birthday) === currentMonth);
  const crmRows: CsvValue[][] = [
    ['Categoria', 'Cliente', 'Total de compras', 'WhatsApp', 'Aniversário'],
    ...topCustomers.map(([customerId, total], index) => {
      const customer = customers.find((item) => item.id === customerId);
      return [`Top ${index + 1} clientes`, customer?.name ?? '—', total.toFixed(2), customer?.phone ?? '—', displayBirthday(customer?.birthday)];
    }),
    ...birthdays.map((customer) => ['Aniversariantes do mês', customer.name, '', customer.phone ?? '—', displayBirthday(customer.birthday)]),
  ];

  function sendBirthdayWhatsApp(phone: string | null | undefined, name: string) {
    if (!phone) return;
    const digits = phone.replace(/\D/g, '');
    const internationalNumber = phone.trim().startsWith('+') || (digits.startsWith('55') && digits.length >= 12)
      ? digits
      : `55${digits}`;
    const msg = `Olá ${name}! Parabéns pelo seu aniversário! 🎉 Será um prazer receber você novamente em nossa loja!`;
    window.open(`https://wa.me/${internationalNumber}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <div>
      <div className="orders-filter-row" style={{ justifyContent: 'flex-end', marginBottom: '12px' }}>
        {canExport && <button type="button" className="module-action-btn" onClick={() => { if (canExport) downloadReportCsv('relatorio-crm', crmRows); }}>
          <Download size={15} /> Exportar CRM CSV
        </button>}
      </div>
      <p>Ranking pelo período selecionado. Aniversariantes do mês atual.</p>
      <h4 className="report-section-title"><Trophy size={16} /> Top 5 Clientes</h4>
      <div className="ranking-list">
        {topCustomers.length === 0 ? (
          <div className="empty-row" style={{ border: 'none' }}>Sem dados de clientes.</div>
        ) : (
          topCustomers.map(([cid, total], i) => {
            const c = customers.find((x) => x.id === cid);
            const icon = i === 0 ? <Crown size={16} /> : i === 1 ? <Medal size={16} /> : i === 2 ? <Medal size={16} /> : null;
            return (
              <div key={cid} className="ranking-item">
                <span className="ranking-pos">{icon ?? <span className="ranking-num">{i + 1}</span>}</span>
                <div className="ranking-info">
                  <strong>{c?.name ?? '—'}</strong>
                  <small>{money.format(total)} em compras</small>
                </div>
              </div>
            );
          })
        )}
      </div>

      <h4 className="report-section-title"><Cake size={16} /> Aniversariantes do Mês</h4>
      <div className="stock-table-wrap crm-birthdays-wrap">
        <table className="rma-table crm-birthdays-table">
          <thead><tr><th>Cliente</th><th>WhatsApp</th><th>Aniversário</th><th></th></tr></thead>
          <tbody>
            {birthdays.length === 0 ? (
              <tr><td colSpan={4} className="empty-row">Nenhum aniversariante este mês.</td></tr>
            ) : (
              birthdays.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.phone ?? '—'}</td>
                  <td>{displayBirthday(c.birthday)}</td>
                  <td>
                    <button
                      className="rma-advance-btn whatsapp-btn"
                      aria-label={`Enviar parabéns para ${c.name} pelo WhatsApp`}
                      title="Enviar mensagem no WhatsApp"
                      onClick={() => sendBirthdayWhatsApp(c.phone, c.name)}
                      disabled={!c.phone}
                    >
                      <MessageCircle size={14} /> <span>Enviar Mensagem no WhatsApp</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
