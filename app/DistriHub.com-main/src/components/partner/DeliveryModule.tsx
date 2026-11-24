import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Truck, MapPin, Package, Check, Clock, X, Navigation,
} from 'lucide-react';
import type { DeliveryStatus, DeliveryDetails, DeliveryOperation, DeliveryPatch, PartnerSale, PartnerSalesperson, PartnerCustomer } from '../../types';
import { money } from '../../utils';
import { saleChargeTotal, isDefinitiveSaleRejection } from '../../lib/pdv';
import { OperationAttempts } from '../../lib/operationAttempts';
import { useDeliveries } from '../../hooks/useDeliveries';

type Props = {
  companyId?: string;
  operatorKey?: string;
  operatorId?: string | null;
  operatorPin?: string | null;
  currentRole?: string;
  isActive?: boolean;
  sales: PartnerSale[];
  salespeople: PartnerSalesperson[];
  customers?: PartnerCustomer[];
  selectedBranchId: string | null;
  onUpdateDelivery: (saleId: string, status: DeliveryStatus, driverId: string | null, details?: DeliveryDetails & { address: string; contact: string }, operation?: DeliveryOperation) => Promise<PartnerSale | void>;
};

const statusConfig: Record<DeliveryStatus, { label: string; color: string; icon: typeof Clock }> = {
  pendente: { label: 'Pendente', color: '#e6a06d', icon: Clock },
  em_rota: { label: 'Em Rota', color: '#55adf1', icon: Navigation },
  entregue: { label: 'Entregue', color: '#5bbc87', icon: Check },
  falhou: { label: 'Falhou', color: '#e3829b', icon: X },
};

export function DeliveryModule(props: Props) {
  return <DeliveryScreen key={[props.companyId, props.selectedBranchId, props.operatorKey, props.currentRole].join(':')} {...props} />;
}

