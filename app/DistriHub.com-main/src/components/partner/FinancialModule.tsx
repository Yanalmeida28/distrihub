import { useEffect, useMemo, useRef, useState } from 'react';
import { Wallet, CreditCard, Receipt, Check } from 'lucide-react';
import type { PartnerInvoice, RmaRequest } from '../../types';
import { accountPaid as paidAmount, accountBalance as balance, isOverdue } from '../../lib/accounts';
import { InvoiceReceipts } from './InvoiceReceipts';
import { money } from '../../utils';
import { FinancialRecoveryPanel } from './FinancialRecoveryPanel';
import type { FinancialRecovery } from '../../lib/invoicePayments';

type Props = {
  contextKey?: string;
  isActive?: boolean;
  recoveries?: FinancialRecovery[];
  recoveryError?: string;
  invoices: PartnerInvoice[];
  creditLimit: number;
  creditUsed: number;
  onPayInvoice: (id: string, amount?: number, requestId?: string) => Promise<void>;
  rmaRequests?: RmaRequest[];
  onApplyCredit?: (rmaId: string, invoiceId: string, amount: number, applicationId: string) => Promise<void>;
};

const isOpen = (invoice: PartnerInvoice) => invoice.status === 'aberta' || invoice.status === 'parcial';

export function FinancialModule(props: Props) {
  const context = props.contextKey ?? [...new Set(props.invoices.map(invoice => invoice.user_id + ':' + invoice.branch_id))].sort().join('|');
  return <FinancialScreen key={context} {...props} />;
}

