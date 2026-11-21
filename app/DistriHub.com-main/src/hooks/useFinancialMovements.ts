import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { FinancialRefund, InvoiceReceipt, PayablePayment } from '../lib/financialFlow';

export function useFinancialMovements(userId: string | undefined, branchId: string, invoices: unknown, payables: unknown, isActive: boolean) {
  const [receipts, setReceipts] = useState<InvoiceReceipt[]>([]);
  const [payments, setPayments] = useState<PayablePayment[]>([]);
  const [refunds, setRefunds] = useState<FinancialRefund[]>([]);
  const [loading, setLoading] = useState(true);
  const reading = useRef(loading); reading.current = loading;
  const loadedContext = useRef('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!isActive || !userId) return;
    const visible = () => document.visibilityState !== 'hidden' && (typeof navigator === 'undefined' || navigator.onLine !== false);
    const resume = () => { if (visible() && !reading.current) reload(); };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string; branchId?: string | null }>).detail;
      if (detail?.companyId === userId && (!branchId || !detail.branchId || detail.branchId === branchId) && visible()) reload();
    };
    // Events give prompt updates; the bounded retry also covers lost events.
    const timer = window.setInterval(resume, 30_000);
    window.addEventListener('distrihub:financial-changed', changed);
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('distrihub:financial-changed', changed);
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [isActive, userId, branchId, reload]);
  // A sincronização pode recriar as listas sem alterar seu conteúdo. Isso não exige outra consulta.
  const sourceVersion = JSON.stringify([invoices, payables]);
  useEffect(() => {
    if (!isActive) return;
    let active = true;
    const context = `${userId}:${branchId}`;
    setLoading(true); setError('');
    // Keep the current statement while revalidating so pagination stays stable.
    // A company/branch change must never keep the previous context's records.
    if (loadedContext.current !== context) { setReceipts([]); setPayments([]); setRefunds([]); }
    loadedContext.current = context;
    async function load() {
      const client = supabase;
      if (!client || !userId) throw new Error('Loja não conectada.');
      const { data: auth, error: failure } = await client.auth.getUser();
      if (!active) return;
      if (failure || auth.user?.id !== userId) throw new Error('Os movimentos financeiros são administrados pelo proprietário da loja.');
      async function pages(table: string) {
        const all: unknown[] = [];
        for (let offset = 0; active; offset += 500) {
          const columns = table === 'rma_requests_v2' ? 'id,user_id,branch_id,customer_name,refund_amount,refund_request_id,refunded_at' : '*';
          const result = await client!.from(table).select(columns).eq('user_id', userId!).order('id').range(offset, offset + 499);
          if (!active) return [];
          if (result.error) throw new Error(result.error.message);
          if (!Array.isArray(result.data)) throw new Error('Resposta de movimentos inválida.');
          all.push(...result.data);
          if (result.data.length < 500) return all;
        }
        return [];
      }
      const [receiptRows, paymentRows, refundRows] = await Promise.all([pages('partner_invoice_receipts'), pages('partner_payable_payments'), pages('rma_requests_v2')]);
      if (active) {
        setReceipts((receiptRows as InvoiceReceipt[]).filter(row => row.user_id === userId && (!branchId || row.branch_id === branchId)));
        setPayments((paymentRows as PayablePayment[]).filter(row => row.user_id === userId));
        setRefunds((refundRows as FinancialRefund[]).filter(row => row.user_id === userId && (!branchId || row.branch_id === branchId)));
      }
    }
    void load().catch(cause => { if (active) { setReceipts([]); setPayments([]); setRefunds([]); setError(cause instanceof Error ? cause.message : 'Falha ao consultar movimentos.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, branchId, sourceVersion, revision, isActive]);
  return { receipts, payments, refunds, loading, error, reload };
}
