import { useMemo, useState, type ReactNode } from 'react';
import { ClipboardList, PackageCheck, Search } from 'lucide-react';
import type { B2BOrder } from '../../types';
import { money } from '../../utils';

type Props = { orders?: B2BOrder[]; salesHistory?: ReactNode };

const statusMap: Record<string, { label: string; color: string }> = {
  pendente: { label: 'Pendente', color: '#e6a06d' },
  pago: { label: 'Pago', color: '#5bbc87' },
  concluido: { label: 'Concluído', color: '#5bbc87' },
  cancelado: { label: 'Cancelado', color: '#e3829b' },
  em_producao: { label: 'Em produção', color: '#7eb1ff' },
  enviado: { label: 'Enviado', color: '#62d0ff' },
  entregue: { label: 'Entregue', color: '#3fbf8d' },
};

const paymentMap: Record<string, string> = {
  pix: 'PIX',
  cartao: 'Cartão',
  faturado: 'Faturado',
  rma: 'RMA',
  dinheiro: 'Dinheiro',
};

export function OrderHistoryModule({ orders = [], salesHistory }: Props) {
  const [section, setSection] = useState<'sales' | 'purchases'>('sales');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const safeOrders = useMemo(() => (Array.isArray(orders) ? orders : []), [orders]);

  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return safeOrders.filter((order) => {
      if (!order) return false;
      const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
      const orderIdStr = order.id ? String(order.id) : '';
      const bizNameStr = order.business_name ? String(order.business_name) : '';
      const payMethodStr = order.payment_method ? String(order.payment_method) : '';

      const matchesSearch =
        !term ||
        bizNameStr.toLowerCase().includes(term) ||
        orderIdStr.toLowerCase().includes(term) ||
        payMethodStr.toLowerCase().includes(term);
      return matchesStatus && matchesSearch;
    });
  }, [safeOrders, search, statusFilter]);

  const totalValue = filteredOrders.reduce((sum, order) => sum + (Number(order?.total) || 0), 0);
  const pendingCount = filteredOrders.filter((order) => order?.status === 'pendente').length;

  return (
    <div className="panel-module">
      {salesHistory && <div className="pdv-subtabs">
        <button className={`pdv-subtab ${section === 'sales' ? 'active' : ''}`} onClick={() => setSection('sales')}>Vendas</button>
        <button className={`pdv-subtab ${section === 'purchases' ? 'active' : ''}`} onClick={() => setSection('purchases')}>Compras</button>
      </div>}
      {salesHistory && section === 'sales' ? salesHistory : <>

      <div className="module-header">
        <span className="module-icon"><ClipboardList size={20} /></span>
        <div>
          <h3>Histórico de Compras</h3>
          <p>Pedidos realizados por esta conta na plataforma</p>
        </div>
      </div>

      <div className="orders-filter-bar" style={{ marginBottom: '16px' }}>
        <div className="orders-filter-row">
          <label className="orders-filter-field">
            <Search size={14} /> Buscar pedido
            <input
              type="search"
              name="purchase-history-search"
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pedido, loja ou pagamento"
            />
          </label>

          <label className="orders-filter-field">
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Todos</option>
              <option value="pendente">Pendente</option>
              <option value="pago">Pago</option>
              <option value="concluido">Concluído</option>
              <option value="em_producao">Em produção</option>
              <option value="enviado">Enviado</option>
              <option value="entregue">Entregue</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </label>
        </div>
      </div>

      <div className="orders-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <div className="orders-summary-card" style={{ padding: '14px 16px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', background: '#0f1f2c' }}>
          <small style={{ color: '#8ba3b5' }}>Pedidos</small>
          <strong style={{ display: 'block', fontSize: '22px', marginTop: '6px' }}>{filteredOrders.length}</strong>
        </div>
        <div className="orders-summary-card" style={{ padding: '14px 16px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', background: '#0f1f2c' }}>
          <small style={{ color: '#8ba3b5' }}>Valor total</small>
          <strong style={{ display: 'block', fontSize: '22px', marginTop: '6px' }}>{money.format(totalValue)}</strong>
        </div>
        <div className="orders-summary-card" style={{ padding: '14px 16px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', background: '#0f1f2c' }}>
          <small style={{ color: '#8ba3b5' }}>Pendentes</small>
          <strong style={{ display: 'block', fontSize: '22px', marginTop: '6px' }}>{pendingCount}</strong>
        </div>
      </div>

      <div className="stock-table-wrap mobile-record-wrap">
        <table className="rma-table mobile-record-table">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Loja</th>
              <th>Data</th>
              <th>Total</th>
              <th>Pagamento</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr><td colSpan={6} className="empty-row"><PackageCheck size={18} /> Nenhuma compra registrada.</td></tr>
            ) : filteredOrders.map((order, index) => {
              if (!order) return null;
              const statusKey = order.status ? String(order.status) : '';
              const mappedStatus = statusMap[statusKey] ?? { label: statusKey || 'Pendente', color: '#7f97a9' };
              const mappedPayment = paymentMap[order.payment_method ?? ''] ?? order.payment_method ?? '—';
              const orderIdStr = order.id ? String(order.id) : '';
              const displayId = orderIdStr ? (orderIdStr.length > 8 ? orderIdStr.slice(0, 8) : orderIdStr) : '—';

              let formattedDate = '—';
              if (order.created_at) {
                try {
                  const d = new Date(order.created_at);
                  if (!isNaN(d.getTime())) {
                    formattedDate = d.toLocaleDateString('pt-BR');
                  }
                } catch {
                  formattedDate = '—';
                }
              }

              return (
                <tr key={order.id ?? index}>
                  <td data-label="Pedido"><strong>#{displayId}</strong></td>
                  <td data-label="Loja" className="mobile-record-title">{order.business_name ?? '—'}</td>
                  <td data-label="Data">{formattedDate}</td>
                  <td data-label="Total">{money.format(Number(order.total) || 0)}</td>
                  <td data-label="Pagamento">{mappedPayment}</td>
                  <td data-label="Status">
                    <span className="rma-status-badge" style={{ color: mappedStatus.color, borderColor: mappedStatus.color }}>
                      {mappedStatus.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>}
    </div>
  );
}
