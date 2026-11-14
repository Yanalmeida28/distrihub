import type { PartnerCustomer, PartnerInvoice, PartnerProduct, PartnerSale, RmaRequest, StockMovement } from '../types';
import { registeredBusinessResult } from './registeredBusinessResult';
import { accountBalance, accountPaid, invoiceCashReceived, type PayableAccount } from './accounts';
import { adminBusinessDay, adminSaleDate, getAdminPeriodRange, shiftAdminDay } from './adminDashboard';
import { actualFinancialFlow, localDate, projectedFinancialFlow, type FinancialRefund, type InvoiceReceipt, type PayablePayment } from './financialFlow';
import { getCostOfGoodsSold, legacyCostSalesCount } from './reportMetrics';
import { computeStagnantStock } from './stagnantStock';

export function canViewBusinessIntelligence(owner: boolean, ownerOperator: boolean, modules: string[]) {
  return owner && ownerOperator && ['administrativo', 'relatorios', 'financeiro'].every(module => modules.includes(module));
}

type Scoped = { user_id: string; branch_id?: string | null };
export function intelligenceScope<T extends Scoped>(rows: T[], company: string, branch: string, shared = false): T[] {
  if (!company) return [];
  return rows.filter(row => row.user_id === company && (!branch || row.branch_id === branch || (shared && !row.branch_id)));
}
const validAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100));
const cents = (value: number) => Math.round(value * 100);
const total = (rows: { amount: number }[]) => rows.reduce((sum, row) => sum + cents(row.amount), 0) / 100;

export function businessCostQuality(sales: PartnerSale[], products: PartnerProduct[]) {
  const byId = new Map(products.map(product => [product.id, product]));
  let unknown = 0, zeroCostLines = 0;
  const sanitized = sales.map(sale => {
    const snapshot: Record<string, number> = {};
    if (!Array.isArray(sale.items) || sale.items.length === 0) unknown++;
    for (const item of Array.isArray(sale.items) ? sale.items : []) {
      const product = byId.get(item.product_id);
      const saved = sale.cost_snapshot?.[item.product_id];
      const historical = validAmount(saved);
      if (historical) snapshot[item.product_id] = saved;
      const cost = historical ? saved : product?.is_service ? 0 : product?.cost_price;
      if (!Number.isFinite(item.quantity) || item.quantity <= 0 || !validAmount(cost)) unknown++;
      else if (!product?.is_service && cost === 0) zeroCostLines++;
    }
    return { ...sale, cost_snapshot: snapshot };
  });
  return { cost: unknown ? null : getCostOfGoodsSold(sanitized, products), unknown, zeroCostLines,
    estimatedSales: legacyCostSalesCount(sanitized, products) };
}

export type IntelligenceAlert = { id: string; title: string; detail: string; action: string; target: 'relatorios' | 'financeiro'; severity: 'attention' | 'critical' };
export type BusinessInput = {
  company: string; branch: string; now: Date; days: 7 | 30 | 90;
  sales: PartnerSale[]; products: PartnerProduct[]; customers: PartnerCustomer[]; movements: StockMovement[];
  invoices: PartnerInvoice[]; payables: PayableAccount[];
  receipts: InvoiceReceipt[]; payments: PayablePayment[]; refunds: FinancialRefund[];
  rmas?: RmaRequest[]; period?: 'closed' | 'month' | 'today' | 'previousMonth' | 'selectedMonth' | 'custom';
  selectedMonth?: string; customStart?: string; customEnd?: string;
};

export function intelligencePeriod(input: Pick<BusinessInput, 'now' | 'days' | 'period' | 'selectedMonth' | 'customStart' | 'customEnd'>) {
  const today = adminBusinessDay(input.now);
  let first = shiftAdminDay(today, -input.days), last = shiftAdminDay(today, -1);
  if (input.period === 'month') { first = today.slice(0, 7) + '-01'; last = today; }
  if (input.period === 'today') first = last = today;
  if (input.period === 'previousMonth' || input.period === 'selectedMonth') {
    const month = input.period === 'previousMonth' ? shiftAdminDay(today.slice(0, 7) + '-01', -1).slice(0, 7) : input.selectedMonth ?? '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1 || Number(month.slice(0, 4)) > 9998) {
      return { first: today, last: today, error: 'Selecione um mês e ano válidos.' };
    }
    first = month + '-01';
    const nextMonth = new Date(first + 'T12:00:00Z');
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    last = shiftAdminDay(nextMonth.toISOString().slice(0, 10), -1);
  }
  if (input.period === 'custom') { first = input.customStart ?? ''; last = input.customEnd ?? ''; }
  if ([first, last].some(day => Number(day.slice(0, 4)) > 9998)) return { first: today, last: today, error: 'Informe datas até o ano 9998.' };
  const { error } = getAdminPeriodRange('custom', first, last, input.now);
  return error ? { first: today, last: today, error } : { first, last, error: '' };
}

