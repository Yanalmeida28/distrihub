import { useEffect, useRef, useState } from 'react';
import type { PartnerBranch, PartnerInvoice, PartnerSupplier } from '../../types';
import { accountBalance, accountPaid, isOverdue, payableCategories, expenseBehaviorLabels, isOperatingExpense, withdrawalSummary, type PayableAccount, type PayableExpenseBehavior } from '../../lib/accounts';
import { money } from '../../utils';
import { FinancialRecoveryPanel } from './FinancialRecoveryPanel';
import type { FinancialRecovery } from '../../lib/invoicePayments';
import type { usePayables } from '../../hooks/usePayables';
import { localDate } from '../../lib/financialFlow';
import { payablePaymentMethods, payableMethodLabel, payableSchedule, validPayableDay, type PayablePaymentMethod } from '../../lib/payableDetails';
import { PayableManagementPanel } from './PayableManagementPanel';
import { WithdrawalSummary } from './WithdrawalSummary';

type Props = {
  contextKey?: string;
  isActive?: boolean;
  recoveries?: FinancialRecovery[];
  recoveryError?: string;
  timeZone?: string;
  initialFilter?: string;
  kind: 'pagar' | 'receber';
  invoices: PartnerInvoice[];
  payables: ReturnType<typeof usePayables>;
  branches: PartnerBranch[];
  suppliers: PartnerSupplier[];
  branchId: string;
  onReceive?: (id: string, amount: number, requestId?: string) => Promise<void>;
};

const categories = payableCategories;
const parseAmount = (text: string) => /^\d+(?:[.,]\d{1,2})?$/.test(text.trim()) ? Number(text.replace(',', '.')) : NaN;