function FinancialScreen({ invoices, creditLimit, creditUsed, onPayInvoice, rmaRequests = [], onApplyCredit, recoveries = [], recoveryError, isActive = true }: Props) {
  const mounted = useRef(true);
  const activeRef = useRef(isActive); activeRef.current = isActive;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!isActive) { setPayingId(null); setCreditInvoice(null); setFilter('aberta'); } }, [isActive]);
  const pending = recoveries.length > 0 || Boolean(recoveryError);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [paymentMode, setPaymentMode] = useState<'full' | 'partial'>('full');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const paymentRequest = useRef<{ id: string; amount: number; token: string } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [receiptInvoiceId, setReceiptInvoiceId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'aberta' | 'paga'>('aberta');
  const [creditInvoice, setCreditInvoice] = useState<PartnerInvoice | null>(null);
  useEffect(() => {
    setCreditInvoice(current => current ? invoices.find(invoice => invoice.id === current.id && isOpen(invoice)) ?? null : null);
  }, [invoices]);
  const [selectedCreditId, setSelectedCreditId] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditError, setCreditError] = useState<string | null>(null);
  const applicationId = useRef<string | null>(null);
  const availableCredit = (rma: RmaRequest) => Math.max(0, Math.round(Number(rma.credit_amount ?? 0) * 100) - Math.round(Number(rma.credit_used_amount ?? 0) * 100)) / 100;
  const creditBalanceKnown = rmaRequests.every(rma => !Number(rma.credit_amount) || rma.credit_used_amount != null);
  const walletBalance = rmaRequests.reduce((sum, rma) => sum + Math.round(availableCredit(rma) * 100), 0) / 100;
  const eligibleCredits = (invoice: PartnerInvoice) => rmaRequests.filter(rma => rma.customer_id === invoice.customer_id && rma.branch_id === invoice.branch_id && rma.credit_used_amount != null && availableCredit(rma) > 0);

  function openCredit(invoice: PartnerInvoice) {
    const credit = eligibleCredits(invoice)[0];
    setCreditInvoice(invoice); setSelectedCreditId(credit?.id ?? '');
    setCreditAmount(credit ? Math.min(availableCredit(credit), balance(invoice)).toFixed(2) : '');
    setCreditError(null); applicationId.current = crypto.randomUUID();
  }

  async function confirmCredit(event: React.FormEvent) {
    event.preventDefault();
    if (!isActive || pending || submittingRef.current || !creditInvoice || !onApplyCredit || !applicationId.current) return;
    const normalized = creditAmount.trim().replace(',', '.');
    const value = Number(normalized);
    const credit = eligibleCredits(creditInvoice).find(rma => rma.id === selectedCreditId);
    if (!credit || !/^\d+(\.\d{1,2})?$/.test(normalized) || !Number.isFinite(value) || value <= 0 || value > Math.min(availableCredit(credit), balance(creditInvoice))) {
      setCreditError('Informe um valor válido dentro do saldo do crédito e da fatura.'); return;
    }
    submittingRef.current = true; setSubmitting(true); setCreditError(null);
    try {
      await onApplyCredit(credit.id, creditInvoice.id, value, applicationId.current);
      if (!mounted.current || !activeRef.current) return;
      setCreditInvoice(null); setSuccess('Crédito abatido na fatura. Nenhuma entrada em dinheiro foi registrada.');
    } catch (error) { if (mounted.current && activeRef.current) setCreditError(error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Não foi possível abater o crédito.'); }
    finally { submittingRef.current = false; if (mounted.current) setSubmitting(false); }
  }

  const openInvoices = invoices.filter(isOpen);
  const totalOpen = openInvoices.reduce((sum, i) => sum + balance(i), 0);
  const totalPaid = invoices.reduce((sum, i) => sum + paidAmount(i), 0);
  const totalInvoiced = invoices.filter(invoice => invoice.status !== 'cancelada').reduce((sum, i) => sum + i.amount, 0);
  const creditAvailable = creditLimit - creditUsed;

  const overdueCount = useMemo(
    () => openInvoices.filter((invoice) => isOverdue(invoice)).length,
    [openInvoices],
  );

  const visibleInvoices = useMemo(() => {
    if (filter === 'all') return invoices;
    if (filter === 'aberta') return invoices.filter(isOpen);
    return invoices.filter((invoice) => invoice.status === filter);
  }, [filter, invoices]);

  function handlePay(id: string, mode: 'full' | 'partial') {
    setPaymentMode(mode);
    setAmount('');
    setPaymentError(null);
    setSuccess(null);
    setPayingId(id);
  }

  async function confirmPay(invoice: PartnerInvoice) {
    if (!isActive || pending || submittingRef.current) return;
    setPaymentError(null);
    const normalizedAmount = amount.trim().replace(',', '.');
    const value = paymentMode === 'partial' ? Number(normalizedAmount) : balance(invoice);
    if (paymentMode === 'partial' && (!/^\d+(\.\d{1,2})?$/.test(normalizedAmount) || !Number.isFinite(value) || value <= 0 || value >= balance(invoice))) {
      setPaymentError('Informe um valor maior que zero e menor que o saldo, com até duas casas decimais. Para pagar todo o saldo, use Quitar título.');
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (!paymentRequest.current || paymentRequest.current.id !== invoice.id || paymentRequest.current.amount !== value) {
        paymentRequest.current = { id: invoice.id, amount: value, token: crypto.randomUUID() };
      }
      await onPayInvoice(invoice.id, value, paymentRequest.current.token);
      if (!mounted.current || !activeRef.current) return;
      paymentRequest.current = null;
      setPayingId(null);
      setSuccess(paymentMode === 'partial' ? 'Amortização registrada com sucesso!' : 'Título quitado com sucesso!');
    } catch (error) {
      if (mounted.current && activeRef.current) setPaymentError(error instanceof Error ? error.message : 'Não foi possível registrar o pagamento.');
    } finally {
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <div className="panel-module financial-scope">
      {!creditInvoice && <FinancialRecoveryPanel actions={recoveries} error={recoveryError} disabled={submitting} />}
      {rmaRequests.some(rma => Number(rma.refund_amount) > 0) && <details className="module-card">
        <summary>Reembolsos de devoluções · {money.format(rmaRequests.reduce((sum, rma) => sum + Math.round(Number(rma.refund_amount ?? 0) * 100), 0) / 100)}</summary>
        <p>Saídas registradas no Caixa. Estes valores não são créditos disponíveis nem novos recebimentos.</p>
        {rmaRequests.filter(rma => Number(rma.refund_amount) > 0).map(rma => <p key={rma.id}>
          <strong>{rma.customer_name} · {money.format(Number(rma.refund_amount))}</strong><br />
          {rma.product_name} · {rma.refund_method === 'pix' ? 'PIX' : rma.refund_method === 'cartao' ? 'Cartão' : 'Dinheiro'} · {rma.refunded_at ? new Date(rma.refunded_at).toLocaleDateString('pt-BR') : ''}<br />
          {rma.refund_reason}
        </p>)}
      </details>}
      <div className="module-header">
        <span className="module-icon"><Wallet size={20} /></span>
        <div>
          <h3><span className="financial-title-mobile">Financeiro</span><span className="financial-title-desktop">Módulo Financeiro &amp; Pagamentos B2B</span></h3>
          <p>Limite de crédito, faturas, quitação via PIX e saldo de RMA</p>
        </div>
      </div>

      <div className="financial-dashboard">
        <div className="fin-card tone-blue">
          <CreditCard size={22} />
          <div>
            <small>Limite de Crédito Aprovado</small>
            <strong>{money.format(creditLimit)}</strong>
          </div>
        </div>
        <div className="fin-card tone-amber">
          <Receipt size={22} />
          <div>
            <small>Faturas em Aberto</small>
            <strong>{money.format(totalOpen)}</strong>
            <small className="fin-sub">{openInvoices.length} fatura(s)</small>
          </div>
        </div>
        <div className="fin-card tone-green">
          <Wallet size={22} />
          <div>
            <small>Crédito Disponível</small>
            <strong>{money.format(creditAvailable)}</strong>
          </div>
        </div>
        <div className="fin-card tone-slate">
          <Wallet size={22} />
          <div>
            <small>Saldo de Crédito RMA</small>
            <strong>{creditBalanceKnown ? money.format(walletBalance) : 'Saldo indisponível'}</strong>
          </div>
        </div>
      </div>

      {creditInvoice && <div className="modal-overlay">
        <form className="modal-card pdv-form" onSubmit={confirmCredit}>
          <h4>Abater crédito de devolução</h4>
          <FinancialRecoveryPanel actions={recoveries} error={recoveryError} disabled={submitting} />
          <p>{creditInvoice.customer_name} — {creditInvoice.number} · Saldo da fatura: {money.format(balance(creditInvoice))}</p>
          <label>Crédito disponível<select aria-label="Crédito disponível" value={selectedCreditId} disabled={submitting || pending || !isActive} onChange={event => {
            setSelectedCreditId(event.target.value);
            const credit = eligibleCredits(creditInvoice).find(rma => rma.id === event.target.value);
            setCreditAmount(credit ? Math.min(availableCredit(credit), balance(creditInvoice)).toFixed(2) : '');
          }}>{eligibleCredits(creditInvoice).map(rma => <option key={rma.id} value={rma.id}>{rma.product_name} — {money.format(availableCredit(rma))}</option>)}</select></label>
          <label>Valor a abater (R$)<input aria-label="Valor a abater" inputMode="decimal" value={creditAmount} onChange={event => setCreditAmount(event.target.value)} disabled={submitting || pending || !isActive} required /></label>
          {creditError && <p className="otp-error-msg" role="alert">{creditError}</p>}
          <div className="pix-actions">
            <button type="submit" className="module-submit-btn" disabled={submitting || pending || !isActive}>{submitting ? 'Registrando...' : 'Confirmar abatimento'}</button>
            <button type="button" className="rma-advance-btn" disabled={submitting} onClick={() => setCreditInvoice(null)}>Cancelar</button>
          </div>
        </form>
      </div>}

      <div className="orders-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', margin: '18px 0 12px' }}>
        <div className="orders-summary-card" style={{ padding: '14px 16px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', background: '#0f1f2c' }}>
          <small style={{ color: '#8ba3b5' }}>Total faturado</small>
          <strong style={{ display: 'block', fontSize: '22px', marginTop: '6px' }}>{money.format(totalInvoiced)}</strong>
        </div>
        <div className="orders-summary-card" style={{ padding: '14px 16px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', background: '#0f1f2c' }}>
          <small style={{ color: '#8ba3b5' }}>Liquidado (recebimentos + créditos)</small>
          <strong style={{ display: 'block', fontSize: '22px', marginTop: '6px' }}>{money.format(totalPaid)}</strong>
        </div>
        <div className="orders-summary-card" style={{ padding: '14px 16px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', background: '#0f1f2c' }}>
          <small style={{ color: '#8ba3b5' }}>Vencidas</small>
          <strong style={{ display: 'block', fontSize: '22px', marginTop: '6px' }}>{overdueCount}</strong>
        </div>
      </div>

      <div className="fin-invoices">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <h4 style={{ margin: 0 }}>Extrato de Faturas</h4>
          <div className="orders-filter-row" style={{ gap: '8px' }}>
            {(['all', 'aberta', 'paga'] as const).map((option) => (
              <button
                key={option}
                className={`rma-advance-btn ${filter === option ? 'active' : ''}`}
                onClick={() => setFilter(option)}
                style={{ minWidth: '110px' }}
              >
                {option === 'all' ? 'Todas' : option === 'aberta' ? 'Abertas' : 'Pagas'}
              </button>
            ))}
          </div>
        </div>

        {success && <p className="sent-message" role="status"><Check size={14} /> {success}</p>}
        <div className="stock-table-wrap directory-card-wrap">
          <table className="rma-table directory-card-table" aria-label="Faturas">
            <thead>
              <tr><th>Cliente</th><th>Venda/Título</th><th>Original</th><th>Liquidado</th><th>Saldo</th><th>Vencimento</th><th>Status</th><th>Ação</th></tr>
            </thead>
            <tbody>
              {visibleInvoices.length === 0 ? (
                <tr><td colSpan={8} className="empty-row">Nenhuma fatura registrada.</td></tr>
              ) : (
                visibleInvoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="directory-card-title"><strong>{inv.customer_name || '—'}</strong></td>
                    <td data-label="Venda / título">{inv.number || inv.sale_id?.slice(0, 8) || '—'}</td>
                    <td data-label="Valor original"><strong>{money.format(inv.amount)}</strong></td>
                    <td data-label="Liquidado">{money.format(paidAmount(inv))}{Number(inv.return_credit_amount) > 0 && <small style={{ display: 'block' }}>Inclui crédito RMA: {money.format(Number(inv.return_credit_amount))}</small>}</td>
                    <td data-label="Saldo">{money.format(balance(inv))}</td>
                    <td data-label="Vencimento">{inv.due_date ? new Date(inv.due_date.slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
                    <td data-label="Status">
                      <span className={`rma-status-badge status-${inv.status === 'paga' ? 'success' : inv.status === 'cancelada' ? 'danger' : 'warning'}`}>
                        {inv.status === 'paga' ? 'Paga' : inv.status === 'parcial' ? 'Parcialmente paga' : inv.status === 'cancelada' ? 'Cancelada' : 'Em Aberto'}
                      </span>
                    </td>
                    <td className="financial-title-actions directory-card-actions" data-label="Ações">
                      <div className="invoice-quick-actions">
                      {isOpen(inv) && payingId !== inv.id && <>
                        <button type="button" className="rma-advance-btn" disabled={submitting || pending || !isActive} onClick={() => handlePay(inv.id, 'partial')}>Amortizar</button>
                        <button type="button" className="rma-advance-btn" disabled={submitting || pending || !isActive} onClick={() => handlePay(inv.id, 'full')}>Quitar título</button>
                      </>}
                      <button type="button" className="rma-advance-btn" title="Histórico de recebimentos" aria-label="Histórico de recebimentos" onClick={()=>setReceiptInvoiceId(receiptInvoiceId === inv.id ? null : inv.id)}>Histórico</button>
                      </div>
                      {receiptInvoiceId === inv.id && <InvoiceReceipts invoice={inv} />}
                      {isOpen(inv) && (
                        <>
                          {payingId === inv.id ? (
                            <form onSubmit={(event) => { event.preventDefault(); void confirmPay(inv); }}>
                              <p>Saldo em aberto: {money.format(balance(inv))}</p>
                              {paymentMode === 'partial' && (
                                <label>
                                  Valor a amortizar (R$)
                                  <input type="text" inputMode="decimal" placeholder="0,00" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={submitting || pending || !isActive} required autoFocus />
                                </label>
                              )}
                              <div className="pix-actions">
                                <button type="submit" className="module-submit-btn" disabled={submitting || pending || !isActive}><Check size={16} /> {submitting ? 'Registrando...' : paymentMode === 'partial' ? 'Confirmar amortização' : 'Confirmar quitação'}</button>
                                <button type="button" className="rma-advance-btn" disabled={submitting} onClick={() => setPayingId(null)}>Cancelar</button>
                              </div>
                            </form>
                          ) : (
                            <div className="pix-actions">
                              {onApplyCredit && eligibleCredits(inv).length > 0 && <button className="rma-advance-btn" disabled={submitting || pending || !isActive} onClick={() => openCredit(inv)}>Abater crédito RMA</button>}
                            </div>
                          )}
                          {paymentError && payingId === inv.id && <p className="otp-error-msg" role="alert">{paymentError}</p>}
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
