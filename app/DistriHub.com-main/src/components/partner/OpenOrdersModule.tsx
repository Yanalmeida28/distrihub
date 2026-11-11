import { SplitPaymentFields } from './SplitPaymentFields';
import { useEffect, useMemo, useRef, useState } from 'react';
import { orderMatchesDate } from '../../lib/openOrderFilters';
import {
  ClipboardList, Search, X, Calendar, Filter, ArrowRight, Wallet, Lock,
} from 'lucide-react';
import type { PartnerSale, SalePayment, PartnerCustomer, PartnerSalesperson, SalespersonRole, PartnerProduct } from '../../types';
import { OpenOrderItemsEditor } from './OpenOrderItemsEditor';
import { money } from '../../utils';
import { draftPayments, emptySplitPaymentDraft, splitPaymentDraft, splitPaymentError, pdvErrorMessage, saleChargeTotal } from '../../lib/pdv';
import { SaleActionsMenu } from './SaleActionsMenu';
import { printSale, type ReceiptDetails } from '../../lib/salePrint';
import { directOrderEmailEnabled, sendOrderQuoteEmail } from '../../lib/orderEmail';
import { saleShareUrl } from '../../lib/saleShare';
import { shareOrderQuotePdf, downloadOrderQuotePdf, prepareOrderQuoteLogo } from '../../lib/orderQuotePdf';

type Props = {
  canEditPrice: boolean;
  products: PartnerProduct[];
  onUpdateItems: (id: string, items: PartnerSale['items']) => Promise<void>;
  onUpdateCustomer: (id: string, customerId: string) => Promise<void>;
  sales: PartnerSale[];
  customers: PartnerCustomer[];
  salespeople: PartnerSalesperson[];
  currentRole: SalespersonRole;
  isActive?: boolean;
  receiptDetails?: ReceiptDetails;
  onFinalizePreSale?: (id: string, paymentMethod: string, paymentSplits?: SalePayment[]) => Promise<void>;
  onCancelSale: (id: string, operatorId?: string | null, operatorPin?: string | null) => Promise<void>;
  onDeleteSale: (id: string, operatorId?: string | null, operatorPin?: string | null) => Promise<void>;
  onPullToPdv?: (sale: PartnerSale) => void;
};

const cashierRoles: SalespersonRole[] = ['administrador', 'gerente', 'caixa', 'vendedor'];

const statusLabels: Record<string, { label: string; color: string }> = {
  aberta: { label: 'ABERTO', color: '#7bc8ff' },
  pre_venda: { label: 'ABERTO', color: '#7bc8ff' },
  concluida: { label: 'CONCLUÍDO', color: '#4ade80' },
  cancelada: { label: 'CANCELADO', color: '#fda4af' },
};

const payStatusLabels: Record<string, { label: string; color: string }> = {
  pago: { label: 'Pago', color: '#4ade80' },
  pendente: { label: 'Pendente', color: '#fbbf24' },
  cancelado: { label: 'Cancelado', color: '#fda4af' },
};

