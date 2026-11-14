export const payablePaymentMethods = {
  nao_informado: 'Definir depois',
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  cartao_debito: 'Cartão de débito',
  cartao_credito: 'Cartão de crédito',
  boleto: 'Boleto',
  transferencia: 'Transferência bancária',
  cheque: 'Cheque',
  outro: 'Outra forma',
} as const;
export type PayablePaymentMethod = keyof typeof payablePaymentMethods;
export type PayableInstallment = { id: string; amount: number; due_date: string };

export function validPayableDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '0001-01-01' && value <= '9998-12-31'
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

// Divide em centavos e mantém o dia original nos meses seguintes (31/01 → 28/02 → 31/03).
export function payableSchedule(amount: number, count: number, firstDue: string) {
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 99999999999999
    || !Number.isInteger(count) || count < 1 || count > 120 || cents < count || !validPayableDay(firstDue)) return [];
  const anchor = new Date(firstDue + 'T12:00:00Z'), day = anchor.getUTCDate();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(anchor);
    date.setUTCMonth(anchor.getUTCMonth() + index, 1);
    const end = new Date(date); end.setUTCMonth(date.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(day, end.getUTCDate()));
    return { amount: (Math.floor(cents / count) + (index < cents % count ? 1 : 0)) / 100, due_date: date.toISOString().slice(0, 10) };
  });
}

export function payableMethodLabel(method?: PayablePaymentMethod | null, detail?: string | null) {
  return method === 'outro' ? detail?.trim() || 'Outra forma' : method ? payablePaymentMethods[method] ?? 'Não informado' : 'Não informado';
}
