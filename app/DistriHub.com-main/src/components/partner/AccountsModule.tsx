import { useEffect, useRef, useState } from 'react';
import type { PartnerBranch, PartnerInvoice, PartnerSupplier } from '../../types';
import { accountBalance, accountPaid, isOverdue, type PayableAccount } from '../../lib/accounts';
import { money } from '../../utils';
import { FinancialRecoveryPanel } from './FinancialRecoveryPanel';
import type { FinancialRecovery } from '../../lib/invoicePayments';
import type { usePayables } from '../../hooks/usePayables';
import { localDate } from '../../lib/financialFlow';
import { payablePaymentMethods, payableMethodLabel, payableSchedule, validPayableDay, type PayablePaymentMethod } from '../../lib/payableDetails';

type Props = {
  contextKey?: string;
  isActive?: boolean;
  recoveries?: FinancialRecovery[];
  recoveryError?: string;
  kind: 'pagar' | 'receber';
  invoices: PartnerInvoice[];
  payables: ReturnType<typeof usePayables>;
  branches: PartnerBranch[];
  suppliers: PartnerSupplier[];
  branchId: string;
  onReceive?: (id: string, amount: number, requestId?: string) => Promise<void>;
};

const categories = { fornecedor: 'Compra de mercadorias / estoque', aluguel: 'Aluguel', energia: 'Energia', salarios: 'Salários', impostos: 'Impostos', outros: 'Outras despesas' };
const parseAmount = (text: string) => /^\d+(?:[.,]\d{1,2})?$/.test(text.trim()) ? Number(text.replace(',', '.')) : NaN;