export function businessForecast(invoices: PartnerInvoice[], payables: PayableAccount[], today: string) {
  const expenseData = payables.some(account => account.status !== 'cancelada');
  const projected = projectedFinancialFlow(invoices, payables);
  const dated = projected.filter(row => row.date && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(Date.parse(row.date)) && new Date(row.date).toISOString().slice(0, 10) === row.date);
  return {
    expenseData,
    undated: projected.length - dated.length,
    overdueIncoming: total(dated.filter(row => row.date! < today && row.amount > 0)),
    overdueOutgoing: expenseData ? Math.abs(total(dated.filter(row => row.date! < today && row.amount < 0))) : null,
    windows: ([7, 15, 30] as const).map(days => {
      const end = shiftAdminDay(today, days - 1);
      const rows = dated.filter(row => row.date! >= today && row.date! <= end);
      const incoming = total(rows.filter(row => row.amount > 0));
      const outgoing = expenseData ? Math.abs(total(rows.filter(row => row.amount < 0))) : null;
      return { days, end, incoming, outgoing, change: outgoing === null ? null : (cents(incoming) - cents(outgoing)) / 100 };
    }),
  };
}

export function buildBusinessIntelligence(input: BusinessInput) {
  const { company, branch, now } = input;
  const today = adminBusinessDay(now);
  const { first, last, error: periodError } = intelligencePeriod(input);
  const periodDays = Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1;
  const range = getAdminPeriodRange('custom', first, last, now);
  const sales = intelligenceScope(input.sales, company, branch).filter(sale => sale.status === 'concluida');
  const products = intelligenceScope(input.products, company, branch);
  const movements = intelligenceScope(input.movements, company, branch);
  const customers = intelligenceScope(input.customers, company, branch, true).filter(customer => customer.is_active !== false);
  const invoices = intelligenceScope(input.invoices, company, branch);
  const payables = intelligenceScope(input.payables, company, branch);
  const inRange = (value: string | null | undefined, start: Date, end: Date) => {
    const time = value ? Date.parse(value) : NaN;
    return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
  };
  const currentSales = sales.filter(sale => inRange(adminSaleDate(sale), range.start, range.end));
  const previousSales = sales.filter(sale => inRange(adminSaleDate(sale), range.prevStart, range.prevEnd));
  const revenue = (rows: PartnerSale[]) => rows.every(sale => validAmount(sale.total)) ? rows.reduce((sum, sale) => sum + cents(sale.total), 0) / 100 : null;
  const currentRevenue = revenue(currentSales), previousRevenue = revenue(previousSales);
  const quality = businessCostQuality(currentSales, products), previousQuality = businessCostQuality(previousSales, products);
  const profit = currentRevenue === null || quality.cost === null ? null : (cents(currentRevenue) - cents(quality.cost)) / 100;
  const margin = currentRevenue && profit !== null ? profit / currentRevenue * 100 : null;
  const previousMargin = previousRevenue && previousQuality.cost !== null ? (previousRevenue - previousQuality.cost) / previousRevenue * 100 : null;
  // An early recorded sale is evidence of history; absence of one is not proof of a zero-sales reference period.
  const comparisonReady = !periodError && last < today && previousSales.length >= 5 && sales.some(sale => Date.parse(adminSaleDate(sale)) <= range.prevStart.getTime());
  const growth = comparisonReady && currentRevenue !== null && previousRevenue && previousRevenue > 0 ? (currentRevenue - previousRevenue) / previousRevenue * 100 : null;
  const forecast = businessForecast(invoices, payables, today);
  const invoiceIds = new Set(invoices.map(invoice => invoice.id));
  const payableIds = new Set(payables.map(account => account.id));
  const receipts = intelligenceScope(input.receipts, company, branch).filter(row => invoiceIds.has(row.invoice_id));
  const payments = input.payments.filter(row => row.user_id === company && payableIds.has(row.payable_id));
  const refunds = intelligenceScope(input.refunds, company, branch);
  const ledger = actualFinancialFlow(sales, movements, receipts, payments, payables, invoices, refunds);
  const periodLedger = ledger.filter(row => inRange(row.date, range.start, range.end));
  const result = registeredBusinessResult({ revenue: currentRevenue, cost: quality.cost, sales, products, payables,
    rmas: input.rmas === undefined ? undefined : intelligenceScope(input.rmas, company, branch), first, last });
  const undatedMovements = ledger.filter(row => !row.date || !localDate(row.date)).length;
  const invalidCashAmounts = periodLedger.filter(row => !validAmount(Math.abs(row.amount))).length;
  const paidByAccount = new Map<string, number>(), receivedByInvoice = new Map<string, number>();
  for (const payment of payments) if (validAmount(payment.amount)) paidByAccount.set(payment.payable_id, (paidByAccount.get(payment.payable_id) ?? 0) + cents(payment.amount));
  for (const receipt of receipts) if (validAmount(receipt.amount)) receivedByInvoice.set(receipt.invoice_id, (receivedByInvoice.get(receipt.invoice_id) ?? 0) + cents(receipt.amount));
  const missingCashHistory = payables.filter(account => account.status !== 'cancelada' && cents(accountPaid(account)) !== (paidByAccount.get(account.id) ?? 0)).length
    + invoices.filter(invoice => invoice.status !== 'cancelada' && cents(invoiceCashReceived(invoice)) !== (receivedByInvoice.get(invoice.id) ?? 0)).length;
  const cashResult = forecast.expenseData && !undatedMovements && !invalidCashAmounts && !missingCashHistory ? total(periodLedger) : null;
  const paid = forecast.expenseData ? Math.abs(total(periodLedger.filter(row => row.id.startsWith('payment-')))) : null;
  const received = total(periodLedger.filter(row => row.amount >= 0));
  const refunded = Math.abs(total(periodLedger.filter(row => row.id.startsWith('rma-refund-'))));
  const payableById = new Map(payables.map(account => [account.id, account]));
  const paymentById = new Map(payments.map(payment => [`payment-${payment.id}`, payment]));
  const categoryTotals = new Map<string, number>();
  for (const record of periodLedger) {
    const payment = paymentById.get(record.id);
    const category = payment ? payableById.get(payment.payable_id)?.category : undefined;
    if (category) categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + cents(Math.abs(record.amount)));
  }
  const stagnant = computeStagnantStock(products, sales, movements, now);
  const lastPurchase = new Map<string, string>();
  for (const sale of sales) {
    if (!sale.customer_id) continue;
    const day = localDate(adminSaleDate(sale));
    if (day && day <= today && day > (lastPurchase.get(sale.customer_id) ?? '')) lastPurchase.set(sale.customer_id, day);
  }
  const inactive = customers.filter(customer => { const day = lastPurchase.get(customer.id); return day && day <= shiftAdminDay(today, -90); });
  const neverPurchased = customers.filter(customer => !lastPurchase.has(customer.id)).length;
  const overdueInvoices = invoices.filter(invoice => accountBalance(invoice) > 0 && invoice.due_date && invoice.due_date < today);
  const overduePayables = payables.filter(account => accountBalance(account) > 0 && account.due_date < today);
  const alerts: IntelligenceAlert[] = [];
  if (result.result !== null && result.result < 0) alerts.push({ id: 'registered-loss', title: 'Prejuízo estimado nos registros', detail: 'Receitas, devoluções, custos e despesas por vencimento resultaram em valor negativo.', action: 'Confira a composição do resultado e as despesas cadastradas antes de decidir cortes ou preços.', target: 'financeiro', severity: 'critical' });
  if (cashResult !== null && cashResult < 0) alerts.push({ id: 'cash-deficit', title: 'Saídas registradas maiores que entradas', detail: 'O movimento de caixa do período está negativo; isso não é, por si só, prejuízo.', action: 'Confira vencimentos, recebimentos e compras no Financeiro.', target: 'financeiro', severity: 'attention' });
  if (growth !== null && growth <= -20) alerts.push({ id: 'sales', title: 'Queda de faturamento', detail: `${Math.abs(growth).toFixed(1)}% abaixo dos ${periodDays} dias anteriores.`, action: 'Revise os produtos, vendedores e clientes no relatório de vendas.', target: 'relatorios', severity: 'attention' });
  if (comparisonReady && margin !== null && previousMargin !== null && previousMargin - margin >= 5) alerts.push({ id: 'margin', title: 'Redução de margem bruta estimada', detail: `Queda de ${(previousMargin - margin).toFixed(1)} pontos percentuais; custos antigos podem usar o cadastro atual.`, action: 'Confira custo e composição das vendas antes de rever preços.', target: 'relatorios', severity: 'attention' });
  if (overdueInvoices.length || overduePayables.length) alerts.push({ id: 'overdue', title: 'Contas vencidas', detail: `${overdueInvoices.length} a receber e ${overduePayables.length} a pagar cadastradas.`, action: 'Confira vencimentos e pagamentos antes de priorizar cobranças ou despesas.', target: 'financeiro', severity: 'critical' });
  if (stagnant.count) alerts.push({ id: 'stock', title: 'Estoque sem giro', detail: `${stagnant.count} produto(s) há 30 dias ou mais sem giro; ${stagnant.criticalCount} há 90 dias ou mais.`, action: 'Consulte o relatório Sem giro e avalie a reposição desses itens.', target: 'relatorios', severity: 'attention' });
  if (inactive.length) alerts.push({ id: 'customers', title: 'Clientes sem compra há 90 dias', detail: `${inactive.length} cliente(s) sem compras concluídas ${branch ? 'nesta filial' : 'na empresa'}.`, action: 'Consulte o CRM para planejar retornos. Nenhum contato será enviado automaticamente.', target: 'relatorios', severity: 'attention' });
  return { today, first, last, periodError, periodDays, result, cashResult, invalidCashAmounts, missingCashHistory, currentRevenue, previousRevenue, profit, margin, quality, previousQuality, comparisonReady, growth,
    salesCount: currentSales.length, previousCount: previousSales.length, forecast, received, paid, refunded,
    expenseCategories: [...categoryTotals].map(([category, value]) => ({ category, amount: value / 100 })),
    undatedMovements,
    receivable: invoices.reduce((sum, invoice) => sum + cents(accountBalance(invoice)), 0) / 100,
    payable: forecast.expenseData ? payables.reduce((sum, account) => sum + cents(accountBalance(account)), 0) / 100 : null,
    stagnant, inactiveCount: inactive.length, neverPurchased, alerts,
    zeroCostProducts: products.filter(product => !product.is_service && product.cost_price === 0).length,
    legacyDateSales: sales.filter(sale => !sale.completed_at).length,
  };
}

