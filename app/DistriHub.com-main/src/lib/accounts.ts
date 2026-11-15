import { adminBusinessDay } from './adminDashboard';
import type { PartnerInvoice } from '../types';
import type { PayableInstallment, PayablePaymentMethod } from './payableDetails';
export const payableCategories = { fornecedor: 'Compra de mercadorias / estoque', aluguel: 'Aluguel', energia: 'Energia', salarios: 'Salários', impostos: 'Impostos', outros: 'Outras despesas' };

export interface PayableAccount {
  id: string;
  user_id: string;
  branch_id: string | null;
  supplier_id: string | null;
  description: string;
  creditor_name: string;
  category: 'fornecedor' | 'aluguel' | 'energia' | 'salarios' | 'impostos' | 'outros';
  amount: number;
  paid_amount: number;
  due_date: string;
  purchased_on?: string | null;
  payment_method?: PayablePaymentMethod | null;
  payment_method_detail?: string | null;
  purchase_id?: string | null;
  installment_number?: number | null;
  installment_count?: number | null;
  purchase_total?: number | null;
  revision?: number;
  deleted_at?: string | null;
  deletion_reason?: string | null;
  status: 'aberta' | 'parcial' | 'paga' | 'cancelada';
  created_at: string;
}
export type PayableCreation = Omit<PayableAccount, 'id' | 'user_id' | 'paid_amount' | 'status' | 'created_at' | 'purchase_id' | 'installment_number' | 'installment_count' | 'purchase_total' | 'revision' | 'deleted_at' | 'deletion_reason'> & { installments?: PayableInstallment[] };
export type PayableEdit = Pick<PayableAccount, 'description' | 'creditor_name' | 'supplier_id' | 'category' | 'amount' | 'due_date' | 'purchased_on' | 'payment_method' | 'payment_method_detail'>;

export function accountPaid(account: { amount: number; paid_amount?: number; status: string }): number {
  return account.status === 'cancelada' ? 0 : Number(account.paid_amount ?? (account.status === 'paga' ? account.amount : 0));
}

export function invoiceCashReceived(invoice: PartnerInvoice): number {
  return Math.max(0, accountPaid(invoice) - Number(invoice.return_credit_amount ?? 0));
}

export function accountBalance(account: { amount: number; paid_amount?: number; status: string }): number {
  if (account.status === 'cancelada' || account.status === 'paga') return 0;
  return Math.max(0, Math.round(Number(account.amount) * 100) - Math.round(accountPaid(account) * 100)) / 100;
}

export function isOverdue(account: { amount: number; paid_amount?: number; status: string; due_date: string | null }, today = new Date(), timeZone?: string): boolean {
  const date = timeZone ? adminBusinessDay(today, timeZone) : `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return accountBalance(account) > 0 && Boolean(account.due_date && account.due_date.slice(0, 10) < date);
}

export function financialAccounts(invoices: PartnerInvoice[], payables: PayableAccount[]) {
  return {
    receivable: invoices.reduce((sum, account) => sum + accountBalance(account), 0),
    received: invoices.reduce((sum, account) => sum + invoiceCashReceived(account), 0),
    payable: payables.reduce((sum, account) => sum + accountBalance(account), 0),
    paid: payables.reduce((sum, account) => sum + accountPaid(account), 0),
  };
}
