import { adminBusinessDay, businessTimeZone } from './adminDashboard';
export interface CashSession {
  history_complete?: boolean;
  id: string;
  branch_id: string;
  operator_id: string | null;
  actor_key: string;
  operator_name: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  counted_amount: number | null;
  expected_amount: number | null;
  difference: number | null;
  closing_totals: Record<string, number> | null;
  notes: string | null;
}

export interface CashRequest {
  id: string;
  action: 'abrir' | 'movimentar' | 'fechar' | 'devolver';
  sessionId: string | null;
  saleId?: string | null;
  paymentMethod?: string | null;
  amount: number;
  kind: 'sangria' | 'suprimento' | 'dinheiro' | 'pix' | 'cartao' | 'faturado';
  reason: string;
  supervised?: boolean;
}

// No operator/manager PIN is persisted. Reloads recover the same financial UUID.
export class CashRequestStore {
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, private scope: string) {}
  private get key() { return `distrihub:cash-attempt:${this.scope}`; }
  read(): CashRequest | null {
    const raw = this.storage.getItem(this.key);
    if (!raw) return null;
    const request = JSON.parse(raw) as CashRequest;
    if (!request.id || !['abrir', 'movimentar', 'fechar', 'devolver'].includes(request.action) || !Number.isFinite(request.amount)) {
      throw new Error('Operação pendente inválida. Solicite a conferência do caixa.');
    }
    return request;
  }
  save(request: CashRequest) {
    const { id, action, sessionId, saleId, paymentMethod, amount, kind, reason, supervised } = request;
    this.storage.setItem(this.key, JSON.stringify({ id, action, sessionId, saleId, paymentMethod, amount, kind, reason, supervised }));
  }
  clear() { this.storage.removeItem(this.key); }
}

export interface CashMovement {
  performed_by?: string | null;
  performed_by_name?: string | null;
  id: string;
  session_id: string;
  kind: 'venda' | 'estorno' | 'devolucao' | 'sangria' | 'suprimento';
  payment_method: string;
  amount: number;
  reason: string;
  sale_id: string | null;
  created_at: string;
}

export const cashPaymentLabels: Record<string, string> = {
  dinheiro: 'Dinheiro', pix: 'PIX', cartao: 'Cartão', faturado: 'Faturado (a receber)', credito_rma: 'Crédito de devolução (sem entrada de dinheiro)',
};

export function cashTotals(movements: CashMovement[]): Record<string, number> {
  const cents: Record<string, number> = { dinheiro: 0, pix: 0, cartao: 0, faturado: 0 };
  for (const movement of movements) {
    const key = movement.payment_method;
    const sign = movement.kind === 'estorno' || movement.kind === 'devolucao' || movement.kind === 'sangria' ? -1 : 1;
    cents[key] = (cents[key] ?? 0) + sign * Math.round(Number(movement.amount) * 100);
  }
  return Object.fromEntries(Object.entries(cents).map(([key, value]) => [key, value / 100]));
}

export function cashAmount(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error('Informe um valor válido com até duas casas decimais.');
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount > 99999999.99) throw new Error('Valor fora do limite permitido.');
  return amount;
}

export function cashBusinessDay(value: string | Date, timeZone?: string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : adminBusinessDay(date, timeZone);
}

export function cashDaySalesTotal(movements: CashMovement[], sessions: CashSession[], branchId: string, actorKey: string, day: string, timeZone?: string): number {
  const sessionIds = new Set(sessions.filter(session => session.branch_id === branchId && session.actor_key === actorKey).map(session => session.id));
  return movements.filter(movement => sessionIds.has(movement.session_id) && cashBusinessDay(movement.created_at, timeZone) === day &&
    ['venda', 'estorno', 'devolucao'].includes(movement.kind) && ['dinheiro', 'pix', 'cartao', 'faturado', 'credito_rma'].includes(movement.payment_method))
    .reduce((sum, movement) => sum + (movement.kind === 'venda' ? 1 : -1) * Math.round(Number(movement.amount) * 100), 0) / 100;
}

export function printCashReport(session: CashSession, movements: CashMovement[], branchName: string, timeZone?: string) {
  const popup = window.open('', '_blank', 'width=600,height=750');
  if (!popup) throw new Error('Permita pop-ups para imprimir o relatório.');
  const doc = popup.document;
  doc.title = 'Fechamento de caixa';
  doc.documentElement.lang = 'pt-BR';
  const style = doc.createElement('style');
  style.textContent = 'body{font:14px Arial;color:#000;padding:16px}p{white-space:pre-wrap} @media print{button{display:none}}';
  doc.head.append(style);
  const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const totals = session.closing_totals ?? cashTotals(movements);
  const lines = [
    'RELATÓRIO DE CAIXA', `Filial: ${branchName}`, `Operador: ${session.operator_name}`,
    `Abertura: ${new Date(session.opened_at).toLocaleString('pt-BR', timeZone ? { timeZone: businessTimeZone(timeZone) } : undefined)}`,
    `Fechamento: ${session.closed_at ? new Date(session.closed_at).toLocaleString('pt-BR', timeZone ? { timeZone: businessTimeZone(timeZone) } : undefined) : 'Em aberto'}`,
    `Troco inicial: ${currency.format(session.opening_amount)}`,
    ...Object.entries(totals).map(([key, value]) => `${cashPaymentLabels[key] ?? key} (movimento líquido): ${currency.format(value)}`),
    `Dinheiro esperado: ${currency.format(session.expected_amount ?? (Number(session.opening_amount) + (totals.dinheiro ?? 0)))}`,
    ...(session.closed_at ? [`Dinheiro contado: ${currency.format(session.counted_amount ?? 0)}`, `Diferença: ${currency.format(session.difference ?? 0)}`] : []),
    ...(session.notes ? [`Observações: ${session.notes}`] : []),
    '', 'MOVIMENTAÇÕES',
    ...movements.map(m => `${new Date(m.created_at).toLocaleString('pt-BR', timeZone ? { timeZone: businessTimeZone(timeZone) } : undefined)} | ${m.kind} | ${cashPaymentLabels[m.payment_method] ?? m.payment_method} | ${currency.format(m.amount)} | ${m.reason} | Finalizado por: ${m.performed_by_name || 'Não registrado'}`),
  ];
  for (const text of lines) { const p = doc.createElement('p'); p.textContent = text; doc.body.append(p); }
  const button = doc.createElement('button');
  button.textContent = 'Imprimir'; button.onclick = () => popup.print(); doc.body.append(button);
  popup.focus(); popup.print();
}
