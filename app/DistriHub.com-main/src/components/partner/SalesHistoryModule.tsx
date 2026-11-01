import { salePaymentDescription } from '../../lib/pdv';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Ban, Lock, X } from 'lucide-react';
import type { PartnerSale, PartnerCustomer, PartnerSalesperson, RmaRequest } from '../../types';
import { saleReturnLabel, saleItemDescription } from '../../lib/saleReturns';
import { SaleActionsMenu } from './SaleActionsMenu';
import { money } from '../../utils';
import { saleChargeTotal } from '../../lib/pdv';
import { printSale, type PrintableSale, type ReceiptDetails } from '../../lib/salePrint';
import { saleShareUrl } from '../../lib/saleShare';

type Props = {
  companyId?: string;
  branchId?: string | null;
  isActive?: boolean;
  currentRole?: string;
  operatorKey?: string;
  onPageLoaded?: (sales: PartnerSale[]) => void;
  sales: PartnerSale[];
  rmaRequests?: RmaRequest[];
  customers: PartnerCustomer[];
  salespeople: PartnerSalesperson[];
  segment: string;
  receiptDetails?: ReceiptDetails;
  onCancelSale: (id: string, operatorId?: string | null, operatorPin?: string | null) => Promise<void>;
};

function localDate(value: string | Date) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function SalesHistoryModule(props: Props) {
  return <SalesHistoryContent key={JSON.stringify([props.companyId, props.branchId, props.operatorKey, props.currentRole])} {...props} />;
}