export function AccountsModule(props: Props) {
  return <AccountsScreen key={[props.contextKey ?? '', props.kind, props.branchId].join(':')} {...props} />;
}
function AccountsScreen({ timeZone, initialFilter = 'abertas', kind, invoices, payables, branches, suppliers, branchId, onReceive, recoveries = [], recoveryError, isActive = true }: Props) {
  const mounted = useRef(true);
  const activeRef = useRef(isActive); activeRef.current = isActive;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!isActive) { setCreating(false); setPayment(null); setManagement(null); } }, [isActive]);
  const pending = Boolean(recoveryError || payables.recoveryError || recoveries.length || payables.recoveries?.length);
  const [filter, setFilter] = useState(initialFilter);
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [recipientFilter, setRecipientFilter] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (recipientFilter) listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [recipientFilter]);
  const [creating, setCreating] = useState(false);
  const [management, setManagement] = useState<{ account: PayableAccount; mode: 'edit' | 'delete' } | null>(null);
  const emptyForm = () => ({ description: '', creditor: '', category: 'outros', behavior: '' as PayableExpenseBehavior | '', supplierId: '', branchId, amount: '', dueDate: '',
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
  const invalidPeriod = Boolean((dueFrom && !validPayableDay(dueFrom)) || (dueTo && !validPayableDay(dueTo)) || (dueFrom && dueTo && dueFrom > dueTo));
  const accounts = kind === 'receber' ? invoices : payables.accounts.filter(account => (!branchId || account.branch_id === branchId)
    && (!categoryFilter || account.category === categoryFilter) && !invalidPeriod
    && (!dueFrom || account.due_date >= dueFrom) && (!dueTo || account.due_date <= dueTo));
  const withdrawals = kind === 'pagar' ? withdrawalSummary(accounts as PayableAccount[]) : [];
  const visible = accounts.filter(account => {
    if (recipientFilter && (!('description' in account) || account.category !== 'retirada' || account.creditor_name.trim().toLocaleLowerCase('pt-BR') !== recipientFilter.toLocaleLowerCase('pt-BR'))) return false;
    if (recipientFilter && filter !== 'excluidas' && account.status === 'cancelada') return false;
    if ('description' in account && Boolean(account.deleted_at) !== (filter === 'excluidas')) return false;
    if (filter === 'excluidas' && !('description' in account)) return false;
    const name = 'description' in account ? `${account.description} ${account.creditor_name} ${payableMethodLabel(account.payment_method, account.payment_method_detail)} ${account.purchased_on ?? ''}` : `${account.customer_name} ${account.number}`;
    return (!query.trim() || name.toLowerCase().includes(query.trim().toLowerCase()))
      && (filter === 'todas' || filter === 'excluidas' || (filter === 'abertas' && accountBalance(account) > 0)
        || (filter === 'vencidas' && isOverdue(account, new Date(), timeZone)) || (filter === 'pagas' && account.status === 'paga'));
  });
  const open = accounts.reduce((sum, a) => sum + accountBalance(a), 0);
  const overdue = accounts.filter(a => isOverdue(a, new Date(), timeZone)).reduce((sum, a) => sum + accountBalance(a), 0);
  const paid = accounts.reduce((sum, a) => sum + accountPaid(a), 0);
  const kanbanColumns = [
    { key: 'open', title: 'Em aberto', accounts: visible.filter(a => accountBalance(a) > 0 && !isOverdue(a, new Date(), timeZone)) },
    { key: 'overdue', title: 'Vencidas', accounts: visible.filter(a => isOverdue(a, new Date(), timeZone)) },
    { key: 'paid', title: 'Quitadas', accounts: visible.filter(a => a.status === 'paga') },
    { key: 'cancelled', title: filter === 'excluidas' ? 'Excluídas' : 'Canceladas', accounts: visible.filter(a => a.status === 'cancelada') },
  ];

  function renderPaymentAction(account: (typeof accounts)[number]) {
    if (accountBalance(account) <= 0 || ('description' in account && account.deleted_at) || (kind === 'receber' && !onReceive)) return null;
    if (payment?.id !== account.id) {
      return <button type="button" className="rma-advance-btn" disabled={busy || pending || !isActive || Boolean(management)} onClick={() => {
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
    if (isOperatingExpense(form.category) && !['fixed', 'variable'].includes(form.behavior)) { setError('Selecione se a despesa é fixa ou variável.'); return; }
    lock.current = true; setBusy(true); setError(''); setSuccess('');
    creationId.current ??= crypto.randomUUID();
    const installments = schedule.map((item, index) => {
      installmentIds.current[index] ??= schedule.length === 1 ? creationId.current! : crypto.randomUUID();
      return { ...item, id: installmentIds.current[index] };
    });
    try {
      await payables.create({ description: form.description, creditor_name: form.creditor,
        supplier_id: form.category === 'retirada' ? null : form.supplierId || null, category: form.category as PayableAccount['category'],
        expense_behavior: isOperatingExpense(form.category) ? form.behavior as PayableExpenseBehavior : null,
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
      <span style={{ display: 'block' }}>{categories[account.category]}</span>
      {account.installment_count && account.installment_count > 1 ? <span>Parcela {account.installment_number}/{account.installment_count} · Compra total: {money.format(account.purchase_total ?? account.amount)}</span> : null}
      <span>Compra em: {account.purchased_on ? account.purchased_on.split('-').reverse().join('/') : 'Não informada'}</span>
      <span>Forma prevista: {payableMethodLabel(account.payment_method, account.payment_method_detail)}</span>
      {isOperatingExpense(account.category) && <span>{account.expense_behavior ? expenseBehaviorLabels[account.expense_behavior] : 'Tipo: segue a classificação da categoria'}</span>}
      {account.deleted_at && <span>Excluída em {new Date(account.deleted_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Motivo: {account.deletion_reason}</span>}
    </small>;
  }
  function renderManagementActions(account: (typeof accounts)[number]) {
    if (kind !== 'pagar' || !('description' in account) || account.deleted_at) return null;
    const start = (mode: 'edit' | 'delete') => { setCreating(false); setPayment(null); setError(''); setSuccess(''); setManagement({ account, mode }); };
    const disabled = busy || pending || !isActive || Boolean(management) || payables.loading || Boolean(payables.error);
    return <div className="payable-actions">
      {account.status !== 'cancelada' && <button type="button" className="rma-advance-btn" disabled={disabled} onClick={() => start('edit')}>Editar conta</button>}
      <button type="button" className="rma-advance-btn" disabled={disabled} onClick={() => start('delete')}>Excluir conta</button>
    </div>;
  }

  return <section className="module-card financial-accounts-module">
    <FinancialRecoveryPanel actions={[...recoveries, ...(payables.recoveries ?? []).map(action => ({ ...action, run: async () => {
      await action.run();
      if (mounted.current && activeRef.current && (action.id === 'payable-edit' || action.id === 'payable-delete')) {
        setManagement(null); setSuccess('Alteração confirmada. Confira os dados atualizados na lista.');
      }
    } }))]} error={recoveryError || payables.recoveryError} disabled={busy} />
    <h4 className="report-section-title">Contas a {kind}</h4>
    <p>{kind === 'receber' ? 'Faturas de clientes, com saldo após os recebimentos registrados.' : 'Compras, despesas da loja e retiradas de sócios. Registrar um pagamento não faz uma transferência bancária.'}</p>
    {kind === 'receber' && !onReceive && <p>O proprietário da loja pode registrar os recebimentos.</p>}
    {kind === 'pagar' && payables.loading && <p role="status">Carregando contas…</p>}
    {kind === 'pagar' && payables.error && <p role="alert">{payables.error} <button type="button" className="rma-advance-btn" onClick={() => void payables.reload()}>Tentar novamente</button></p>}
    {kind === 'pagar' && <div className="orders-filter-row accounts-scope-filters" style={{ margin: '16px 0' }}>
      <label>Categoria<select aria-label="Filtrar categoria das contas" value={categoryFilter} onChange={event => { setCategoryFilter(event.target.value); setRecipientFilter(null); }}><option value="">Todas as categorias</option>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Vencimento de<input aria-label="Vencimento de" type="date" value={dueFrom} onChange={event => setDueFrom(event.target.value)} /></label>
      <label>Vencimento até<input aria-label="Vencimento até" type="date" value={dueTo} onChange={event => setDueTo(event.target.value)} /></label>
      <button type="button" className="rma-advance-btn" onClick={() => { setCategoryFilter(''); setDueFrom(''); setDueTo(''); setRecipientFilter(null); }}>Limpar filtros de categoria e período</button>
    </div>}
    {invalidPeriod && <p role="alert">Confira o período: a data inicial deve ser anterior ou igual à final.</p>}
    <div className="report-cards financial-accounts-totals">
      <div className="report-card"><small>Saldo em aberto</small><strong>{money.format(open)}</strong></div>
      <div className="report-card"><small>Vencido</small><strong>{money.format(overdue)}</strong></div>
      <div className="report-card"><small>{kind === 'pagar' ? 'Pago' : 'Liquidado (dinheiro + créditos)'}</small><strong>{money.format(paid)}</strong></div>
    </div>
    {kind === 'pagar' && withdrawals.length > 0 && <WithdrawalSummary rows={withdrawals} selectedRecipient={recipientFilter}
      periodLabel={[dueFrom ? `De ${dueFrom.split('-').reverse().join('/')}` : '', dueTo ? `Até ${dueTo.split('-').reverse().join('/')}` : ''].filter(Boolean).join(' · ') || 'Todos os vencimentos'}
      disabled={busy || pending || !isActive || Boolean(management) || creating} onSelectRecipient={recipient => {
      if (recipientFilter === recipient) listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setRecipientFilter(recipient); setCategoryFilter('retirada'); setFilter('todas'); setQuery(''); setView('table');
    }} />}
    <div ref={listRef} className="orders-filter-row accounts-list-controls" style={{ margin: '16px 0', flexWrap: 'wrap' }}>
      <details className="accounts-status-filter" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
        <summary className="rma-advance-btn">Filtrar: {filter === 'excluidas' ? 'Excluídas' : filter === 'abertas' ? 'Em aberto' : filter[0].toUpperCase() + filter.slice(1)}</summary>
        <div className="accounts-status-options" role="group" aria-label="Filtrar situação das contas">
          {(kind === 'pagar' ? ['todas', 'abertas', 'vencidas', 'pagas', 'excluidas'] : ['todas', 'abertas', 'vencidas', 'pagas']).map(value => <button key={value} type="button" className={`rma-advance-btn ${filter === value ? 'active' : ''}`} aria-pressed={filter === value} onClick={event => { setFilter(value); const details = event?.currentTarget?.closest('details'); if (details) { details.open = false; details.querySelector('summary')?.focus(); } }}>{value === 'excluidas' ? 'Excluídas' : value === 'abertas' ? 'Em aberto' : value[0].toUpperCase() + value.slice(1)}</button>)}
        </div>
      </details>
      {filter === 'excluidas' && <span className="accounts-archive-notice" role="status">Exibindo contas excluídas</span>}
      <input type="search" aria-label="Buscar contas" placeholder="Buscar contas" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="accounts-view-toggle" role="group" aria-label="Visualização das contas">
        <button type="button" className={`rma-advance-btn ${view === 'table' ? 'active' : ''}`} aria-pressed={view === 'table'} onClick={() => setView('table')}>Tabela</button>
        <button type="button" className={`rma-advance-btn ${view === 'kanban' ? 'active' : ''}`} aria-pressed={view === 'kanban'} onClick={() => setView('kanban')}>Quadro</button>
      </div>
      {kind === 'pagar' && <button type="button" className="module-submit-btn" disabled={busy || pending || !isActive || Boolean(management) || payables.loading || Boolean(payables.error)} onClick={() => { creationId.current = null; installmentIds.current = []; setInstallmentDates({}); setForm(emptyForm()); setCreating(true); setError(''); }}>Nova conta a pagar</button>}
    </div>
    {recipientFilter && <div className="withdrawal-selected" role="status"><strong>Lançamentos de {recipientFilter}</strong><button type="button" className="rma-advance-btn" onClick={() => setRecipientFilter(null)}>Mostrar todas as pessoas</button></div>}
    {success && <p role="status">{success}</p>}
    {error && <p className="otp-error-msg" role="alert">{error}</p>}
    {management && <PayableManagementPanel key={management.account.id + ':' + management.mode} account={management.account} mode={management.mode}
      suppliers={suppliers} branchName={branches.find(branch => branch.id === management.account.branch_id)?.name ?? 'Filial da conta'}
      blocked={pending} isActive={isActive}
      onEdit={(changes, revision, token) => payables.update(management.account.id, changes, revision, token)}
      onDelete={(reason, revision, token) => payables.remove(management.account.id, reason, revision, token)}
      onDone={message => { if (mounted.current && activeRef.current) { setManagement(null); setSuccess(message); } }} onCancel={() => setManagement(null)} />}
    {creating && <form onSubmit={saveAccount} className="accounts-entry-form">
      <label>Filial<select required value={form.branchId} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, branchId: e.target.value })}><option value="">Selecione</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label>Descrição<input required maxLength={200} value={form.description} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
      <label>Categoria<select aria-label="Categoria da nova conta" value={form.category} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, category: e.target.value, behavior: isOperatingExpense(e.target.value) ? form.behavior : '', supplierId: e.target.value === 'retirada' ? '' : form.supplierId })}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {isOperatingExpense(form.category) && <label>Tipo de despesa<select aria-label="Tipo de despesa" required value={form.behavior} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, behavior: e.target.value as PayableExpenseBehavior })}><option value="">Selecionar fixa ou variável</option><option value="fixed">Fixa — existe mesmo sem vendas</option><option value="variable">Variável — varia conforme as vendas</option></select><small>Esta escolha será usada no ponto de equilíbrio e em todas as parcelas desta conta. O valor de uma despesa fixa pode mudar entre os meses.</small></label>}
      {form.category === 'retirada' && <p style={{ gridColumn: '1 / -1' }}>Identifique quem recebeu e descreva o motivo. A retirada sai no caixa quando paga, mas não entra como despesa operacional nem no ponto de equilíbrio. Use esta categoria para retiradas e uso pessoal; a compra de água para consumo da loja é uma despesa da operação.</p>}
      {form.category !== 'retirada' && <label>Fornecedor (opcional)<select value={form.supplierId} disabled={busy || pending || !isActive} onChange={e => { const supplier = suppliers.find(s => s.id === e.target.value); setForm({ ...form, supplierId: e.target.value, creditor: supplier?.name ?? form.creditor }); }}><option value="">Sem fornecedor</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      <label>{form.category === 'retirada' ? 'Quem recebeu / beneficiário' : 'Credor'}<input aria-label="Credor ou beneficiário" required maxLength={200} value={form.creditor} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, creditor: e.target.value })} /></label>
      <label>{form.category === 'retirada' ? 'Data do lançamento' : 'Data da compra'}<input aria-label="Data da compra" required type="date" min="0001-01-01" max={localDate(new Date().toISOString())} value={form.purchasedOn} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, purchasedOn: e.target.value })} /></label>
      <label>{form.category === 'retirada' ? 'Valor total da retirada (R$)' : 'Valor total da compra (R$)'}<input required inputMode="decimal" placeholder="0,00" value={form.amount} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, amount: e.target.value })} /></label>
      <label>Forma de pagamento da conta<select aria-label="Forma de pagamento da conta" value={form.paymentMethod} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, paymentMethod: e.target.value as PayablePaymentMethod, paymentMethodDetail: '' })}>{Object.entries(payablePaymentMethods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {form.paymentMethod === 'outro' && <label>Qual forma de pagamento?<input aria-label="Detalhe da forma de pagamento da conta" required maxLength={80} value={form.paymentMethodDetail} disabled={busy || pending || !isActive} onChange={e => setForm({ ...form, paymentMethodDetail: e.target.value })} /></label>}
      <label>Condição de pagamento<select aria-label="Condição de pagamento" value={form.terms} disabled={busy || pending || !isActive} onChange={e => { setForm({ ...form, terms: e.target.value }); setInstallmentDates({}); }}><option value="vista">À vista / uma parcela</option><option value="parcelado">Parcelado</option></select></label>
      {form.terms === 'parcelado' && <label>Quantidade de parcelas<input aria-label="Quantidade de parcelas" type="number" required min={2} max={120} step={1} value={form.installmentCount} disabled={busy || pending || !isActive} onChange={e => { setForm({ ...form, installmentCount: e.target.value }); setInstallmentDates({}); }} /></label>}
      <label>{form.terms === 'parcelado' ? 'Vencimento da primeira parcela' : 'Vencimento'}<input aria-label="Vencimento" required type="date" value={form.dueDate} disabled={busy || pending || !isActive} aria-describedby="payable-date-help" onChange={e => { setForm({ ...form, dueDate: e.target.value }); setInstallmentDates({}); }} /></label>
      {form.terms === 'parcelado' && <div className="payable-schedule" aria-label="Prévia das parcelas"><strong>Confira as parcelas antes de cadastrar</strong><p>O total é dividido entre as parcelas. Inclua juros e taxas no valor total, se houver. Ajuste os vencimentos conforme a compra.</p>{schedule.length ? <ol>{schedule.map((item, index) => <li key={index}><span>Parcela {index + 1}/{schedule.length} · {money.format(item.amount)}</span><label>Vencimento<input aria-label={`Vencimento da parcela ${index + 1}`} type="date" required value={item.due_date} disabled={busy || pending || !isActive} onChange={e => setInstallmentDates({ ...installmentDates, [index]: e.target.value })} /></label></li>)}</ol> : <p>Informe valor total, quantidade de parcelas e primeiro vencimento para visualizar.</p>}</div>}
      {form.category === 'retirada' ? <p style={{ gridColumn: '1 / -1' }}>Informe a data real do lançamento e o vencimento. Cadastrar não movimenta o caixa: confirme o pagamento com a data em que o dinheiro saiu. Para corrigir uma conta já paga, edite o registro existente em vez de criar outra retirada.</p> : <>
      <p style={{ gridColumn: '1 / -1' }}>Data da compra informa quando você comprou. Vencimento é o prazo para pagar. Cadastrar a conta não registra pagamento; cada parcela ficará em aberto até você confirmar o pagamento.</p>
      <p id="payable-date-help" style={{ gridColumn: '1 / -1' }}>Esqueceu uma despesa? Informe o vencimento original, mesmo de um mês passado. Ela será considerada nesse período na Inteligência Empresarial. Ao registrar o pagamento, informe a data em que você realmente pagou; essa data define a saída no fluxo de caixa.</p>
      <p style={{ gridColumn: '1 / -1' }}>A categoria define como a conta entra no resultado. Escolha compra de mercadorias / estoque apenas para reposição de produtos; serviços, taxas e demais gastos usam a categoria de despesa correspondente. Selecionar um fornecedor não muda essa escolha.</p>
      </>}
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
            <div><dt>{kind === 'pagar' ? 'description' in a && a.deleted_at ? 'Pago no registro excluído' : 'Pago' : 'Liquidado'}</dt><dd>{money.format('description' in a && a.deleted_at ? a.paid_amount : accountPaid(a))}</dd></div>
            <div><dt>Saldo</dt><dd>{money.format(accountBalance(a))}</dd></div>
            <div><dt>Vencimento</dt><dd>{a.due_date ? new Date(a.due_date.slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</dd></div>
          </dl>
          {renderPaymentAction(a)}
          {renderManagementActions(a)}
        </article>)}
      </section>)}
    </div> : <div className="stock-table-wrap"><table className="rma-table">
      <thead><tr><th>{kind === 'pagar' ? 'Conta / Credor' : 'Cliente / Fatura'}</th><th>Original</th><th>{kind === 'pagar' ? 'Pago' : 'Liquidado'}</th><th>Saldo</th><th>Vencimento</th><th>Status</th><th>Ação</th></tr></thead>
      <tbody>{visible.length === 0 ? <tr><td colSpan={7} className="empty-row">Nenhuma conta nesta seleção.</td></tr> : visible.map(a => <tr key={a.id}>
        <td>{'description' in a ? <><strong>{a.description}</strong><br />{a.creditor_name}{purchaseDetails(a)}</> : <><strong>{a.customer_name}</strong><br />{a.number}</>}</td>
        <td>{money.format(a.amount)}</td><td>{money.format('description' in a && a.deleted_at ? a.paid_amount : accountPaid(a))}{'description' in a && a.deleted_at && <small> · Desconsiderado</small>}</td><td>{money.format(accountBalance(a))}</td>
        <td>{a.due_date ? new Date(a.due_date.slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
        <td>{'description' in a && a.deleted_at ? 'Excluída' : isOverdue(a, new Date(), timeZone) ? 'Vencida' : a.status === 'paga' ? 'Quitada' : a.status === 'parcial' ? 'Parcial' : a.status === 'cancelada' ? 'Cancelada' : 'Aberta'}</td>
        <td>{renderPaymentAction(a)}{renderManagementActions(a)}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}
