import type { PartnerProduct, PartnerSale, RmaRequest } from '../types';
import type { PayableAccount } from './accounts';
import { localDate } from './financialFlow';

const amountValid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100));
const cents = (value: number) => Math.round(value * 100);
const day = (value: string | null | undefined, timeZone?: string) => {
  if (!value) return '';
  const result = localDate(value, timeZone);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) && Number.isFinite(Date.parse(result)) && new Date(result).toISOString().slice(0, 10) === result ? result : '';
};
const expenseCategories = new Set(['aluguel', 'energia', 'salarios', 'impostos', 'outros']);

// A managerial estimate based on registered due dates, not an accounting competence ledger.
// Inputs are already filtered by company/branch by buildBusinessIntelligence.
export function registeredBusinessResult({ revenue, cost, sales, products, payables, rmas, first, last, timeZone }: {
  timeZone?: string; revenue: number | null; cost: number | null; sales: PartnerSale[]; products: PartnerProduct[];
  payables: PayableAccount[]; rmas?: RmaRequest[]; first: string; last: string;
}) {
  const inPeriod = (value: string) => value >= first && value <= last;
  const active = payables.filter(account => account.status !== 'cancelada');
  const categories = new Map<string, { amount: number; count: number }>();
  let expenseCents = 0, purchaseCents = 0, expenseCount = 0, purchaseCount = 0;
  let undatedExpenses = 0, invalidExpenses = 0;
  for (const account of active) {
    const date = day(account.due_date);
    if (!date) { undatedExpenses++; continue; }
    if (!inPeriod(date)) continue;
    if (!amountValid(account.amount)) { invalidExpenses++; continue; }
    if (account.category === 'fornecedor') { purchaseCents += cents(account.amount); purchaseCount++; continue; }
    if (!expenseCategories.has(account.category)) { invalidExpenses++; continue; }
    expenseCents += cents(account.amount); expenseCount++;
    const category = categories.get(account.category) ?? { amount: 0, count: 0 };
    category.amount += cents(account.amount); category.count++;
    categories.set(account.category, category);
  }

  const salesById = new Map(sales.map(sale => [sale.id, sale]));
  const productsById = new Map(products.map(product => [product.id, product]));
  const restoredByItem = new Map<string, number>();
  const seen = new Set<string>();
  let returnCents = 0, restoredCostCents = 0, invalidReturns = 0, estimatedReturnCosts = 0, returnCount = 0;
  for (const rma of rmas ?? []) {
    if (seen.has(rma.id)) continue;
    seen.add(rma.id);
    const credit = rma.credit_amount ?? 0, refund = rma.refund_amount ?? 0;
    if (!amountValid(credit) || !amountValid(refund) || (credit > 0 && refund > 0)) { invalidReturns++; continue; }
    const returnAmount = credit || refund;
    const date = day(credit > 0 ? rma.credited_at : rma.refunded_at, timeZone);
    const sale = rma.sale_id ? salesById.get(rma.sale_id) : undefined;
    const index = rma.sale_item_index;
    const item = sale && Number.isInteger(index) && index! >= 0 ? sale.items?.[index!] : undefined;
    const quantity = rma.quantity;
    if (returnAmount > 0 && !date) invalidReturns++;
    if (returnAmount > 0 && date && inPeriod(date)) {
      if (!sale || sale.user_id !== rma.user_id || sale.branch_id !== rma.branch_id || !item || item.product_id !== rma.product_id
        || !Number.isSafeInteger(quantity) || quantity! <= 0 || quantity! > item.quantity || !amountValid(sale.total) || returnAmount > sale.total) invalidReturns++;
      else { returnCents += cents(returnAmount); returnCount++; }
    }

    const restoredAt = day(rma.stock_restored_at, timeZone);
    if (!restoredAt) {
      if (rma.stock_restored_at || rma.status === 'reintegrado_estoque') invalidReturns++;
      continue;
    }
    if (restoredAt > last) continue;
    const key = `${rma.sale_id}:${index}`;
    const accumulated = (restoredByItem.get(key) ?? 0) + (quantity ?? 0);
    if (!sale || sale.user_id !== rma.user_id || sale.branch_id !== rma.branch_id || !item || item.product_id !== rma.product_id || !Number.isSafeInteger(quantity) || quantity! <= 0
      || !Number.isFinite(item.quantity) || accumulated > item.quantity) { invalidReturns++; continue; }
    restoredByItem.set(key, accumulated);
    if (!inPeriod(restoredAt)) continue;
    const product = productsById.get(item.product_id);
    const historical = sale.cost_snapshot?.[item.product_id];
    const unitCost = amountValid(historical) ? historical : product?.is_service ? 0 : product?.cost_price;
    if (!amountValid(unitCost)) { invalidReturns++; continue; }
    if (!amountValid(historical) && !product?.is_service) estimatedReturnCosts++;
    restoredCostCents += cents(unitCost * quantity!);
  }
  const hasExpenseRecords = active.some(account => expenseCategories.has(account.category));
  const expensesKnown = hasExpenseRecords && undatedExpenses === 0 && invalidExpenses === 0;
  const returnsKnown = rmas !== undefined && invalidReturns === 0;
  const returns = returnsKnown ? returnCents / 100 : null;
  const netRevenue = revenue === null || returns === null ? null : (cents(revenue) - returnCents) / 100;
  const netCost = cost === null || !returnsKnown ? null : (cents(cost) - restoredCostCents) / 100;
  const grossAfterReturns = netRevenue === null || netCost === null ? null : (cents(netRevenue) - cents(netCost)) / 100;
  const result = !expensesKnown || grossAfterReturns === null ? null : (cents(grossAfterReturns) - expenseCents) / 100;
  const safeResult = result !== null && Number.isSafeInteger(cents(result)) ? result : null;
  return {
    expenses: expensesKnown ? expenseCents / 100 : null, expenseCount, purchases: purchaseCents / 100, purchaseCount,
    categories: [...categories].map(([category, row]) => ({ category, amount: row.amount / 100, count: row.count })),
    undatedExpenses, invalidExpenses, hasExpenseRecords, returnsKnown, invalidReturns, estimatedReturnCosts,
    returns, returnCount, restoredCost: returnsKnown ? restoredCostCents / 100 : null,
    netRevenue, netCost, grossAfterReturns, result: safeResult,
    margin: safeResult === null || netRevenue === null || netRevenue <= 0 ? null : safeResult / netRevenue * 100,
    status: safeResult === null ? 'incomplete' : safeResult < 0 ? 'loss' : safeResult > 0 ? 'profit' : 'balanced',
  };
}
