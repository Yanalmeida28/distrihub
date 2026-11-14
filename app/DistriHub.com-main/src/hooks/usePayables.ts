import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { FinancialOperationAttempts, type FinancialOperation, type FinancialRecovery } from '../lib/invoicePayments';
import { isDefinitiveSaleRejection } from '../lib/pdv';
import type { PayableAccount, PayableCreation } from '../lib/accounts';
import type { PayablePaymentMethod } from '../lib/payableDetails';

export function usePayables(userId?: string) {
  const [accounts, setAccounts] = useState<PayableAccount[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const revision = useRef(0);
  const locks = useRef(new Set<string>());
  const [attemptVersion, setAttemptVersion] = useState(0);
  const companyRef = useRef(userId); companyRef.current = userId;
  const load = useCallback(async () => {
    const request = ++revision.current;
    setLoading(true);
    setError('');
    try {
    if (!supabase || !userId) {
      setError('Conecte a loja para consultar Contas a Pagar.');
      setAccounts([]);
      setLoading(false);
      return false;
    }
    const all: PayableAccount[] = [];
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (request !== revision.current) return false;
    if (authError || auth.user?.id !== userId) {
      setError('Contas a Pagar são administradas pelo proprietário da loja.');
      setAccounts([]); setLoading(false); return false;
    }
    for (let offset = 0; ; offset += 500) {
      const result = await supabase.from('partner_payables').select('*').eq('user_id', userId)
        .order('due_date').order('id').range(offset, offset + 499);
      if (request !== revision.current) return false;
      if (result.error) {
        setError('Não foi possível carregar Contas a Pagar. ' + result.error.message);
        setAccounts([]);
        setLoading(false);
        return false;
      }
      all.push(...result.data as PayableAccount[]);
      if (result.data.length < 500) break;
    }
    if (request === revision.current) { setAccounts(all); setLoading(false); }
    return request === revision.current;
    } catch (cause) {
      if (request === revision.current) {
        setAccounts([]); setLoading(false);
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as contas.');
      }
      return false;
    }
  }, [userId]);
  const invalidate = useCallback(() => { revision.current++; }, []);
  useEffect(() => { setAccounts([]); void load(); return invalidate; }, [load, invalidate]);

  const execute = async (payload: FinancialOperation, token: string) => {
    const client = supabase;
    if (!client || !userId) throw new Error('Loja não conectada.');
    const company = userId;
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || auth.user?.id !== company || companyRef.current !== company) throw new Error('Operação financeira exige o proprietário autenticado.');
    const scope = company + ':' + company;
    const store = new FinancialOperationAttempts(window.localStorage);
    const key = scope + ':' + payload.kind;
    if (locks.current.has(key)) throw new Error('Operação em confirmação. Aguarde.');
    const pending = store.pending(scope, payload.kind);
    locks.current.add(key);
    try {
      const attempt = store.get(scope, payload, token);
      setAttemptVersion(version => version + 1);
      let response;
      let expected: string;
      if (payload.kind === 'payable-create') {
        const account = payload.account; expected = attempt.token;
        const args = { p_id: attempt.token, p_branch_id: account.branch_id,
          p_supplier_id: account.supplier_id, p_description: account.description, p_creditor_name: account.creditor_name,
          p_category: account.category, p_amount: account.amount, p_due_date: account.due_date };
        response = account.purchased_on === undefined
          ? await client.rpc('create_partner_payable', args)
          : await client.rpc('create_partner_payable_purchase', {
            p_purchase_id: attempt.token, p_branch_id: account.branch_id, p_supplier_id: account.supplier_id,
            p_description: account.description, p_creditor_name: account.creditor_name, p_category: account.category,
            p_total: account.amount, p_purchased_on: account.purchased_on,
            p_payment_method: account.payment_method ?? 'nao_informado', p_payment_method_detail: account.payment_method_detail ?? null,
            p_installments: account.installments ?? [{ id: attempt.token, amount: account.amount, due_date: account.due_date }],
          });
      } else if (payload.kind === 'payable-payment') {
        expected = payload.payableId;
        const args = { p_payable_id: payload.payableId, p_amount: payload.amount, p_payment_id: attempt.token };
        // Tentativas antigas continuam usando a mesma operação, sem inventar outra data na recuperação.
        response = payload.paymentMethod !== undefined
          ? await client.rpc('record_partner_payable_payment_details', { ...args, p_payment_date: payload.paymentDate,
            p_payment_method: payload.paymentMethod, p_payment_method_detail: payload.paymentMethodDetail ?? null })
          : payload.paymentDate === undefined
          ? await client.rpc('record_partner_payable_payment', args)
          : await client.rpc('record_partner_payable_payment_dated', { ...args, p_payment_date: payload.paymentDate });
      } else throw new Error('Operação de contas inválida.');
      if (response.error) {
        if (!pending && isDefinitiveSaleRejection(response.error.code ?? '')) store.confirm(scope, payload.kind);
        throw new Error(response.error.message);
      }
      if (response.data !== expected) throw new Error('O servidor não confirmou a operação. Recupere a tentativa pendente.');
      store.confirm(scope, payload.kind);
      if (companyRef.current === company) await load();
    } finally { locks.current.delete(key); setAttemptVersion(version => version + 1); }
  };
  const create = (account: PayableCreation, id: string) => execute({ kind: 'payable-create', account }, id);
  const pay = (id: string, amount: number, paymentId: string, paymentDate?: string, paymentMethod?: PayablePaymentMethod, paymentMethodDetail?: string | null) => execute({ kind: 'payable-payment', payableId: id, amount, ...(paymentDate === undefined ? {} : { paymentDate }), ...(paymentMethod === undefined ? {} : { paymentMethod, paymentMethodDetail: paymentMethodDetail ?? null }) }, paymentId);
  const recoveries: FinancialRecovery[] = [];
  let recoveryError = '';
  void attemptVersion;
  if (userId) {
    try {
      const store = new FinancialOperationAttempts(window.localStorage);
      for (const kind of ['payable-create', 'payable-payment'] as const) {
        const attempt = store.pending(userId + ':' + userId, kind);
        if (attempt) recoveries.push({ id: kind, label: kind === 'payable-create' ? 'Recuperar cadastro de conta' : 'Recuperar pagamento de conta', run: () => execute(attempt.payload, attempt.token) });
      }
    } catch (cause) { recoveryError = cause instanceof Error ? cause.message : 'Não foi possível recuperar tentativas.'; }
  }
  return { accounts, loading, error, reload: load, create, pay, recoveries, recoveryError };
}
