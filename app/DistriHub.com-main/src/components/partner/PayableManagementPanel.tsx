import { useEffect, useRef, useState } from 'react';
import type { PartnerSupplier } from '../../types';
import { payableCategories, type PayableAccount, type PayableEdit, type PayableExpenseBehavior } from '../../lib/accounts';
import { payablePaymentMethods, validPayableDay, type PayablePaymentMethod } from '../../lib/payableDetails';
import { localDate } from '../../lib/financialFlow';
import { money } from '../../utils';

type Props = {
  account: PayableAccount; mode: 'edit' | 'delete'; suppliers: PartnerSupplier[]; branchName: string;
  blocked: boolean; isActive: boolean;
  onEdit: (changes: PayableEdit, revision: number, token: string) => Promise<void>;
  onDelete: (reason: string, revision: number, token: string) => Promise<void>;
  onDone: (message: string) => void; onCancel: () => void;
};
export function PayableManagementPanel({ account, mode, suppliers, branchName, blocked, isActive, onEdit, onDelete, onDone, onCancel }: Props) {
  const [form, setForm] = useState(() => ({
    description: account.description, creditor: account.creditor_name, supplier: account.supplier_id ?? '', category: account.category,
    behavior: account.expense_behavior ?? '' as PayableExpenseBehavior | '',
    amount: String(account.amount).replace('.', ','), due: account.due_date, purchased: account.purchased_on ?? '',
    method: account.payment_method ?? 'nao_informado', detail: account.payment_method_detail ?? '',
  }));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false), mounted = useRef(true), token = useRef<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); panel.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, []);
  const disabled = busy || blocked || !isActive;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (disabled || lock.current) return;
    const amount = /^\d+(?:[.,]\d{1,2})?$/.test(form.amount.trim()) ? Number(form.amount.replace(',', '.')) : NaN;
    if (mode === 'delete' && (!reason.trim() || reason.trim().length > 500)) { setError('Informe o motivo da exclusão.'); return; }
    if (mode === 'edit') {
      if (!form.description.trim() || !form.creditor.trim() || !Number.isFinite(amount) || amount <= 0) { setError('Confira descrição, credor e valor.'); return; }
      if (amount < account.paid_amount) { setError('O valor da conta não pode ser menor que o total já pago.'); return; }
      if (!validPayableDay(form.due) || (form.purchased && (!validPayableDay(form.purchased) || form.purchased > localDate(new Date().toISOString())))) { setError('Confira as datas da compra e do vencimento.'); return; }
      if (form.method === 'outro' && !form.detail.trim()) { setError('Informe qual é a outra forma de pagamento.'); return; }
    }
    lock.current = true; setBusy(true); setError(''); token.current ??= crypto.randomUUID();
    try {
      if (mode === 'delete') await onDelete(reason.trim(), account.revision ?? 0, token.current);
      else await onEdit({
        description: form.description.trim(), creditor_name: form.creditor.trim(), supplier_id: form.supplier || null,
        category: form.category, expense_behavior: form.category === 'fornecedor' ? null : form.behavior || null,
        amount, due_date: form.due, purchased_on: form.purchased || null,
        payment_method: form.method, payment_method_detail: form.method === 'outro' ? form.detail.trim() : null,
      }, account.revision ?? 0, token.current);
      if (mounted.current) onDone(mode === 'delete' ? 'Conta excluída dos cálculos. O histórico foi preservado para conferência.' : 'Conta atualizada.');
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar a alteração.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <section ref={panel} tabIndex={-1} className="module-card payable-management" aria-label={mode === 'edit' ? 'Editar conta a pagar' : 'Excluir conta a pagar'}>
    <h4>{mode === 'edit' ? 'Editar conta a pagar' : 'Excluir registro de conta'}</h4>
    <p><strong>{account.description}</strong> · {money.format(account.amount)} · {branchName}</p>
    {account.installment_count && account.installment_count > 1 ? <p>Parcela {account.installment_number}/{account.installment_count}. A ação vale somente para esta parcela; os valores e vencimentos das demais permanecem como estão.</p> : null}
    {mode === 'delete' ? <>
      <p>A conta sairá da lista normal, dos saldos e do resultado. Os pagamentos vinculados também deixarão de contar no fluxo financeiro, inclusive nos períodos anteriores.</p>
      {account.paid_amount > 0 && <p role="note">Esta conta tem {money.format(account.paid_amount)} em pagamentos registrados. Use a exclusão para corrigir um lançamento indevido. Essa ação não devolve dinheiro à conta bancária.</p>}
      <p>O registro e o motivo permanecerão disponíveis em Excluídas para conferência.</p>
    </> : <p>Você pode corrigir descrição, categoria, fornecedor, valor, datas e forma prevista. Pagamentos confirmados mantêm seus valores, datas e formas reais; o valor da conta deve cobrir o total já pago.</p>}
    <form className="accounts-entry-form" onSubmit={submit}>
      {mode === 'delete' ? <label style={{ gridColumn: '1 / -1' }}>Motivo da exclusão<textarea aria-label="Motivo da exclusão" required maxLength={500} value={reason} disabled={disabled} onChange={event => setReason(event.target.value)} /></label> : <>
        <label>Descrição<input aria-label="Editar descrição da conta" required maxLength={200} value={form.description} disabled={disabled} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
        <label>Credor<input aria-label="Editar credor da conta" required maxLength={200} value={form.creditor} disabled={disabled} onChange={event => setForm({ ...form, creditor: event.target.value })} /></label>
        <label>Fornecedor<select aria-label="Editar fornecedor da conta" value={form.supplier} disabled={disabled} onChange={event => setForm({ ...form, supplier: event.target.value })}><option value="">Sem fornecedor</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        <label>Categoria<select aria-label="Editar categoria da conta" value={form.category} disabled={disabled} onChange={event => setForm({ ...form, category: event.target.value as PayableAccount['category'] })}>{Object.entries(payableCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {form.category !== 'fornecedor' && <label>Tipo de despesa<select aria-label="Editar tipo de despesa" value={form.behavior} disabled={disabled} onChange={event => setForm({ ...form, behavior: event.target.value as PayableExpenseBehavior })}><option value="">Usar classificação da categoria no ponto de equilíbrio</option><option value="fixed">Fixa — não acompanha as vendas</option><option value="variable">Variável — acompanha as vendas</option></select></label>}
        <label>Valor desta conta ou parcela (R$)<input aria-label="Editar valor da conta" inputMode="decimal" required value={form.amount} disabled={disabled} onChange={event => setForm({ ...form, amount: event.target.value })} /></label>
        <label>Vencimento<input aria-label="Editar vencimento da conta" type="date" required value={form.due} disabled={disabled} onChange={event => setForm({ ...form, due: event.target.value })} /></label>
        <label>Data da compra<input aria-label="Editar data da compra" type="date" max={localDate(new Date().toISOString())} value={form.purchased} disabled={disabled} onChange={event => setForm({ ...form, purchased: event.target.value })} /></label>
        <label>Forma prevista<select aria-label="Editar forma prevista" value={form.method} disabled={disabled} onChange={event => setForm({ ...form, method: event.target.value as PayablePaymentMethod, detail: '' })}>{Object.entries(payablePaymentMethods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {form.method === 'outro' && <label>Qual forma?<input aria-label="Editar detalhe da forma" required maxLength={80} value={form.detail} disabled={disabled} onChange={event => setForm({ ...form, detail: event.target.value })} /></label>}
      </>}
      {error && <p role="alert" style={{ gridColumn: '1 / -1' }}>{error}</p>}
      {blocked && <p role="status" style={{ gridColumn: '1 / -1' }}>Recupere a operação pendente antes de enviar outra alteração.</p>}
      <div style={{ gridColumn: '1 / -1' }}>
        <button className={'module-submit-btn' + (mode === 'delete' ? ' payable-delete-confirm' : '')} disabled={disabled}>{busy ? 'Confirmando…' : mode === 'delete' ? 'Confirmar exclusão' : 'Salvar alterações'}</button>{' '}
        <button type="button" className="rma-advance-btn" disabled={busy} onClick={onCancel}>Cancelar alteração</button>
      </div>
    </form>
  </section>;
}
