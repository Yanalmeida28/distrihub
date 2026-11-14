import type { PartnerInvoice, PartnerSale, StockMovement } from '../types';
import { accountBalance, type PayableAccount } from './accounts';
import { saleChargeTotal, salePaymentParts } from './pdv';

export interface InvoiceReceipt {
  id: string; user_id: string; invoice_id: string; branch_id: string | null;
  customer_id: string | null; customer_name: string; invoice_number: string;
  amount: number; occurred_at: string | null;
}
export interface PayablePayment {
  id: string; payable_id: string; user_id: string; amount: number; created_at: string; paid_at?: string | null;
}
export interface FinancialMovement {
  id: string; date: string | null; description: string; amount: number;
}
export interface FinancialRefund {
  id: string; user_id: string; branch_id: string | null; customer_name?: string | null;
  refund_amount: number; refund_request_id?: string | null; refunded_at?: string | null;
}

export function actualFinancialFlow(sales: PartnerSale[], movements: StockMovement[], receipts: InvoiceReceipt[], payments: PayablePayment[], payables: PayableAccount[], invoices: PartnerInvoice[], refunds: FinancialRefund[] = []): FinancialMovement[] {
  const saleTimes = new Map<string, string>();
  for (const movement of movements) {
    const match = /^\s*sa[ií]da por venda\s+(\S+)\s*$/i.exec(movement.reason ?? '');
    if (movement.type !== 'saida' || !match || movement.quantity <= 0) continue;
    if (!saleTimes.has(match[1]) || movement.created_at > saleTimes.get(match[1])!) saleTimes.set(match[1], movement.created_at);
  }
  const billed = new Set(invoices.filter(i => i.status !== 'cancelada').map(i => i.sale_id));
  const accounts = new Map(payables.map(a => [a.id, a]));
  const confirmedRefunds = new Map(refunds.filter(refund => Number.isFinite(Number(refund.refund_amount)) && Number(refund.refund_amount) > 0)
    .map(refund => [refund.refund_request_id || refund.id, refund]));
  return [
    ...sales.filter(s => s.status === 'concluida' && s.payment_method !== 'faturado' && !billed.has(s.id)).map(s => ({
      id: `sale-${s.id}`, date: saleTimes.get(s.id) ?? s.completed_at ?? s.created_at,
      description: `Venda à vista — ${s.customer_name}${s.freight_fee ? ' (inclui frete para repasse)' : ''}`, amount: s.payment_method === 'misto' ? salePaymentParts(s).filter(part => part.method !== 'credito_rma').reduce((sum, part) => sum + Math.round(part.amount * 100), 0) / 100 : saleChargeTotal(s),
    })),
    ...receipts.map(r => ({ id: `receipt-${r.id}`, date: r.occurred_at, description: `Fatura ${r.invoice_number} — ${r.customer_name}`, amount: Number(r.amount) })),
    ...payments.filter(p => accounts.has(p.payable_id)).map(p => ({ id: `payment-${p.id}`, date: p.paid_at ?? p.created_at,
      description: `${accounts.get(p.payable_id)!.description} — ${accounts.get(p.payable_id)!.creditor_name}`, amount: -Number(p.amount) })),
    ...[...confirmedRefunds].map(([id, refund]) => ({ id: `rma-refund-${id}`, date: refund.refunded_at ?? null,
      description: `Reembolso de devolução — ${refund.customer_name ?? 'Cliente'}`, amount: -Number(refund.refund_amount) })),
  ];
}

export function projectedFinancialFlow(invoices: PartnerInvoice[], payables: PayableAccount[]): FinancialMovement[] {
  return [
    ...invoices.filter(i => accountBalance(i) > 0).map(i => ({ id: `invoice-${i.id}`, date: i.due_date,
      description: `A receber — ${i.customer_name} / ${i.number}`, amount: accountBalance(i) })),
    ...payables.filter(a => accountBalance(a) > 0).map(a => ({ id: `payable-${a.id}`, date: a.due_date,
      description: `A pagar — ${a.description} / ${a.creditor_name}`, amount: -accountBalance(a) })),
  ];
}

export function localDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find(value => value.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
