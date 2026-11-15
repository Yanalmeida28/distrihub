import type { PartnerProduct, PartnerSale, StockMovement } from '../types';

export type StagnantLevel = 'atencao' | 'alerta' | 'critico';

export interface StagnantProduct {
  product: PartnerProduct;
  lastSaleAt: string | null;
  lastEntryAt: string | null;
  daysWithoutTurnover: number;
  costKnown: boolean;
  unitCost: number;
  tiedUpCapital: number;
  level: StagnantLevel;
}

export interface StagnantSummary {
  items: StagnantProduct[];
  count: number;
  totalUnits: number;
  totalValue: number;
  criticalCount: number;
}

export const STAGNANT_MIN_DAYS = 30;

export const stagnantLevelLabels: Record<StagnantLevel, string> = {
  atencao: 'Atenção (30–59 dias)',
  alerta: 'Alerta (60–89 dias)',
  critico: 'Crítico (90+ dias)',
};

const levelRank: Record<StagnantLevel, number> = { critico: 0, alerta: 1, atencao: 2 };
const DAY_MS = 86_400_000;

export function getStagnantLevel(days: number): StagnantLevel | null {
  if (days >= 90) return 'critico';
  if (days >= 60) return 'alerta';
  if (days >= STAGNANT_MIN_DAYS) return 'atencao';
  return null;
}

/**
 * stock_movements não tem campo estruturado de origem; só `type`, `quantity`, `reason`, `branch_id`.
 * Entradas geradas automaticamente pelo sistema (textos fixos nas RPCs) não são reposição comercial:
 *  - 'Estorno por cancelamento da venda ...' (restauração de estoque ao cancelar venda)
 *  - 'Devolucao RMA #...'                    (devolução/RMA)
 *  - 'Ajuste de estoque por edição do produto' (correção manual no cadastro)
 * Todo o resto de `entrada` ('Cadastro inicial', 'Reposição de estoque' e motivo livre da reposição) conta.
 */
const ADMINISTRATIVE_ENTRY_REASON =
  /^\s*(estorno por cancelamento da venda|devolu[cç][aã]o rma|ajuste de estoque por edi[cç][aã]o do produto)/i;

export function isCommercialEntry(movement: StockMovement): boolean {
  return movement.type === 'entrada' && !ADMINISTRATIVE_ENTRY_REASON.test(movement.reason ?? '');
}

const sameBranch = (a?: string | null, b?: string | null) => (a ?? null) === (b ?? null);

/**
 * Estoque sem giro (somente leitura). Cada produto é avaliado apenas com vendas e
 * reposições da PRÓPRIA filial (`product.branch_id`), para que a filial B não afete a A.
 * Referência = última venda concluída. Para quem nunca vendeu, última entrada
 * comercial ou `created_at` do produto. Reposição não apaga a falta de vendas.
 */
export function computeStagnantStock(
  products: PartnerProduct[],
  sales: PartnerSale[],
  movements: StockMovement[] = [],
  now: Date = new Date(),
): StagnantSummary {
  const eligible = new Map<string, PartnerProduct>();
  for (const product of products) {
    if (!product.is_service && product.stock > 0) eligible.set(product.id, product);
  }

  // A baixa vinculada à venda ocorre na conclusão, inclusive de pré-vendas.
  const saleExits = new Map<string, Map<string, number>>();
  for (const movement of movements) {
    if (movement.type !== 'saida' || movement.quantity <= 0) continue;
    const match = /^\s*sa[ií]da por venda\s+(\S+)\s*$/i.exec(movement.reason ?? '');
    const product = eligible.get(movement.product_id);
    const time = new Date(movement.created_at).getTime();
    if (!match || !product || !sameBranch(movement.branch_id, product.branch_id) || !Number.isFinite(time)) continue;
    const exits = saleExits.get(match[1]) ?? new Map<string, number>();
    exits.set(product.id, Math.max(exits.get(product.id) ?? -Infinity, time));
    saleExits.set(match[1], exits);
  }

  const lastSale = new Map<string, number>();
  for (const sale of sales) {
    if (sale.status !== 'concluida') continue;
    if (!Array.isArray(sale.items)) continue;
    for (const item of sale.items) {
      const product = eligible.get(item.product_id);
      if (!product || !sameBranch(sale.branch_id, product.branch_id)) continue;
      // completed_at é usado no modo local; registros persistidos usam a baixa.
      // Vendas legadas sem baixa vinculada mantêm created_at como aproximação.
      const time = saleExits.get(sale.id)?.get(product.id)
        ?? new Date(sale.completed_at ?? sale.created_at).getTime();
      if (!Number.isFinite(time) || item.quantity <= 0) continue;
      if ((lastSale.get(product.id) ?? -Infinity) < time) lastSale.set(product.id, time);
    }
  }

  const lastEntry = new Map<string, number>();
  for (const movement of movements) {
    if (!isCommercialEntry(movement)) continue;
    const product = eligible.get(movement.product_id);
    if (!product || !sameBranch(movement.branch_id, product.branch_id)) continue;
    const time = new Date(movement.created_at).getTime();
    if (Number.isNaN(time)) continue;
    if ((lastEntry.get(product.id) ?? -Infinity) < time) lastEntry.set(product.id, time);
  }

  const items: StagnantProduct[] = [];
  for (const product of eligible.values()) {
    const saleTime = lastSale.get(product.id);
    const entryTime = lastEntry.get(product.id);
    const referenceTime = saleTime ?? entryTime ?? new Date(product.created_at).getTime();
    if (Number.isNaN(referenceTime)) continue;

    const daysWithoutTurnover = Math.floor((now.getTime() - referenceTime) / DAY_MS);
    const level = getStagnantLevel(daysWithoutTurnover);
    if (!level) continue;

    const costKnown = typeof product.cost_price === 'number' && Number.isFinite(product.cost_price) && product.cost_price >= 0;
    const unitCost = costKnown ? product.cost_price : 0;
    items.push({
      product,
      lastSaleAt: saleTime === undefined ? null : new Date(saleTime).toISOString(),
      lastEntryAt: entryTime === undefined ? null : new Date(entryTime).toISOString(),
      daysWithoutTurnover,
      costKnown,
      unitCost,
      tiedUpCapital: product.stock * unitCost,
      level,
    });
  }

  items.sort((a, b) =>
    levelRank[a.level] - levelRank[b.level]
    || b.tiedUpCapital - a.tiedUpCapital
    || b.daysWithoutTurnover - a.daysWithoutTurnover);

  return {
    items,
    count: items.length,
    totalUnits: items.reduce((sum, item) => sum + item.product.stock, 0),
    totalValue: items.reduce((sum, item) => sum + item.tiedUpCapital, 0),
    criticalCount: items.filter((item) => item.level === 'critico').length,
  };
}