export function AccountsModule(props: Props) {
  return <AccountsScreen key={props.contextKey ?? [props.kind, props.branchId].join(':')} {...props} />;
}
function AccountsScreen({ kind, invoices, payables, branches, suppliers, branchId, onReceive, recoveries = [], recoveryError, isActive = true }: Props) {
  const mounted = useRef(true);
  const activeRef = useRef(isActive); activeRef.current = isActive;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!isActive) { setCreating(false); setPayment(null); } }, [isActive]);
  const pending = Boolean(recoveryError || payables.recoveryError || recoveries.length || payables.recoveries?.length);
  const [filter, setFilter] = useState('abertas');
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const emptyForm = () => ({ description: '', creditor: '', category: 'outros', supplierId: '', branchId, amount: '', dueDate: '',
    purchasedOn: localDate(new Date().toISOString()), paymentMethod: 'nao_informado' as PayablePaymentMethod, paymentMethodDetail: '', terms: 'vista', installmentCount: '2' });
  const [form, setForm] = useState(emptyForm);
  const [installmentDates, setInstallmentDates] = useState<Record<number, string>>({});
  const installmentIds = useRef<string[]>([]);
  const schedule = payableSchedule(parseAmount(form.amount), form.terms === 'parcelado' ? Number(form.installmentCount) : 1, form.dueDate)
    .map((item, index) => ({ ...item, due_date: installmentDates[index] ?? item.due_date }));
  const [payment, setPayment] = useState<{ id: string; token: string; amount: string; date: string; method: PayablePaymentMethod; methodDetail: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const creationId = useRef<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const accounts = kind === 'receber' ? invoices : payables.accounts.filter(account => !branchId || account.branch_id === branchId);
  const visible = accounts.filter(account => {
    const name = 'description' in account ? `${account.description} ${account.creditor_name} ${payableMethodLabel(account.payment_method, account.payment_method_detail)} ${account.purchased_on ?? ''}` : `${account.customer_name} ${account.number}`;
    return (!query.trim() || name.toLowerCase().includes(query.trim().toLowerCase()))
      && (filter === 'todas' || (filter === 'abertas' && accountBalance(account) > 0)
        || (filter === 'vencidas' && isOverdue(account)) || (filter === 'pagas' && account.status === 'paga'));
  });
  const open = accounts.reduce((sum, a) => sum + accountBalance(a), 0);
  const overdue = accounts.filter(a => isOverdue(a)).reduce((sum, a) => sum + accountBalance(a), 0);
  const paid = accounts.reduce((sum, a) => sum + accountPaid(a), 0);
  const kanbanColumns = [
    { key: 'open', title: 'Em aberto', accounts: visible.filter(a => accountBalance(a) > 0 && !isOverdue(a)) },
    { key: 'overdue', title: 'Vencidas', accounts: visible.filter(a => isOverdue(a)) },
    { key: 'paid', title: 'Quitadas', accounts: visible.filter(a => a.status === 'paga') },
    { key: 'cancelled', title: 'Canceladas', accounts: visible.filter(a => a.status === 'cancelada') },
  ];

  function renderPaymentAction(account: (typeof accounts)[number]) {
    if (accountBalance(account) <= 0 || (kind === 'receber' && !onReceive)) return null;
    if (payment?.id !== account.id) {
      return <button type="button" className="rma-advance-btn" disabled={busy || pending || !isActive} onClick={() => {
        setPayment({ id: account.id, token: crypto.randomUUID(), amount: accountBalance(account).toFixed(2), date: localDate(new Date().toISOString()),
          method: 'description' in account ? account.payment_method ?? 'nao_informado' : 'nao_informado',
          methodDetail: 'description' in account ? account.payment_method_detail ?? '' : '' });
        setError('');
      }}>{kind === 'pagar' ? 'Registrar pagamento' : 'Registrar recebimento'}</button>;
    }
    return <form className="payable-payment-form" onSubmit={confirmPayment}>
      <label>Valor (R$)<input aria-label="Valor do pagamento ou recebimento" inputMode="decimal" required value={payment.amount} disabled={busy || pending || !isActive} onChange={e => setPayment({ ...payment, amount: e.target.value })} /></label>
      {kind === 'pagar' && <>
        <label>Data do pagamento<input aria-label="Data do pagamento" required type="date" min="0001-01-01" max={localDate(new Date().toISOString())} value={payment.date} disabled={busy || pending || !isActive} onChange={e => setPayment({ ...payment, date: e.target.value })} /></label>
        <label>Forma deste pagamento<select aria-label="Forma deste pagamento" value={payment.method} disabled={busy || pending || !isActive} onChange={e => setPayment({ ...payment, method: e.target.value as PayablePaymentMethod, methodDetail: '' })}>{Object.entries(payablePaymentMethods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {payment.method === 'outro' && <label>Qual forma de pagamento?<input aria-label="Detalhe da forma deste pagamento" required maxLength={80} value={payment.methodDetail} disabled={busy || pending || !isActive} onChange={e => setPayment({ ...payment, methodDetail: e.target.value })} /></label>}
        <p>Informe quando você realmente pagou. A saída entrará no fluxo de caixa dessa data, mesmo que você esteja lançando hoje.</p>
      </>}
      <button className="module-submit-btn" disabled={busy || pending || !isActive}>{busy ? 'Registrando…' : 'Confirmar'}</button>{' '}
      <button type="button" className="rma-advance-btn" disabled={busy || pending || !isActive} onClick={() => setPayment(null)}>Cancelar</button>
    </form>;
  }

  async function saveAccount(event: React.FormEvent) {
    event.preventDefault();
    if (!isActive || pending || lock.current) return;
    const amount = parseAmount(form.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !form.branchId || !form.description.trim() || !form.creditor.trim() || !form.dueDate) {
      setError('Informe filial, descrição, credor, vencimento e um valor positivo com até duas casas decimais.'); return;
    }
    if (!validPayableDay(form.purchasedOn) || form.purchasedOn > localDate(new Date().toISOString())) { setError('Informe a data real da compra, até hoje.'); return; }
    if (!schedule.length || (form.terms === 'parcelado' && Number(form.installmentCount) < 2) || schedule.some(item => !validPayableDay(item.due_date))) { setError('Confira a quantidade de parcelas, os vencimentos e o valor total.'); return; }
    if (form.paymentMethod === 'outro' && !form.paymentMethodDetail.trim()) { setError('Informe qual é a outra forma de pagamento.'); return; }
    lock.current = true; setBusy(true); setError(''); setSuccess('');
    creationId.current ??= crypto.randomUUID();
    const installments = schedule.map((item, index) => {
      installmentIds.current[index] ??= schedule.length === 1 ? creationId.current! : crypto.randomUUID();
      return { ...item, id: installmentIds.current[index] };
    });
    try {
      await payables.create({ description: form.description, creditor_name: form.creditor,
        supplier_id: form.supplierId || null, category: form.category as PayableAccount['category'],
        branch_id: form.branchId, amount, due_date: installments[0].due_date, purchased_on: form.purchasedOn,
        payment_method: form.paymentMethod, payment_method_detail: form.paymentMethod === 'outro' ? form.paymentMethodDetail.trim() : null,
        installments }, creationId.current);
      if (!mounted.current || !activeRef.current) return;
      creationId.current = null; installmentIds.current = []; setCreating(false); setSuccess(installments.length > 1 ? `Compra cadastrada em ${installments.length} parcelas. Confira os vencimentos na lista.` : 'Conta cadastrada.');
    } catch (cause) { if (mounted.current && activeRef.current) setError(cause instanceof Error ? cause.message : 'Não foi possível cadastrar.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  async function confirmPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!isActive || pending || !payment || lock.current) return;
    const account = accounts.find(a => a.id === payment.id);
    const value = parseAmount(payment.amount);
    if (!account || !Number.isFinite(value) || value <= 0 || value > accountBalance(account)) { setError('Informe um valor positivo que não exceda o saldo.'); return; }
    if (kind === 'pagar' && (!/^\d{4}-\d{2}-\d{2}$/.test(payment.date) || !Number.isFinite(Date.parse(payment.date))
      || new Date(payment.date).toISOString().slice(0, 10) !== payment.date || payment.date < '0001-01-01'
      || payment.date > localDate(new Date().toISOString()))) { setError('Informe a data real do pagamento, até hoje.'); return; }
    if (kind === 'pagar' && payment.method === 'outro' && !payment.methodDetail.trim()) { setError('Informe qual é a outra forma de pagamento.'); return; }
    lock.current = true; setBusy(true); setError(''); setSuccess('');
    try {
      if (kind === 'pagar') await payables.pay(account.id, value, payment.token, payment.date, payment.method, payment.method === 'outro' ? payment.methodDetail.trim() : null);
      else {
        if (!onReceive) throw new Error('Recebimento indisponível.');
        await onReceive(account.id, value, payment.token);
      }
      if (!mounted.current || !activeRef.current) return;
      setPayment(null); setSuccess(kind === 'pagar' ? `Pagamento registrado com data de ${payment.date.split('-').reverse().join('/')}.` : 'Recebimento registrado.');
    } catch (cause) { if (mounted.current && activeRef.current) setError(cause instanceof Error ? cause.message : 'Não foi possível registrar.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  function purchaseDetails(account: (typeof accounts)[number]) {
    if (!('description' in account)) return null;
    return <small className="payable-purchase-details">
      {account.installment_count && account.installment_count > 1 ? <span>Parcela {account.installment_number}/{account.installment_count} · Compra total: {money.format(account.purchase_total ?? account.amount)}</span> : null}
      <span>Compra em: {account.purchased_on ? account.purchased_on.split('-').reverse().join('/') : 'Não informada'}</span>
      <span>Forma prevista: {payableMethodLabel(account.payment_method, account.payment_method_detail)}</span>
    </small>;
  }

  return <section className="module-card">
    <FinancialRecoveryPanel actions={[...recoveries, ...(payables.recoveries ?? [])]} error={recoveryError || payables.recoveryError} disabled={busy} />
    <h4 className="report-section-title">Contas a {kind}</h4>
    <p>{kind === 'receber' ? 'Faturas de clientes, com saldo após os recebimentos registrados.' : 'Compras de fornecedores e despesas da loja. Registrar um pagamento não faz uma transferência bancária.'}</p>
    {kind === 'receber' && !onReceive && <p>O proprietário da loja pode registrar os recebimentos.</p>}
    {kind === 'pagar' && payables.loading && <p role="status">Carregando contas…</p>}
    {kind === 'pagar' && payables.error && <p role="alert">{payables.error} <button type="button" className="rma-advance-btn" onClick={() => void payables.reload()}>Tentar novamente</button></p>}
    <div className="report-cards">
      <div className="report-card"><small>Saldo em aberto</small><strong>{money.format(open)}</strong></div>
      <div className="report-card"><small>Vencido</small><strong>{money.format(overdue)}</strong></div>
      <div className="report-card"><small>{kind === 'pagar' ? 'Pago' : 'Liquidado (dinheiro + créditos)'}</small><strong>{money.format(paid)}</strong></div>
    </div>
    <div className="orders-filter-row" style={{ margin: '16px 0', flexWrap: 'wrap' }}>
      {['abertas', 'vencidas', 'pagas', 'todas'].map(value => <button key={value} type="button" className={`rma-advance-btn ${filter === value ? 'active' : ''}`} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
      <input type="search" aria-label="Buscar contas" placeholder="Buscar contas" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="accounts-view-toggle" role="group" aria-label="Visualização das contas">
        <button type="button" className={`rma-advance-btn ${view === 'table' ? 'active' : ''}`} aria-pressed={view === 'table'} onClick={() => setView('table')}>Tabela</button>
        <button type="button" className={`rma-advance-btn ${view === 'kanban' ? 'active' : ''}`} aria-pressed={view === 'kanban'} onClick={() => setView('kanban')}>Quadro</button>
      </div>
      {kind === 'pagar' && <button type="button" className="module-submit-btn" disabled={busy || pending || !isActive || payables.loading || Boolean(payables.error)} onClick={() => { creationId.current = null; installmentIds.current = []; setInstallmentDates({}); setForm(emptyForm()); setCreating(true); setError(''); }}>Nova conta a pagar</button>}
    </div>
    {success && <p role="status">{success}</p>}
    {error && <p className="otp-error-msg" role="alert">{error}</p>}
    {creating && <form onSubmit={saveAccount} className="accounts-entry-form">
      <label>Filial<select required value={form.branchId} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, branchId: e.target.value })}><option value="">Selecione</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label>Descrição<input required maxLength={200} value={form.description} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
      <label>Categoria<select value={form.category} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, category: e.target.value })}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Fornecedor (opcional)<select value={form.supplierId} disabled={busy || pending || !isActive} onChange={e => { const supplier = suppliers.find(s => s.id === e.target.value); setForm({ ...form, supplierId: e.target.value, creditor: supplier?.name ?? form.creditor }); }}><option value="">Sem fornecedor</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Credor<input required maxLength={200} value={form.creditor} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, creditor: e.target.value })} /></label>
      <label>Data da compra<input aria-label="Data da compra" required type="date" min="0001-01-01" max={localDate(new Date().toISOString())} value={form.purchasedOn} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, purchasedOn: e.target.value })} /></label>
      <label>Valor total da compra (R$)<input required inputMode="decimal" placeholder="0,00" value={form.amount} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, amount: e.target.value })} /></label>
      <label>Forma de pagamento da conta<select aria-label="Forma de pagamento da conta" value={form.paymentMethod} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, paymentMethod: e.target.value as PayablePaymentMethod, paymentMethodDetail: '' })}>{Object.entries(payablePaymentMethods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {form.paymentMethod === 'outro' && <label>Qual forma de pagamento?<input aria-label="Detalhe da forma de pagamento da conta" required maxLength={80} value={form.paymentMethodDetail} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, paymentMethodDetail: e.target.value })} /></label>}
      <label>Condição de pagamento<select aria-label="Condição de pagamento" value={form.terms} disabled={busy || pending || !isActive} onChange={e => { setForm({ ...form, terms: e.target.value }); setInstallmentDates({}); }}><option value="vista">À vista / uma parcela</option><option value="parcelado">Parcelado</option></select></label>
      {form.terms === 'parcelado' && <label>Quantidade de parcelas<input aria-label="Quantidade de parcelas" type="number" required min={2} max={120} step={1} value={form.installmentCount} disabled={busy || pending || !isActive} onChange={e => { setForm({ ...form, installmentCount: e.target.value }); setInstallmentDates({}); }} /></label>}
      <label>{form.terms === 'parcelado' ? 'Vencimento da primeira parcela' : 'Vencimento'}<input aria-label="Vencimento" required type="date" value={form.dueDate} disabled={busy || pending || !isActive} aria-describedby="payable-date-help" onChange={e => { setForm({ ...form, dueDate: e.target.value }); setInstallmentDates({}); }} /></label>
      {form.terms === 'parcelado' && <div className="payable-schedule" aria-label="Prévia das parcelas"><strong>Confira as parcelas antes de cadastrar</strong><p>O total é dividido entre as parcelas. Inclua juros e taxas no valor total, se houver. Ajuste os vencimentos conforme a compra.</p>{schedule.length ? <ol>{schedule.map((item, index) => <li key={index}><span>Parcela {index + 1}/{schedule.length} · {money.format(item.amount)}</span><label>Vencimento<input aria-label={`Vencimento da parcela ${index + 1}`} type="date" required value={item.due_date} disabled={busy || pending || !isActive} onChange={e => setInstallmentDates({ ...installmentDates, [index]: e.target.value })} /></label></li>)}</ol> : <p>Informe valor total, quantidade de parcelas e primeiro vencimento para visualizar.</p>}</div>}
      <p style={{ gridColumn: '1 / -1' }}>Data da compra informa quando você comprou. Vencimento é o prazo para pagar. Cadastrar a conta não registra pagamento; cada parcela ficará em aberto até você confirmar o pagamento.</p>
      <p id="payable-date-help" style={{ gridColumn: '1 / -1' }}>Esqueceu uma despesa? Informe o vencimento original, mesmo de um mês passado. Ela será considerada nesse período na Inteligência Empresarial. Ao registrar o pagamento, informe a data em que você realmente pagou; essa data define a saída no fluxo de caixa.</p>
      <p style={{ gridColumn: '1 / -1' }}>A categoria define como a conta entra no resultado. Escolha compra de mercadorias / estoque apenas para reposição de produtos; serviços, taxas e demais gastos usam a categoria de despesa correspondente. Selecionar um fornecedor não muda essa escolha.</p>
      <div><button className="module-submit-btn" disabled={busy || pending || !isActive}>{busy ? 'Salvando…' : 'Cadastrar'}</button> <button type="button" className="rma-advance-btn" disabled={busy || pending || !isActive} onClick={() => setCreating(false)}>Cancelar</button></div>
    </form>}
    {view === 'kanban' ? <div className="accounts-kanban" aria-label={`Quadro de contas a ${kind}`}>
      {kanbanColumns.map(column => <section key={column.key} className="accounts-kanban-column">
        <h5>{column.title}<span>{column.accounts.length}</span></h5>
        {column.accounts.length === 0 ? <p className="accounts-kanban-empty">Nenhuma conta</p> : column.accounts.map(a => <article key={a.id} className="accounts-kanban-card">
          <strong>{'description' in a ? a.description : a.customer_name}</strong>
          <small>{'description' in a ? a.creditor_name : a.number}</small>
          {purchaseDetails(a)}
          <dl>
            <div><dt>Original</dt><dd>{money.format(a.amount)}</dd></div>
            <div><dt>{kind === 'pagar' ? 'Pago' : 'Liquidado'}</dt><dd>{money.format(accountPaid(a))}</dd></div>
            <div><dt>Saldo</dt><dd>{money.format(accountBalance(a))}</dd></div>
            <div><dt>Vencimento</dt><dd>{a.due_date ? new Date(a.due_date.slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</dd></div>
          </dl>
          {renderPaymentAction(a)}
        </article>)}
      </section>)}
    </div> : <div className="stock-table-wrap"><table className="rma-table">
      <thead><tr><th>{kind === 'pagar' ? 'Conta / Credor' : 'Cliente / Fatura'}</th><th>Original</th><th>{kind === 'pagar' ? 'Pago' : 'Liquidado'}</th><th>Saldo</th><th>Vencimento</th><th>Status</th><th>Ação</th></tr></thead>
      <tbody>{visible.length === 0 ? <tr><td colSpan={7} className="empty-row">Nenhuma conta nesta seleção.</td></tr> : visible.map(a => <tr key={a.id}>
        <td>{'description' in a ? <><strong>{a.description}</strong><br />{a.creditor_name}{purchaseDetails(a)}</> : <><strong>{a.customer_name}</strong><br />{a.number}</>}</td>
        <td>{money.format(a.amount)}</td><td>{money.format(accountPaid(a))}</td><td>{money.format(accountBalance(a))}</td>
        <td>{a.due_date ? new Date(a.due_date.slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
        <td>{isOverdue(a) ? 'Vencida' : a.status === 'paga' ? 'Quitada' : a.status === 'parcial' ? 'Parcial' : a.status === 'cancelada' ? 'Cancelada' : 'Aberta'}</td>
        <td>{renderPaymentAction(a)}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
