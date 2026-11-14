import type { PayableAccount } from './accounts';
type Attempt = { token: string; amount: number };
type AttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & Partial<Pick<Storage, 'key' | 'length'>>;
export type FinancialRecovery = { id: string; label: string; run: () => Promise<void> };
export class InvoicePaymentAttempts {
  constructor(private storage: AttemptStorage) {}
  private index(scope: string) { return `distrihub-invoice-payment-index:${scope}`; }
  pending(scope: string, invoiceId: string): Attempt | null {
    const raw = this.storage.getItem(`distrihub-invoice-payment:${scope}:${invoiceId}`);
    if (!raw) return null;
    const value = JSON.parse(raw) as Attempt;
    if (!value.token || !Number.isFinite(value.amount) || value.amount <= 0) throw new Error('Tentativa de recebimento inválida. Confira o registro antes de continuar.');
    return value;
  }
  list(scope: string): { invoiceId: string; token: string; amount: number }[] {
    const ids = new Set<string>(JSON.parse(this.storage.getItem(this.index(scope)) ?? '[]'));
    const prefix = `distrihub-invoice-payment:${scope}:`;
    for (let i = 0; i < (this.storage.length ?? 0); i++) {
      const key = this.storage.key?.(i);
      if (key?.startsWith(prefix)) ids.add(key.slice(prefix.length));
    }
    return [...ids].flatMap(invoiceId => { const value = this.pending(scope, invoiceId); return value ? [{ invoiceId, ...value }] : []; });
  }
  get(scope: string, invoiceId: string, amount: number, token: string): Attempt {
    const key = `distrihub-invoice-payment:${scope}:${invoiceId}`;
    const raw = this.storage.getItem(key);
    if (raw) {
      const previous = JSON.parse(raw) as Attempt;
      if (!previous.token || !Number.isFinite(previous.amount)) throw new Error('Registro de tentativa inválido. Verifique o recebimento antes de continuar.');
      if (previous.amount !== amount) throw new Error('Há um recebimento sem confirmação para esta fatura. Tente novamente com o valor anterior antes de registrar outro.');
      return previous;
    }
    const attempt = { token, amount };
    const ids = this.list(scope).map(item => item.invoiceId);
    this.storage.setItem(this.index(scope), JSON.stringify([...new Set([...ids, invoiceId])]));
    this.storage.setItem(key, JSON.stringify(attempt));
    return attempt;
  }
  confirm(scope: string, invoiceId: string) { this.storage.removeItem(`distrihub-invoice-payment:${scope}:${invoiceId}`); }
}

export type FinancialOperation =
  | { kind: 'payable-create'; account: Omit<PayableAccount, 'id' | 'user_id' | 'paid_amount' | 'status' | 'created_at'> }
  | { kind: 'payable-payment'; payableId: string; amount: number; paymentDate?: string }
  | { kind: 'rma-credit'; rmaId: string; invoiceId: string; amount: number };
export class FinancialOperationAttempts {
  constructor(private storage: AttemptStorage) {}
  private key(scope: string, kind: FinancialOperation['kind']) { return `distrihub-financial-operation:${scope}:${kind}`; }
  pending(scope: string, kind: FinancialOperation['kind']): { token: string; payload: FinancialOperation } | null {
    const raw = this.storage.getItem(this.key(scope, kind));
    if (!raw) return null;
    const value = JSON.parse(raw) as { token: string; payload: FinancialOperation };
    if (!value.token || !value.payload || value.payload.kind !== kind) throw new Error('Tentativa financeira inválida. Confira o registro antes de continuar.');
    return value;
  }
  get(scope: string, payload: FinancialOperation, token: string) {
    const previous = this.pending(scope, payload.kind);
    if (previous) {
      if (JSON.stringify(previous.payload) !== JSON.stringify(payload)) throw new Error('Existe uma operação financeira sem confirmação. Recupere a tentativa pendente antes de registrar outra.');
      return previous;
    }
    const value = { token, payload };
    this.storage.setItem(this.key(scope, payload.kind), JSON.stringify(value));
    return value;
  }
  confirm(scope: string, kind: FinancialOperation['kind']) { this.storage.removeItem(this.key(scope, kind)); }
}
