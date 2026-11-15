import type { PartnerCustomer, PartnerInvoice, PartnerProduct, PartnerSale, RmaRequest, StockMovement } from '../types';
import { registeredBusinessResult } from './registeredBusinessResult';
import { accountBalance, accountPaid, invoiceCashReceived, type PayableAccount } from './accounts';
import { adminBusinessDay, adminDayStart, businessTimeZone, adminSaleDate, getAdminPeriodRange, shiftAdminDay } from './adminDashboard';
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
  company: string; branch: string; timeZone?: string; now: Date; days: 7 | 30 | 90;
  sales: PartnerSale[]; products: PartnerProduct[]; customers: PartnerCustomer[]; movements: StockMovement[];
  invoices: PartnerInvoice[]; payables: PayableAccount[];
  receipts: InvoiceReceipt[]; payments: PayablePayment[]; refunds: FinancialRefund[];
  rmas?: RmaRequest[]; period?: 'closed' | 'month' | 'today' | 'previousMonth' | 'selectedMonth' | 'custom';
  selectedMonth?: string; customStart?: string; customEnd?: string;
};

export function intelligencePeriod(input: Pick<BusinessInput, 'timeZone' | 'now' | 'days' | 'period' | 'selectedMonth' | 'customStart' | 'customEnd'>) {
  const today = adminBusinessDay(input.now, input.timeZone);
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
  const { error } = getAdminPeriodRange('custom', first, last, input.now, input.timeZone);
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
  input = { ...input, timeZone: businessTimeZone(input.timeZone) };
  const { company, branch, now } = input;
  const today = adminBusinessDay(now, input.timeZone);
  const { first, last, error: periodError } = intelligencePeriod(input);
  const periodDays = Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1;
  const range = getAdminPeriodRange('custom', first, last, now, input.timeZone);
  // Compare equal civil days; an open day uses the same wall-clock cutoff.
  let comparisonEnd = range.end;
  if (input.period === 'month') {
    const priorLast = shiftAdminDay(first, -1);
    const commonDays = Math.min(Number(today.slice(8)), Number(priorLast.slice(8)));
    const priorFirst = priorLast.slice(0, 7) + '-01';
    const currentLast = shiftAdminDay(first, commonDays - 1);
    const previousLast = shiftAdminDay(priorFirst, commonDays - 1);
    range.prevStart = adminDayStart(priorFirst, input.timeZone);
    if (currentLast === today) {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: input.timeZone ?? 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
      const n = (key: string) => Number(parts.find(p => p.type === key)?.value ?? 0);
      const offset = ((n('hour') * 60 + n('minute')) * 60 + n('second')) * 1000 + now.getUTCMilliseconds();
      comparisonEnd = now;
      range.prevEnd = new Date(adminDayStart(previousLast, input.timeZone).getTime() + offset);
    } else {
      comparisonEnd = adminDayStart(shiftAdminDay(currentLast, 1), input.timeZone);
      range.prevEnd = adminDayStart(shiftAdminDay(previousLast, 1), input.timeZone);
    }
  }
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
  const comparisonSales = sales.filter(sale => inRange(adminSaleDate(sale), range.start, comparisonEnd));
  const previousSales = sales.filter(sale => inRange(adminSaleDate(sale), range.prevStart, range.prevEnd));
  const revenue = (rows: PartnerSale[]) => rows.every(sale => validAmount(sale.total)) ? rows.reduce((sum, sale) => sum + cents(sale.total), 0) / 100 : null;
  const currentRevenue = revenue(currentSales), previousRevenue = revenue(previousSales);
  const quality = businessCostQuality(currentSales, products), previousQuality = businessCostQuality(previousSales, products);
  const profit = currentRevenue === null || quality.cost === null ? null : (cents(currentRevenue) - cents(quality.cost)) / 100;
  const margin = currentRevenue && profit !== null ? profit / currentRevenue * 100 : null;
  const previousMargin = previousRevenue && previousQuality.cost !== null ? (previousRevenue - previousQuality.cost) / previousRevenue * 100 : null;
  // An early recorded sale is evidence of history; absence of one is not proof of a zero-sales reference period.
  const comparisonRevenue = revenue(comparisonSales);
  const comparisonQuality = businessCostQuality(comparisonSales, products);
  const comparisonMargin = comparisonRevenue && comparisonQuality.cost !== null ? (comparisonRevenue - comparisonQuality.cost) / comparisonRevenue * 100 : null;
  const comparisonReady = !periodError && (last < today || input.period === 'month') && previousSales.length >= 5 && sales.some(sale => Date.parse(adminSaleDate(sale)) <= range.prevStart.getTime());
  const growth = comparisonReady && comparisonRevenue !== null && previousRevenue && previousRevenue > 0 ? (comparisonRevenue - previousRevenue) / previousRevenue * 100 : null;
  const forecast = businessForecast(invoices, payables, today);
  const invoiceIds = new Set(invoices.map(invoice => invoice.id));
  const payableIds = new Set(payables.map(account => account.id));
  const receipts = intelligenceScope(input.receipts, company, branch).filter(row => invoiceIds.has(row.invoice_id));
  const payments = input.payments.filter(row => !row.voided_at && row.user_id === company && payableIds.has(row.payable_id));
  const refunds = intelligenceScope(input.refunds, company, branch);
  const ledger = actualFinancialFlow(sales, movements, receipts, payments, payables, invoices, refunds);
  const periodLedger = ledger.filter(row => inRange(row.date, range.start, range.end));
  const result = registeredBusinessResult({ revenue: currentRevenue, cost: quality.cost, sales, products, payables,
    rmas: input.rmas === undefined ? undefined : intelligenceScope(input.rmas, company, branch), first, last, timeZone: input.timeZone });
  const undatedMovements = ledger.filter(row => !row.date || !localDate(row.date, input.timeZone)).length;
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
    const day = localDate(adminSaleDate(sale), input.timeZone);
    if (day && day <= today && day > (lastPurchase.get(sale.customer_id) ?? '')) lastPurchase.set(sale.customer_id, day);
  }
  const inactive = customers.filter(customer => { const day = lastPurchase.get(customer.id); return day && day <= shiftAdminDay(today, -90); });
  const neverPurchased = customers.filter(customer => !lastPurchase.has(customer.id)).length;
  const overdueInvoices = invoices.filter(invoice => accountBalance(invoice) > 0 && invoice.due_date && invoice.due_date < today);
  const overduePayables = payables.filter(account => accountBalance(account) > 0 && account.due_date < today);
  const branchValues = new Map<string, number>(), productValues = new Map<string, number>();
  let productAnalysisPartial = false;
  for (const [rows, sign] of [[previousSales, 1], [comparisonSales, -1]] as const) for (const sale of rows) {
    const branchId = sale.branch_id ?? '';
    branchValues.set(branchId, (branchValues.get(branchId) ?? 0) + sign * cents(sale.total));
    let sum = 0;
    if (!sale.items?.length) productAnalysisPartial = true;
    for (const item of Array.isArray(sale.items) ? sale.items : []) {
      const value = item.quantity * item.unit_price;
      if (!validAmount(value) || !Number.isFinite(item.quantity) || item.quantity <= 0) { productAnalysisPartial = true; continue; }
      sum += cents(value);
      productValues.set(item.product_id, (productValues.get(item.product_id) ?? 0) + sign * cents(value));
    }
    if (!validAmount(sale.total) || sum !== cents(sale.total)) productAnalysisPartial = true;
  }
  const reductions = (values: Map<string, number>) => [...values].map(([id, value]) => ({ id, reduction: value / 100 })).filter(row => row.reduction > 0).sort((a,b) => b.reduction - a.reduction).slice(0,5);
  const productReductions = reductions(productValues).map(row => ({ ...row, name: products.find(p => p.id === row.id)?.name ?? row.id }));
  const overdue = {
    incoming: overdueInvoices.map(row => ({ id: row.id, name: row.number + ' · ' + row.customer_name, due: row.due_date!, balance: accountBalance(row) })).sort((a,b) => b.balance - a.balance),
    outgoing: overduePayables.map(row => ({ id: row.id, name: row.description + ' · ' + row.creditor_name, due: row.due_date, balance: accountBalance(row) })).sort((a,b) => b.balance - a.balance),
  };
  const alerts: IntelligenceAlert[] = [];
  if (result.result !== null && result.result < 0) alerts.push({ id: 'registered-loss', title: 'Prejuízo estimado nos registros', detail: 'Receitas, devoluções, custos e despesas por vencimento resultaram em valor negativo.', action: 'Confira a composição do resultado e as despesas cadastradas antes de decidir cortes ou preços.', target: 'financeiro', severity: 'critical' });
  if (cashResult !== null && cashResult < 0) alerts.push({ id: 'cash-deficit', title: 'Saídas registradas maiores que entradas', detail: 'O movimento de caixa do período está negativo; isso não é, por si só, prejuízo.', action: 'Confira vencimentos, recebimentos e compras no Financeiro.', target: 'financeiro', severity: 'attention' });
  if (growth !== null && growth <= -20) alerts.push({ id: 'sales', title: 'Queda de faturamento', detail: `${Math.abs(growth).toFixed(1)}% abaixo do intervalo de comparação indicado.`, action: 'Revise os produtos, vendedores e clientes no relatório de vendas.', target: 'relatorios', severity: 'attention' });
  if (comparisonReady && comparisonMargin !== null && previousMargin !== null && previousMargin - comparisonMargin >= 5) alerts.push({ id: 'margin', title: 'Redução de margem bruta estimada', detail: `Queda de ${(previousMargin - comparisonMargin!).toFixed(1)} pontos percentuais; custos antigos podem usar o cadastro atual.`, action: 'Confira custo e composição das vendas antes de rever preços.', target: 'relatorios', severity: 'attention' });
  if (overdueInvoices.length || overduePayables.length) alerts.push({ id: 'overdue', title: 'Contas vencidas', detail: `${overdueInvoices.length} a receber e ${overduePayables.length} a pagar cadastradas.`, action: 'Confira vencimentos e pagamentos antes de priorizar cobranças ou despesas.', target: 'financeiro', severity: 'critical' });
  if (stagnant.count) alerts.push({ id: 'stock', title: 'Estoque sem giro', detail: `${stagnant.count} produto(s) há 30 dias ou mais sem giro; ${stagnant.criticalCount} há 90 dias ou mais.`, action: 'Consulte o relatório Sem giro e avalie a reposição desses itens.', target: 'relatorios', severity: 'attention' });
  if (inactive.length) alerts.push({ id: 'customers', title: 'Clientes sem compra há 90 dias', detail: `${inactive.length} cliente(s) sem compras concluídas ${branch ? 'nesta filial' : 'na empresa'}.`, action: 'Consulte o CRM para planejar retornos. Nenhum contato será enviado automaticamente.', target: 'relatorios', severity: 'attention' });
  return { overdue, productReductions, productAnalysisPartial, branchReductions: branch ? [] : reductions(branchValues), comparisonRevenue,
    comparison: { first, last: input.period === 'month' && comparisonEnd === now ? today : localDate(new Date(comparisonEnd.getTime() - 1).toISOString(), input.timeZone), previousFirst: localDate(range.prevStart.toISOString(), input.timeZone), previousLast: localDate(new Date(range.prevEnd.getTime() - (input.period === 'month' && comparisonEnd === now ? 0 : 1)).toISOString(), input.timeZone), cutoff: input.period === 'month' && comparisonEnd === now ? now.toLocaleTimeString('pt-BR', { timeZone: input.timeZone ?? 'America/Sao_Paulo' }) : null },
    today, first, last, periodError, periodDays, result, cashResult, invalidCashAmounts, missingCashHistory, currentRevenue, previousRevenue, profit, margin, quality, previousQuality, comparisonReady, growth,
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

export type BreakEvenSettings = Record<'aluguel' | 'energia' | 'salarios' | 'impostos' | 'outros', '' | 'fixed' | 'variable'> & { desired: number };

// Caller must confirm completeness of this period before displaying the estimate.
export function registeredBreakEven(data: ReturnType<typeof registeredBusinessResult>, settings: BreakEvenSettings) {
  const fail = (error: string) => ({ error, result: null });
  if (!validAmount(settings.desired) || settings.desired > 1e12) return fail('Informe um resultado desejado válido.');
  if (data.undatedExpenses || data.invalidExpenses || !data.returnsKnown || data.netRevenue === null || data.netCost === null)
    return fail('Existem custos, despesas ou devoluções incompletos. Confira os avisos do resultado após despesas.');
  if (data.netRevenue <= 0) return fail('É necessário ter receita líquida positiva no período para calcular a margem de contribuição.');
  let fixed = 0, variable = 0;
  for (const row of data.categories) {
    fixed += cents(row.fixedAmount ?? 0);
    variable += cents(row.variableAmount ?? 0);
    const unclassified = row.unclassifiedAmount ?? row.amount;
    if (unclassified === 0) continue;
    const kind = settings[row.category as keyof Omit<BreakEvenSettings, 'desired'>];
    if (kind !== 'fixed' && kind !== 'variable') return fail('Classifique todas as categorias com despesas neste período.');
    if (kind === 'fixed') fixed += cents(unclassified); else variable += cents(unclassified);
  }
  const margin = (data.netRevenue - data.netCost - variable / 100) / data.netRevenue;
  if (margin <= 0) return fail('A margem de contribuição é nula ou negativa. Aumentar as vendas mantendo essa margem não cobre os gastos fixos.');
  if (margin > 1 || !Number.isFinite(margin)) return fail('A margem está fora do intervalo esperado. Revise custos e reintegrações de estoque do período.');
  const breakEven = fixed / 100 / margin;
  const requiredRevenue = (fixed / 100 + settings.desired) / margin;
  if (![fixed / 100, variable / 100, breakEven, requiredRevenue].every(validAmount)) return fail('Valores fora do limite de cálculo. Revise os registros.');
  return { error: '', result: { fixed: fixed / 100, variable: variable / 100, margin: margin * 100, breakEven,
    requiredRevenue, remaining: Math.max(0, breakEven - data.netRevenue) } };
}
