type ScopedRow = { id: string; user_id: string; branch_id?: string | null; status?: string | null };

export function branchDirectoryRows<T extends { branch_id?: string | null }>(rows: T[], branchId: string | null): T[] {
  return branchId ? rows.filter(row => row.branch_id === branchId) : rows;
}

export const partnerCollections = ['profile', 'branches', 'settings', 'salespeople', 'customers', 'products', 'sales', 'suppliers', 'categories', 'movements', 'rmas', 'combos', 'modifiers', 'invoices', 'orders', 'auditLogs', 'serviceOrders', 'serviceOrderItems', 'serviceOrderPhotos'] as const;
export type PartnerCollection = typeof partnerCollections[number];
const baseCollections: PartnerCollection[] = ['profile', 'branches', 'settings', 'salespeople'];
const moduleCollections: Record<string, PartnerCollection[]> = {
  cadastros: ['products', 'categories', 'suppliers'],
  'cadastros:produtos': ['products', 'categories', 'suppliers'],
  'cadastros:categorias': ['categories'], 'cadastros:fornecedores': ['suppliers'],
  'cadastros:clientes': ['customers'],
  'cadastros:clientes-historico': ['customers', 'sales', 'rmas'], 'cadastros:vendedores': [],
  'cadastros:xml': ['products', 'categories', 'suppliers'],
  'cadastros:importar': ['products', 'categories', 'suppliers', 'customers'],
  'cadastros:combos': ['products', 'combos'], 'cadastros:modificadores': ['modifiers'],
  'cadastros:reposicao': ['products', 'sales'],
  pdv: ['products', 'customers', 'categories', 'combos', 'modifiers'],
  pedidos: ['products', 'customers', 'sales'],
  // Cash RPC returns its own authorized sales and movements; do not gate it
  // on downloading the company's complete customer/sales directories.
  caixa: [], os: ['products', 'customers'],
  rma: ['products', 'customers', 'sales', 'rmas'],
  historico: ['customers', 'orders'],
  suporte: [], 'white-label': [], configuracoes: [],
  entregas: [], fiscal: ['sales', 'products', 'customers'],
  financeiro: ['invoices', 'customers', 'rmas'],
  relatorios: ['sales', 'products', 'customers', 'invoices', 'movements', 'categories'],
  administrativo: ['sales', 'products', 'customers', 'invoices', 'movements', 'categories', 'suppliers', 'rmas', 'combos', 'modifiers', 'auditLogs'],
  'administrativo:dashboard': ['sales', 'products', 'customers', 'movements'],
  'administrativo:inteligencia': ['sales', 'products', 'customers', 'invoices', 'movements', 'categories', 'rmas'],
  'administrativo:financeiro': ['invoices', 'customers', 'rmas', 'suppliers', 'sales', 'products', 'movements'],
  'administrativo:fiscal': ['sales', 'products', 'customers'],
  'administrativo:auditoria': ['sales'],
  'administrativo:gestao-dados': ['products', 'sales', 'customers', 'suppliers', 'categories', 'invoices', 'movements'],
  'relatorios:vendas': ['sales', 'products', 'customers'],
  'relatorios:financeiro': ['sales', 'products', 'customers'],
  'relatorios:estoque': ['products', 'sales', 'customers'],
  'relatorios:sem-giro': ['products', 'sales', 'movements'],
  'relatorios:crm': ['sales', 'products', 'customers', 'invoices'],
};
export function partnerResources(scope: string | null): PartnerCollection[] {
  return scope === null ? [...partnerCollections] : [...new Set([...baseCollections, ...(moduleCollections[scope] ?? [])])];
}

// The product list can open before its supplier editor is ready.
export function partnerRequiredResources(scope: string | null): PartnerCollection[] {
  return partnerResources(scope).filter(key => key !== 'suppliers' || !['cadastros', 'cadastros:produtos'].includes(scope ?? ''));
}