function DeliveryScreen({ sales: fallbackSales, salespeople, customers = [], selectedBranchId, onUpdateDelivery, companyId, operatorKey = '', operatorId, operatorPin, currentRole, isActive = true }: Props) {
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const remote = useDeliveries(companyId, selectedBranchId, operatorId, operatorPin, isActive);
  const sales = companyId ? remote.sales : fallbackSales;
  const canAssign = currentRole !== 'logistica';
  const mounted = useRef(true);
  const activeRef = useRef(isActive); activeRef.current = isActive;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!isActive) setEditing(null); }, [isActive]);
  const scope = companyId + ':' + operatorKey + ':' + selectedBranchId;
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  type Pending = { saleId: string; branchId: string; expectedRevision: number; patch: DeliveryPatch };
  function attempts() { return new OperationAttempts(window.sessionStorage); }
  useEffect(() => {
    if (!companyId || !isActive) return;
    try { setPendingIds(new Set(sales.filter(sale => attempts().pending(scope, 'delivery:' + sale.id)).map(sale => sale.id))); }
    catch { setSaveError('Não foi possível recuperar as tentativas de entrega deste navegador.'); }
  }, [sales, companyId, scope, isActive]);
  const drivers = (companyId ? remote.drivers : salespeople).filter((s) => s.role === 'logistica' && (s.active ?? s.is_active));
  const [savingSaleIds, setSavingSaleIds] = useState<Set<string>>(() => new Set());
  const savingRef = useRef(new Set<string>());
  const [saveError, setSaveError] = useState('');

  const deliveries = useMemo(
    () => sales
      .filter((sale) => sale.delivery_type === 'entrega' && sale.status === 'concluida')
      .filter((sale) => !selectedBranchId || sale.branch_id === selectedBranchId)
      .map((sale) => {
        return {
          saleId: sale.id,
          number: sale.sale_number ? String(sale.sale_number).padStart(6, '0') : sale.id.slice(0, 8),
          customerName: sale.customer_name ?? 'Cliente',
          address: sale.delivery_address ?? '',
          contact: sale.delivery_contact ?? '',
          details: sale.delivery_details ?? {},
          history: sale.delivery_history ?? [],
          items: Array.isArray(sale.items) ? sale.items.reduce((sum, item) => sum + item.quantity, 0) : 0,
          total: saleChargeTotal(sale),
          status: sale.delivery_status ?? 'pendente',
          driverId: sale.delivery_driver_id ?? null,
        };
      }),
    [sales, selectedBranchId],
  );

  const [query, setQuery] = useState('');
  const [driverFilter, setDriverFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [editing, setEditing] = useState<{ saleId: string; revision: number; original: DeliveryPatch; status: DeliveryStatus; driverId: string | null; address: string; contact: string; scheduled_date: string; failure_reason: string; received_by: string; notes: string } | null>(null);
  const [filter, setFilter] = useState<DeliveryStatus | 'all'>('all');

  const filtered = useMemo(
    () => deliveries.filter(d => (filter === 'all' || d.status === filter) && (!query.trim() || `${d.customerName} ${d.number} ${d.saleId}`.toLowerCase().includes(query.trim().toLowerCase())) && (!driverFilter || d.driverId === driverFilter) && (!dateFilter || d.details.scheduled_date === dateFilter)),
    [deliveries, filter, query, driverFilter, dateFilter],
  );

  const totalValue = useMemo(() => deliveries.filter(d => d.status === 'em_rota').reduce((sum, d) => sum + d.total, 0), [deliveries]);
  const assignedCount = useMemo(() => deliveries.filter((d) => d.driverId).length, [deliveries]);

  function editDelivery(saleId: string, status?: DeliveryStatus) {
    const d = deliveries.find(item => item.saleId === saleId);
    if (!d) return;
    const sale = sales.find(item => item.id === saleId);
    const customer = customers.find(item => item.id === sale?.customer_id);
    const address = d.address || [customer?.address, customer?.address_number, customer?.complement, customer?.neighborhood, customer?.city, customer?.state, customer?.zip_code].filter(Boolean).join(', ');
    const original: DeliveryPatch = { status: d.status, driver_id: d.driverId, address: d.address, contact: d.contact, scheduled_date: d.details.scheduled_date ?? '', failure_reason: d.details.failure_reason ?? '', received_by: d.details.received_by ?? '', notes: d.details.notes ?? '' };
    setEditing({ saleId, revision: sale?.delivery_revision ?? 0, original, status: status ?? d.status, driverId: d.driverId, address, contact: d.contact || customer?.phone || '', scheduled_date: d.details.scheduled_date ?? '', failure_reason: d.details.failure_reason ?? '', received_by: d.details.received_by ?? '', notes: d.details.notes ?? '' });
    setSaveError('');
  }

  async function persist(saleId: string, patch: DeliveryPatch, revision?: number, retry = false) {
    if (!isActive || savingRef.current.has(saleId)) return;
    const sale = sales.find(item => item.id === saleId);
    if (!sale) return;
    savingRef.current.add(saleId); setSavingSaleIds(new Set(savingRef.current)); setSaveError('');
    const kind = 'delivery:' + saleId;
    let attempted = false;
    try {
      let operation: DeliveryOperation | undefined;
      let payload: Pending = { saleId, branchId: sale.branch_id!, expectedRevision: revision ?? sale.delivery_revision ?? 0, patch };
      if (companyId) {
        if (retry) {
          const previous = attempts().pending<Pending>(scope, kind);
          if (!previous) throw new Error('Tentativa não encontrada. Atualize a lista.');
          payload = previous.payload;
        }
        const attempt = attempts().get(scope, kind, payload);
        operation = { requestId: attempt.id, branchId: payload.branchId, expectedRevision: payload.expectedRevision, patch: payload.patch };
        setPendingIds(previous => new Set([...previous, saleId]));
      }
      attempted = true;
      const result = await onUpdateDelivery(saleId, payload.patch.status ?? sale.delivery_status ?? 'pendente', payload.patch.driver_id === undefined ? sale.delivery_driver_id ?? null : payload.patch.driver_id, undefined, operation);
      if (companyId) {
        if (!result || result.id !== saleId || result.user_id !== companyId || result.branch_id !== payload.branchId || !Number.isSafeInteger(result.delivery_revision)) throw new Error('Confirmação indisponível. Repita a ação pendente.');
        attempts().confirm(scope, kind);
      }
      if (!mounted.current || !activeRef.current) return;
      if (result) remote.accept(result);
      setPendingIds(previous => { const next = new Set(previous); next.delete(saleId); return next; });
      setEditing(current => current?.saleId === saleId ? null : current);
      if (companyId) void remote.reload();
    } catch (error) {
      if (companyId && attempted && isDefinitiveSaleRejection(String((error as { code?: string })?.code ?? ''))) {
        attempts().confirm(scope, kind);
        if (mounted.current) setPendingIds(previous => { const next = new Set(previous); next.delete(saleId); return next; });
      }
      if (mounted.current && activeRef.current) {
        setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar a entrega.');
        if (companyId) void remote.reload();
      }
    } finally {
      savingRef.current.delete(saleId);
      if (mounted.current) setSavingSaleIds(new Set(savingRef.current));
    }
  }

  async function saveDetails(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    if (editing.status === 'falhou' && !editing.failure_reason.trim() || editing.status === 'entregue' && !editing.received_by.trim()) { setSaveError('Informe o motivo da falha ou quem recebeu a entrega.'); return; }
    const values: DeliveryPatch = { status: editing.status, ...(canAssign ? { driver_id: editing.driverId, address: editing.address, contact: editing.contact } : {}), scheduled_date: editing.scheduled_date, failure_reason: editing.failure_reason, received_by: editing.received_by, notes: editing.notes };
    const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== editing.original[key as keyof DeliveryPatch])) as DeliveryPatch;
    if (!Object.keys(patch).length) { setEditing(null); return; }
    await persist(editing.saleId, patch, editing.revision);
  }

  async function saveDelivery(saleId: string, status: DeliveryStatus, driverId: string | null) {
    const sale = sales.find(item => item.id === saleId);
    if (!sale) return;
    if (status === 'em_rota' && (!sale.delivery_address || !driverId)) { editDelivery(saleId, status); return; }
    const patch: DeliveryPatch = {};
    if (status !== (sale.delivery_status ?? 'pendente')) patch.status = status;
    if (driverId !== (sale.delivery_driver_id ?? null)) patch.driver_id = driverId;
    if (Object.keys(patch).length) await persist(saleId, patch);
  }

  const stats = {
    pendente: deliveries.filter((d) => d.status === 'pendente').length,
    em_rota: deliveries.filter((d) => d.status === 'em_rota').length,
    entregue: deliveries.filter((d) => d.status === 'entregue').length,
    falhou: deliveries.filter((d) => d.status === 'falhou').length,
  };

  return (
    <div className="panel-module delivery-scope">
      <div className="module-header">
        <span className="module-icon"><Truck size={20} /></span>
        <div>
          <h3>Gestão de Entregas</h3>
          <p>Acompanhe e organize as entregas dos seus pedidos</p>
        </div>
      </div>

      {editing && <div className="modal-overlay"><form className="module-card" onSubmit={saveDetails} style={{ maxWidth: 620, maxHeight: '90vh', overflowY: 'auto', padding: 24 }}>
        <h4>Detalhes da entrega</h4>
        <fieldset disabled={!isActive || savingSaleIds.has(editing.saleId) || pendingIds.has(editing.saleId)} style={{ border: 0 }}>
          <label>Endereço<input readOnly={!canAssign} value={editing.address} onChange={e => setEditing({ ...editing, address: e.target.value })} required maxLength={1500} /></label>
          <label>Contato<input readOnly={!canAssign} value={editing.contact} onChange={e => setEditing({ ...editing, contact: e.target.value })} maxLength={200} /></label>
          <label>Previsão de entrega<input type="date" value={editing.scheduled_date} onChange={e => setEditing({ ...editing, scheduled_date: e.target.value })} /></label>
          {canAssign && <label>Entregador<select value={editing.driverId ?? ''} onChange={e => setEditing({ ...editing, driverId: e.target.value || null })} disabled={editing.original.status === 'entregue'}><option value="">Sem entregador</option>{drivers.filter(driver => !driver.branch_id || driver.branch_id === sales.find(sale => sale.id === editing.saleId)?.branch_id).map(driver => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></label>}
          <label>Status<select value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value as DeliveryStatus })}>{Object.entries(statusConfig).filter(([key]) => editing.original.status === 'entregue' ? key === 'entregue' : key !== 'entregue' || editing.original.status === 'em_rota').map(([key,cfg]) => <option key={key} value={key}>{cfg.label}</option>)}</select></label>
          {editing.status === 'falhou' && <label>Motivo da falha<input maxLength={2000} value={editing.failure_reason} onChange={e => setEditing({ ...editing, failure_reason: e.target.value })} required /></label>}
          {editing.status === 'entregue' && <label>Recebido por<input maxLength={200} value={editing.received_by} onChange={e => setEditing({ ...editing, received_by: e.target.value })} required /></label>}
          <label>Observações<textarea value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })} maxLength={4000} /></label>
          {saveError && <p role="alert">{saveError}</p>}
          <button type="submit" className="module-action-btn">Salvar entrega</button>
          <button type="button" className="rma-advance-btn" onClick={() => setEditing(null)}>Fechar</button>
        </fieldset>
        {pendingIds.has(editing.saleId) && <><button type="button" disabled={savingSaleIds.has(editing.saleId) || !isActive} onClick={() => void persist(editing.saleId, {}, undefined, true)}>Repetir ação pendente</button><button type="button" disabled={savingSaleIds.has(editing.saleId)} onClick={() => setEditing(null)}>Voltar à lista</button></>}
        <h4>Histórico</h4>{(deliveries.find(d => d.saleId === editing.saleId)?.history ?? []).map((entry,index) => <p key={index}>{new Date(entry.at).toLocaleString('pt-BR')} — {statusConfig[entry.status]?.label ?? entry.status}{entry.details?.received_by ? ' — ' + entry.details.received_by : ''}{entry.details?.failure_reason ? ' — ' + entry.details.failure_reason : ''}</p>)}
      </form></div>}
      {companyId && remote.loading && <p role="status">Atualizando entregas…</p>}
      {companyId && remote.error && <p role="alert">{remote.error} <button type="button" onClick={() => void remote.reload()}>Tentar novamente</button></p>}
      {saveError && <p className="otp-error-msg" role="alert">{saveError}</p>}

      <div className="financial-dashboard">
        <div className="fin-card">
          <div className="wallet-icon" style={{ color: '#e6a06d', background: 'rgba(230,160,109,.12)' }}>
            <Clock size={22} />
          </div>
          <div>
            <small>Pendentes</small>
            <strong>{stats.pendente}</strong>
          </div>
        </div>
        <div className="fin-card">
          <div className="wallet-icon" style={{ color: '#55adf1', background: 'rgba(85,173,241,.12)' }}>
            <Navigation size={22} />
          </div>
          <div>
            <small>Em Rota</small>
            <strong>{stats.em_rota}</strong>
          </div>
        </div>
        <div className="fin-card">
          <div className="wallet-icon" style={{ color: '#5bbc87', background: 'rgba(80,211,148,.12)' }}>
            <Check size={22} />
          </div>
          <div>
            <small>Entregues</small>
            <strong>{stats.entregue}</strong>
          </div>
        </div>
        <div className="fin-card">
          <div className="wallet-icon" style={{ color: '#e3829b', background: 'rgba(227,130,155,.12)' }}>
            <X size={22} />
          </div>
          <div>
            <small>Falhas</small>
            <strong>{stats.falhou}</strong>
          </div>
        </div>
      </div>

      <div className="orders-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', margin: '18px 0 12px' }}>
        <div className="orders-summary-card" style={{ padding: '14px 16px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', background: '#0f1f2c' }}>
          <small style={{ color: '#8ba3b5' }}>Valor total em rota</small>
          <strong style={{ display: 'block', fontSize: '22px', marginTop: '6px' }}>{money.format(totalValue)}</strong>
        </div>
        <div className="orders-summary-card" style={{ padding: '14px 16px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', background: '#0f1f2c' }}>
          <small style={{ color: '#8ba3b5' }}>Entregas atribuídas</small>
          <strong style={{ display: 'block', fontSize: '22px', marginTop: '6px' }}>{assignedCount}</strong>
        </div>
        <div className="orders-summary-card" style={{ padding: '14px 16px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', background: '#0f1f2c' }}>
          <small style={{ color: '#8ba3b5' }}>Fila ativa</small>
          <strong style={{ display: 'block', fontSize: '22px', marginTop: '6px' }}>{deliveries.filter(d => d.status === 'pendente' || d.status === 'em_rota').length}</strong>
        </div>
      </div>

      <div className="orders-filter-row delivery-search-controls" data-mobile-filters={advancedFiltersOpen}>
        <input type="search" aria-label="Buscar entrega" placeholder="Buscar cliente ou pedido" autoComplete="off" value={query} onChange={e => setQuery(e.target.value)} />
        <button type="button" className="rma-advance-btn mobile-routine-filter-toggle"
        aria-expanded={advancedFiltersOpen} onClick={() => setAdvancedFiltersOpen(open => !open)}>Filtros{(driverFilter || dateFilter) ? ' ativos' : ''}</button>
        <select className="mobile-routine-filter-extra" aria-label="Filtrar entregador" value={driverFilter} onChange={e => setDriverFilter(e.target.value)}><option value="">Todos os entregadores</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <label className="mobile-routine-filter-extra">Previsão<input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} /></label>
      </div>
      <div className="subtab-bar">
        <button className={`subtab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          <Package size={15} /> Todas
        </button>
        {Object.entries(statusConfig).map(([key, cfg]) => (
          <button
            key={key}
            className={`subtab ${filter === key ? 'active' : ''}`}
            onClick={() => setFilter(key as DeliveryStatus)}
          >
            <cfg.icon size={15} /> {cfg.label}
          </button>
        ))}
      </div>

      <div className="stock-table-wrap directory-card-wrap">
        <table className="rma-table directory-card-table" aria-label="Entregas">
          <thead>
            <tr>
              <th>Cliente</th><th>Itens</th><th>Total</th><th>Entregador</th><th>Status</th><th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="empty-row">{companyId && (remote.loading || remote.error) ? 'Aguardando a consulta de entregas.' : 'Nenhuma entrega encontrada.'}</td></tr>
            ) : (
              filtered.map((d) => {
                const cfg = statusConfig[d.status];
                const isSaving = !isActive || savingSaleIds.has(d.saleId) || pendingIds.has(d.saleId);
                return (
                  <tr key={d.saleId}>
                    <td className="directory-card-title">
                      <strong>{d.customerName}</strong><small>Pedido #{d.number}</small>
                      {!d.address && <small>Endereço não informado — abra os detalhes</small>}
                      {d.contact && <small>{d.contact}</small>}
                      {d.details.scheduled_date && <small>Previsão: {d.details.scheduled_date.split('-').reverse().join('/')}</small>}
                      {d.address && <small><MapPin size={10} /> {d.address}</small>}
                    </td>
                    <td data-label="Itens">{d.items} {d.items === 1 ? 'item' : 'itens'}</td>
                    <td data-label="Total">{money.format(d.total)}</td>
                    <td data-label="Entregador" className="delivery-driver-cell">
                      <select
                        aria-label={`Entregador do pedido ${d.number}`}
                        value={d.driverId ?? ''}
                        onChange={(e) => saveDelivery(d.saleId, d.status, e.target.value || null)}
                        disabled={isSaving || !canAssign || d.status === 'entregue'}
                        className="inline-input"
                        style={{ width: 'auto', minWidth: '120px' }}
                      >
                        <option value="">Sem entregador</option>
                        {drivers.filter(s => !s.branch_id || s.branch_id === sales.find(sale => sale.id === d.saleId)?.branch_id).map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Status">
                      <span className={`rma-status-badge status-${d.status === 'entregue' ? 'success' : d.status === 'falhou' ? 'danger' : d.status === 'em_rota' ? 'info' : 'warning'}`}>
                        <cfg.icon size={11} style={{ display: 'inline', marginRight: '4px' }} />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="directory-card-actions" data-label="Ações">
                      <div className="row-action-group">
                        {pendingIds.has(d.saleId) && <button type="button" disabled={!isActive || savingSaleIds.has(d.saleId)} onClick={() => void persist(d.saleId, {}, undefined, true)}>Repetir ação pendente</button>}
                        <button type="button" className="rma-advance-btn" disabled={isSaving} onClick={() => editDelivery(d.saleId)}>Detalhes</button>
                        {d.status !== 'em_rota' && d.status !== 'entregue' && (
                          <button
                            className="rma-advance-btn"
                            onClick={() => saveDelivery(d.saleId, 'em_rota', d.driverId)}
                            disabled={isSaving}
                            title="Marcar Em Rota"
                          >
                            <Navigation size={14} /><span className="delivery-action-label">Em rota</span>
                          </button>
                        )}
                        {d.status === 'em_rota' && (
                          <button
                            className="rma-advance-btn"
                            onClick={() => editDelivery(d.saleId, 'entregue')}
                            disabled={isSaving}
                            title="Marcar Entregue"
                          >
                            <Check size={14} /><span className="delivery-action-label">Entregue</span>
                          </button>
                        )}
                        {d.status !== 'falhou' && d.status !== 'entregue' && (
                          <button
                            className="rma-advance-btn danger"
                            onClick={() => editDelivery(d.saleId, 'falhou')}
                            disabled={isSaving}
                            title="Marcar Falha"
                          >
                            <X size={14} /><span className="delivery-action-label">Falhou</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {drivers.length === 0 && (
        <div className="delivery-info-banner">
          <Truck size={20} />
          <div>
            <strong>Nenhum entregador cadastrado</strong>
            <p>Cadastre funcionários com a função "Logística / Entregador" em Cadastros para atribuir entregas.</p>
          </div>
        </div>
      )}
    </div>
  );
}
