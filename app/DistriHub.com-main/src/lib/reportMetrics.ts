import { adminSaleDate, getAdminPeriodRange } from './adminDashboard';
import { salePaymentDescription } from './pdv';
import type { PartnerProduct, PartnerSale } from '../types';

export type SalesRange = '30d' | '90d' | 'all' | 'custom';

export function completedSalesOnly(sales: PartnerSale[]): PartnerSale[] {
  return sales.filter((sale) => sale.status === 'concluida');
}

export function filterReportSales(
  sales: PartnerSale[],
  range: SalesRange,
  startDate: string,
  endDate: string,
  now = new Date(),
  timeZone?: string,
): PartnerSale[] {
  const completed = completedSalesOnly(sales);
  if (range === 'all') return completed;

  if (timeZone && range === 'custom') {
    const bounds = getAdminPeriodRange('custom', startDate, endDate, now, timeZone);
    return bounds.error ? [] : completed.filter(sale => { const time = Date.parse(adminSaleDate(sale)); return time >= +bounds.start && time < +bounds.end; });
  }
  if (range === 'custom') {
    if (!startDate || !endDate) return [];
    const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
    const start = new Date(startYear, startMonth - 1, startDay);
    const end = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(startDate)
      || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
      || !Number.isFinite(start.getTime())
      || !Number.isFinite(end.getTime())
      || start > end
      || start.getFullYear() !== startYear || start.getMonth() !== startMonth - 1 || start.getDate() !== startDay
      || end.getFullYear() !== endYear || end.getMonth() !== endMonth - 1 || end.getDate() !== endDay
    ) return [];
    return completed.filter((sale) => {
      const createdAt = new Date(timeZone ? adminSaleDate(sale) : sale.created_at).getTime();
      return Number.isFinite(createdAt) && createdAt >= start.getTime() && createdAt <= end.getTime();
    });
  }

  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - (range === '30d' ? 30 : 90));
  return completed.filter((sale) => {
    const createdAt = new Date(timeZone ? adminSaleDate(sale) : sale.created_at).getTime();
    return Number.isFinite(createdAt) && createdAt >= cutoff.getTime() && createdAt <= now.getTime();
  });
}

export function isServiceProductId(productId: string, productById: Map<string, PartnerProduct>): boolean {
  const product = productById.get(productId);
  return product ? product.is_service : productId.toLowerCase().includes('svc');
}

export function getItemRevenueByType(
  sales: PartnerSale[],
  products: PartnerProduct[],
) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const totals = {
    productRevenue: 0,
    serviceRevenue: 0,
    productSalesCount: 0,
    serviceSalesCount: 0,
  };

  for (const sale of sales) {
    let hasProduct = false;
    let hasService = false;
    for (const item of Array.isArray(sale.items) ? sale.items : []) {
      const lineTotal = item.unit_price * item.quantity;
      if (!Number.isFinite(lineTotal)) continue;
      if (isServiceProductId(item.product_id, productById)) {
        totals.serviceRevenue += lineTotal;
        hasService = true;
      } else {
        totals.productRevenue += lineTotal;
        hasProduct = true;
      }
    }
    if (hasProduct) totals.productSalesCount += 1;
    if (hasService) totals.serviceSalesCount += 1;
  }

  return totals;
}

export function getCostOfGoodsSold(sales: PartnerSale[], products: PartnerProduct[]): number {
  const productById = new Map(products.map((product) => [product.id, product]));
  return sales.reduce((total, sale) => total + (Array.isArray(sale.items) ? sale.items : []).reduce((saleCost, item) => {
    const product = productById.get(item.product_id);
    const snapshot = sale.cost_snapshot?.[item.product_id];
    if (snapshot != null) return saleCost + Number(snapshot) * item.quantity;
    if (!product || product.is_service) return saleCost;
    return saleCost + (Number(product.cost_price) || 0) * item.quantity;
  }, 0), 0);
}

export function legacyCostSalesCount(sales: PartnerSale[], products: PartnerProduct[]): number {
  const productById = new Map(products.map(product => [product.id, product]));
  return sales.filter(sale => sale.status === 'concluida' && (Array.isArray(sale.items) ? sale.items : []).some(item => !productById.get(item.product_id)?.is_service && sale.cost_snapshot?.[item.product_id] == null)).length;
}

export function birthdayMonth(birthday: string | null | undefined): number | null {
  if (!birthday) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday);
  if (match) {
    const month = Number(match[2]);
    return month >= 1 && month <= 12 ? month - 1 : null;
  }
  const date = new Date(birthday);
  return Number.isNaN(date.getTime()) ? null : date.getMonth();
}

export function buildSalesCsv(sales: PartnerSale[]): string {
  const cell = (value: string | number) => {
    let text = String(value);
    if (typeof value === 'string' && /^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = [
    ['ID da venda', 'Data', 'Cliente', 'Status', 'Pagamento', 'Total (produtos/serviços)', 'Frete terceirizado', 'Total cobrado'],
    ...sales.map((sale) => [
      sale.id,
      sale.created_at,
      sale.customer_name ?? '',
      sale.status,
      salePaymentDescription(sale),
      Number(sale.total).toFixed(2),
      Number(sale.freight_fee ?? 0).toFixed(2),
      ((Math.round(Number(sale.total) * 100) + Math.round(Number(sale.freight_fee ?? 0) * 100)) / 100).toFixed(2),
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(cell).join(';')).join('\r\n')}`;
}