export function withLoadTimeout<T>(loader: () => PromiseLike<T>, message: string, timeoutMs = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(loader), deadline]).finally(() => clearTimeout(timer));
}
export class PartnerLoadCache {
  private scope = '';
  private loaded = new Map<string, number>();
  private pending = new Map<string, Promise<unknown>>();
  private controllers = new Map<string, AbortController>();
  reset(scope: string): boolean {
    if (this.scope === scope) return false;
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.scope = scope; this.loaded.clear(); this.pending.clear(); return true;
  }
  has(key: string): boolean { return this.loaded.has(key); }
  needs(key: string, now = Date.now()): boolean { return !this.loaded.has(key) || now - this.loaded.get(key)! >= 30_000; }
  stale(key: string): void { if (this.loaded.has(key)) this.loaded.set(key, 0); }
  mark(key: string): void { this.loaded.set(key, Date.now()); }
  read<T>(key: string, loader: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const request = withLoadTimeout(() => loader(controller.signal), 'A consulta demorou demais. Tente carregar novamente.').finally(() => {
      controller.abort();
      if (this.controllers.get(key) === controller) this.controllers.delete(key);
    });
    this.pending.set(key, request);
    void request.finally(() => { if (this.pending.get(key) === request) this.pending.delete(key); }).catch(() => {});
    return request;
  }
}

// Share only explicitly requested concurrent reads, never a completed snapshot.
// A post-mutation refresh defaults to fresh and cannot join a pre-mutation read.
export class PartnerReadFlight {
  private pending: { key: string; request: Promise<unknown> } | null = null;
  run<T>(key: string, loader: (signal: AbortSignal) => PromiseLike<T>, reusePending = false): Promise<T> {
    if (reusePending && this.pending?.key === key) return this.pending.request as Promise<T>;
    const controller = new AbortController();
    const request = withLoadTimeout(() => loader(controller.signal), 'A consulta demorou demais. Tente atualizar novamente.')
      .finally(() => { controller.abort(); if (this.pending?.request === request) this.pending = null; });
    this.pending = { key, request };
    return request;
  }
}

// Versions are independent per collection, including local mutations and events.
export class PartnerDataVersions {
  private revision = 0;
  private versions = new Map<string, number>();
  constructor(private readonly keys: string[]) {}
  begin(keys = this.keys): number {
    const revision = ++this.revision;
    for (const key of keys) this.versions.set(key, revision);
    return revision;
  }
  invalidate(keys = this.keys): void { this.begin(keys); }
  isCurrent(revision: number, key: string): boolean { return this.versions.get(key) === revision; }
}

// Realtime DELETE events expose only the primary key under RLS. Remove only
// records that are already known and authorized in the current local scope.
export function mergePartnerChange<T extends ScopedRow>(
  rows: T[], event: string, record: Partial<T>, oldId: unknown,
  companyId: string, branchId: string | null,
  preserveClosedSale = false,
): T[] {
  if (event === 'DELETE') {
    if (typeof oldId !== 'string') return rows;
    if (!rows.some(row => row.id === oldId && row.user_id === companyId && (!branchId || row.branch_id === branchId))) return rows;
    return rows.filter(row => row.id !== oldId || row.user_id !== companyId ||
      (branchId !== null && row.branch_id !== branchId));
  }
  if ((event !== 'INSERT' && event !== 'UPDATE') || typeof record.id !== 'string' || record.user_id !== companyId) return rows;
  if (branchId && record.branch_id !== branchId) return rows;
  const index = rows.findIndex(row => row.id === record.id);
  if (preserveClosedSale && index >= 0) {
    // A queued older Realtime event must not undo a locally confirmed checkout.
    const status = rows[index].status;
    if (status === 'cancelada' && record.status !== 'cancelada') return rows;
    if (status === 'concluida' && (record.status === 'pre_venda' || record.status === 'aberta')) return rows;
  }
  if (index < 0) return [record as T, ...rows];
  return rows.map((row, position) => position === index ? { ...row, ...record } : row);
}