export function OpenOrdersModule({ canEditPrice, products, onUpdateItems, onUpdateCustomer, sales, customers, salespeople, currentRole, receiptDetails, onFinalizePreSale, onCancelSale, onDeleteSale, onPullToPdv, isActive = true }: Props) {
  useEffect(() => { void prepareOrderQuoteLogo(receiptDetails?.settings?.logo_url); }, [receiptDetails?.settings?.logo_url]);
  const mounted = useRef(true);
  const active = useRef(isActive); active.current = isActive;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const canApply = () => mounted.current && active.current;
  const [notice, setNotice] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [customerTarget, setCustomerTarget] = useState<PartnerSale | null>(null);
  const [newCustomerId, setNewCustomerId] = useState('');
  const [customerTerm, setCustomerTerm] = useState('');
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const customerInFlight = useRef(false);
  const canChangeCustomer = ['administrador', 'gerente', 'caixa', 'vendedor'].includes(currentRole);
  const availableCustomers = customers.filter(customer =>
    customer.is_active !== false &&
    (!customer.branch_id || customer.branch_id === customerTarget?.branch_id) &&
    (!customerTerm.trim() || `${customer.name} ${customer.document ?? ''}`.toLocaleLowerCase('pt-BR').includes(customerTerm.trim().toLocaleLowerCase('pt-BR'))));

  async function saveCustomer() {
    if (!canApply() || !customerTarget || !newCustomerId || customerInFlight.current || finalizeInFlight.current || cancelInFlight.current) return;
    if (!sales.some(sale => sale.id === customerTarget.id && sale.branch_id === customerTarget.branch_id && ['pre_venda', 'aberta'].includes(sale.status))) { setCustomerError('Pedido não está mais aberto. Atualize a lista.'); return; }
    customerInFlight.current = true;
    setSavingCustomer(true);
    setCustomerError(null);
    try {
      await onUpdateCustomer(customerTarget.id, newCustomerId);
      if (canApply()) setCustomerTarget(null);
    } catch (error) { if (canApply()) setCustomerError(pdvErrorMessage(error)); }
    finally { customerInFlight.current = false; setSavingCustomer(false); }
  }
  const [editTarget, setEditTarget] = useState<PartnerSale | null>(null);
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [orderId, setOrderId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<{
    dateStart: string;
    dateEnd: string;
    orderId: string;
    customerSearch: string;
    statusFilter: string;
    paymentFilter: string;
    sourceFilter: string;
  } | null>(null);
  const [finalizeTarget, setFinalizeTarget] = useState<PartnerSale | null>(null);
  const [finalizePayment, setFinalizePayment] = useState('pix');
  const [finalizeDraft, setFinalizeDraft] = useState({ ...emptySplitPaymentDraft });
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const finalizeInFlight = useRef(false);
  const [cancelTarget, setCancelTarget] = useState<PartnerSale | null>(null);
  const [supervisorId, setSupervisorId] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);
  const cancelInFlight = useRef(false);
  const canSelfAuthorize = currentRole === 'administrador' || currentRole === 'gerente';
  const busy = isFinalizing || isVerifyingPin || savingCustomer;
  useEffect(() => {
    if (!isActive) { setFinalizeTarget(null); setCancelTarget(null); setCustomerTarget(null); setEditTarget(null); setPinInput(''); return; }
    const latest = (target: PartnerSale | null) => target ? sales.find(sale => sale.id === target.id && sale.branch_id === target.branch_id && ['aberta', 'pre_venda'].includes(sale.status)) ?? null : null;
    setFinalizeTarget(target => { const sale = latest(target); return sale?.status === 'pre_venda' ? sale : null; });
    setCancelTarget(latest); setCustomerTarget(latest); setEditTarget(latest);
  }, [sales, isActive]);

  const [documentError, setDocumentError] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const quoteInFlight = useRef(false);
  const [downloadingQuote, setDownloadingQuote] = useState(false);
  async function handleDownloadQuote(sale: PartnerSale, share = false) {
    if (!canApply() || quoteInFlight.current) return;
    quoteInFlight.current = true; setDownloadingQuote(true); setDocumentError(null); setShareNotice(null);
    try {
      const details = { ...receiptDetails,
        customer: customers.find(customer => customer.id === sale.customer_id),
        salespersonName: salespeople.find(person => person.id === sale.salesperson_id)?.name };
      if (share) {
        const result = await shareOrderQuotePdf(sale, details);
        if (canApply() && result !== 'cancelled') setShareNotice(result === 'shared' ? 'Orçamento encaminhado ao aplicativo escolhido.' : 'PDF baixado. Abra o arquivo e anexe ao WhatsApp ou e-mail do cliente.');
        return;
      }
      if (!canApply()) return;
      await downloadOrderQuotePdf(sale, details);
      if (canApply()) setShareNotice('Download do orçamento iniciado. Você pode compartilhar o arquivo PDF com o cliente.');
    } catch (error) {
      if (canApply()) setDocumentError(error instanceof Error ? error.message : 'Não foi possível gerar o PDF do orçamento.');
    } finally { quoteInFlight.current = false; if (mounted.current) setDownloadingQuote(false); }
  }

  async function handlePrint(sale: PartnerSale, format: 'receipt' | 'label') {
    setDocumentError(null);
    setShareNotice(null);
    try {
      await printSale(sale, format, {
        ...receiptDetails,
        customer: customers.find((customer) => customer.id === sale.customer_id),
        salespersonName: salespeople.find((person) => person.id === sale.salesperson_id)?.name,
      });
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : 'Não foi possível abrir a impressão.');
    }
  }

  const emailInFlight = useRef(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  async function handleShare(sale: PartnerSale, channel: 'whatsapp' | 'email') {
    if (!canApply() || emailInFlight.current) return;
    if (channel === 'email' && directOrderEmailEnabled) {
      emailInFlight.current = true; setSendingEmail(true); setDocumentError(null); setShareNotice('Enviando orçamento por e-mail...');
      try { const message = await sendOrderQuoteEmail(sale.id); if (canApply()) setShareNotice(message); }
      catch (error) { if (canApply()) { setShareNotice(null); setDocumentError(error instanceof Error ? error.message : 'Falha ao confirmar o envio.'); } }
      finally { emailInFlight.current = false; if (canApply()) setSendingEmail(false); }
      return;
    }
    setDocumentError(null);
    setShareNotice(null);
    try {
      const url = saleShareUrl(sale, channel,
        customers.find((customer) => customer.id === sale.customer_id),
        salespeople.find((person) => person.id === sale.salesperson_id)?.name);
      if (channel === 'whatsapp') {
        const popup = window.open('about:blank', '_blank');
        if (!popup) throw new Error('Permita pop-ups neste navegador para abrir o WhatsApp.');
        popup.opener = null;
        popup.location.replace(url);
        setShareNotice('Confirme o envio no WhatsApp. O orçamento vai em texto, sem PDF anexado.');
      } else {
        const link = document.createElement('a');
        link.href = url;
        document.body.append(link);
        link.click();
        link.remove();
        setShareNotice('Confirme o envio no aplicativo de e-mail. Se nada abriu, configure um aplicativo de e-mail padrão. O orçamento vai em texto, sem PDF anexado.');
      }
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : 'Não foi possível preparar o envio.');
    }
  }

  const canCheckout = cashierRoles.includes(currentRole);

  // O PIN nunca é comparado no cliente: quem valida é a RPC no backend.
  // A lista abaixo serve apenas para escolher o responsável que autoriza.
  const managers = salespeople.filter(s => (s.active ?? s.is_active) !== false && (s.role === 'administrador' || (s.role === 'gerente' && s.branch_id === cancelTarget?.branch_id)));

  const customerNames = useMemo(() => new Map(customers.map(customer => [customer.id, customer.name.toLowerCase()])), [customers]);
  const openOrders = useMemo(() => {
    return sales.filter((s) => s.status === 'aberta' || s.status === 'pre_venda');
  }, [sales]);

  const displayedOrders = useMemo(() => {
    if (!appliedFilters) return openOrders;
    const filters = appliedFilters;
    return openOrders.filter((sale) => {
      if (!orderMatchesDate(sale.created_at, filters.dateStart, filters.dateEnd)) return false;
      if (filters.orderId) {
        const term = filters.orderId.toLowerCase();
        if (!sale.id.toLowerCase().includes(term) && !(sale.sale_number ? String(sale.sale_number).padStart(6, '0') : sale.id.slice(0, 8).toUpperCase()).includes(term)) return false;
      }
      if (filters.customerSearch) {
        const term = filters.customerSearch.toLowerCase();
        if (!(sale.customer_name ?? '').toLowerCase().includes(term) &&
          !(customerNames.get(sale.customer_id ?? '') ?? '').includes(term)) return false;
      }
      if (filters.statusFilter !== 'all' && sale.status !== filters.statusFilter) return false;
      if (filters.paymentFilter !== 'all' && sale.payment_status !== filters.paymentFilter) return false;
      if (filters.sourceFilter !== 'all' && sale.origin !== filters.sourceFilter) return false;
      return true;
    });
  }, [appliedFilters, customerNames, openOrders]);

  function handleSearch() {
    if (dateStart && dateEnd && dateStart > dateEnd) { setFilterError('A data inicial deve ser anterior ou igual à data final.'); return; }
    setFilterError(null);
    setAppliedFilters({ dateStart, dateEnd, orderId, customerSearch, statusFilter, paymentFilter, sourceFilter });
  }

  function clearFilters() {
    setDateStart(''); setDateEnd(''); setOrderId(''); setCustomerSearch('');
    setStatusFilter('all'); setPaymentFilter('all'); setSourceFilter('all');
    setAppliedFilters(null);
    setFilterError(null);
  }

  function clearPeriod() {
    setDateStart(''); setDateEnd(''); setFilterError(null);
    setAppliedFilters(current => current ? { ...current, dateStart: '', dateEnd: '' } : null);
  }

  const totalAmount = displayedOrders.reduce((sum, s) => sum + saleChargeTotal(s), 0);
  const pendingCount = displayedOrders.filter((s) => s.payment_status === 'pendente' || s.status === 'pre_venda').length;

  function requestFinalize(sale: PartnerSale) {
    if (!canApply() || finalizeInFlight.current || cancelInFlight.current || customerInFlight.current) return;
    setFinalizeTarget(sale);
    setFinalizePayment(sale.payment_method || 'pix');
    setFinalizeDraft(splitPaymentDraft(sale.payment_splits));
    setFinalizeError(null);
  }

  async function confirmFinalize() {
    if (!canApply() || !finalizeTarget || !onFinalizePreSale || finalizeInFlight.current || cancelInFlight.current || customerInFlight.current) return;
    if (!sales.some(sale => sale.id === finalizeTarget.id && sale.branch_id === finalizeTarget.branch_id && sale.status === 'pre_venda')) { setFinalizeError('Pedido não está mais aberto. Atualize a lista.'); return; }
    const parts = finalizePayment === 'misto' ? draftPayments(finalizeDraft) : [];
    const validation = finalizePayment === 'misto' ? splitPaymentError(saleChargeTotal(finalizeTarget), parts) : null;
    if (validation) { setFinalizeError(validation); return; }
    finalizeInFlight.current = true;
    setIsFinalizing(true);
    setFinalizeError(null);
    try {
      // The shared hook checks a fresh authorized credit balance before calling the sale RPC.
      await onFinalizePreSale(finalizeTarget.id, finalizePayment, parts);
      if (!canApply()) return;
      setNotice(`Pedido #${finalizeTarget.sale_number ?? finalizeTarget.id.slice(0, 8).toUpperCase()} finalizado.`);
      setFinalizeTarget(null);
    } catch (error) {
      if (canApply()) setFinalizeError(pdvErrorMessage(error));
    } finally {
      finalizeInFlight.current = false;
      setIsFinalizing(false);
    }
  }

  function requestCancel(sale: PartnerSale) {
    if (!canApply() || finalizeInFlight.current || cancelInFlight.current || customerInFlight.current) return;
    setCancelTarget(sale);
    setSupervisorId(canSelfAuthorize ? '' : salespeople.find(person => (person.active ?? person.is_active) !== false && (person.role === 'administrador' || (person.role === 'gerente' && person.branch_id === sale.branch_id)))?.id ?? '');
    setPinInput('');
    setPinError(null);
  }

  // O callback mantém o operador autenticado e envia a autorização do
  // supervisor separadamente. O PIN é validado somente no servidor.
  async function verifyPinAndCancel(action: 'cancel' | 'delete') {
    if (!canApply() || !cancelTarget || cancelInFlight.current || finalizeInFlight.current || customerInFlight.current) return;
    if (!sales.some(sale => sale.id === cancelTarget.id && sale.branch_id === cancelTarget.branch_id && ['pre_venda', 'aberta'].includes(sale.status))) { setPinError('Pedido não está mais aberto. Atualize a lista.'); return; }
    if (!supervisorId && !canSelfAuthorize) {
      setPinError('Selecione o responsável (Administrador ou Gerente).');
      return;
    }
    if (supervisorId && !/^\d{4,8}$/.test(pinInput.trim())) {
      setPinError('Digite o PIN do responsável selecionado.');
      return;
    }
    cancelInFlight.current = true;
    setIsVerifyingPin(true);
    setPinError(null);
    try {
      if (action === 'cancel') {
        await onCancelSale(cancelTarget.id, supervisorId || undefined, supervisorId ? pinInput.trim() : undefined);
      } else {
        await onDeleteSale(cancelTarget.id, supervisorId || undefined, supervisorId ? pinInput.trim() : undefined);
      }
      if (!canApply()) return;
      setNotice(`Pedido #${cancelTarget.sale_number ?? cancelTarget.id.slice(0, 8).toUpperCase()} ${action === 'delete' ? 'apagado' : 'cancelado'}.`);
      setCancelTarget(null);
      setSupervisorId('');
      setPinInput('');
      setPinError(null);
    } catch (error) {
      if (canApply()) setPinError(pdvErrorMessage(error));
    } finally {
      setIsVerifyingPin(false);
      cancelInFlight.current = false;
    }
  }

  return (
    <div className="panel-module">
      <div className="module-header">
        <span className="module-icon"><ClipboardList size={20} /></span>
        <div>
          <h3>Pedidos em Aberto</h3>
          <p>Acompanhe e finalize pré-vendas e pedidos online</p>
        </div>
      </div>

      <div className="orders-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <div className="orders-summary-card" style={{ padding: '14px 16px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', background: '#0f1f2c' }}>
          <small style={{ color: '#8ba3b5' }}>Pedidos em aberto</small>
          <strong style={{ display: 'block', fontSize: '22px', marginTop: '6px' }}>{displayedOrders.length}</strong>
        </div>
        <div className="orders-summary-card" style={{ padding: '14px 16px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', background: '#0f1f2c' }}>
          <small style={{ color: '#8ba3b5' }}>Valor total</small>
          <strong style={{ display: 'block', fontSize: '22px', marginTop: '6px' }}>{money.format(totalAmount)}</strong>
        </div>
        <div className="orders-summary-card" style={{ padding: '14px 16px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', background: '#0f1f2c' }}>
          <small style={{ color: '#8ba3b5' }}>Pendentes</small>
          <strong style={{ display: 'block', fontSize: '22px', marginTop: '6px' }}>{pendingCount}</strong>
        </div>
      </div>

      {documentError && <p className="otp-error-msg" role="alert">{documentError}</p>}
      {shareNotice && <p role="status">{shareNotice}</p>}
      {notice && <p role="status">{notice}</p>}
      {filterError && <p role="alert" className="otp-error-msg">{filterError}</p>}

      {/* Filter Bar */}
      <div className="orders-filter-bar">
        <div className="orders-filter-row">
          <div className="date-range-fields" role="group" aria-label="Período dos pedidos">
          <label className="orders-filter-field">
            <Calendar size={14} /> Data inicial
            <input type="date" aria-label="Data inicial dos pedidos" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
          </label>
          <label className="orders-filter-field">
            <Calendar size={14} /> Data final
            <input type="date" aria-label="Data final dos pedidos" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
          </label>
          </div>
          <label className="orders-filter-field">
            Identificador do pedido
            <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Nº do pedido" />
          </label>
          <label className="orders-filter-field">
            <Search size={14} /> Cliente
            <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Buscar cliente..." />
          </label>
        </div>
        <div className="orders-filter-actions">
          <button type="button" className="rma-advance-btn" onClick={clearPeriod}>Limpar período</button>
          <button className="rma-advance-btn" onClick={() => setShowAdvanced(!showAdvanced)}>
            <Filter size={14} /> Opções de pesquisa
          </button>
          <button className="rma-advance-btn" onClick={clearFilters}>
            <X size={14} /> Limpar filtros
          </button>
          <button className="module-submit-btn" onClick={handleSearch}>
            <Search size={14} /> Pesquisar
          </button>
        </div>
        {showAdvanced && (
          <div className="orders-advanced-filters">
            <label className="orders-filter-field">
              Status do pedido
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">Todos</option>
                <option value="aberta">Aberta</option>
                <option value="pre_venda">Pré-venda</option>
              </select>
            </label>
            <label className="orders-filter-field">
              Status do pagamento
              <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
                <option value="all">Todos</option>
                <option value="pago">Pago</option>
                <option value="pendente">Pendente</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </label>
            <label className="orders-filter-field">
              Origem
              <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
                <option value="all">Todas</option>
                <option value="pdv">PDV</option>
                <option value="catalogo">Pedidos Online</option>
              </select>
            </label>
          </div>
        )}
      </div>

      {/* Data Table */}
      <div className="stock-table-wrap open-orders-table-wrap">
        <table className="rma-table orders-table">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Pagamento</th>
              <th>Total (R$)</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {displayedOrders.length === 0 ? (
              <tr><td colSpan={5} className="empty-row">Nenhum pedido em aberto.</td></tr>
            ) : (
              displayedOrders.map((s) => {
                const st = statusLabels[s.status] ?? { label: s.status, color: '#7f97a9' };
                const pst = payStatusLabels[s.payment_status] ?? { label: s.payment_status, color: '#7f97a9' };
                return (
                  <tr key={s.id}>
                    <td data-label="Pedido">
                      <strong>#{(s.sale_number ? String(s.sale_number).padStart(6, '0') : s.id.slice(0, 8).toUpperCase())}</strong>
                      <small className="open-order-secondary">{new Date(s.created_at).toLocaleString('pt-BR')}</small>
                      <span className="order-origin-badge">{s.origin === 'catalogo' ? 'Online' : 'PDV'}</span>
                    </td>
                    <td data-label="Cliente">
                      <strong>{s.customer_name ?? '—'}</strong>
                      <small className="open-order-secondary">{s.items.length} {s.items.length === 1 ? 'item' : 'itens'}</small>
                      <span className="rma-status-badge" style={{ color: st.color, borderColor: st.color, backgroundColor: `${st.color}18` }}>{st.label}</span>
                    </td>
                    <td data-label="Pagamento">
                      <small className="open-order-secondary">{s.payment_method ?? 'A definir'}</small>
                      <span className="rma-status-badge" style={{ color: pst.color, borderColor: pst.color, backgroundColor: `${pst.color}18` }}>{pst.label}</span>
                      {s.online_payment && <small className="open-order-secondary">Pagamento online</small>}
                    </td>
                    <td data-label="Total"><strong>{money.format(saleChargeTotal(s))}</strong>{s.freight_fee ? <small>Frete: {money.format(s.freight_fee)}</small> : null}</td>
                    <td data-label="Ações" className="open-order-actions">
                      <div className="row-action-group">
                        {canCheckout && s.status === 'pre_venda' && (
                          <button className="module-submit-btn compact" disabled={busy} onClick={() => requestFinalize(s)} title="Finalizar no caixa">
                            <Wallet size={14} /> Finalizar
                          </button>
                        )}
                        {canCheckout && onPullToPdv && s.status === 'pre_venda' && (
                          <button className="rma-advance-btn" disabled={busy} onClick={() => onPullToPdv(s)} title="Resgatar para PDV">
                            <ArrowRight size={14} /> Resgatar para PDV
                          </button>
                        )}
                        <SaleActionsMenu
                          onShareQuote={!downloadingQuote ? () => { void handleDownloadQuote(s, true); } : undefined}
                          onDownloadQuote={!downloadingQuote ? () => { void handleDownloadQuote(s); } : undefined}
                          onChangeCustomer={canChangeCustomer && s.payment_status === 'pendente' && !s.online_payment ? () => {
                            if (!canApply() || finalizeInFlight.current || cancelInFlight.current || customerInFlight.current) return;
                            setCustomerTarget(s); setNewCustomerId(s.customer_id ?? ''); setCustomerTerm(''); setCustomerError(null);
                          } : undefined}
                          onEditItems={s.status === 'pre_venda' && !busy ? () => setEditTarget(s) : undefined}
                          onPrintReceipt={() => handlePrint(s, 'receipt')}
                          onPrintLabel={() => handlePrint(s, 'label')}
                          onWhatsApp={() => handleShare(s, 'whatsapp')}
                          onEmail={() => { if (!sendingEmail) void handleShare(s, 'email'); }}
                          onCancel={() => requestCancel(s)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="orders-footer-row">
              <td colSpan={3}><strong>{displayedOrders.length} registro(s)</strong></td>
              <td><strong>{money.format(totalAmount)}</strong></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Finalize Modal */}
      {editTarget && (
        <OpenOrderItemsEditor
          canEditPrice={canEditPrice}
          sale={editTarget}
          products={products}
          customers={customers}
          onSave={onUpdateItems}
          onClose={() => setEditTarget(null)}
        />
      )}
      {finalizeTarget && (
        <div className="modal-backdrop" onClick={() => { if (!finalizeInFlight.current) setFinalizeTarget(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3><Wallet size={18} style={{ display: 'inline', marginRight: '6px' }} /> Finalizar Pedido</h3>
              <button disabled={isFinalizing} onClick={() => { if (!finalizeInFlight.current) setFinalizeTarget(null); }}><X size={18} /></button>
            </div>
            <p className="otp-description">
              <strong>{finalizeTarget.customer_name ?? 'Cliente'}</strong> — {finalizeTarget.items.length} {finalizeTarget.items.length === 1 ? 'item' : 'itens'} — {money.format(saleChargeTotal(finalizeTarget))}
            </p>
            <label style={{ display: 'block', marginBottom: '12px' }}>
              <strong>Forma de Pagamento</strong>
              <select
                value={finalizePayment}
                disabled={isFinalizing}
                onChange={(e) => setFinalizePayment(e.target.value)}
                style={{ width: '100%', marginTop: '6px' }}
              >
                <option value="pix">PIX</option>
                <option value="cartao">Cartão</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="faturado">Faturado</option>
                <option value="misto">Dividido (dinheiro / PIX / cartão)</option>
              </select>
            </label>
            {finalizePayment === 'misto' && <SplitPaymentFields total={saleChargeTotal(finalizeTarget)} value={finalizeDraft} onChange={setFinalizeDraft} disabled={isFinalizing} />}
            {finalizeError && <p className="otp-error-msg" role="alert">{finalizeError}</p>}
            <div className="otp-actions">
              <button className="rma-advance-btn" disabled={isFinalizing} onClick={() => setFinalizeTarget(null)}>Cancelar</button>
              <button className="module-submit-btn" onClick={confirmFinalize} disabled={isFinalizing}>
                {isFinalizing ? 'Finalizando...' : 'Confirmar Venda'}
              </button>
            </div>
          </div>
        </div>
      )}

      {customerTarget && (
        <div className="modal-backdrop" onClick={() => { if (!customerInFlight.current) setCustomerTarget(null); }}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="change-customer-title" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h3 id="change-customer-title">Alterar cliente — #{customerTarget.id.slice(0, 8).toUpperCase()}</h3>
              <button disabled={savingCustomer} aria-label="Fechar alteração de cliente" onClick={() => setCustomerTarget(null)}><X size={18} /></button>
            </div>
            <p>Cliente atual: <strong>{customerTarget.customer_name || 'Sem cliente'}</strong></p>
            <p>Os produtos, preços e total deste pedido serão mantidos.</p>
            <fieldset disabled={savingCustomer} className="open-order-editor-fields">
              <label>Buscar cliente<input value={customerTerm} onChange={event => setCustomerTerm(event.target.value)} placeholder="Nome ou documento" /></label>
              <label>Novo cliente<select value={newCustomerId} onChange={event => setNewCustomerId(event.target.value)}>
                <option value="">Selecione um cliente</option>
                {newCustomerId && !availableCustomers.some(customer => customer.id === newCustomerId) && (
                  <option value={newCustomerId}>{customers.find(customer => customer.id === newCustomerId)?.name ?? 'Cliente selecionado'}</option>
                )}
                {availableCustomers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}{customer.document ? ` — ${customer.document}` : ''}</option>)}
              </select></label>
            </fieldset>
            {customerError && <p className="otp-error-msg" role="alert">{customerError}</p>}
            <div className="otp-actions">
              <button className="rma-advance-btn" disabled={savingCustomer} onClick={() => setCustomerTarget(null)}>Cancelar</button>
              <button className="module-submit-btn" disabled={savingCustomer || !newCustomerId || newCustomerId === customerTarget.customer_id} onClick={() => void saveCustomer()}>{savingCustomer ? 'Salvando...' : 'Salvar cliente'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel/Delete Modal */}
      {cancelTarget && (
        <div className="modal-backdrop" onClick={() => { if (!cancelInFlight.current) { setCancelTarget(null); setPinInput(''); } }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '380px' }}>
            <div className="modal-header">
              <h3><Lock size={18} style={{ display: 'inline', marginRight: '6px' }} /> Confirmação Necessária</h3>
              <button disabled={isVerifyingPin} onClick={() => { if (!cancelInFlight.current) { setCancelTarget(null); setPinInput(''); } }}><X size={18} /></button>
            </div>
            <p className="otp-description">
              Gerente e proprietário podem autorizar pelo próprio acesso. Funcionários precisam selecionar um responsável e informar o PIN dele.
            </p>
            {managers.length === 0 && !canSelfAuthorize ? (
              <p className="otp-error-msg">Nenhum Administrador ou Gerente cadastrado. Cadastre um em Colaboradores antes de continuar.</p>
            ) : (
              <>
                <label style={{ display: 'block', marginBottom: '12px' }}>
                  <strong>Responsável</strong>
                  <select
                    value={supervisorId}
                    disabled={isVerifyingPin}
                    onChange={(e) => { setSupervisorId(e.target.value); setPinError(null); }}
                    style={{ width: '100%', marginTop: '6px' }}
                  >
                    {canSelfAuthorize && <option value="">Autorizar com meu acesso atual</option>}
                    {managers.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.role === 'administrador' ? 'Administrador' : 'Gerente'})</option>)}
                  </select>
                </label>
                {supervisorId && <label style={{ display: 'block', marginBottom: '12px' }}>
                  <strong>PIN do responsável</strong>
                  <input
                    type="password"
                    disabled={isVerifyingPin}
                    value={pinInput}
                    onChange={(e) => { setPinInput(e.target.value); setPinError(null); }}
                    maxLength={8}
                    style={{ width: '100%', marginTop: '6px' }}
                    autoFocus
                  />
                </label>}
              </>
            )}
            {pinError && <p className="otp-error-msg">{pinError}</p>}
            <div className="otp-actions">
              <button className="rma-advance-btn danger" onClick={() => verifyPinAndCancel('delete')} disabled={isVerifyingPin || (!canSelfAuthorize && managers.length === 0) || cancelTarget.status !== 'pre_venda'}>
                {isVerifyingPin ? 'Verificando...' : 'Apagar'}
              </button>
              <button className="module-submit-btn" onClick={() => verifyPinAndCancel('cancel')} disabled={isVerifyingPin || (!canSelfAuthorize && managers.length === 0)}>
                {isVerifyingPin ? 'Verificando...' : 'Cancelar Pedido'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