export function simulateBusinessGoal(fixed: string, contribution: string, desired: string, target: string, revenue: number | null) {
  const parse = (value: string) => /^\d+(?:[.,]\d{1,2})?$/.test(value.trim()) ? Number(value.trim().replace(',', '.')) : null;
  const fixedValue = parse(fixed), rate = parse(contribution), desiredValue = parse(desired), targetValue = target.trim() ? parse(target) : null;
  if (fixedValue === null || rate === null || desiredValue === null || (target.trim() && targetValue === null)) return { error: 'Informe gastos fixos, margem de contribuição e resultado desejado. Use zero apenas quando confirmado.', result: null };
  if (rate <= 0 || rate > 100) return { error: 'A margem de contribuição deve ser maior que zero e até 100%. Com margem nula ou negativa não há equilíbrio neste modelo.', result: null };
  const breakEven = fixedValue / (rate / 100), requiredRevenue = (fixedValue + desiredValue) / (rate / 100);
  if (![fixedValue, desiredValue, breakEven, requiredRevenue, targetValue ?? 0].every(value => Number.isSafeInteger(cents(value)))) return { error: 'Valores fora do limite de cálculo. Revise as premissas.', result: null };
  const objective = Math.max(requiredRevenue, targetValue ?? 0);
  return { error: '', result: { breakEven, requiredRevenue, objective, remaining: revenue === null ? null : Math.max(0, objective - revenue) } };
}
