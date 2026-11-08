import { useCallback, useEffect, useRef, useState } from 'react';
import { Wallet, Printer, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { isDefinitiveSaleRejection, pdvErrorMessage } from '../../lib/pdv';
import { CashRequestStore, cashAmount, cashBusinessDay, cashDaySalesTotal, cashPaymentLabels, cashTotals, printCashReport, type CashMovement, type CashRequest, type CashSession } from '../../lib/cashRegister';
import { money } from '../../utils';
import { CashOverview } from './CashOverview';
import { PartnerReadFlight } from '../../lib/partnerSync';
import type { PartnerSale, PartnerSalesperson } from '../../types';

type Props = {
  branchId: string;
  branchName: string;
  scopeKey: string;
  sales: PartnerSale[];
  operatorId: string | null;
  operatorPin: string | null;
  salespeople: PartnerSalesperson[];
  isActive?: boolean;
  managedSessionId?: string | null;
  onManageSession?: (session: CashSession | null) => void;
  onGoToPdv?: () => void;
};

export function CashRegisterModule({ branchId, branchName, scopeKey, sales, operatorId, operatorPin, salespeople, isActive = true, managedSessionId = null, onManageSession, onGoToPdv }: Props) {
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [opening, setOpening] = useState('0');
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<'sangria' | 'suprimento'>('sangria');
  const [reason, setReason] = useState('');
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [refundSaleId, setRefundSaleId] = useState('');
  const [refundMethod, setRefundMethod] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [supervisorPin, setSupervisorPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<CashRequest | null>(null);
  const [actorKey, setActorKey] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [canViewOverview, setCanViewOverview] = useState(false);
  const [cashSales, setCashSales] = useState<PartnerSale[]>([]);
  const inFlight = useRef(false);
  const reportRef = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const reads = useRef(new PartnerReadFlight());
  const hasSnapshot = useRef(false);
  const context = useRef({ branchId, operatorId, operatorPin, scopeKey });
  context.current = { branchId, operatorId, operatorPin, scopeKey };
  const invalidateReads = useCallback(() => { generation.current++; }, []);

  const refresh = useCallback(async (reusePending = false) => {
    if (!supabase) throw new Error('Conecte-se para usar o controle de caixa.');
    const request = ++generation.current;
    const { data, error } = await reads.current.run(JSON.stringify([scopeKey, branchId, operatorId, operatorPin]), signal => {
      const query = supabase!.rpc('read_partner_cash_register', {
        p_branch_id: branchId, p_salesperson_id: operatorId, p_pin: operatorPin,
      });
      return typeof query.abortSignal === 'function' ? query.abortSignal(signal) : query;
    }, reusePending);
    if (error) throw error;
    if (!data || typeof data.actor_key !== 'string' || !Array.isArray(data.sessions) || !Array.isArray(data.movements)) throw new Error('Não foi possível conferir os dados do Caixa. Atualize antes de operar.');
    if (request === generation.current) {
      hasSnapshot.current = true;
      setSessions(data.sessions ?? []);
      setMovements(data.movements ?? []);
      setActorKey(data.actor_key);
      setCanManage(data.can_manage === true);
      setCanViewOverview(data.can_view_overview === true);
      setCashSales(data.sales ?? []);
    }
  }, [branchId, operatorId, operatorPin, scopeKey]);

  useEffect(() => {
    hasSnapshot.current = false;
    setLoading(true); setError(null); setNotice(null); setSessions([]); setMovements([]);
    setActorKey(''); setCanManage(false); setCanViewOverview(false); setCashSales([]);
    setSelectedId(''); setSupervisorPin(''); setCounted(''); setNotes('');
    setOpening('0'); setAmount(''); setKind('sangria'); setReason(''); setSupervisorId('');
    setRefundSaleId(''); setRefundMethod(''); setRefundAmount(''); setRefundReason('');
    setPending(null);
    try { setPending(new CashRequestStore(sessionStorage, scopeKey).read()); }
    catch (e) { setError(pdvErrorMessage(e)); setLoading(false); return; }
    return invalidateReads;
  }, [branchId, operatorId, operatorPin, scopeKey, invalidateReads]);

  useEffect(() => {
    if (!isActive || !branchId) { invalidateReads(); setLoading(false); return; }
    let active = true;
    const sync = (reusePending = true) => {
      setLoading(true);
      void refresh(reusePending).then(() => { if (active) setError(null); })
        .catch(e => { if (active) setError(pdvErrorMessage(e)); })
        .finally(() => { if (active) setLoading(false); });
    };
    const visible = () => { if (document.visibilityState === 'visible') sync(); };
    const focused = () => sync();
    const changed = () => sync(false);
    sync();
    window.addEventListener('focus', focused);
    window.addEventListener('distrihub:cash-changed', changed);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false; invalidateReads();
      window.removeEventListener('focus', focused); window.removeEventListener('distrihub:cash-changed', changed);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh, isActive, branchId, sales, invalidateReads]);

  const ownCurrent = sessions.find(s => !s.closed_at && s.actor_key === actorKey);
  const current = managedSessionId
    ? canManage ? sessions.find(s => s.id === managedSessionId && !s.closed_at) : undefined
    : ownCurrent;
  const supervised = Boolean(current && current.actor_key !== actorKey);
  const otherOpenSessions = sessions.filter(s => !s.closed_at && s.actor_key !== actorKey);
  const selected = sessions.find(s => s.id === selectedId) ?? current ?? sessions[0];
  const selectedMovements = movements.filter(m => m.session_id === selected?.id);
  const totals = selected?.closing_totals ?? cashTotals(selectedMovements);
  const today = cashBusinessDay(new Date());
  const dayTotal = cashDaySalesTotal(movements, sessions, branchId, selected?.actor_key ?? actorKey, today);
  const expected = selected ? Math.round((Number(selected.opening_amount) + (totals.dinheiro ?? 0)) * 100) / 100 : 0;
  const managers = salespeople.filter(p => p.is_active && ['administrador', 'gerente'].includes(p.role));
  const originalSaleMovements = movements.filter(movement => movement.kind === 'venda');
  const eligiblePayments = (saleId: string) => originalSaleMovements.filter(original =>
    original.sale_id === saleId && ['dinheiro', 'pix', 'cartao'].includes(original.payment_method) &&
    sessions.some(session => session.id === original.session_id && session.closed_at));
  const paymentRemaining = (original: CashMovement) => Math.round((Number(original.amount) - movements
    .filter(movement => movement.sale_id === original.sale_id && movement.payment_method === original.payment_method && ['devolucao', 'estorno'].includes(movement.kind))
    .reduce((sum, movement) => sum + Number(movement.amount), 0)) * 100) / 100;
  const allSales = [...cashSales, ...sales.filter(sale => !cashSales.some(saved => saved.id === sale.id))];
  const refundableSales = allSales.filter(sale => sale.branch_id === branchId && sale.status === 'concluida' &&
    eligiblePayments(sale.id).some(original => paymentRemaining(original) > 0));
  const selectedRefundSale = refundableSales.find(sale => sale.id === refundSaleId);
  const refundPayments = selectedRefundSale ? eligiblePayments(selectedRefundSale.id).filter(original => paymentRemaining(original) > 0) : [];
  const refundOriginal = refundPayments.find(original => original.payment_method === refundMethod) ?? refundPayments[0];
  const refundRemaining = refundOriginal ? paymentRemaining(refundOriginal) : 0;

  async function mutate(action: 'abrir' | 'movimentar' | 'fechar' | 'devolver', recovery = false) {
    if (!supabase || inFlight.current) return;
    const startedContext = context.current;
    const stillCurrent = () => context.current.scopeKey === startedContext.scopeKey && context.current.branchId === startedContext.branchId && context.current.operatorId === startedContext.operatorId && context.current.operatorPin === startedContext.operatorPin;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const store = new CashRequestStore(sessionStorage, scopeKey);
      const previous = store.read();
      if (previous && !recovery) throw new Error('Confirme a operação pendente antes de registrar outra movimentação.');
      const request: CashRequest | null = recovery ? previous : {
        id: crypto.randomUUID(), action, sessionId: action === 'abrir' ? null : current?.id ?? null,
        saleId: action === 'devolver' ? refundSaleId : null,
        paymentMethod: action === 'devolver' ? refundOriginal?.payment_method ?? null : null,
        amount: cashAmount(action === 'abrir' ? opening : action === 'fechar' ? counted : action === 'devolver' ? refundAmount : amount),
        kind: action === 'devolver' ? 'dinheiro' : kind,
        reason: action === 'fechar' ? notes.trim() : action === 'devolver' ? refundReason.trim() : reason.trim(),
        supervised,
      };
      if (!request) throw new Error('Nenhuma operação pendente.');
      if (!recovery && (loading || !isActive || (action !== 'abrir' && !current))) throw new Error('Atualize e selecione um caixa aberto antes de operar.');
      if (request.action === 'movimentar' && (!request.reason || request.amount <= 0)) throw new Error('Informe um valor maior que zero e o motivo da movimentação.');
      if (request.action === 'devolver') {
        if (!request.saleId || !request.reason || request.amount <= 0) {
          throw new Error('A solicitação de devolução pendente está incompleta.');
        }
        if (!recovery && (!selectedRefundSale || !refundOriginal ||
          !['dinheiro', 'pix', 'cartao'].includes(refundOriginal.payment_method) ||
          request.amount > refundRemaining)) {
          throw new Error('Selecione uma venda elegível e informe um valor dentro do saldo disponível.');
        }
      }
      store.save(request); setPending(request);
      const { error } = request.action === 'devolver'
        ? await supabase.rpc(request.supervised ? 'supervised_record_partner_cash_refund' : 'record_partner_cash_refund', {
          p_branch_id: branchId,
          p_salesperson_id: operatorId,
          p_pin: operatorPin,
          p_session_id: request.sessionId,
          p_sale_id: request.saleId,
          p_refund_method: request.paymentMethod ?? null,
          p_amount: request.amount,
          p_reason: request.reason,
          p_supervisor_id: supervisorId || null,
          p_supervisor_pin: supervisorPin || null,
          p_request_id: request.id,
        })
        : await supabase.rpc(request.supervised ? 'supervised_mutate_partner_cash_register' : 'mutate_partner_cash_register', {
          p_action: request.action, p_branch_id: branchId, p_salesperson_id: operatorId, p_pin: operatorPin,
          p_session_id: request.sessionId,
          p_amount: request.amount, p_kind: request.kind, p_reason: request.reason,
          p_supervisor_id: supervisorId || null, p_supervisor_pin: supervisorPin || null,
          p_request_id: request.id,
        });
      if (error) {
        if (!previous && isDefinitiveSaleRejection(error.code ?? '')) {
          store.clear(); if (stillCurrent()) setPending(null);
          throw error;
        }
        if (previous && isDefinitiveSaleRejection(error.code ?? '')) {
          const resolution = await supabase.rpc('resolve_partner_cash_request', {
            p_branch_id: branchId, p_salesperson_id: operatorId, p_pin: operatorPin, p_request: request,
          });
          if (resolution.error) throw resolution.error;
          if (resolution.data === false) {
            store.clear(); if (stillCurrent()) setPending(null);
            throw new Error('Operação não registrada; a pendência foi liberada. Corrija os dados e tente novamente. ' + pdvErrorMessage(error));
          }
          if (resolution.data !== true) throw new Error('Não foi possível conciliar a operação pendente. Atualize e tente confirmar novamente.');
        } else throw error;
      }
      store.clear();
      if (!stillCurrent()) return;
      setPending(null);
      setNotice(request.action === 'abrir' ? 'Caixa aberto.' : request.action === 'fechar' ? 'Caixa fechado. O relatório está no histórico.' : request.action === 'devolver' ? 'Devolução financeira registrada nesta sessão.' : 'Movimentação registrada.');
      setAmount(''); setReason(''); setCounted(''); setNotes(''); setSupervisorPin(''); setSelectedId('');
      if (request.action === 'devolver') { setRefundSaleId(''); setRefundMethod(''); setRefundAmount(''); setRefundReason(''); }
      if (request.action === 'fechar' && request.supervised) onManageSession?.(null);
      window.dispatchEvent(new Event('distrihub:cash-changed'));
      try { await refresh(); } catch (e) { if (stillCurrent()) setError('Operação confirmada, mas a atualização falhou. Clique em Atualizar. ' + pdvErrorMessage(e)); }
    } catch (e) { if (stillCurrent()) setError(pdvErrorMessage(e)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function authorization() {
    return <div className="cash-fields">
      <label>Responsável (gerente ou administrador)<select value={supervisorId} onChange={e => setSupervisorId(e.target.value)} disabled={busy}>
        <option value="">Operador atual, se autorizado</option>
        {managers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <label>PIN do responsável<input type="password" autoComplete="off" value={supervisorPin} onChange={e => setSupervisorPin(e.target.value)} disabled={busy} /></label>
    </div>;
  }

  if (!branchId) return <div className="panel-module"><h3>Caixa</h3><p>Selecione uma filial para abrir ou consultar o caixa.</p></div>;
  return <div className="panel-module cash-module">
    <div className="module-header"><span className="module-icon"><Wallet size={20} /></span><div><h3>Caixa</h3><p>{branchName} · Abertura, movimentações e fechamento por operador</p></div></div>
    <button type="button" className="rma-advance-btn" disabled={busy || loading} onClick={async () => {
      setLoading(true); setError(null);
      try { await refresh(); } catch (e) { setError(pdvErrorMessage(e)); } finally { setLoading(false); }
    }}><RefreshCw size={14} /> Atualizar</button>
    {error && <p className="otp-error-msg" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {canManage && canViewOverview && hasSnapshot.current && !error && <CashOverview key={branchId} branchId={branchId} branchName={branchName} sessions={sessions} movements={movements}
      onViewReport={id => { setSelectedId(id); reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />}
    {canManage && onManageSession && <section className="cash-card">
      <label>Caixa para operar<select aria-label="Caixa para operar" value={managedSessionId ?? ''} disabled={busy || loading || Boolean(pending)} onChange={e => {
        const session = sessions.find(item => item.id === e.target.value && !item.closed_at) ?? null;
        setSelectedId(session?.id ?? ''); onManageSession(session);
        setOpening('0'); setAmount(''); setReason(''); setCounted(''); setNotes(''); setSupervisorId(''); setSupervisorPin('');
        setRefundSaleId(''); setRefundMethod(''); setRefundAmount(''); setRefundReason('');
      }}>
        <option value="">Meu caixa</option>
        {otherOpenSessions.map(session => <option key={session.id} value={session.id}>{session.operator_name} · Caixa aberto</option>)}
      </select></label>
      <p>Gerente e proprietário podem finalizar vendas, registrar movimentos e fechar o caixa selecionado. O sistema registra o responsável pela operação.</p>
      {current && onGoToPdv && <button className="module-submit-btn" disabled={busy || loading || Boolean(pending)} onClick={onGoToPdv}>Ir ao PDV · Caixa de {current.operator_name}</button>}
      {managedSessionId && !current && !loading && <p role="alert">O caixa selecionado foi fechado ou não está mais disponível. Selecione outro caixa.</p>}
    </section>}
    {pending && <section className="cash-card"><p>Há uma operação com resultado ainda não confirmado: {pending.action} · {money.format(pending.amount)}. Confirme antes de iniciar outra operação.</p>
      {authorization()}<button className="module-submit-btn" disabled={busy || loading} onClick={() => void mutate(pending.action, true)}>Confirmar operação pendente</button>
    </section>}
    {loading && !hasSnapshot.current ? <p>Carregando caixa...</p> : <>
      {!current && !error && otherOpenSessions.length > 0 && <p role="status">Há caixas abertos de {otherOpenSessions.map(session => session.operator_name).join(', ')}. Você pode finalizar vendas no PDV usando o caixa aberto da filial; o colaborador ficará registrado em cada venda.</p>}
      {!current && !managedSessionId && actorKey && <section className="cash-card"><h4>Abrir caixa</h4><p>Informe o dinheiro disponível para troco. Pré-vendas não entram no saldo até serem finalizadas.</p>
        <form onSubmit={e => { e.preventDefault(); void mutate('abrir'); }} className="cash-fields">
          <label>Troco inicial (R$)<input inputMode="decimal" value={opening} onChange={e => setOpening(e.target.value)} disabled={busy || loading} required /></label>
          <button className="module-submit-btn" disabled={busy || loading || Boolean(pending)}>{busy ? 'Aguarde...' : 'Abrir caixa'}</button>
        </form>
      </section>}
      {current && <section className="cash-card"><h4>Caixa aberto · {current.operator_name}</h4><p>Aberto em {new Date(current.opened_at).toLocaleString('pt-BR')}</p>
        <fieldset disabled={busy || loading || Boolean(pending)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <form onSubmit={e => { e.preventDefault(); void mutate('movimentar'); }}>
          <h4>Registrar movimentação</h4><div className="cash-fields">
            <label>Tipo<select value={kind} onChange={e => setKind(e.target.value as typeof kind)} disabled={busy}><option value="sangria">Sangria (retirada)</option><option value="suprimento">Suprimento (entrada)</option></select></label>
            <label>Valor (R$)<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} required disabled={busy} /></label>
            <label>Motivo<input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} required disabled={busy} /></label>
          </div>{kind === 'sangria' && authorization()}<button className="module-submit-btn" disabled={busy}>Registrar</button>
        </form>
        <form onSubmit={e => { e.preventDefault(); void mutate('devolver'); }}>
          <h4>Registrar devolução financeira</h4>
          <p>A devolução fica vinculada à venda original e à sessão aberta. O caixa já fechado permanece imutável. Vendas faturadas e devoluções de estoque precisam do fluxo correspondente.</p>
          <div className="cash-fields">
            <label>Venda<select value={refundSaleId} onChange={e => { setRefundSaleId(e.target.value); setRefundMethod(''); setRefundAmount(''); }} required disabled={busy}>
              <option value="">Selecione uma venda elegível</option>
              {refundableSales.map(sale => {
                const remaining = eligiblePayments(sale.id).reduce((sum, original) => sum + paymentRemaining(original), 0);
                return <option key={sale.id} value={sale.id}>#{(sale.sale_number ? String(sale.sale_number).padStart(6, '0') : sale.id.slice(0, 8).toUpperCase())} · {money.format(remaining)} restantes</option>;
              })}
            </select></label>
            {selectedRefundSale && refundOriginal && <>
              <label>Forma da devolução<select value={refundOriginal.payment_method} onChange={e => { setRefundMethod(e.target.value); setRefundAmount(''); }} disabled={busy}>
                {refundPayments.map(original => <option key={original.payment_method} value={original.payment_method}>{cashPaymentLabels[original.payment_method] ?? original.payment_method} · {money.format(paymentRemaining(original))} disponíveis</option>)}
              </select></label>
              <label>Valor da devolução (máx. {money.format(refundRemaining)})<input inputMode="decimal" value={refundAmount} onChange={e => setRefundAmount(e.target.value)} required disabled={busy} /></label>
              <label>Motivo<input value={refundReason} onChange={e => setRefundReason(e.target.value)} maxLength={500} required disabled={busy} /></label>
              <p>Forma de saída: {cashPaymentLabels[refundOriginal.payment_method] ?? refundOriginal.payment_method} (mesma forma da venda).</p>
            </>}
          </div>
          {authorization()}
          <button className="module-submit-btn" disabled={busy || !selectedRefundSale || !refundAmount || !refundReason.trim()}>Registrar devolução</button>
        </form>
        <form onSubmit={e => { e.preventDefault(); void mutate('fechar'); }}>
          <h4>Fechar caixa</h4><p>Dinheiro esperado: <strong>{money.format(Number(current.opening_amount) + (cashTotals(movements.filter(m => m.session_id === current.id)).dinheiro ?? 0))}</strong></p>
          <div className="cash-fields"><label>Dinheiro contado (R$)<input inputMode="decimal" value={counted} onChange={e => setCounted(e.target.value)} required disabled={busy} /></label>
            <label>Observação / justificativa da diferença<input value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} disabled={busy} /></label></div>
          <p>Fechamentos com diferença exigem justificativa e autorização de gerente ou administrador.</p>{authorization()}
          <button className="module-submit-btn" disabled={busy}>Confirmar fechamento</button>
        </form>
        </fieldset>
      </section>}
      <section className="cash-card" ref={reportRef}><h4>Histórico e relatório</h4><label>Caixa<select value={selected?.id ?? ''} onChange={e => setSelectedId(e.target.value)}>
        {!sessions.length && <option value="">Nenhum caixa registrado</option>}
        {sessions.map(s => <option key={s.id} value={s.id}>{new Date(s.opened_at).toLocaleString('pt-BR')} · {s.operator_name} · {s.closed_at ? 'Fechado' : 'Aberto'}</option>)}
      </select></label>
      {selected && <>
        {selected.actor_key !== actorKey && <p>Caixa aberto por {selected.operator_name}. {selected.history_complete === false ? 'Aqui são exibidas as vendas finalizadas por você neste caixa compartilhado.' : 'Cada venda identifica o colaborador que a finalizou.'}</p>}
        <h4>Vendas deste caixa</h4>
        <div className="stock-table-wrap"><table className="rma-table"><thead><tr><th>Venda</th><th>Cliente</th><th>Finalizado por</th><th>Total</th><th>Status</th></tr></thead><tbody>
          {allSales.filter(sale => selectedMovements.some(m => m.sale_id === sale.id && m.kind === 'venda')).map(sale => <tr key={sale.id}><td>#{sale.sale_number ?? sale.id.slice(0, 8).toUpperCase()}</td><td>{sale.customer_name}</td><td>{selectedMovements.find(m => m.sale_id === sale.id && m.kind === 'venda')?.performed_by_name || 'Não registrado'}</td><td>{money.format(Number(sale.total) + Number(sale.freight_fee ?? 0))}</td><td>{sale.status}</td></tr>)}
          {!selectedMovements.some(m => m.kind === 'venda') && <tr><td colSpan={5}>Nenhuma venda registrada neste caixa.</td></tr>}
        </tbody></table></div>
        {selected.history_complete !== false && <>
        <div className="cash-summary"><div><small>Troco inicial</small><strong>{money.format(selected.opening_amount)}</strong></div>
          {Object.entries(totals).map(([key, value]) => <div key={key}><small>{cashPaymentLabels[key] ?? key} · líquido</small><strong>{money.format(value)}</strong></div>)}
          <div className="cash-day-total"><small>Total do dia</small><strong>{money.format(dayTotal)}</strong><small>{today.split('-').reverse().join('/')} · {selected.operator_name}</small></div>
          <div><small>Dinheiro esperado</small><strong>{money.format(selected.expected_amount ?? expected)}</strong></div>
          {selected.closed_at && <><div><small>Dinheiro contado</small><strong>{money.format(selected.counted_amount ?? 0)}</strong></div><div><small>Diferença</small><strong>{money.format(selected.difference ?? 0)}</strong></div></>}
        </div>
        <p>O líquido em dinheiro inclui sangrias e suprimentos. Faturado é valor a receber e não compõe o dinheiro do caixa.</p>
        <p>O total do dia soma as vendas de hoje do operador nesta filial, incluindo faturado e descontando estornos e devoluções do dia. Não inclui troco inicial, sangrias ou suprimentos.</p>
        <button className="rma-advance-btn" onClick={() => { try { printCashReport(selected, selectedMovements, branchName); } catch (e) { setError(pdvErrorMessage(e)); } }}><Printer size={14} /> Imprimir relatório</button>
        </>}
        <div className="stock-table-wrap"><table className="rma-table"><thead><tr><th>Data</th><th>Tipo</th><th>Colaborador</th><th>Pagamento</th><th>Valor</th><th>Motivo / pedido</th></tr></thead><tbody>
          {selectedMovements.length ? selectedMovements.map(m => <tr key={m.id}><td>{new Date(m.created_at).toLocaleString('pt-BR')}</td><td>{m.kind}</td><td>{m.performed_by_name || 'Não registrado'}</td><td>{cashPaymentLabels[m.payment_method] ?? m.payment_method}</td><td>{money.format(m.amount)}</td><td>{m.reason}{m.sale_id && ` · #${m.sale_id.slice(0, 8).toUpperCase()}`}</td></tr>) : <tr><td colSpan={6}>Nenhuma movimentação.</td></tr>}
        </tbody></table></div>
      </>}
      </section>
    </>}
  </div>;
}