function SalesHistoryContent({ companyId, branchId = null, isActive = true, currentRole, onPageLoaded, sales, rmaRequests = [], customers, salespeople, receiptDetails, onCancelSale }: Props) {
  const mounted = useRef(true);
  const active = useRef(isActive); active.current = isActive;
  const actionInFlight = useRef(false);
  const actionVersion = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState(() => localDate(new Date()));
  const [endDate, setEndDate] = useState(() => localDate(new Date()));
  const [status, setStatus] = useState('all');
  const serverMode = Boolean(companyId);
  const [page, setPage] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [serverHistory, setServerHistory] = useState<{ key: string; sales: PartnerSale[]; rmas: RmaRequest[]; total: number; completedTotal: number } | null>(null);
  const historyKey = JSON.stringify([companyId, branchId, startDate, endDate, status, search, page, historyVersion]);
  const currentHistory = serverHistory?.key === historyKey ? serverHistory : null;
  const historyRmas = useMemo(() => serverMode ? [...new Map([...rmaRequests, ...(currentHistory?.rmas ?? [])].map(row => [row.id, row])).values()] : rmaRequests, [serverMode, rmaRequests, currentHistory]);
  useEffect(() => { setPage(0); }, [companyId, branchId, startDate, endDate, status, search]);
  useEffect(() => {
    if (!serverMode || !isActive) return;
    let active = true; setHistoryError(null);
    const timer = setTimeout(() => {
      if (!supabase) { setHistoryError('Historico indisponivel.'); return; }
      void Promise.resolve(supabase.rpc('read_partner_sales_history', { p_company_id: companyId, p_branch_id: branchId || null, p_start: startDate || null, p_end: endDate || null, p_status: status, p_search: search.trim(), p_page: page })).then(({ data, error }) => {
        if (!active) return;
        if (error || !data || !Array.isArray(data.sales) || !Array.isArray(data.rmas) || !Number.isInteger(Number(data.total)) || Number(data.total) < 0 || !Number.isFinite(Number(data.completed_total))) { setHistoryError(error?.message ?? 'Resposta do historico invalida.'); return; }
        setServerHistory({ key: historyKey, sales: data.sales, rmas: data.rmas, total: Number(data.total), completedTotal: Number(data.completed_total) });
        onPageLoaded?.(data.sales);
      }).catch(() => { if (active) setHistoryError('Nao foi possivel carregar o historico.'); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [serverMode, isActive, companyId, branchId, startDate, endDate, status, search, page, historyVersion, historyKey, onPageLoaded]);
  useEffect(() => {
    if (!companyId || !isActive || !supabase || typeof supabase.channel !== 'function') return;
    const client = supabase;
    const channel = client.channel('history-' + companyId + '-' + (branchId ?? 'all'));
    for (const table of ['partner_sales', 'rma_requests_v2']) channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: 'user_id=eq.' + companyId }, () => setHistoryVersion(value => value + 1));
    channel.subscribe();
    return () => { void client.removeChannel(channel); };
  }, [companyId, branchId, isActive]);
  const traceabilityLabel = 'Série / IMEI / Selo';
  const filteredSales = useMemo(() => {
    if (serverMode) return [];
    const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const term = normalize(search.trim());
    return sales.filter(sale => {
      const date = localDate(sale.completed_at ?? sale.created_at);
      return sale.status !== 'pre_venda' && (!startDate || date >= startDate) && (!endDate || date <= endDate)
        && (status === 'all' || (status === 'devolucao' ? !!saleReturnLabel(sale, rmaRequests) || sale.status === status : sale.status === status && !saleReturnLabel(sale, rmaRequests)))
        && (!term || normalize([sale.id, sale.sale_number ? String(sale.sale_number).padStart(6, '0') : '', sale.customer_name, sale.imei, sale.serial_number].join(' ')).includes(term));
    }).sort((a, b) => new Date(b.completed_at ?? b.created_at).getTime() - new Date(a.completed_at ?? a.created_at).getTime());
  }, [serverMode, sales, rmaRequests, search, startDate, endDate, status]);
  const displayedSales = serverMode ? currentHistory?.sales ?? [] : filteredSales;
  const [printError, setPrintError] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);

  function handleShare(sale: PrintableSale, channel: 'whatsapp' | 'email') {
    setPrintError(null);
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
        setShareNotice('Confirme o envio no WhatsApp conectado ao número da empresa. O resumo vai em texto, sem PDF anexado.');
      } else {
        const link = document.createElement('a');
        link.href = url;
        document.body.append(link);
        link.click();
        link.remove();
        setShareNotice('Confirme o envio usando o e-mail da empresa. Se nada abriu, configure um aplicativo de e-mail padrão no dispositivo. O resumo vai em texto, sem PDF anexado.');
      }
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : 'Não foi possível preparar o envio.');
    }
  }

  async function handlePrint(sale: PrintableSale, format: 'receipt' | 'label') {
    setPrintError(null);
    try { await printSale(sale, format, {
      ...receiptDetails,
      customer: customers.find((customer) => customer.id === sale.customer_id),
      salespersonName: salespeople.find((person) => person.id === sale.salesperson_id)?.name,
    }); } catch (error) {
      setPrintError(error instanceof Error ? error.message : 'Não foi possível abrir a impressão.');
    }
  }
  const [cancelTarget, setCancelTarget] = useState<PartnerSale | null>(null);
  const [supervisorId, setSupervisorId] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);
  const canSelfAuthorize = currentRole === 'administrador' || currentRole === 'gerente';
  const managersFor = (saleBranch?: string | null) => salespeople.filter((s) =>
    (s.active ?? s.is_active) !== false && !s.blocked_modules?.includes('pdv') &&
    (s.role === 'administrador' || (s.role === 'gerente' && (s.branch_id === saleBranch || (!companyId && !s.branch_id)))));
  const managers = managersFor(cancelTarget?.branch_id ?? branchId);
  useEffect(() => {
    if (!isActive) {
      actionVersion.current += 1;
      setCancelTarget(null); setSupervisorId(''); setPinInput(''); setPinError(null);
    }
  }, [isActive]);
  function closeCancel() {
    if (actionInFlight.current) return;
    setCancelTarget(null); setSupervisorId(''); setPinInput(''); setPinError(null);
  }
  function requestCancelSale(sale: PartnerSale) {
    if (!active.current || actionInFlight.current) return;
    setCancelTarget(sale);
    setSupervisorId(managersFor(sale.branch_id)[0]?.id ?? '');
    setPinInput('');
    setPinError(null);
  }

  async function verifyPinAndCancel() {
    if (!cancelTarget || !active.current || actionInFlight.current) return;
    if (!canSelfAuthorize && !supervisorId) {
      setPinError('Selecione o responsável (Administrador ou Gerente).');
      return;
    }
    if (!canSelfAuthorize && !pinInput) {
      setPinError('Digite o PIN do responsável selecionado.');
      return;
    }
    actionInFlight.current = true;
    const version = actionVersion.current;
    const canApply = () => mounted.current && active.current && actionVersion.current === version;
    setIsVerifyingPin(true);
    setPinError(null);
    try {
      await onCancelSale(cancelTarget.id, canSelfAuthorize ? null : supervisorId, canSelfAuthorize ? null : pinInput);
      if (!canApply()) return;
      setHistoryVersion(value => value + 1);
      setCancelTarget(null);
      setSupervisorId('');
      setPinInput('');
      setPinError(null);
    } catch (error) {
      if (!canApply()) return;
      setPinError(error instanceof Error ? error.message : 'Não foi possível autorizar. Verifique o PIN.');
    } finally {
      actionInFlight.current = false;
      if (mounted.current) setIsVerifyingPin(false);
    }
  }

  return (<>
    <div className="orders-filter-row sales-history-filters">
      <label>Buscar venda<input type="search" name="sales-history-search" maxLength={200} autoComplete="off" data-lpignore="true" data-1p-ignore="true" disabled={!!cancelTarget} value={search} onChange={e => { if (!cancelTarget) setSearch(e.target.value); }} placeholder="Cliente, número da venda, série ou IMEI" /></label>
      <label>De<input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
      <label>Até<input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label>
      <label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="all">Todos</option><option value="concluida">Concluída</option><option value="cancelada">Cancelada</option><option value="aberta">Aberta</option><option value="devolucao">Devolução</option></select></label>
      <button className="rma-advance-btn" onClick={() => { const today = localDate(new Date()); setStartDate(today); setEndDate(today); }}>Hoje</button>
      <button className="rma-advance-btn" onClick={() => { setStartDate(''); setEndDate(''); }}>Todo o período</button>
    </div>
    {historyError && <p role="alert" className="otp-error-msg">{historyError}<button className="rma-advance-btn" onClick={() => setHistoryVersion(value => value + 1)}>Tentar novamente</button></p>}
    {serverMode && !currentHistory ? !historyError && <p role="status">Carregando histórico...</p> : <p>{serverMode ? currentHistory?.total ?? 0 : filteredSales.length} vendas encontradas no período. Total concluído: <strong>{money.format(serverMode ? currentHistory?.completedTotal ?? 0 : filteredSales.filter(s => s.status === 'concluida').reduce((sum, s) => sum + Number(s.total), 0))}</strong></p>}
    {serverMode && <div className="subscription-actions"><button type="button" disabled={page === 0 || !currentHistory} onClick={() => setPage(value => value - 1)}>Anterior</button><span>Página {page + 1} · {currentHistory?.total ?? '…'} venda(s)</span><button type="button" disabled={!currentHistory || (page + 1) * 25 >= currentHistory.total} onClick={() => setPage(value => value + 1)}>Próxima</button><button type="button" onClick={() => setHistoryVersion(value => value + 1)}>Atualizar histórico</button></div>}
      {printError && <p className="otp-error-msg" role="alert">{printError}</p>}
      {shareNotice && <p role="status">{shareNotice}</p>}
      <div className="pdv-recent-sales sales-history-table">
        <h4>Vendas</h4>
        <div className="stock-table-wrap sales-history-list-wrap">
          <table className="rma-table sales-history-list-table">
            <thead><tr><th>Cliente</th><th>Itens</th><th>Total</th><th>Pagamento</th><th>{traceabilityLabel}</th><th>Status</th><th>Data</th><th></th></tr></thead>
            <tbody>
              {displayedSales.length === 0 ? (
                <tr><td colSpan={8} className="empty-row">{serverMode && !currentHistory ? 'Aguardando consulta do historico.' : 'Nenhuma venda registrada.'}</td></tr>
              ) : (
                displayedSales.map((s) => (
                  <tr key={s.id} className={s.status === 'cancelada' ? 'cancelled-row' : ''}>
                    <td data-label="Cliente"><strong>{s.customer_name ?? '—'}</strong><small className="sales-history-id" title={s.id}>#{(s.sale_number ? String(s.sale_number).padStart(6, '0') : s.id.slice(0, 8))}</small></td>
                    <td data-label="Itens">
                      {s.items.length} {s.items.length === 1 ? 'item' : 'itens'}
                      {s.items.length > 0 && <details style={{ marginTop: '6px' }}>
                        <summary style={{ cursor: 'pointer', color: '#5cb5f1' }}>Visualizar produtos</summary>
                        <small style={{ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere', maxWidth: '360px', maxHeight: '260px', overflowY: 'auto', marginTop: '8px' }}>
                          {saleItemDescription(s, historyRmas)}
                        </small>
                      </details>}
                    </td>
                    <td data-label="Total">{money.format(saleChargeTotal(s))}{s.freight_fee ? <small>Frete: {money.format(s.freight_fee)}</small> : null}</td>
                    <td data-label="Pagamento">{salePaymentDescription(s)}</td>
                    <td data-label={traceabilityLabel}>{s.imei ?? s.serial_number ?? '—'}</td>
                    <td data-label="Status">
                      {s.status === 'cancelada' ? (
                        <span className="rma-status-badge history-status-cancelled">Cancelada</span>
                      ) : (
                        <span className={`rma-status-badge ${saleReturnLabel(s, historyRmas) || s.status === 'devolucao' ? 'history-status-returned' : s.status === 'concluida' ? 'history-status-completed' : 'history-status-open'}`}>{saleReturnLabel(s, historyRmas) || (s.status === 'concluida' ? 'Concluída' : s.status === 'aberta' ? 'Aberta' : 'Devolução')}</span>
                      )}
                    </td>
                    <td data-label="Data">{new Date(s.completed_at ?? s.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td>
                    <td className="sales-history-actions" data-label="Ações">
                      {s.status !== 'cancelada' && (
                        <SaleActionsMenu
                          onPrintReceipt={() => handlePrint(s, 'receipt')}
                          onPrintLabel={() => handlePrint(s, 'label')}
                          onWhatsApp={() => handleShare(s, 'whatsapp')}
                          onEmail={() => handleShare(s, 'email')}
                          onCancel={saleReturnLabel(s, historyRmas) ? undefined : () => requestCancelSale(s)}
                        />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>


      {cancelTarget && (
        <div className="modal-backdrop" onClick={closeCancel}>
          <form id="sales-history-cancel-authorization" autoComplete="off" className="modal-content" onSubmit={e => e.preventDefault()} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '380px' }}>
            <div className="modal-header">
              <h3><Lock size={18} style={{ display: 'inline', marginRight: '6px' }} /> Confirmação Necessária</h3>
              <button type="button" disabled={isVerifyingPin} onClick={closeCancel}><X size={18} /></button>
            </div>
            <p className="otp-description">
              {canSelfAuthorize ? 'Confirme o cancelamento com sua permissão de gerente ou proprietário.' : 'Selecione o responsável e digite o PIN dele para autorizar o cancelamento.'}
            </p>
            <p>Venda #{cancelTarget.sale_number ? String(cancelTarget.sale_number).padStart(6, '0') : cancelTarget.id.slice(0, 8)} — {cancelTarget.customer_name || 'Cliente não informado'}</p>
            {!canSelfAuthorize && (managers.length === 0 ? (
              <p className="otp-error-msg">Nenhum Administrador ou Gerente cadastrado com PIN. Cadastre um em Colaboradores antes de continuar.</p>
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
                    {managers.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.role === 'administrador' ? 'Administrador' : 'Gerente'})</option>)}
                  </select>
                </label>
                <label style={{ display: 'block', marginBottom: '12px' }}>
                  <strong>PIN do responsável</strong>
                  <input
                    type="password"
                    disabled={isVerifyingPin}
                    name="sales-cancellation-supervisor-pin"
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    inputMode="numeric"
                    value={pinInput}
                    onChange={(e) => { setPinInput(e.target.value); setPinError(null); }}
                    maxLength={8}
                    style={{ width: '100%', marginTop: '6px' }}
                    autoFocus
                  />
                </label>
              </>
            ))}
            {pinError && <p className="otp-error-msg">{pinError}</p>}
            <div className="otp-actions">
              <button type="button" className="module-submit-btn" onClick={verifyPinAndCancel} disabled={isVerifyingPin || (!canSelfAuthorize && managers.length === 0)}>
                <Ban size={16} /> {isVerifyingPin ? 'Verificando...' : 'Cancelar Venda'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
