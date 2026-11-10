import { useCallback, useEffect, useRef, useState } from 'react';
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { InvoicePaymentAttempts, FinancialOperationAttempts, type FinancialRecovery } from '../lib/invoicePayments';
import type { XmlStockImport } from '../lib/cadastroXml';
import { OperationAttempts } from '../lib/operationAttempts';
import type { RmaPhotoFile } from '../components/partner/RmaPhotoUpload';
import { mergePartnerChange, PartnerDataVersions, PartnerLoadCache, PartnerReadFlight, partnerResources, partnerRequiredResources, withLoadTimeout, type PartnerCollection } from '../lib/partnerSync';
import { productFiscalPatch } from '../lib/productPersistence';
import { findProductNameDuplicates } from '../lib/productNames';
import { splitPaymentError, billedSaleError, saleChargeTotal, validSalePrice, isDefinitiveSaleRejection, PdvSaleAttemptStore, PdvCartBackupStore, pdvErrorMessage, type CustomerCredit } from '../lib/pdv';
import type {
  AdminCompany,
  AdminFinancialMonth,
  AdminLojista,
  AuditLog,
  B2BOrder,
  DeliveryOperation,
  PartnerBranch,
  PartnerCategory,
  PartnerCombo,
  PartnerCustomer,
  PartnerIdentity,
  PartnerInvoice,
  PartnerModifier,
  PartnerProduct,
  PartnerProfile,
  PartnerSalesperson,
  PartnerSale,
  SalePayment,
  PartnerSupplier,
  PermissionOverride,
  RmaPayload,
  RmaRequest,
  RmaStatus,
  SalespersonRole,
  ServiceOrder,
  ServiceOrderApprovalStatus,
  ServiceOrderItem,
  ServiceOrderPhoto,
  ServiceOrderStatus,
  StockMovement,
  StoreSettings,
} from '../types';

type SalePayload = Omit<
  PartnerSale,
  | 'id'
  | 'sale_number'
  | 'user_id'
  | 'created_at'
  | 'status'
  | 'origin'
  | 'online_payment'
  | 'payment_status'
  | 'imei'
  | 'serial_number'
  | 'payment_method'
> & {
  status?: PartnerSale['status'];
  origin?: PartnerSale['origin'];
  online_payment?: PartnerSale['online_payment'];
  payment_status?: PartnerSale['payment_status'];
  imei?: string | null;
  serial_number?: string | null;
  payment_method?: string | null;
};

type CustomerPayload = Omit<
  PartnerCustomer,
  'id' | 'user_id' | 'created_at' | 'updated_at'
>;

type ProductPayload = Omit<
  PartnerProduct,
  'id' | 'user_id' | 'created_at' | 'updated_at'
>;

type SupplierPayload = Omit<
  PartnerSupplier,
  | 'id'
  | 'user_id'
  | 'created_at'
  | 'updated_at'
  | 'payable_balance'
>;

type SalespersonPayload = Omit<
  PartnerSalesperson,
  'id' | 'user_id' | 'created_at' | 'updated_at'
>;

type CategoryPayload = Omit<
  PartnerCategory,
  'id' | 'user_id' | 'created_at' | 'updated_at'
>;

type BranchPayload = Omit<
  PartnerBranch,
  'id' | 'user_id' | 'created_at' | 'updated_at'
>;

function normalizeSalespersonEmail(
  email: string | null | undefined,
): string | null {
  const normalized = email?.trim().toLowerCase() ?? '';
  return normalized || null;
}

function formatSalespersonSaveError(error: unknown): Error | unknown {
  if (!error || typeof error !== 'object') {
    return error;
  }

  const candidate = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    constraint?: unknown;
  };
  const text = [
    candidate.message,
    candidate.details,
    candidate.constraint,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');

  if (
    candidate.code === '23505' ||
    text.includes('idx_partner_salespeople_email_unique')
  ) {
    return new Error(
      'Este e-mail já está cadastrado para outro colaborador.',
    );
  }

  return error;
}

interface PartnerDataState {
  profile: PartnerProfile | null;
  branches: PartnerBranch[];
  customers: PartnerCustomer[];
  suppliers: PartnerSupplier[];
  categories: PartnerCategory[];
  products: PartnerProduct[];
  salespeople: PartnerSalesperson[];
  sales: PartnerSale[];
  movements: StockMovement[];
  settings: StoreSettings | null;
  rmas: RmaRequest[];
  combos: PartnerCombo[];
  modifiers: PartnerModifier[];
  invoices: PartnerInvoice[];
  orders: B2BOrder[];
  adminCompanies: AdminCompany[];
  adminLojistas: AdminLojista[];
  financialMonths: AdminFinancialMonth[];
  permissionOverrides: PermissionOverride[];
  auditLogs: AuditLog[];
  serviceOrders: ServiceOrder[];
  serviceOrderItems: ServiceOrderItem[];
  serviceOrderPhotos: ServiceOrderPhoto[];
}

const initialData: PartnerDataState = {
  profile: null,
  branches: [],
  customers: [],
  suppliers: [],
  categories: [],
  products: [],
  salespeople: [],
  sales: [],
  movements: [],
  settings: null,
  rmas: [],
  combos: [],
  modifiers: [],
  invoices: [],
  orders: [],
  adminCompanies: [],
  adminLojistas: [],
  financialMonths: [],
  permissionOverrides: [],
  auditLogs: [],
  serviceOrders: [],
  serviceOrderItems: [],
  serviceOrderPhotos: [],
};

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return new Error(error.message);
  }

  return new Error(String(error));
}

const DATA_PAGE_SIZE = 500;
const PAGE_BATCH = 4;

// Pages are requested in small parallel batches and joined in order, so the
// result is identical to a sequential read but needs far fewer round trips.
async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  signal?: AbortSignal,
): Promise<{ data: T[] | null; error: PostgrestError | null }> {
  const rows: T[] = [];
  const run = (from: number) => {
    const pageQuery = fetchPage(from, from + DATA_PAGE_SIZE - 1);
    const cancellable = pageQuery as typeof pageQuery & { abortSignal?: (signal: AbortSignal) => typeof pageQuery };
    return Promise.resolve(signal && cancellable.abortSignal ? cancellable.abortSignal(signal) : pageQuery);
  };
  // Small tables finish in one request; only full first pages fan out.
  let start = 0;
  let size = 1;
  for (;;) {
    if (signal?.aborted) throw new Error('Consulta cancelada.');
    const results = await Promise.all(Array.from({ length: size }, (_, index) => run(start + index * DATA_PAGE_SIZE)));
    if (signal?.aborted) throw new Error('Consulta cancelada.');
    for (const { data, error } of results) {
      if (error) return { data: null, error };
      const page = data ?? [];
      rows.push(...page);
      if (page.length < DATA_PAGE_SIZE) return { data: rows, error: null };
    }
    start += size * DATA_PAGE_SIZE;
    size = PAGE_BATCH;
  }
}

function isEmployeeIdentity(identity: PartnerIdentity | null): boolean {
  return Boolean(identity?.salespersonId);
}

function ensureEmployeeBranch(
  identity: PartnerIdentity,
  branchId: string | null | undefined,
): void {
  if (!identity.salespersonId) {
    return;
  }

  if (!identity.branchId) {
    throw new Error(
      'Funcionário autenticado não possui uma filial atribuída.',
    );
  }

  if (!branchId || branchId !== identity.branchId) {
    throw new Error(
      'Acesso negado: a operação não pertence à filial vinculada ao seu usuário.',
    );
  }
}

export function usePartnerData(identity: PartnerIdentity | null, syncBranchId: string | null = null, resourceScope: string | null = null) {
  const [financialRevision, setFinancialRevision] = useState(0);
  const financialLocks = useRef(new Set<string>());
  const [data, setData] = useState<PartnerDataState>(initialData);
  const resourceScopeRef = useRef(resourceScope); resourceScopeRef.current = resourceScope;
  const requestedResourcesRef = useRef(partnerResources(resourceScope)); requestedResourcesRef.current = partnerResources(resourceScope);
  const loadCacheRef = useRef(new PartnerLoadCache());
  const prefetchInFlightRef = useRef(false);
  const authorizedPdvScopeRef = useRef('');
  const dataSnapshotRef = useRef(data);
  dataSnapshotRef.current = data;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const syncInFlight = useRef(false);

  const [pdvCredits, setPdvCredits] = useState<CustomerCredit[]>([]);
  const [pdvReturnCredits, setPdvReturnCredits] = useState<RmaRequest[]>([]);
  const [pdvSyncWarning, setPdvSyncWarning] = useState<string | null>(null);
  const [pendingSale, setPendingSale] = useState<PartnerSale | null>(null);
  const saleInFlight = useRef(false);
  const pdvRequestId = useRef(0);
  const pdvReadFlight = useRef(new PartnerReadFlight());
  const identityScope = identity ? identity.authUserId + ':' + identity.companyUserId : '';
  const identityScopeRef = useRef(identityScope);
  identityScopeRef.current = identityScope;
  useEffect(() => {
    setPdvCredits([]);
    setPdvReturnCredits([]);
    setPdvSyncWarning(null);
    ++pdvRequestId.current;
    try {
      setPendingSale(identityScope ? new PdvSaleAttemptStore(window.localStorage, identityScope, sessionStorage).read() : null);
    } catch (err) {
      setPdvSyncWarning(pdvErrorMessage(err));
    }
  }, [identityScope]);

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const dataRevisionRef = useRef(new PartnerDataVersions(Object.keys(initialData)));
  const previousSyncBranchRef = useRef(syncBranchId);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const requireIdentity = useCallback((): PartnerIdentity => {
    if (!identity) {
      throw new Error('Usuário não autenticado.');
    }

    return identity;
  }, [identity]);

  // Garante que existe uma SESSÃO Supabase viva (JWT) antes de uma RPC
  // protegida. O `identity` é apenas estado React e pode existir mesmo sem
  // sessão válida; esta checagem lê a sessão real do client. Não expõe token.
  // Retorna o client Supabase já validado (não-nulo) junto da identity, para
  // que o TypeScript faça o narrowing e a RPC nunca rode sem sessão.
  const requireAuthenticatedSession = useCallback(
    async (): Promise<{ identity: PartnerIdentity; client: NonNullable<typeof supabase> }> => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const { data, error } = await supabase.auth.getSession();
      if (error) {
        throw error;
      }
      if (!data.session || !data.session.user) {
        throw new Error('Sessão expirada. Faça login novamente.');
      }

      return { identity: currentIdentity, client: supabase };
    },
    [requireIdentity],
  );

  const clearData = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }

    dataRevisionRef.current.invalidate();
    setData(initialData);
    setError(null);
  }, []);

  const loadBatch = useCallback(async (collections?: PartnerCollection[], force = true) => {
    // Scope generations isolate identities; per-collection versions order overlapping reads.
    // A prefetch or a tab change must not discard another collection's valid response.
    const currentRequestId = requestIdRef.current;
    const loadScope = identity ? identity.authUserId + ':' + identity.companyUserId + ':' + (identity.salespersonId ?? '') + ':' + (identity.branchId ?? '') : '';
    if (loadCacheRef.current.reset(loadScope)) { clearData(); dataSnapshotRef.current = initialData; authorizedPdvScopeRef.current = ''; setLastSyncedAt(null); setSyncError(null); }
    const requested = new Set((collections ?? requestedResourcesRef.current).filter(key => force || loadCacheRef.current.needs(key)));
    const readRevision = dataRevisionRef.current.begin([...requested]);
    const read = <T,>(key: PartnerCollection, loader: (signal: AbortSignal) => PromiseLike<T>, queryKey: string = key): Promise<T | { data: null; error: null }> =>
      requested.has(key) ? loadCacheRef.current.read(queryKey, signal => {
        const query = loader(signal);
        const cancellable = query as typeof query & { abortSignal?: (signal: AbortSignal) => typeof query };
        return cancellable.abortSignal ? cancellable.abortSignal(signal) : query;
      }) : Promise.resolve({ data: null, error: null });
    if (!requested.size) return null;

    if (!identity) {
      clearData();
      return null;
    }

    if (!isSupabaseConfigured || !supabase) {
      return null;
    }


    try {
      const currentIdentity = requireIdentity();
      const companyUserId = currentIdentity.companyUserId;

      // SELECT explícito e restritivo de colaboradores: somente colunas
      // que existem em producao (a coluna real de ativacao eh `active`;
      // `is_active` nao existe em partner_salespeople). O PIN em texto
      // puro (pin) e o hash (pin_hash) jamais saem do banco para o
      // estado do React. No mapeamento abaixo, is_active eh derivado de
      // `active`.
      // `client` fixa o narrowing de `supabase` (nao-nulo neste ponto).
      const client = supabase;
      const fetchSalespeople = () =>
        client
          .from('partner_salespeople')
          .select(
            'id, user_id, auth_user_id, name, role, commission_rate, phone, email, active, branch_id, created_at, blocked_modules, can_access_all_branches, can_edit_sale_price',
          )
          .eq('user_id', companyUserId)
          .order('name');

      // Consultas essenciais: qualquer falha bloqueia o carregamento,
      // pois o painel não funciona sem elas.
      const essentialReads = Promise.all([
        read('profile', () => client
  .from('partner_profiles')
  .select('*')
  .eq('id', companyUserId)
  .maybeSingle()),

read('branches', (signal) => fetchAllPages((from, to) => client
  .from('partner_branches')
  .select('*')
  .eq('user_id', companyUserId)
  .order('name')
  .order('id')
  .range(from, to), signal)),

read('customers', (signal) => fetchAllPages((from, to) => client
  .from('partner_customers')
  .select('*')
  .eq('user_id', companyUserId)
  .order('name')
  .order('id')
  .range(from, to), signal)),

read('products', (signal) => fetchAllPages((from, to) => client
  .from('partner_products')
  .select('*')
  .eq('user_id', companyUserId)
  .order('name')
  .order('id')
  .range(from, to), signal)),

read('salespeople', (signal) => fetchAllPages((from, to) => fetchSalespeople().range(from, to), signal)),

read('sales', (signal) => fetchAllPages((from, to) => client
  .from('partner_sales')
  .select('*')
  .eq('user_id', companyUserId)
  .order('created_at', { ascending: false })
  .order('id', { ascending: false })
  .range(from, to), signal)),
      ]);

      // Consultas secundárias: falham individualmente sem derrubar o
      // carregamento; cada uma assume fallback seguro ([], null).
      const secondaryReads = Promise.all([
        read('suppliers', (signal) => fetchAllPages((from, to) => client
          .from('partner_suppliers')
          .select('*')
          .eq('user_id', companyUserId)
          .order('name').order('id').range(from, to), signal)),

        read('categories', (signal) => fetchAllPages((from, to) => client
          .from('partner_categories')
          .select('*')
          .eq('user_id', companyUserId)
          .order('name').order('id').range(from, to), signal)),

        read('movements', (signal) => fetchAllPages((from, to) => client
          .from('partner_stock_movements')
          .select('*')
          .eq('user_id', companyUserId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }).range(from, to), signal)),

        read('settings', () => client
          .from('partner_store_settings')
          .select('*')
          .eq('user_id', companyUserId)
          .maybeSingle()),

        read('rmas', (signal) => fetchAllPages((from, to) => client
          .from('rma_requests_v2')
          .select('*')
          .eq('user_id', companyUserId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }).range(from, to), signal)),

        read('combos', (signal) => fetchAllPages((from, to) => client
          .from('partner_combos')
          .select('*')
          .eq('user_id', companyUserId)
          .order('name').order('id').range(from, to), signal)),

        read('modifiers', (signal) => fetchAllPages((from, to) => client
          .from('partner_modifiers')
          .select('*')
          .eq('user_id', companyUserId)
          .order('name').order('id').range(from, to), signal)),

        read('invoices', (signal) => {
          const employeeScope = currentIdentity.authUserId + ':' + currentIdentity.companyUserId;
          if (resourceScopeRef.current !== null && currentIdentity.salespersonId && currentIdentity.branchId && authorizedPdvScopeRef.current === employeeScope) {
            return Promise.resolve(client.rpc('get_partner_pdv_snapshot', { p_branch_id: currentIdentity.branchId })).then(({ data: snapshot, error }) => {
              if (error) return { data: null, error };
              if (!snapshot || !Array.isArray(snapshot.invoices) || !Array.isArray(snapshot.credits)) return { data: null, error: { name: 'PostgrestError', code: 'INVALID_SNAPSHOT', message: 'Invalid authorized invoice snapshot', details: '', hint: '' } };
              if (mountedRef.current && identityScopeRef.current === employeeScope && dataRevisionRef.current.isCurrent(readRevision, 'invoices')) setPdvCredits(snapshot.credits);
              return { data: snapshot.invoices as PartnerInvoice[], error: null };
            });
          }
          return fetchAllPages((from, to) => client
          .from('partner_invoices')
          .select('*')
          .eq('user_id', companyUserId)
          .order('due_date').order('id').range(from, to), signal);
        }),

        read('orders', (signal) => fetchAllPages((from, to) => client
          .from('b2b_orders')
          .select('*')
          .eq('user_id', companyUserId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }).range(from, to), signal)),

        read('auditLogs', (signal) => fetchAllPages((from, to) => client
          .from('partner_audit_logs')
          .select('*')
          .eq('user_id', companyUserId)
          .gte('created_at', new Date(Date.now() - 90 * 86_400_000).toISOString())
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }).range(from, to), signal)),

        read('serviceOrders', (signal) => fetchAllPages((from, to) => client
          .from('service_orders')
          .select('*')
          .eq('user_id', companyUserId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }).range(from, to), signal)),

        read('serviceOrderItems', (signal) => fetchAllPages((from, to) => client
          .from('service_order_items')
          .select('*')
          .eq('user_id', companyUserId)
          .range(from, to), signal)),

        read('serviceOrderPhotos', (signal) => fetchAllPages((from, to) => client
          .from('service_order_photos')
          .select('*')
          .eq('user_id', companyUserId)
          .order('created_at')
          .order('id').range(from, to), signal)),
        read('rmas', (signal) => fetchAllPages((from, to) => client
          .from('partner_rma_credit_applications')
          .select('id,rma_id,amount')
          .eq('user_id', companyUserId)
          .order('id').range(from, to), signal), 'rmaCreditApplications'),
      ]);

      const [essentialData, secondaryData] = await Promise.all([essentialReads, secondaryReads]);
      const [
        profileResult,
        branchesResult,
        customersResult,
        productsResult,
        salespeopleResult,
        salesResult,
      ] = essentialData;
      const [
        suppliersResult,
        categoriesResult,
        movementsResult,
        settingsResult,
        rmasResult,
        combosResult,
        modifiersResult,
        invoicesResult,
        ordersResult,
        auditLogsResult,
        serviceOrdersResult,
        serviceOrderItemsResult,
        serviceOrderPhotosResult,
        rmaCreditApplicationsResult,
      ] = secondaryData;
      const essentialResults = [
        ['partner_profiles', profileResult],
        ['partner_branches', branchesResult],
        ['partner_customers', customersResult],
        ['partner_products', productsResult],
        ['partner_salespeople', salespeopleResult],
        ['partner_sales', salesResult],
      ] as const;

      const essentialError = essentialResults.find(
        ([, result]) => result.error,
      );

      if (essentialError?.[1].error) {
        throw essentialError[1].error;
      }

      // Diagnóstico técnico de falhas secundárias — sem PIN, tokens
      // ou dados de linhas; apenas nome da consulta e mensagem de erro.
      const secondaryResults = [
        ['partner_rma_credit_applications', rmaCreditApplicationsResult],
        ['partner_suppliers', suppliersResult],
        ['partner_categories', categoriesResult],
        ['partner_stock_movements', movementsResult],
        ['partner_store_settings', settingsResult],
        ['rma_requests_v2', rmasResult],
        ['partner_combos', combosResult],
        ['partner_modifiers', modifiersResult],
        ['partner_invoices', invoicesResult],
        ['b2b_orders', ordersResult],
        ['partner_audit_logs', auditLogsResult],
        ['service_orders', serviceOrdersResult],
        ['service_order_items', serviceOrderItemsResult],
        ['service_order_photos', serviceOrderPhotosResult],
      ] as const;

      for (const [queryName, result] of secondaryResults) {
        if (result.error) {
          console.warn(
            `[usePartnerData] Falha na consulta secundária "${queryName}":`,
            result.error.message,
          );
        }
      }

      if (
        !mountedRef.current ||
        currentRequestId !== requestIdRef.current
      ) {
        return;
      }

      const branchId = currentIdentity.branchId;

      // includeCompanyWide: clientes e vendedores com branch_id null são
      // registros company-wide válidos e devem ser preservados; produtos,
      // vendas e estoque seguem com filtro estrito de filial.
      const filterBranch = <T extends { branch_id?: string | null; can_access_all_branches?: boolean }>(
        rows: T[] | null,
        includeCompanyWide = false,
      ): T[] => {
        const values = rows ?? [];

        if (!currentIdentity.salespersonId) {
          return values;
        }

        return values.filter(
          (row) =>
            (includeCompanyWide && (row.branch_id == null || row.can_access_all_branches === true)) ||
            row.branch_id === branchId,
        );
      };

      for (const [table, result] of [...essentialResults, ...secondaryResults]) {
        const key = ({ partner_profiles: 'profile', partner_branches: 'branches', partner_customers: 'customers', partner_products: 'products', partner_salespeople: 'salespeople', partner_sales: 'sales', partner_suppliers: 'suppliers', partner_categories: 'categories', partner_stock_movements: 'movements', partner_store_settings: 'settings', rma_requests_v2: 'rmas', partner_combos: 'combos', partner_modifiers: 'modifiers', partner_invoices: 'invoices', b2b_orders: 'orders', partner_audit_logs: 'auditLogs', service_orders: 'serviceOrders', service_order_items: 'serviceOrderItems', service_order_photos: 'serviceOrderPhotos', partner_rma_credit_applications: 'rmas' } as Record<string, PartnerCollection>)[table];
        if (requested.has(key) && !result.error && dataRevisionRef.current.isCurrent(readRevision, key) && !(key === 'rmas' && (rmasResult.error || rmaCreditApplicationsResult.error))) loadCacheRef.current.mark(key);
      }
      setData((previous) => {
        const snapshot: PartnerDataState = {
        profile:
          (profileResult.data as PartnerProfile | null) ?? null,
        branches:
          ((branchesResult.data as PartnerBranch[] | null) ?? []).filter(branch =>
            !currentIdentity.salespersonId || branch.id === currentIdentity.branchId),
        customers: filterBranch(
          customersResult.data as PartnerCustomer[] | null,
          true,
        ),
        suppliers:
          (suppliersResult.data as PartnerSupplier[] | null) ?? [],
        categories:
          (categoriesResult.data as PartnerCategory[] | null) ?? [],
        products: filterBranch(
          productsResult.data as PartnerProduct[] | null,
        ),
        salespeople: filterBranch(
          (
            (salespeopleResult.data as PartnerSalesperson[] | null) ?? []
          ).map((sp) => ({
            ...sp,
            // partner_salespeople nao possui is_active; deriva de active.
            is_active: sp.active ?? true,
          })),
          true,
        ),
        sales: filterBranch(
          salesResult.data as PartnerSale[] | null,
        ),
        movements: filterBranch(
          movementsResult.data as StockMovement[] | null,
        ),
        settings:
          (settingsResult.data as StoreSettings | null) ?? null,
        rmas: filterBranch(
          ((rmasResult.data as RmaRequest[] | null) ?? []).map(rma => ({
            ...rma,
            credit_used_amount: rmaCreditApplicationsResult.error ? null :
              ((rmaCreditApplicationsResult.data as { rma_id: string; amount: number }[] | null) ?? [])
                .filter(application => application.rma_id === rma.id)
                .reduce((sum, application) => sum + Math.round(Number(application.amount) * 100), 0) / 100,
          })),
        ),
        combos:
          (combosResult.data as PartnerCombo[] | null) ?? [],
        modifiers:
          (modifiersResult.data as PartnerModifier[] | null) ?? [],
        invoices: filterBranch(
          invoicesResult.data as PartnerInvoice[] | null,
        ),
        orders: filterBranch(
          ordersResult.data as B2BOrder[] | null,
        ),
        adminCompanies: [],
        adminLojistas: [],
        financialMonths: [],
        permissionOverrides: [],
        auditLogs:
          (auditLogsResult.data as AuditLog[] | null) ?? [],
        serviceOrders: filterBranch(
          serviceOrdersResult.data as ServiceOrder[] | null,
        ),
        serviceOrderItems:
          (serviceOrderItemsResult.data as ServiceOrderItem[] | null) ??
          [],
        serviceOrderPhotos:
          (serviceOrderPhotosResult.data as ServiceOrderPhoto[] | null) ??
          [],
        };
        // A PDV read, local mutation or Realtime event may have superseded this read.
        for (const key of Object.keys(initialData) as Array<keyof PartnerDataState>) {
          if (!requested.has(key as PartnerCollection) || !dataRevisionRef.current.isCurrent(readRevision, key)) {
            Object.assign(snapshot, { [key]: previous[key] });
          }
        }
        const secondaryCollections = {
          partner_suppliers: 'suppliers', partner_categories: 'categories', partner_stock_movements: 'movements',
          partner_store_settings: 'settings', rma_requests_v2: 'rmas', partner_combos: 'combos',
          partner_modifiers: 'modifiers', partner_invoices: 'invoices', b2b_orders: 'orders',
          partner_audit_logs: 'auditLogs', service_orders: 'serviceOrders',
          service_order_items: 'serviceOrderItems', service_order_photos: 'serviceOrderPhotos',
        } as const;
        for (const [table, result] of secondaryResults) {
          if (table === 'partner_rma_credit_applications') continue;
          if (result.error) {
            const key = secondaryCollections[table];
            Object.assign(snapshot, { [key]: previous[key] });
          }
        }
        if (rmaCreditApplicationsResult.error) {
          snapshot.rmas = snapshot.rmas.map(rma => ({ ...rma, credit_used_amount: null }));
        }
        return snapshot;
      });
      return secondaryResults.some(([, result]) => result.error)
        ? 'Alguns módulos não foram atualizados. Os dados anteriores foram preservados; tente sincronizar novamente.'
        : null;
    } catch (err) {
      if (!mountedRef.current || currentRequestId !== requestIdRef.current) return null;
      return normalizeError(err).message;
    }
  }, [clearData, identity, requireIdentity]);

  const loadData = useCallback(async (background = false, collections?: PartnerCollection[], force = true) => {
    const generation = requestIdRef.current;
    const activeScope = resourceScopeRef.current;
    const keys = collections ?? requestedResourcesRef.current;
    const ready = () => partnerRequiredResources(resourceScopeRef.current).every(key => loadCacheRef.current.has(key));
    if (!background) setError(null);
    setLoading(!ready() && !background);
    const results = await Promise.all(keys.map(async key => {
      let failure = await loadBatch([key], force);
      const needsRecovery = () => Boolean(identityScopeRef.current) && mountedRef.current && generation === requestIdRef.current
        && activeScope === resourceScopeRef.current
        && partnerRequiredResources(activeScope).includes(key) && !loadCacheRef.current.has(key);
      // Realtime or a newer authorized snapshot can invalidate an initial read.
      // Discarding that response is correct, but it must not leave an unloaded
      // collection behind a permanent spinner. Retry only that read, once.
      if (!failure && needsRecovery()) failure = await loadBatch([key], true);
      if (!failure && needsRecovery()) failure = 'Os dados mudaram durante o carregamento. Tente carregar novamente.';
      if (mountedRef.current && generation === requestIdRef.current && ready()) setLoading(false);
      return failure;
    }));
    if (!mountedRef.current || generation !== requestIdRef.current) return false;
    const failure = results.find((result): result is string => typeof result === 'string');
    if (activeScope !== resourceScopeRef.current) return !failure;
    if (background) setSyncError(failure ?? null);
    else { setError(failure ?? null); setSyncError(failure ?? null); }
    if (!failure) setLastSyncedAt(new Date());
    setLoading(false);
    return !failure;
  }, [loadBatch]);

  useEffect(() => {
    const alreadyLoaded = requestedResourcesRef.current.every(key => loadCacheRef.current.has(key));
    void loadData(alreadyLoaded, undefined, false);
  }, [loadData, resourceScope]);

  useEffect(() => {
    if (previousSyncBranchRef.current === syncBranchId) return;
    previousSyncBranchRef.current = syncBranchId;
    if (identity && requestedResourcesRef.current.includes('products')) {
      void loadData(true, ['products']);
    }
  }, [identity, loadData, syncBranchId]);

  useEffect(() => {
    const requests = requestIdRef;
    const revisions = dataRevisionRef;
    return () => { ++requests.current; revisions.current.invalidate(); };
  }, [loadData]);

  useEffect(() => {
    const profileId = identity?.companyUserId;
    if (!profileId || !isSupabaseConfigured || !supabase) return;

    const client = supabase;
    let active = true;
    const refreshProfile = async () => {
      const { data: profile, error: profileError } = await client
        .from('partner_profiles')
        .select('*')
        .eq('id', profileId)
        .maybeSingle();
      if (!active) return;
      if (profileError) {
        setError(profileError.message);
        return;
      }
      if (profile) {
        dataRevisionRef.current.invalidate(["profile"]);
        setData((previous) => ({ ...previous, profile: profile as PartnerProfile }));
      }
    };
    const channel = client
      .channel(`partner-profile-${profileId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'partner_profiles', filter: `id=eq.${profileId}` },
        (payload) => {
          const updatedProfile = payload.new as PartnerProfile;
          if (updatedProfile.id === profileId) {
            dataRevisionRef.current.invalidate(["profile"]);
            setData((previous) => ({ ...previous, profile: updatedProfile }));
          }
        },
      )
      .subscribe();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshProfile();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      active = false;
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      void client.removeChannel(channel);
    };
  }, [identity?.companyUserId]);

  const addCustomer = useCallback(
    async (
      customer: CustomerPayload,
      operatorId?: string | null,
      operatorPin?: string | null,
    ) => {
      const { identity: currentIdentity, client } =
        await requireAuthenticatedSession();

      ensureEmployeeBranch(
        currentIdentity,
        customer.branch_id,
      );

      // Operador que autoriza a operação (fluxo A: id + PIN do modal).
      // Quando não informado, envia null para que a RPC resolva o
      // operador pelo auth.uid() da sessão (fluxo B). Nunca enviar o id
      // da sessão com PIN nulo: a RPC exige PIN válido nesse caso.
      const effectiveOperatorId = operatorId ?? null;
      const effectiveOperatorPin = operatorPin ?? null;

      const { data: created, error: rpcError } =
        await client.rpc(
          'execute_partner_customer_mutation',
          {
            p_salesperson_id: effectiveOperatorId,
            p_pin: effectiveOperatorPin,
            p_customer_id: null,
            p_branch_id: customer.branch_id ?? null,
            p_name: customer.name,
            p_document: customer.document ?? null,
            p_phone: customer.phone ?? null,
            p_email: customer.email ?? null,
            p_birthday: customer.birthday ?? null,
            p_address: customer.address ?? null,
            p_neighborhood: customer.neighborhood ?? null,
            p_city: customer.city ?? null,
            p_device_model: customer.device_model ?? null,
            p_notes: customer.notes ?? null,
            p_customer_type: customer.customer_type ?? 'varejo',
            p_credit_limit: customer.credit_limit ?? 0,
            p_allow_credit: customer.allow_credit ?? false,
          },
        );

      if (rpcError) {
        throw rpcError;
      }

      // A RPC retorna o id (uuid) do cliente, não a linha completa.
      const createdCustomer: PartnerCustomer = {
        ...customer,
        id:
          (created as string | null) ??
          crypto.randomUUID(),
        user_id: currentIdentity.companyUserId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      dataRevisionRef.current.invalidate(["customers"]);
      setData((prev) => ({
        ...prev,
        customers: [
          createdCustomer,
          ...prev.customers.filter(
            (item) => item.id !== createdCustomer.id,
          ),
        ],
      }));

      return createdCustomer;
    },
    [requireAuthenticatedSession],
  );

  const customerPhotoPaths = useRef(new WeakMap<File, string>());
  const updateCustomer = useCallback(
    async (id: string, customer: Partial<CustomerPayload> & { photo_file?: File | null; remove_photo?: boolean }, operatorId?: string | null, operatorPin?: string | null) => {
      const { identity: currentIdentity, client } = await requireAuthenticatedSession();
      const existing = data.customers.find(item => item.id === id);
      if (!existing) throw new Error('Cliente não encontrado.');
      ensureEmployeeBranch(currentIdentity, existing.branch_id);
      const { photo_file: file, remove_photo: remove, ...fields } = customer;
      if (file) {
        if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('Use uma foto JPG, PNG ou WebP de até 2 MB.');
        const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
        const photoPath = customerPhotoPaths.current.get(file) ?? currentIdentity.authUserId + '/' + id + '/' + crypto.randomUUID() + '.' + extension;
        customerPhotoPaths.current.set(file, photoPath);
        const { error } = await client.storage.from('customer-photos').upload(photoPath, file, { upsert: true, contentType: file.type });
        if (error) throw error;
        fields.photo_url = photoPath;
      } else if (remove) fields.photo_url = null;
      // Undefined means preserve; explicit null clears nullable fields.
      const { data: saved, error } = await client.rpc('update_partner_customer_profile', {
        p_customer_id: id, p_fields: fields, p_operator_id: operatorId ?? null, p_operator_pin: operatorPin ?? null,
        p_branch_id: existing.branch_id ?? syncBranchId ?? currentIdentity.branchId ?? null,
      });
      if (error) throw error;
      if (!saved || saved.id !== id) throw new Error('O banco não confirmou o salvamento do cliente.');
      const updatedCustomer = saved as PartnerCustomer;
      if (file) customerPhotoPaths.current.delete(file);
      dataRevisionRef.current.invalidate(['customers']);
      setData(previous => ({ ...previous, customers: previous.customers.map(item => item.id === id ? updatedCustomer : item) }));
      return updatedCustomer;
    }, [data.customers, requireAuthenticatedSession, syncBranchId],
  );

  const importStockXml = useCallback(async (invoice: XmlStockImport, branchId: string, operatorId?: string | null, operatorPin?: string | null) => {
    const { identity: currentIdentity, client } = await requireAuthenticatedSession();
    ensureEmployeeBranch(currentIdentity, branchId);
    const { error } = await client.rpc('import_partner_stock_xml', {
      p_branch_id: branchId, p_invoice: invoice, p_operator_id: operatorId ?? null, p_operator_pin: operatorPin ?? null,
    });
    if (error) throw error;
    dataRevisionRef.current.invalidate(['products','suppliers','movements']);
    await loadData(true, ['products','suppliers','movements']);
  }, [requireAuthenticatedSession, loadData]);

  const deleteCustomer = useCallback(
    async (
      id: string,
      operatorId?: string | null,
      operatorPin?: string | null,
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const existing = data.customers.find(
        (item) => item.id === id,
      );

      if (!existing) {
        throw new Error('Cliente não encontrado.');
      }

      ensureEmployeeBranch(
        currentIdentity,
        existing.branch_id,
      );

      // Mesma regra de operador: id + PIN do modal ou null (auth.uid()).
      const effectiveOperatorId = operatorId ?? null;
      const effectiveOperatorPin = operatorPin ?? null;

      const { error: rpcError } = await supabase.rpc(
        'execute_partner_customer_delete',
        {
          p_salesperson_id: effectiveOperatorId,
          p_pin: effectiveOperatorPin,
          p_customer_id: id,
        },
      );

      if (rpcError) {
        throw rpcError;
      }

      dataRevisionRef.current.invalidate(["customers"]);
      setData((prev) => ({
        ...prev,
        customers: prev.customers.filter(
          (item) => item.id !== id,
        ),
      }));
    },
    [data.customers, requireIdentity],
  );

  const addProduct = useCallback(
    async (
      product: ProductPayload,
      operatorId?: string | null,
      operatorPin?: string | null,
    ) => {
      const { identity: currentIdentity, client } =
        await requireAuthenticatedSession();

      ensureEmployeeBranch(
        currentIdentity,
        product.branch_id,
      );

      // Mesma regra de operador: id + PIN do modal ou null (auth.uid()).
      const effectiveOperatorId = operatorId ?? null;
      const effectiveOperatorPin = operatorPin ?? null;

      const { data: created, error: rpcError } =
        await client.rpc(
          'save_partner_product_profile',
          {
            p_salesperson_id: effectiveOperatorId,
            p_pin: effectiveOperatorPin,
            p_product_id: null,
            p_fiscal: productFiscalPatch(product),
            p_branch_id: product.branch_id ?? null,
            p_name: product.name,
            p_cost_price: product.cost_price,
            p_sale_price: product.sale_price,
            p_wholesale_price: product.wholesale_price,
            p_stock: product.stock,
            p_min_stock: product.min_stock,
            p_category: product.category,
            p_sku: product.sku,
            p_barcode: product.barcode?.trim() || null,
            p_is_service: product.is_service,
            p_image_url: product.image_url ?? null,
            p_supplier_id: product.supplier_id ?? null,
            p_premium_price: product.premium_price ?? null,
          },
        );

      if (rpcError) {
        throw rpcError;
      }

      if (!created || typeof created.id !== 'string' || created.user_id !== currentIdentity.companyUserId) {
        throw new Error('O servidor não confirmou o cadastro do produto. Mantenha os dados abertos e tente novamente.');
      }
      const createdProduct = created as PartnerProduct;

      dataRevisionRef.current.invalidate(["products"]);
      setData((prev) => ({
        ...prev,
        products: [
          createdProduct,
          ...prev.products.filter(
            (item) => item.id !== createdProduct.id,
          ),
        ],
      }));

      return createdProduct;
    },
    [requireAuthenticatedSession],
  );

  const findProductDuplicates = useCallback(
    async (name: string, branchId: string): Promise<PartnerProduct[]> => {
      const { identity: currentIdentity, client } = await requireAuthenticatedSession();
      if (!branchId) throw new Error('Selecione uma filial para verificar produtos semelhantes.');
      ensureEmployeeBranch(currentIdentity, branchId);
      const { data: rows, error: readError } = await withLoadTimeout(
        () => fetchAllPages((from, to) => client
          .from('partner_products')
          .select('*')
          .eq('user_id', currentIdentity.companyUserId)
          .eq('branch_id', branchId)
          .order('name')
          .order('id')
          .range(from, to)),
        'A verificação de produtos semelhantes demorou demais. Sincronize e tente novamente.',
      );
      if (readError) throw readError;
      if (!rows) throw new Error('Não foi possível verificar produtos semelhantes. Tente novamente.');
      return findProductNameDuplicates(
        rows as PartnerProduct[],
        name,
        currentIdentity.companyUserId,
        branchId,
      );
    },
    [requireAuthenticatedSession],
  );

  const updateProduct = useCallback(
    async (
      id: string,
      product: Partial<ProductPayload>,
      operatorId?: string | null,
      operatorPin?: string | null,
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const existing = data.products.find(
        (item) => item.id === id,
      );

      if (!existing) {
        throw new Error('Produto não encontrado.');
      }

      ensureEmployeeBranch(
        currentIdentity,
        product.branch_id ?? existing.branch_id,
      );

      // Mesma regra de operador: id + PIN do modal ou null (auth.uid()).
      const effectiveOperatorId = operatorId ?? null;
      const effectiveOperatorPin = operatorPin ?? null;

      const { data: savedProduct, error: rpcError } =
        await supabase.rpc(
          'save_partner_product_profile',
          {
            p_salesperson_id: effectiveOperatorId,
            p_pin: effectiveOperatorPin,
            p_product_id: id,
            p_fiscal: productFiscalPatch(product),
            p_branch_id:
              product.branch_id ?? existing.branch_id ?? null,
            p_name: product.name ?? existing.name,
            p_cost_price:
              product.cost_price ?? existing.cost_price,
            p_sale_price:
              product.sale_price ?? existing.sale_price,
            p_wholesale_price:
              product.wholesale_price ??
              existing.wholesale_price,
            p_stock: product.stock ?? existing.stock,
            p_min_stock:
              product.min_stock ?? existing.min_stock,
            p_category:
              product.category ?? existing.category,
            p_sku: product.sku ?? existing.sku,
            p_barcode: product.barcode === undefined ? existing.barcode ?? null : product.barcode?.trim() || null,
            p_is_service:
              product.is_service ?? existing.is_service,
            p_image_url:
              product.image_url === undefined ? existing.image_url ?? null : product.image_url,
            p_supplier_id: product.supplier_id === undefined ? existing.supplier_id ?? null : product.supplier_id,
            p_premium_price: product.premium_price === undefined ? existing.premium_price ?? null : product.premium_price,
          },
        );

      if (rpcError) {
        throw rpcError;
      }

      if (!savedProduct || savedProduct.id !== id || savedProduct.user_id !== currentIdentity.companyUserId) {
        throw new Error('O servidor não confirmou o produto. Mantenha o cadastro aberto e tente salvar novamente.');
      }
      if (product.image_url !== undefined && (savedProduct.image_url ?? null) !== (product.image_url ?? null)) {
        throw new Error('Não foi possível confirmar a foto salva. Mantenha o cadastro aberto e tente novamente.');
      }
      const updatedProduct = savedProduct as PartnerProduct;

      dataRevisionRef.current.invalidate(["products"]);
      setData((prev) => ({
        ...prev,
        products: prev.products.map((item) =>
          item.id === id ? updatedProduct : item,
        ),
      }));

      return updatedProduct;
    },
    [data.products, requireIdentity],
  );

  const deleteProduct = useCallback(
    async (
      id: string,
      operatorId?: string | null,
      operatorPin?: string | null,
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const existing = data.products.find(
        (item) => item.id === id,
      );

      if (!existing) {
        throw new Error('Produto não encontrado.');
      }

      ensureEmployeeBranch(
        currentIdentity,
        existing.branch_id,
      );

      // Mesma regra de operador: id + PIN do modal ou null (auth.uid()).
      const effectiveOperatorId = operatorId ?? null;
      const effectiveOperatorPin = operatorPin ?? null;

      const { error: rpcError } = await supabase.rpc(
        'execute_partner_product_delete',
        {
          p_salesperson_id: effectiveOperatorId,
          p_pin: effectiveOperatorPin,
          p_product_id: id,
        },
      );

      if (rpcError) {
        throw rpcError;
      }

      dataRevisionRef.current.invalidate(["products"]);
      setData((prev) => ({
        ...prev,
        products: prev.products.filter(
          (item) => item.id !== id,
        ),
      }));
    },
    [data.products, requireIdentity],
  );

  const saveBranchSupplier = useCallback(async (id: string | null, changes: Partial<SupplierPayload>, remove: boolean, operatorId?: string | null, operatorPin?: string | null) => {
    const currentIdentity = requireIdentity();
    if (!supabase) throw new Error('Supabase indisponivel.');
    const existing = id ? data.suppliers.find(item => item.id === id) : undefined;
    if (id && !existing) throw new Error('Fornecedor nao encontrado.');
    const branchId = changes.branch_id ?? existing?.branch_id ?? syncBranchId ?? currentIdentity.branchId;
    if (!branchId) throw new Error('Selecione uma filial antes de salvar o fornecedor.');
    if (syncBranchId && branchId !== syncBranchId) throw new Error('Fornecedor pertence a outra filial.');
    ensureEmployeeBranch(currentIdentity, branchId);
    const value = { ...existing, ...changes };
    const { data: saved, error } = await supabase.rpc('mutate_partner_branch_supplier', {
      p_branch_id: branchId, p_supplier_id: id, p_name: value.name ?? null, p_phone: value.phone ?? null,
      p_notes: value.notes ?? null, p_document: value.document ?? null, p_delete: remove,
      p_operator_id: operatorId ?? null, p_operator_pin: operatorPin ?? null,
    });
    if (error) throw error;
    if (!saved || saved.user_id !== currentIdentity.companyUserId || (!remove && saved.branch_id !== branchId) || (id && saved.id !== id)) throw new Error('Fornecedor nao confirmado pelo servidor.');
    if (identityScopeRef.current !== currentIdentity.authUserId + ':' + currentIdentity.companyUserId) return saved as PartnerSupplier;
    dataRevisionRef.current.invalidate(['suppliers']);
    setData(previous => ({ ...previous, suppliers: remove ? previous.suppliers.filter(item => item.id !== id) : [saved as PartnerSupplier, ...previous.suppliers.filter(item => item.id !== saved.id)] }));
    return saved as PartnerSupplier;
  }, [requireIdentity, data.suppliers, syncBranchId]);
  const addSupplier = useCallback((supplier: SupplierPayload, operatorId?: string | null, operatorPin?: string | null) => saveBranchSupplier(null, supplier, false, operatorId, operatorPin), [saveBranchSupplier]);
  const updateSupplier = useCallback((id: string, supplier: Partial<SupplierPayload>, operatorId?: string | null, operatorPin?: string | null) => saveBranchSupplier(id, supplier, false, operatorId, operatorPin), [saveBranchSupplier]);
  const deleteSupplier = useCallback(async (id: string, operatorId?: string | null, operatorPin?: string | null) => { await saveBranchSupplier(id, {}, true, operatorId, operatorPin); }, [saveBranchSupplier]);

  const addCategory = useCallback(
    async (name: string, requestedBranchId?: string) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const branchId = requestedBranchId ?? syncBranchId ?? currentIdentity.branchId;
      if (!branchId) throw new Error('Selecione uma filial antes de criar a categoria.');
      if (syncBranchId && branchId !== syncBranchId) throw new Error('Categoria pertence a outra filial.');
      ensureEmployeeBranch(currentIdentity, branchId);
      const { data: created, error } = await supabase
        .from('partner_categories')
        .insert({
          name,
          branch_id: branchId,
          user_id: currentIdentity.companyUserId,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      const createdCategory =
        created as PartnerCategory;

      dataRevisionRef.current.invalidate(["categories"]);
      setData((prev) => ({
        ...prev,
        categories: [
          createdCategory,
          ...prev.categories,
        ],
      }));
    },
    [requireIdentity, syncBranchId],
  );

  const updateCategory = useCallback(
    async (
      id: string,
      category: Partial<CategoryPayload>,
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const existing = data.categories.find(
        (item) => item.id === id,
      );

      if (!existing) {
        throw new Error('Categoria não encontrada.');
      }

      if (syncBranchId && existing.branch_id !== syncBranchId) throw new Error('Categoria pertence a outra filial.');
      ensureEmployeeBranch(currentIdentity, category.branch_id ?? existing.branch_id);

      const { data: updated, error } = await supabase
        .from('partner_categories')
        .update(category)
        .eq('id', id)
        .eq('user_id', currentIdentity.companyUserId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      dataRevisionRef.current.invalidate(["categories"]);
      setData((prev) => ({
        ...prev,
        categories: prev.categories.map((item) =>
          item.id === id
            ? (updated as PartnerCategory)
            : item,
        ),
      }));

      return updated as PartnerCategory;
    },
    [data.categories, requireIdentity, syncBranchId],
  );

  const deleteCategory = useCallback(
    async (id: string) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const existing = data.categories.find(
        (item) => item.id === id,
      );

      if (!existing) {
        throw new Error('Categoria não encontrada.');
      }

      if (syncBranchId && existing.branch_id !== syncBranchId) throw new Error('Categoria pertence a outra filial.');
      ensureEmployeeBranch(currentIdentity, existing.branch_id);

      const { error } = await supabase
        .from('partner_categories')
        .delete()
        .eq('id', id)
        .eq('user_id', currentIdentity.companyUserId);

      if (error) {
        throw error;
      }

      dataRevisionRef.current.invalidate(["categories"]);
      setData((prev) => ({
        ...prev,
        categories: prev.categories.filter(
          (item) => item.id !== id,
        ),
      }));
    },
    [data.categories, requireIdentity, syncBranchId],
  );

  const addBranch = useCallback(
    async (name: string, address: string) => {
      const currentIdentity = requireIdentity();

      if (currentIdentity.salespersonId) {
        throw new Error(
          'Funcionários não podem cadastrar filiais.',
        );
      }

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const { data: created, error } = await supabase.rpc(
        'create_partner_branch',
        { p_name: name.trim(), p_address: address.trim() || null },
      );

      if (error) {
        throw error;
      }

      const createdBranch = created as PartnerBranch;

      dataRevisionRef.current.invalidate(["branches"]);
      setData((prev) => ({
        ...prev,
        branches: [
          ...prev.branches,
          createdBranch,
        ],
      }));

      return createdBranch;
    },
    [requireIdentity],
  );

  const updateBranch = useCallback(
    async (
      id: string,
      branch: Partial<BranchPayload>,
    ) => {
      const currentIdentity = requireIdentity();

      if (currentIdentity.salespersonId) {
        throw new Error(
          'Funcionários não podem alterar filiais.',
        );
      }

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const { data: updated, error } = await supabase
        .from('partner_branches')
        .update(branch)
        .eq('id', id)
        .eq('user_id', currentIdentity.companyUserId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      dataRevisionRef.current.invalidate(["branches"]);
      setData((prev) => ({
        ...prev,
        branches: prev.branches.map((item) =>
          item.id === id
            ? (updated as PartnerBranch)
            : item,
        ),
      }));

      return updated as PartnerBranch;
    },
    [requireIdentity],
  );

  const deleteBranch = useCallback(
    async (id: string) => {
      const currentIdentity = requireIdentity();

      if (currentIdentity.salespersonId) {
        throw new Error(
          'Funcionários não podem excluir filiais.',
        );
      }

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const { error } = await supabase
        .from('partner_branches')
        .delete()
        .eq('id', id)
        .eq('user_id', currentIdentity.companyUserId);

      if (error) {
        throw error;
      }

      dataRevisionRef.current.invalidate(["branches"]);
      setData((prev) => ({
        ...prev,
        branches: prev.branches.filter(
          (item) => item.id !== id,
        ),
      }));
    },
    [requireIdentity],
  );

  // One authorized snapshot: current branch records plus company-wide credit totals.
  const refreshPdv = useCallback(async (branchId: string, reusePending = false) => {
    const currentIdentity = requireIdentity();
    ensureEmployeeBranch(currentIdentity, branchId);
    const scope = currentIdentity.authUserId + ':' + currentIdentity.companyUserId;
    const request = ++pdvRequestId.current;
    setPdvReturnCredits([]);
    const readRevision = dataRevisionRef.current.begin(['products', 'sales', 'invoices', 'movements']);
    setPdvCredits([]);
    if (!isSupabaseConfigured || !supabase) throw new Error('Sincronização do PDV requer Supabase.');
    const { data: snapshot, error: syncError } = await pdvReadFlight.current.run(
      JSON.stringify([scope, currentIdentity.salespersonId, branchId]), signal => {
        const query = supabase!.rpc('get_partner_pdv_snapshot', { p_branch_id: branchId });
        return typeof query.abortSignal === 'function' ? query.abortSignal(signal) : query;
      }, reusePending);
    if (syncError) throw syncError;
    if (!snapshot || !Array.isArray(snapshot.credits) || !Array.isArray(snapshot.products)
      || !Array.isArray(snapshot.sales) || !Array.isArray(snapshot.invoices) || !Array.isArray(snapshot.movements)) {
      throw new Error('Resposta de sincronização do PDV inválida.');
    }
    const result = snapshot as { credits: CustomerCredit[]; return_credits?: RmaRequest[]; products: PartnerProduct[]; sales: PartnerSale[]; invoices: PartnerInvoice[]; movements: StockMovement[] };
    if (mountedRef.current && identityScopeRef.current === scope && request === pdvRequestId.current) {
      const mergeBranch = <T extends { branch_id?: string | null }>(old: T[], rows: T[]) =>
        [...rows, ...old.filter(row => row.branch_id !== branchId)];
      setData(prev => ({ ...prev,
        products: dataRevisionRef.current.isCurrent(readRevision, 'products') ? mergeBranch(prev.products, result.products) : prev.products,
        sales: dataRevisionRef.current.isCurrent(readRevision, 'sales') ? mergeBranch(prev.sales, result.sales) : prev.sales,
        invoices: dataRevisionRef.current.isCurrent(readRevision, 'invoices') ? mergeBranch(prev.invoices, result.invoices) : prev.invoices,
        movements: dataRevisionRef.current.isCurrent(readRevision, 'movements') ? mergeBranch(prev.movements, result.movements) : prev.movements,
      }));
      if (dataRevisionRef.current.isCurrent(readRevision, 'invoices') && dataRevisionRef.current.isCurrent(readRevision, 'sales')) {
        setPdvCredits(result.credits);
        setPdvReturnCredits(result.return_credits ?? []);
      }
      if (currentIdentity.salespersonId && resourceScopeRef.current !== null) {
        for (const key of ['products', 'sales', 'invoices', 'movements']) if (dataRevisionRef.current.isCurrent(readRevision, key)) loadCacheRef.current.mark(key);
        if (dataRevisionRef.current.isCurrent(readRevision, 'invoices')) authorizedPdvScopeRef.current = scope;
      }
      setPdvSyncWarning(null);
    }
    return result;
  }, [requireIdentity]);

  const synchronize = useCallback(async () => {
    if (!identity || !supabase || !isSupabaseConfigured || loading || syncInFlight.current) return;
    if (!navigator.onLine) {
      setSyncError('Sem internet. A sincronização será retomada quando a conexão voltar.');
      return;
    }
    const scope = identityScopeRef.current;
    syncInFlight.current = true;
    setSyncing(true);
    try {
      // Employee table RLS intentionally exposes fewer rows than the PDV RPC.
      // Never replace an authorized branch snapshot with that smaller subset.
      if (identity.salespersonId && syncBranchId && (resourceScopeRef.current === null || ['pdv', 'pedidos', 'caixa'].includes(resourceScopeRef.current))) {
        await refreshPdv(syncBranchId);
        if (scope === identityScopeRef.current) { setLastSyncedAt(new Date()); setSyncError(null); }
      } else await loadData(true);
    } catch (failure) {
      if (scope === identityScopeRef.current) setSyncError(pdvErrorMessage(failure));
    } finally {
      syncInFlight.current = false;
      if (mountedRef.current) setSyncing(false);
    }
  }, [identity, syncBranchId, loading, loadData, refreshPdv]);

  const refreshOperationalData = useCallback(async () => {
    if (loading || syncInFlight.current || saleInFlight.current || !navigator.onLine) return;
    const scope = identityScopeRef.current;
    syncInFlight.current = true;
    setSyncing(true);
    try {
      // Realtime reconciliation can follow a remote write: it must not join
      // a snapshot that began before that write was committed.
      if (syncBranchId && (resourceScopeRef.current === null || ['pdv', 'pedidos', 'caixa'].includes(resourceScopeRef.current))) await refreshPdv(syncBranchId);
      else { await loadData(true); return; }
      if (scope === identityScopeRef.current) {
        setLastSyncedAt(new Date());
        setSyncError(null);
      }
    } catch (failure) {
      if (scope === identityScopeRef.current) setSyncError(pdvErrorMessage(failure));
    } finally {
      syncInFlight.current = false;
      if (mountedRef.current) setSyncing(false);
    }
  }, [syncBranchId, loading, refreshPdv, loadData]);

  const hasLoaded = lastSyncedAt !== null;
  useEffect(() => {
    if (!identity || !supabase || !isSupabaseConfigured || loading || !hasLoaded) return;
    const client = supabase;
    const companyId = identity.companyUserId;
    const scope = identity.authUserId + ':' + companyId;
    const branchId = identity.salespersonId ? identity.branchId : syncBranchId;
    let active = true;
    let subscribed = false;
    let connectedOnce = false;
    let debounce: number | undefined;
    const reconcile = () => {
      if (!active || document.visibilityState !== 'visible' || !navigator.onLine) return;
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => { void refreshOperationalData(); }, 500);
    };
    const channel = client.channel(`partner-sync-${scope}-${branchId ?? 'all'}`);
    for (const table of ['partner_sales', 'partner_products', 'partner_invoices', 'stock_movements', 'b2b_orders', 'rma_requests_v2']) {
      const applyChange = (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
        if (!active || identityScopeRef.current !== scope) return;
        const key = {
          partner_sales: 'sales', partner_products: 'products', partner_invoices: 'invoices',
          stock_movements: 'movements', b2b_orders: 'orders', rma_requests_v2: 'rmas',
        }[table] as 'sales' | 'products' | 'invoices' | 'movements' | 'orders' | 'rmas';
        const eventBranchId = table === 'partner_products' && !identity.salespersonId ? null : branchId;
        if (payload.eventType !== 'DELETE' && (payload.new.user_id !== companyId || (eventBranchId && payload.new.branch_id !== eventBranchId))) return;
        if (payload.eventType === 'DELETE' && !dataSnapshotRef.current[key].some(row => row.id === payload.old.id && row.user_id === companyId && (!eventBranchId || row.branch_id === eventBranchId))) return;
        if (!loadCacheRef.current.has(key) && !requestedResourcesRef.current.includes(key)) return;
        const returnCreditChanged = (table === 'partner_invoices' && payload.eventType !== 'DELETE' &&
          Number(payload.new.return_credit_amount ?? 0) !== Number(dataSnapshotRef.current.invoices.find(invoice => invoice.id === payload.new.id)?.return_credit_amount ?? 0)) ||
          (table === 'rma_requests_v2' && Number(payload.new.credit_amount ?? 0) > 0);
        dataRevisionRef.current.invalidate([key]);
        setData(previous => {
          const rows = previous[key] as Array<PartnerSale | PartnerProduct | PartnerInvoice | StockMovement | B2BOrder | RmaRequest>;
          return { ...previous, [key]: mergePartnerChange(rows, payload.eventType, payload.new, payload.old.id, companyId, eventBranchId, key === 'sales') };
        });
        setLastSyncedAt(new Date());
        if (returnCreditChanged) void loadData(true, ['invoices', ...(loadCacheRef.current.has('rmas') ? ['rmas' as const] : [])]);
        // Credit is company-wide and cannot be derived from this branch's rows.
        // Reconcile after financial events so billed checkout is not left disabled.
        if (table === 'partner_invoices' || table === 'partner_sales') {
          setPdvCredits([]);
          reconcile();
        }
      };
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter: `user_id=eq.${companyId}` }, applyChange);
      channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter: `user_id=eq.${companyId}` }, applyChange);
      channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, applyChange);
    }
    channel.subscribe(status => {
      subscribed = status === 'SUBSCRIBED';
      if (subscribed) { const reconnecting = connectedOnce; connectedOnce = true; if (reconnecting || resourceScopeRef.current === null || ['pdv', 'pedidos', 'caixa'].includes(resourceScopeRef.current)) reconcile(); }
    });
    // Employee RLS is narrower than the authorized PDV RPC (especially invoices).
    // Keep branch reconciliation for employees without broadening table access.
    const timer = window.setInterval(() => { if (!subscribed || (identity.salespersonId && (resourceScopeRef.current === null || ['pdv', 'pedidos', 'caixa'].includes(resourceScopeRef.current)))) reconcile(); }, 30_000);
    window.addEventListener('focus', reconcile);
    window.addEventListener('online', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      active = false;
      window.clearTimeout(debounce);
      window.clearInterval(timer);
      window.removeEventListener('focus', reconcile);
      window.removeEventListener('online', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
      void client.removeChannel(channel);
    };
  }, [identity, syncBranchId, loading, hasLoaded, refreshOperationalData, loadData]);

  const syncConfirmedSale = useCallback(async (branchId: string) => {
    try { await refreshPdv(branchId); }
    catch {
      setPdvCredits([]);
      setPdvSyncWarning('Operação confirmada. Não foi possível atualizar os dados do PDV. Use Atualizar dados; não repita a venda.');
    }
  }, [refreshPdv]);

  const validateBilledSale = useCallback(async (sale: Pick<PartnerSale, 'customer_id' | 'branch_id' | 'total' | 'freight_fee'>) => {
    if (!sale.customer_id) throw new Error(billedSaleError(undefined, null, sale.total)!);
    const snapshot = await refreshPdv(sale.branch_id!);
    const message = billedSaleError(snapshot.credits.find(c => c.customer_id === sale.customer_id), sale.customer_id, saleChargeTotal(sale));
    if (message) throw new Error(message);
  }, [refreshPdv]);

  const createSale = useCallback(
    async (sale: SalePayload, operatorId?: string | null, operatorPin?: string | null) => {
      if (isSupabaseConfigured && navigator.onLine === false) throw new Error('Sem internet. O carrinho foi mantido; reconecte para confirmar a venda no servidor.');
      if (saleInFlight.current) throw new Error('Aguarde a conclusão da venda em andamento.');
      saleInFlight.current = true;
      try {
        const currentIdentity = requireIdentity();
        if (!sale.branch_id) throw new Error('Venda sem filial selecionada.');
        if (!validSalePrice(sale.freight_fee ?? 0)) throw new Error('Informe um frete válido.');
        if (sale.payment_method === 'misto') {
          const message = splitPaymentError(saleChargeTotal(sale), sale.payment_splits ?? []);
          if (message) throw new Error(message);
        }
        ensureEmployeeBranch(currentIdentity, sale.branch_id);
        const scope = currentIdentity.authUserId + ':' + currentIdentity.companyUserId;
        const attempts = new PdvSaleAttemptStore(window.localStorage, scope, sessionStorage);
        const previous = attempts.read();
        // Validate a NEW billed request. A retry may already have consumed its credit.
        if (!previous && sale.status !== 'pre_venda' && sale.payment_method === 'faturado') await validateBilledSale(sale);
        const candidate: PartnerSale = {
          ...sale, id: crypto.randomUUID(), user_id: currentIdentity.companyUserId,
          status: sale.status ?? 'concluida', created_at: new Date().toISOString(),
          imei: sale.imei ?? null, serial_number: sale.serial_number ?? null,
          payment_method: sale.payment_method ?? null, payment_splits: sale.payment_method === 'misto' ? sale.payment_splits ?? [] : [], branch_id: sale.branch_id,
          salesperson_id: previous && 'id' in sale && sale.id === previous.id
            ? previous.salesperson_id
            : currentIdentity.salespersonId ?? sale.salesperson_id ?? operatorId ?? null,
          origin: sale.origin ?? 'pdv', online_payment: false,
          payment_status: sale.status === 'pre_venda' || sale.payment_method === 'faturado' ? 'pendente' : 'pago',
        };
        const ns = attempts.begin(candidate);
        setPendingSale(ns);
        if (isSupabaseConfigured && supabase) {
          try {
            const rpcSale = { ...ns };
            delete rpcSale.draft_backup_id;
            const { data: confirmedId, error: rpcError } = await supabase.rpc(ns.rma_credit_id ? 'execute_partner_sale_with_rma_credit' : ns.cash_session_id ? 'supervised_execute_partner_sale_mutation' : 'execute_partner_sale_mutation', ns.rma_credit_id ? {
              p_sale: rpcSale, p_rma_id: ns.rma_credit_id, p_operator_id: operatorId ?? null, p_pin: operatorPin ?? null, p_cash_session_id: ns.cash_session_id ?? null,
            } : {
              ...(ns.cash_session_id ? { p_cash_session_id: ns.cash_session_id } : {}),
              p_salesperson_id: operatorId ?? null, p_pin: operatorPin ?? null,
              p_commercial_salesperson_id: ns.salesperson_id,
              p_sale_id: ns.id, p_customer_id: ns.customer_id, p_customer_name: ns.customer_name,
              p_items: ns.items, p_total: ns.total, p_freight_fee: ns.freight_fee ?? 0, p_imei: ns.imei, p_serial_number: ns.serial_number,
              p_payment_splits: ns.payment_splits ?? [],
              p_payment_method: ns.payment_method, p_branch_id: ns.branch_id, p_status: ns.status,
              p_origin: ns.origin, p_customer_type: ns.customer_type, p_delivery_type: ns.delivery_type,
            });
            if (rpcError) {
              // A PostgreSQL rejection of the first request guarantees rollback. Transport
              // failures and retries of an uncertain request must keep the same sale ID.
              if (!previous && isDefinitiveSaleRejection(rpcError.code ?? '')) {
                attempts.complete(ns.id);
                setPendingSale(null);
                throw new Error(pdvErrorMessage(rpcError));
              }
              throw rpcError;
            }
            if (confirmedId !== ns.id) throw new Error('Confirmação da venda não recebida.');
          } catch (err) {
            if (attempts.read()) {
              throw new Error('Resultado da venda ainda não confirmado. Use Recuperar venda pendente; o mesmo ID será reutilizado. ' + pdvErrorMessage(err));
            }
            throw err;
          }
        }
        // Success is final even if the following read fails. Never throw a checkout failure here.
        if (identityScopeRef.current === scope) {
          dataRevisionRef.current.invalidate(["sales"]);
          setData(prev => ({ ...prev, sales: [ns, ...prev.sales.filter(item => item.id !== ns.id)] }));
        }
        try {
          if (ns.draft_scope && ns.draft_backup_id) new PdvCartBackupStore(window.localStorage, ns.draft_scope).remove(ns.draft_backup_id);
          attempts.complete(ns.id); setPendingSale(null);
        }
        catch { setPdvSyncWarning('Venda confirmada. A recuperação local permanece pendente; não repita com outro ID.'); }
        if (isSupabaseConfigured && supabase) {
          await syncConfirmedSale(ns.branch_id!);
          if (ns.rma_credit_id && identityScopeRef.current === scope) {
            dataRevisionRef.current.invalidate(['rmas']);
            if (loadCacheRef.current.has('rmas')) {
              try { await loadData(true, ['rmas']); } catch { setPdvSyncWarning('Venda confirmada. Atualize os dados para conferir o saldo de devolução.'); }
            }
          }
          try {
            const { data: numbered } = await supabase.from('partner_sales').select('sale_number').eq('id', ns.id).eq('user_id', currentIdentity.companyUserId).maybeSingle();
            if (numbered?.sale_number) {
              ns.sale_number = Number(numbered.sale_number);
              if (identityScopeRef.current === scope) setData(previous=>({...previous,sales:previous.sales.map(item=>item.id===ns.id?{...item,sale_number:ns.sale_number}:item)}));
            }
          } catch { /* Sale is confirmed; number can be recovered in history. */ }
        }
        return ns;
      } finally { saleInFlight.current = false; }
    }, [requireIdentity, validateBilledSale, syncConfirmedSale, loadData],
  );

  const retryPendingSale = useCallback(async (operatorId?: string | null, operatorPin?: string | null) => {
    const currentIdentity = requireIdentity();
    const attempt = new PdvSaleAttemptStore(window.localStorage, currentIdentity.authUserId + ':' + currentIdentity.companyUserId, sessionStorage).read();
    if (!attempt) throw new Error('Nenhuma venda pendente para recuperar.');
    return createSale(attempt, operatorId, operatorPin);
  }, [createSale, requireIdentity]);

  // Share the persisted attempt and synchronous guard with checkout. The status is
  // part of the immutable request key, so a pending pre-sale cannot become a sale.
  const createPreSale = useCallback(
    (sale: SalePayload, operatorId?: string | null, operatorPin?: string | null) =>
      createSale({ ...sale, status: 'pre_venda', payment_method: sale.payment_method ?? null, origin: 'pdv' }, operatorId, operatorPin),
    [createSale],
  );

  const updatePreSale = useCallback(async (id: string, edits: Pick<PartnerSale, 'customer_id' | 'customer_name' | 'items' | 'total' | 'customer_type' | 'delivery_type'> & Partial<Pick<PartnerSale, 'freight_fee' | 'salesperson_id' | 'payment_method' | 'branch_id'>>, operatorId?: string | null, operatorPin?: string | null) => {
    if (saleInFlight.current) throw new Error('Aguarde a operação em andamento.');
    saleInFlight.current = true;
    try {
      const currentIdentity = requireIdentity();
      const saved = data.sales.find(item => item.id === id);
      if (!saved?.branch_id || saved.status !== 'pre_venda' || saved.online_payment || saved.payment_status === 'pago') throw new Error('Somente pré-vendas pendentes podem ser salvas. Atualize os pedidos.');
      ensureEmployeeBranch(currentIdentity, saved.branch_id);
      if (edits.branch_id && edits.branch_id !== saved.branch_id) throw new Error('Não é permitido transferir a pré-venda para outra filial.');
      if (!edits.items.length || edits.items.some(item => !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || !validSalePrice(item.unit_price)) || !validSalePrice(edits.freight_fee ?? 0)) throw new Error('Confira os produtos, quantidades, preços e frete antes de salvar.');
      const total = edits.items.reduce((sum, item) => sum + Math.round(item.unit_price * 100) * item.quantity, 0) / 100;
      const updated = { ...saved, customer_id: edits.customer_id, customer_name: edits.customer_name,
        items: edits.items, total, freight_fee: edits.freight_fee ?? 0, customer_type: edits.customer_type,
        delivery_type: edits.delivery_type, salesperson_id: edits.salesperson_id ?? null,
        // Split payments belong to finalization, never to a pending quote.
        payment_method: edits.payment_method === 'misto' ? saved.payment_method : edits.payment_method ?? saved.payment_method };
      if (isSupabaseConfigured && supabase) {
        const { data: confirmedId, error } = await supabase.rpc('execute_partner_sale_mutation', {
          p_salesperson_id: operatorId ?? null, p_pin: operatorPin ?? null,
          p_commercial_salesperson_id: updated.salesperson_id, p_sale_id: id,
          p_customer_id: updated.customer_id, p_customer_name: updated.customer_name,
          p_items: updated.items, p_total: total, p_freight_fee: updated.freight_fee,
          p_imei: saved.imei, p_serial_number: saved.serial_number, p_payment_method: updated.payment_method,
          p_branch_id: saved.branch_id, p_status: 'pre_venda', p_origin: saved.origin,
          p_customer_type: updated.customer_type, p_delivery_type: updated.delivery_type,
        });
        if (error) throw new Error(pdvErrorMessage(error));
        if (confirmedId !== id) throw new Error('O servidor não confirmou o salvamento da pré-venda. Confira os pedidos antes de tentar novamente.');
      }
      if (identityScopeRef.current === currentIdentity.authUserId + ':' + currentIdentity.companyUserId) {
        dataRevisionRef.current.invalidate(['sales']);
        setData(previous => ({ ...previous, sales: previous.sales.map(item => item.id === id ? updated : item) }));
        if (isSupabaseConfigured && supabase) await syncConfirmedSale(saved.branch_id);
      }
    } finally { saleInFlight.current = false; }
  }, [data.sales, requireIdentity, syncConfirmedSale]);

  const updatePreSaleItems = useCallback(async (id: string, items: PartnerSale['items'], operatorId?: string | null, operatorPin?: string | null) => {
    if (saleInFlight.current) throw new Error('Aguarde a operação em andamento.');
    saleInFlight.current = true;
    try {
      const currentIdentity = requireIdentity();
      const sale = data.sales.find(item => item.id === id);
      if (!sale?.branch_id || sale.status !== 'pre_venda') throw new Error('Somente pré-vendas pendentes podem ser editadas.');
      ensureEmployeeBranch(currentIdentity, sale.branch_id);
      if (!items.length || items.some(item => !Number.isInteger(item.quantity) || item.quantity <= 0)) throw new Error('Adicione pelo menos um produto com quantidade válida.');
      const total = Math.round(items.reduce((sum, item) => sum + Math.round(item.unit_price * 100) * item.quantity, 0)) / 100;
      if (isSupabaseConfigured && supabase) {
        const { data: confirmedId, error } = await supabase.rpc('execute_partner_sale_mutation', {
          p_salesperson_id: operatorId ?? null, p_pin: operatorPin ?? null,
          p_commercial_salesperson_id: sale.salesperson_id, p_sale_id: sale.id,
          p_customer_id: sale.customer_id, p_customer_name: sale.customer_name,
          p_items: items, p_total: total, p_freight_fee: sale.freight_fee ?? 0, p_imei: sale.imei, p_serial_number: sale.serial_number,
          p_payment_method: sale.payment_method, p_branch_id: sale.branch_id, p_status: 'pre_venda',
          p_origin: sale.origin, p_customer_type: sale.customer_type, p_delivery_type: sale.delivery_type,
        });
        if (error) throw new Error(pdvErrorMessage(error));
        if (confirmedId !== id) throw new Error('Não foi possível confirmar a edição. Atualize os pedidos antes de tentar novamente.');
      }
      dataRevisionRef.current.invalidate(["sales"]);
      setData(prev => ({ ...prev, sales: prev.sales.map(item => item.id === id ? { ...item, items, total } : item) }));
      if (isSupabaseConfigured && supabase) await syncConfirmedSale(sale.branch_id);
    } finally { saleInFlight.current = false; }
  }, [data.sales, requireIdentity, syncConfirmedSale]);

  const updateOpenOrderCustomer = useCallback(async (id: string, customerId: string, operatorId?: string | null, operatorPin?: string | null) => {
    if (saleInFlight.current) throw new Error('Aguarde a operação em andamento.');
    saleInFlight.current = true;
    try {
      const currentIdentity = requireIdentity();
      const sale = data.sales.find(item => item.id === id);
      if (!sale?.branch_id || !['pre_venda', 'aberta'].includes(sale.status)) throw new Error('Somente pedidos abertos e pré-vendas podem alterar o cliente.');
      ensureEmployeeBranch(currentIdentity, sale.branch_id);
      const customer = data.customers.find(item => item.id === customerId && item.user_id === currentIdentity.companyUserId && (!item.branch_id || item.branch_id === sale.branch_id));
      if (!customer) throw new Error('Cliente inválido para esta filial.');
      if (sale.payment_status !== 'pendente' || sale.online_payment) throw new Error('Pedidos com pagamento não podem alterar o cliente.');
      if (isSupabaseConfigured && supabase) {
        const { data: confirmed, error } = await supabase.rpc('execute_partner_open_order_customer_mutation', {
          p_salesperson_id: operatorId ?? null, p_pin: operatorPin ?? null, p_sale_id: id, p_customer_id: customerId,
        });
        if (error) throw new Error(pdvErrorMessage(error));
        if (confirmed !== true) throw new Error('O servidor não confirmou a alteração do cliente.');
      }
      dataRevisionRef.current.invalidate(["sales"]);
      setData(previous => ({ ...previous, sales: previous.sales.map(item => item.id === id ? { ...item, customer_id: customerId, customer_name: customer.name } : item) }));
      if (isSupabaseConfigured && supabase) await syncConfirmedSale(sale.branch_id);
    } finally { saleInFlight.current = false; }
  }, [data.sales, data.customers, requireIdentity, syncConfirmedSale]);

  const updateDelivery = useCallback(async (saleId: string, operation: DeliveryOperation, operatorId?: string | null, operatorPin?: string | null): Promise<PartnerSale> => {
    const { identity: currentIdentity, client } = await requireAuthenticatedSession();
    ensureEmployeeBranch(currentIdentity, operation.branchId);
    const { data: confirmed, error } = await client.rpc('mutate_partner_delivery_checked', {
      p_request_id: operation.requestId, p_branch_id: operation.branchId, p_sale_id: saleId,
      p_expected_revision: operation.expectedRevision, p_patch: operation.patch,
      p_salesperson_id: operatorId ?? null, p_pin: operatorPin ?? null,
    });
    if (error) throw Object.assign(new Error(pdvErrorMessage(error)), { code: error.code });
    const row = confirmed as PartnerSale | null;
    if (!row || row.id !== saleId || row.user_id !== currentIdentity.companyUserId || row.branch_id !== operation.branchId || !Number.isSafeInteger(row.delivery_revision)) throw new Error('O servidor não confirmou o salvamento da entrega. Repita a mesma tentativa.');
    if (identityScopeRef.current === currentIdentity.authUserId + ':' + currentIdentity.companyUserId) {
      dataRevisionRef.current.invalidate(['sales']);
      setData(previous => ({ ...previous, sales: previous.sales.map(item => item.id === saleId && (item.delivery_revision ?? 0) <= row.delivery_revision! ? {
        ...item, delivery_status: row.delivery_status, delivery_driver_id: row.delivery_driver_id,
        delivery_address: row.delivery_address, delivery_contact: row.delivery_contact,
        delivery_details: row.delivery_details, delivery_history: row.delivery_history, delivery_revision: row.delivery_revision,
      } : item) }));
    }
    return row;
  }, [requireAuthenticatedSession]);

  const finalizePreSale = useCallback(
    async (
      id: string,
      paymentMethod: string,
      operatorId?: string | null,
      operatorPin?: string | null,
      paymentSplits?: SalePayment[],
      cashSessionId?: string | null,
      edits?: Pick<PartnerSale, 'customer_id' | 'customer_name' | 'items' | 'total' | 'customer_type' | 'delivery_type'> & Partial<Pick<PartnerSale, 'freight_fee' | 'salesperson_id'>>,
    ) => {
      if (saleInFlight.current) throw new Error('Aguarde a operação em andamento.');
      saleInFlight.current = true;
      try {
        const currentIdentity = requireIdentity();

        const savedSale = data.sales.find(
          (currentSale) =>
            currentSale.id === id,
        );

        if (!savedSale || !savedSale.branch_id) {
          throw new Error(
            'Pré-venda não encontrada ou sem filial válida.',
          );
        }

        // Keep the original identity, branch and lifecycle. Only editable checkout fields
        // may be changed; the server revalidates customer, prices and stock.
        const branchId = savedSale.branch_id;
        const sale = edits ? { ...savedSale,
          customer_id: edits.customer_id, customer_name: edits.customer_name,
          items: edits.items, total: edits.total, customer_type: edits.customer_type,
          delivery_type: edits.delivery_type, freight_fee: edits.freight_fee ?? 0,
          salesperson_id: edits.salesperson_id ?? null,
        } : savedSale;
        const quoteChanged = edits && (
          sale.customer_id !== savedSale.customer_id || sale.customer_name !== savedSale.customer_name
          || sale.total !== savedSale.total || (sale.freight_fee ?? 0) !== (savedSale.freight_fee ?? 0)
          || sale.customer_type !== savedSale.customer_type || sale.delivery_type !== savedSale.delivery_type
          || sale.salesperson_id !== savedSale.salesperson_id
          || JSON.stringify(sale.items) !== JSON.stringify(savedSale.items)
        );

        ensureEmployeeBranch(
          currentIdentity,
          sale.branch_id,
        );

        // Autorização da RPC: operador do modal (id + PIN) ou null para
        // que a RPC resolva o operador pelo auth.uid() da sessão.
        const effectiveOperatorId = operatorId ?? null;
        const effectiveOperatorPin = operatorPin ?? null;

        if (sale.status !== 'pre_venda') throw new Error('Esta pré-venda já foi finalizada ou cancelada.');
        const parts = paymentMethod === 'misto' ? paymentSplits ?? [] : [];
        if (paymentMethod === 'misto') {
          const message = splitPaymentError(saleChargeTotal(sale), parts);
          if (message) throw new Error(message);
        }
        if (paymentMethod === 'faturado' || edits) {
          // Refresh first: another checkout may already have finalized this same sale.
          const snapshot = await refreshPdv(branchId);
          const persisted = snapshot.sales.find(item => item.id === id);
          if (persisted?.status === 'concluida' && persisted.payment_method === paymentMethod && (!edits || (
            persisted.customer_id === sale.customer_id && persisted.customer_name === sale.customer_name
            && persisted.total === sale.total && (persisted.freight_fee ?? 0) === (sale.freight_fee ?? 0)
            && persisted.customer_type === sale.customer_type && persisted.delivery_type === sale.delivery_type
            && JSON.stringify(persisted.items) === JSON.stringify(sale.items)
            && JSON.stringify(persisted.payment_splits ?? []) === JSON.stringify(parts)
          ))) return;
          if (persisted && persisted.status !== 'pre_venda') throw new Error('Esta pré-venda já foi finalizada ou cancelada. Confira o Histórico.');
          if (paymentMethod === 'faturado') {
            const message = billedSaleError(snapshot.credits.find(c => c.customer_id === sale.customer_id), sale.customer_id, saleChargeTotal(sale));
            if (message) throw new Error(message);
          }
        }

        if (isSupabaseConfigured && supabase) {
          if (quoteChanged) {
            // Persist the edited quote before finalizing: the finalization RPC must
            // match its authoritative price snapshot and must reuse the same sale ID.
            const { data: confirmedId, error } = await supabase.rpc('execute_partner_sale_mutation', {
              p_salesperson_id: effectiveOperatorId, p_pin: effectiveOperatorPin,
              p_commercial_salesperson_id: sale.salesperson_id, p_sale_id: id,
              p_customer_id: sale.customer_id, p_customer_name: sale.customer_name,
              p_items: sale.items, p_total: sale.total, p_freight_fee: sale.freight_fee ?? 0,
              p_imei: sale.imei, p_serial_number: sale.serial_number,
              p_payment_method: sale.payment_method, p_branch_id: sale.branch_id,
              p_status: 'pre_venda', p_origin: sale.origin,
              p_customer_type: sale.customer_type, p_delivery_type: sale.delivery_type,
            });
            if (error) throw new Error(pdvErrorMessage(error));
            if (confirmedId !== id) throw new Error('O servidor não confirmou a edição da pré-venda.');
            dataRevisionRef.current.invalidate(['sales']);
            setData(previous => ({ ...previous, sales: previous.sales.map(item => item.id === id ? sale : item) }));
          }
          const { error: rpcErr } =
            await supabase.rpc(
              cashSessionId ? 'supervised_execute_partner_sale_mutation' : 'execute_partner_sale_mutation',
              {
                ...(cashSessionId ? { p_cash_session_id: cashSessionId } : {}),
                p_salesperson_id:
                  effectiveOperatorId,
                p_pin: effectiveOperatorPin,
                p_commercial_salesperson_id: sale.salesperson_id,
                p_sale_id: id,
                p_customer_id:
                  sale.customer_id ?? null,
                p_customer_name:
                  sale.customer_name ?? '',
                p_items: sale.items ?? [],
                p_total: sale.total ?? 0,
                p_freight_fee: sale.freight_fee ?? 0,
                p_imei: sale.imei ?? null,
                p_serial_number:
                  sale.serial_number ?? null,
                p_payment_splits: parts,
                p_payment_method: paymentMethod,
                p_branch_id: sale.branch_id,
                p_status: 'concluida',
                p_origin:
                  sale.origin ?? 'pdv',
                p_customer_type:
                  sale.customer_type ?? 'varejo',
                p_delivery_type:
                  sale.delivery_type ?? 'balcao',
              },
            );

          if (rpcErr) {
            throw rpcErr;
          }
        }

        dataRevisionRef.current.invalidate(["sales"]);
        setData(prev => ({ ...prev, sales: prev.sales.map(item => item.id === id
          ? { ...sale, status: 'concluida', completed_at: new Date().toISOString(), payment_method: paymentMethod, payment_splits: parts, payment_status: paymentMethod === 'faturado' ? 'pendente' : 'pago' }
          : item) }));
        if (isSupabaseConfigured && supabase) await syncConfirmedSale(branchId);
      } finally { saleInFlight.current = false; }
    },
    [data.sales, requireIdentity, refreshPdv, syncConfirmedSale],
  );

  const mutateOpenOrder = useCallback(async (id: string, action: 'cancel' | 'delete', operatorId?: string | null, operatorPin?: string | null, supervisorId?: string | null, supervisorPin?: string | null) => {
    if (saleInFlight.current) throw new Error('Aguarde a operação em andamento.');
    saleInFlight.current = true;
    try {
      const currentIdentity = requireIdentity();
      const sale = data.sales.find(item => item.id === id);
      if (!sale?.branch_id || !['aberta', 'pre_venda'].includes(sale.status)) throw new Error('Pedido não está mais aberto. Atualize a lista.');
      ensureEmployeeBranch(currentIdentity, sale.branch_id);
      if (!supabase || !isSupabaseConfigured) throw new Error('Conecte-se para autorizar esta operação.');
      const { data: confirmed, error } = await supabase.rpc('mutate_partner_open_order', {
        p_sale_id: id, p_branch_id: sale.branch_id, p_action: action,
        p_salesperson_id: operatorId ?? null, p_pin: operatorPin ?? null,
        p_supervisor_id: supervisorId ?? null, p_supervisor_pin: supervisorPin ?? null,
      });
      if (error) throw new Error(pdvErrorMessage(error));
      if (confirmed !== id) throw new Error('Resultado não confirmado. Atualize os pedidos antes de tentar novamente.');
      if (identityScopeRef.current !== `${currentIdentity.authUserId}:${currentIdentity.companyUserId}`) return;
      dataRevisionRef.current.invalidate(['sales']);
      setData(previous => ({ ...previous, sales: action === 'delete'
        ? previous.sales.filter(item => item.id !== id)
        : previous.sales.map(item => item.id === id ? { ...item, status: 'cancelada', payment_status: 'cancelado' } : item) }));
    } finally { saleInFlight.current = false; }
  }, [data.sales, requireIdentity]);

  const cancelHistorySale = useCallback(async (id: string, expectedBranchId: string | null, operatorId?: string | null, operatorPin?: string | null, supervisorId?: string | null, supervisorPin?: string | null) => {
    if (saleInFlight.current) throw new Error('Aguarde a operação de venda em andamento.');
    saleInFlight.current = true;
    try {
      const currentIdentity = requireIdentity();
      const sale = data.sales.find(item => item.id === id);
      if (!sale?.branch_id || (expectedBranchId && sale.branch_id !== expectedBranchId)) throw new Error('Venda não encontrada nesta filial. Atualize o Histórico.');
      ensureEmployeeBranch(currentIdentity, sale.branch_id);
      if (!supabase || !isSupabaseConfigured) throw new Error('Conecte-se para autorizar o cancelamento.');
      const { data: confirmed, error } = await supabase.rpc('cancel_partner_history_sale', {
        p_sale_id: id, p_branch_id: sale.branch_id,
        p_salesperson_id: operatorId ?? null, p_pin: operatorPin ?? null,
        p_supervisor_id: supervisorId ?? null, p_supervisor_pin: supervisorPin ?? null,
      });
      if (error) throw new Error(pdvErrorMessage(error));
      if (confirmed !== id) throw new Error('Resultado não confirmado. Atualize o Histórico antes de tentar novamente.');
      if (!mountedRef.current || identityScopeRef.current !== `${currentIdentity.authUserId}:${currentIdentity.companyUserId}`) return;
      dataRevisionRef.current.invalidate(['sales', 'invoices', 'products', 'movements']);
      setData(previous => ({ ...previous,
        sales: previous.sales.map(item => item.id === id ? { ...item, status: 'cancelada',
          payment_status: item.status === 'aberta' || item.payment_method === 'faturado' ? 'cancelado' : item.payment_status } : item),
        invoices: previous.invoices.map(invoice => invoice.sale_id === id && invoice.status === 'aberta' && Number(invoice.paid_amount ?? 0) === 0
          ? { ...invoice, status: 'cancelada' } : invoice),
      }));
      await syncConfirmedSale(sale.branch_id);
    } finally { saleInFlight.current = false; }
  }, [data.sales, requireIdentity, syncConfirmedSale]);

  const cancelSale = useCallback(
    async (
      id: string,
      operatorId?: string | null,
      operatorPin?: string | null,
    ) => {
      const currentIdentity = requireIdentity();

      const sale = data.sales.find(
        (item) => item.id === id,
      );

      if (!sale) {
        throw new Error('Venda não encontrada.');
      }

      ensureEmployeeBranch(
        currentIdentity,
        sale.branch_id,
      );

      // Cancelar venda exige autorização de Administrador ou Gerente digitada
      // na hora (ver PdvModule). Quando um operatorId é explicitamente
      // informado, ele é usado com o PIN digitado. Sem operador informado,
      // envia null para que a RPC resolva pelo auth.uid() da sessão.
      // Nunca enviar id de colaborador com PIN nulo.
      const effectiveOperatorId = operatorId ?? null;
      const effectiveOperatorPin = operatorPin ?? null;

      if (isSupabaseConfigured && supabase) {
        const { error: rpcErr } =
          await supabase.rpc(
            'execute_partner_sale_mutation',
            {
              p_salesperson_id:
                effectiveOperatorId,
              p_pin: effectiveOperatorPin,
              p_sale_id: id,
              p_customer_id:
                sale.customer_id ?? null,
              p_customer_name:
                sale.customer_name ?? '',
              p_items: sale.items ?? [],
              p_total: sale.total ?? 0,
              p_freight_fee: sale.freight_fee ?? 0,
              p_imei: sale.imei ?? null,
              p_serial_number:
                sale.serial_number ?? null,
              p_payment_method:
                sale.payment_method ?? null,
              p_branch_id:
                sale.branch_id ?? null,
              p_status: 'cancelada',
              p_origin:
                sale.origin ?? 'pdv',
              p_customer_type:
                sale.customer_type ?? 'varejo',
              p_delivery_type:
                sale.delivery_type ?? 'balcao',
            },
          );

        if (rpcErr) {
          throw rpcErr;
        }

        dataRevisionRef.current.invalidate(["sales","invoices"]);
        setData(prev => ({ ...prev,
          sales: prev.sales.map(item => item.id === id
            ? { ...item, status: 'cancelada', payment_status: item.payment_method === 'faturado' ? 'cancelado' : item.payment_status }
            : item),
          invoices: prev.invoices.map(invoice => invoice.sale_id === id && invoice.status === 'aberta' && Number(invoice.paid_amount ?? 0) === 0
            ? { ...invoice, status: 'cancelada' } : invoice),
        }));
        await syncConfirmedSale(sale.branch_id!);
        return;
      }

      dataRevisionRef.current.invalidate(["sales"]);
      setData((prev) => ({
        ...prev,
        sales: prev.sales.map(
          (item) =>
            item.id === id
              ? {
                  ...item,
                  status: 'cancelada',
                }
              : item,
        ),
      }));
    },
    [data.sales, syncConfirmedSale, requireIdentity],
  );

  const deleteSale = useCallback(
    async (
      id: string,
      operatorId?: string | null,
      operatorPin?: string | null,
    ) => {
      const currentIdentity = requireIdentity();

      const sale = data.sales.find(
        (item) => item.id === id,
      );

      if (!sale) {
        throw new Error('Venda não encontrada.');
      }

      ensureEmployeeBranch(
        currentIdentity,
        sale.branch_id,
      );

      // Mesma regra de autorização do cancelamento: operador informado
      // na hora (id + PIN) ou null para resolução via auth.uid().
      const effectiveOperatorId = operatorId ?? null;
      const effectiveOperatorPin = operatorPin ?? null;

      if (isSupabaseConfigured && supabase) {
        const { error: rpcErr } =
          await supabase.rpc(
            'execute_partner_sale_delete',
            {
              p_sale_id: id,
              p_salesperson_id:
                effectiveOperatorId,
              p_pin: effectiveOperatorPin,
            },
          );

        if (rpcErr) {
          throw rpcErr;
        }
      }

      dataRevisionRef.current.invalidate(["sales","invoices"]);
      setData((prev) => ({
        ...prev,
        sales: prev.sales.filter(
          (item) => item.id !== id,
        ),
        invoices: prev.invoices.filter(
          (invoice) =>
            invoice.sale_id !== id,
        ),
      }));
    },
    [data.sales, requireIdentity],
  );

  const replenishStock = useCallback(
    async (
      productId: string,
      branchId: string,
      quantity: number,
      unitCost?: number | null,
      reason?: string,
      operatorId?: string | null,
      operatorPin?: string | null,
    ): Promise<{ newStock: number }> => {
      const currentIdentity = requireIdentity();

      if (quantity <= 0) {
        throw new Error(
          'A quantidade de reposição deve ser maior que zero.',
        );
      }

      const product = data.products.find(
        (item) => item.id === productId,
      );

      if (!product) {
        throw new Error(
          'Produto não encontrado.',
        );
      }

      ensureEmployeeBranch(
        currentIdentity,
        branchId,
      );

      // Mesma regra de operador: id + PIN do modal ou null (auth.uid()).
      const effectiveOperatorId = operatorId ?? null;
      const effectiveOperatorPin = operatorPin ?? null;

      let newStock = product.stock + quantity;

      if (isSupabaseConfigured && supabase) {
        const attempts = new OperationAttempts(window.localStorage);
        const scope = `${currentIdentity.authUserId}:${branchId}:${productId}`;
        const wasPending = !!attempts.pending(scope, 'replenishment');
        const attempt = attempts.get(scope, 'replenishment', { productId, branchId, quantity, unitCost: unitCost ?? null, reason: reason?.trim() ?? '', operatorId: effectiveOperatorId });
        const { data: replenishment, error: rpcError } =
          await supabase.rpc(
            'execute_partner_stock_replenishment_once',
            {
              p_request_id: attempt.id,
              p_salesperson_id: effectiveOperatorId,
              p_pin: effectiveOperatorPin,
              p_product_id: productId,
              p_branch_id: branchId,
              p_quantity: quantity,
              p_unit_cost: unitCost ?? null,
              p_reason: reason ?? null,
            },
          );

        if (rpcError) {
          if (!wasPending && ['P0001','22023','23514'].includes(rpcError.code)) attempts.confirm(scope, 'replenishment');
          throw rpcError;
        }

        // A RPC retorna jsonb com new_stock já calculado no banco.
        const serverNewStock = (
          replenishment as {
            new_stock?: number;
          } | null
        )?.new_stock;

        if (typeof serverNewStock === 'number') {
          newStock = serverNewStock;
        } else {
          throw new Error('Reposição não confirmada pelo servidor. Recupere a mesma tentativa.');
        }
        attempts.confirm(scope, 'replenishment');
        dataRevisionRef.current.invalidate(['products', 'movements']);
        const operationScope = currentIdentity.authUserId + ':' + currentIdentity.companyUserId;
        if (identityScopeRef.current !== operationScope || !mountedRef.current) return { newStock };
        setData(previous => ({ ...previous, products: previous.products.map(row => row.id === productId ? { ...row, stock: newStock } : row) }));
        const readRevision = dataRevisionRef.current.begin(['products']);
        try {
          const { data: updated, error } = await supabase.from('partner_products').select('*').eq('id', productId).eq('user_id', currentIdentity.companyUserId).maybeSingle();
          if (error || !updated) throw error ?? new Error('Product refresh pending');
          if (identityScopeRef.current === operationScope && mountedRef.current && dataRevisionRef.current.isCurrent(readRevision, 'products')) setData(previous => ({ ...previous, products: previous.products.map(row => row.id === productId ? updated as PartnerProduct : row) }));
        } catch { loadCacheRef.current.stale('products'); console.warn('Stock confirmed; product details refresh pending.'); }
        if (identityScopeRef.current === operationScope && loadCacheRef.current.has('movements')) await loadData(true, ['movements']);
        return { newStock };
      }

      dataRevisionRef.current.invalidate(["products","movements"]);
      setData((prev) => ({
        ...prev,
        products: prev.products.map(
          (item) =>
            item.id === productId
              ? {
                  ...item,
                  stock: newStock,
                }
              : item,
        ),
        movements: [
          {
            id: crypto.randomUUID(),
            user_id:
              currentIdentity.companyUserId,
            product_id: product.id,
            product_name: product.name,
            type: 'entrada',
            quantity,
            reason:
              reason ?? 'Reposição de estoque',
            created_at:
              new Date().toISOString(),
            branch_id: branchId,
          },
          ...prev.movements,
        ],
      }));

      return { newStock };
    },
    [data.products, requireIdentity, loadData],
  );

  const payInvoice = useCallback(async (id: string, amount?: number, requestId?: string) => {
    const { identity: currentIdentity, client } = await requireAuthenticatedSession();
    const scope = currentIdentity.authUserId + ':' + currentIdentity.companyUserId;
    const store = new InvoicePaymentAttempts(window.localStorage);
    const pending = store.pending(scope, id);
    const invoice = data.invoices.find(item => item.id === id);
    if (invoice && invoice.user_id !== currentIdentity.companyUserId) throw new Error('Acesso negado à fatura.');
    if (!pending && !invoice) throw new Error('Fatura não encontrada.');
    const outstanding = invoice ? Math.max(0, Math.round(Number(invoice.amount) * 100) - Math.round(Number(invoice.paid_amount ?? 0) * 100)) / 100 : 0;
    const value = amount ?? pending?.amount ?? outstanding;
    if (!Number.isFinite(value) || value <= 0) throw new Error('Valor de recebimento inválido.');
    if (!pending && (invoice?.status === 'cancelada' || value > outstanding + 0.000001)) throw new Error('Valor excede o saldo da fatura ou fatura cancelada.');
    const key = scope + ':invoice:' + id;
    if (financialLocks.current.has(key)) throw new Error('Recebimento em confirmação. Aguarde.');
    financialLocks.current.add(key);
    try {
      const attempt = store.get(scope, id, value, requestId ?? crypto.randomUUID());
      setFinancialRevision(revision => revision + 1);
      const { data: confirmed, error } = await client.rpc('record_partner_invoice_payment_once', { p_invoice_id: id, p_amount: attempt.amount, p_request_id: attempt.token });
      if (error) {
        if (!pending && isDefinitiveSaleRejection(error.code ?? '')) store.confirm(scope, id);
        throw Object.assign(new Error(pdvErrorMessage(error)), { code: error.code });
      }
      if (confirmed !== id) throw new Error('O recebimento não foi confirmado pelo servidor. Recupere a tentativa pendente.');
      store.confirm(scope, id);
      if (identityScopeRef.current === scope) {
        dataRevisionRef.current.invalidate(['invoices']);
        try { await loadData(true, ['invoices']); } catch { console.warn('[usePartnerData] Recebimento confirmado; atualização pendente.'); }
      }
    } finally { financialLocks.current.delete(key); setFinancialRevision(revision => revision + 1); }
  }, [data.invoices, loadData, requireAuthenticatedSession]);

  const updateStoreSettings = useCallback(
    async (settings: Partial<StoreSettings>) => {
      const currentIdentity = requireIdentity();

      if (currentIdentity.salespersonId) {
        throw new Error(
          'Funcionários não podem alterar as configurações da loja.',
        );
      }

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      // UPDATE existing settings directly: an INSERT/upsert runs branding defaults
      // before conflict handling even when only the service terms have changed.
      const result = await supabase.from('store_settings_v2').update(settings)
        .eq('user_id', currentIdentity.companyUserId).select().maybeSingle();
      if (result.error) throw result.error;
      const { data: updated, error } = result.data ? result : await supabase
        .from('store_settings_v2')
        .upsert(
          {
            ...settings,
            user_id:
              currentIdentity.companyUserId,
          },
          {
            onConflict: 'user_id',
          },
        )
        .select()
        .single();

      if (error) {
        throw error;
      }

      if (!updated || updated.user_id !== currentIdentity.companyUserId ||
        (settings.service_warranty_terms !== undefined && updated.service_warranty_terms !== settings.service_warranty_terms)) {
        throw new Error('Não foi possível confirmar o termo de garantia salvo. Mantenha o texto e tente novamente.');
      }
      dataRevisionRef.current.invalidate(["settings"]);
      setData((prev) => ({
        ...prev,
        settings:
          updated as StoreSettings,
      }));

      return updated as StoreSettings;
    },
    [requireIdentity],
  );

  const updateProfile = useCallback(
    async (
      profile: Partial<PartnerProfile>,
    ) => {
      const currentIdentity = requireIdentity();

      if (currentIdentity.salespersonId) {
        throw new Error(
          'Funcionários não podem alterar o perfil da empresa.',
        );
      }

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const { data: updated, error } = await supabase
        .from('partner_profiles')
        .update(profile)
        .eq('id', currentIdentity.companyUserId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      dataRevisionRef.current.invalidate(["profile"]);
      setData((prev) => ({
        ...prev,
        profile:
          updated as PartnerProfile,
      }));

      return updated as PartnerProfile;
    },
    [requireIdentity],
  );

  const createRma = useCallback(
    async (rma: RmaPayload) => {
      const currentIdentity = requireIdentity();

      if (!rma.branch_id) {
        throw new Error(
          'RMA sem filial selecionada.',
        );
      }

      ensureEmployeeBranch(
        currentIdentity,
        rma.branch_id,
      );

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const { files = [], request_id = crypto.randomUUID(), ...payload } = rma;
      const { data: prior, error: priorError } = await supabase.from('rma_requests_v2').select('*').eq('id', request_id).eq('user_id', currentIdentity.companyUserId).maybeSingle();
      if (priorError) throw priorError;
      if (prior) { await loadData(); return prior as RmaRequest; }
      const attachments = [];
      for (const { kind, file } of files) {
        if (file.size > 20 * 1024 * 1024 || !['image/jpeg','image/png','image/webp','image/heic','video/mp4','video/webm'].includes(file.type)) throw new Error('Use imagem JPEG, PNG, WebP, HEIC ou vídeo MP4/WebM de até 20 MB.');
        const path = `${currentIdentity.authUserId}/${request_id}/${kind}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error: uploadError } = await supabase.storage.from('rma-attachments').upload(path, file, { upsert: true, contentType: file.type });
        if (uploadError) throw uploadError;
        attachments.push({ kind, name: file.name, path });
      }
      const { data: created, error } =
        await supabase
          .from('rma_requests_v2')
          .insert({
            ...payload, id: request_id, attachments,
            user_id:
              currentIdentity.companyUserId,
          })
          .select()
          .single();

      if (error) {
        throw error;
      }

      const createdRma =
        created as RmaRequest;

      dataRevisionRef.current.invalidate(["rmas"]);
      setData((prev) => ({
        ...prev,
        rmas: [
          createdRma,
          ...prev.rmas,
        ],
      }));

      return createdRma;
    },
    [requireIdentity, loadData],
  );

  const updateRmaStatus = useCallback(
    async (
      id: string,
      status: RmaStatus,
      destination?: RmaRequest['destination'],
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const existing = data.rmas.find(
        (item) => item.id === id,
      );

      if (!existing) {
        throw new Error(
          'RMA não encontrado.',
        );
      }

      ensureEmployeeBranch(
        currentIdentity,
        existing.branch_id,
      );

      const { data: updated, error } =
        await supabase
          .from('rma_requests_v2')
          .update({
            status,
            ...(destination ? { destination } : {}),
            updated_at:
              new Date().toISOString(),
          })
          .eq('id', id)
          .eq(
            'user_id',
            currentIdentity.companyUserId,
          )
          .select()
          .single();

      if (error) {
        throw error;
      }

      dataRevisionRef.current.invalidate(["rmas"]);
      setData((prev) => ({
        ...prev,
        rmas: prev.rmas.map(
          (item) =>
            item.id === id
              ? (updated as RmaRequest)
              : item,
        ),
      }));

      if ((status === 'reintegrado_estoque' || destination === 'estoque') && existing.branch_id) {
        await syncConfirmedSale(existing.branch_id);
      }
      return updated as RmaRequest;
    },
    [data.rmas, requireIdentity, syncConfirmedSale],
  );

  const grantRmaCredit = useCallback(async (id: string, amount: number) => {
    requireIdentity();
    if (!supabase) throw new Error('Supabase não configurado.');
    const { error } = await supabase.rpc('grant_partner_rma_credit', { p_rma_id: id, p_amount: amount });
    if (error) throw error;
    await loadData();
  }, [requireIdentity, loadData]);

  const addRmaPhotos = useCallback(async (id: string, files: RmaPhotoFile[]) => {
    const identity = requireIdentity();
    const scope = identity.authUserId + ':' + identity.companyUserId;
    if (!supabase) throw new Error('Supabase não configurado.');
    const existing = data.rmas.find(rma=>rma.id===id);
    if (!existing) throw new Error('Devolução não encontrada.');
    ensureEmployeeBranch(identity,existing.branch_id);
    for (const item of files) {
      if (identityScopeRef.current !== scope) throw new Error('A conta mudou durante o envio. Abra a devolução na conta original para conferir os anexos.');
      if (!['image/jpeg','image/png','image/webp','image/heic'].includes(item.file.type) || !item.file.size || item.file.size>20*1024*1024) throw new Error('Use fotos JPG, PNG, WebP ou HEIC de até 20 MB.');
      const path = `${identity.authUserId}/${id}/${item.id}-${item.file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
      const {error: uploadError} = await supabase.storage.from('rma-attachments').upload(path,item.file,{upsert:true,contentType:item.file.type});
      if (uploadError) throw uploadError;
      const {data: updated,error} = await supabase.rpc('add_partner_rma_attachment',{p_rma_id:id,p_kind:item.kind,p_name:item.file.name,p_path:path});
      if (error) throw error;
      if (!updated || updated.id!==id || !updated.attachments?.some((file: {path:string})=>file.path===path)) throw new Error('Anexo sem confirmação. Recupere o envio antes de tentar outros arquivos.');
      if (mountedRef.current && identityScopeRef.current === scope) {
        dataRevisionRef.current.invalidate(['rmas']);
        setData(previous=>({...previous,rmas:previous.rmas.map(rma=>rma.id===id?{...rma,...updated}:rma)}));
      }
    }
  }, [requireIdentity,data.rmas]);

  const refundRma = useCallback(async (id: string, amount: number, method: 'dinheiro' | 'pix' | 'cartao', reason: string, requestId: string, operatorId: string | null, operatorPin: string | null) => {
    requireIdentity();
    if (!supabase) throw new Error('Supabase não configurado.');
    const { data: confirmed, error } = await supabase.rpc('record_partner_rma_refund', {
      p_rma_id: id, p_amount: amount, p_method: method, p_reason: reason, p_request_id: requestId,
      p_salesperson_id: operatorId, p_pin: operatorPin,
    });
    if (error) throw error;
    if (confirmed !== requestId) throw new Error('Reembolso sem confirmação. Recupere a tentativa antes de registrar outro.');
    dataRevisionRef.current.invalidate(['rmas']);
    setData(previous => ({ ...previous, rmas: previous.rmas.map(rma => rma.id === id ? {
      ...rma, refund_amount: amount, refund_request_id: requestId, refund_method: method,
      refund_reason: reason, refunded_at: new Date().toISOString(),
    } : rma) }));
  }, [requireIdentity]);

  const applyRmaCredit = useCallback(async (rmaId: string, invoiceId: string, amount: number, applicationId: string) => {
    const { identity: currentIdentity, client } = await requireAuthenticatedSession();
    const scope = currentIdentity.authUserId + ':' + currentIdentity.companyUserId;
    const store = new FinancialOperationAttempts(window.localStorage);
    const pending = store.pending(scope, 'rma-credit');
    const key = scope + ':rma-credit';
    if (financialLocks.current.has(key)) throw new Error('Abatimento em confirmação. Aguarde.');
    financialLocks.current.add(key);
    try {
      const attempt = store.get(scope, { kind: 'rma-credit', rmaId, invoiceId, amount }, applicationId);
      setFinancialRevision(revision => revision + 1);
      const { data: confirmed, error } = await client.rpc('apply_partner_rma_credit', { p_rma_id: rmaId, p_invoice_id: invoiceId, p_amount: amount, p_application_id: attempt.token });
      if (error) {
        if (!pending && isDefinitiveSaleRejection(error.code ?? '')) store.confirm(scope, 'rma-credit');
        throw Object.assign(new Error(pdvErrorMessage(error)), { code: error.code });
      }
      if (confirmed !== attempt.token) throw new Error('O abatimento não foi confirmado pelo servidor. Recupere a tentativa pendente.');
      store.confirm(scope, 'rma-credit');
      if (identityScopeRef.current === scope) {
        dataRevisionRef.current.invalidate(['invoices', 'rmas']);
        try { await loadData(true, ['invoices', 'rmas']); } catch { console.warn('[usePartnerData] Abatimento confirmado; atualização pendente.'); }
      }
    } finally { financialLocks.current.delete(key); setFinancialRevision(revision => revision + 1); }
  }, [requireAuthenticatedSession, loadData]);

  let financialRecoveries: FinancialRecovery[] = [];
  let financialRecoveryError = '';
  // Revision intentionally triggers this read after a mutation changes local persistence.
  void financialRevision;
  if (identity) {
    const scope = identity.authUserId + ':' + identity.companyUserId;
    try {
      financialRecoveries = new InvoicePaymentAttempts(window.localStorage).list(scope).map(attempt => ({
        id: 'invoice:' + attempt.invoiceId,
        label: 'Recuperar recebimento de R$ ' + attempt.amount.toFixed(2),
        run: () => payInvoice(attempt.invoiceId, attempt.amount, attempt.token),
      }));
      const attempt = new FinancialOperationAttempts(window.localStorage).pending(scope, 'rma-credit');
      if (attempt?.payload.kind === 'rma-credit') {
        const payload = attempt.payload;
        financialRecoveries.push({ id: 'rma-credit', label: 'Recuperar abatimento de R$ ' + payload.amount.toFixed(2), run: () => applyRmaCredit(payload.rmaId, payload.invoiceId, payload.amount, attempt.token) });
      }
    } catch (error) { financialRecoveryError = pdvErrorMessage(error); }
  }

  const deleteRma = useCallback(
    async (id: string) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const existing = data.rmas.find(
        (item) => item.id === id,
      );

      if (!existing) {
        throw new Error(
          'RMA não encontrado.',
        );
      }

      ensureEmployeeBranch(
        currentIdentity,
        existing.branch_id,
      );

      const { error } = await supabase
        .from('rma_requests_v2')
        .delete()
        .eq('id', id)
        .eq(
          'user_id',
          currentIdentity.companyUserId,
        );

      if (error) {
        throw error;
      }

      dataRevisionRef.current.invalidate(["rmas"]);
      setData((prev) => ({
        ...prev,
        rmas: prev.rmas.filter(
          (item) => item.id !== id,
        ),
      }));
    },
    [data.rmas, requireIdentity],
  );

  const addCombo = useCallback(
    async (
      combo: Omit<PartnerCombo, 'id' | 'user_id' | 'created_at'>,
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const payload = {
        ...combo,
        user_id:
          currentIdentity.companyUserId,
      };

      const { data: created, error } =
        await supabase
          .from('partner_combos')
          .insert(payload)
          .select()
          .single();

      if (error) {
        throw error;
      }

      const createdCombo =
        created as PartnerCombo;

      dataRevisionRef.current.invalidate(["combos"]);
      setData((prev) => ({
        ...prev,
        combos: [
          createdCombo,
          ...prev.combos,
        ],
      }));
    },
    [requireIdentity],
  );

  const updateCombo = useCallback(
    async (
      id: string,
      combo: Partial<PartnerCombo>,
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const { data: updated, error } =
        await supabase
          .from('partner_combos')
          .update(combo)
          .eq('id', id)
          .eq(
            'user_id',
            currentIdentity.companyUserId,
          )
          .select()
          .single();

      if (error) {
        throw error;
      }

      dataRevisionRef.current.invalidate(["combos"]);
      setData((prev) => ({
        ...prev,
        combos: prev.combos.map(
          (item) =>
            item.id === id
              ? (updated as PartnerCombo)
              : item,
        ),
      }));

      return updated as PartnerCombo;
    },
    [requireIdentity],
  );

  const deleteCombo = useCallback(
    async (id: string) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const { error } = await supabase
        .from('partner_combos')
        .delete()
        .eq('id', id)
        .eq(
          'user_id',
          currentIdentity.companyUserId,
        );

      if (error) {
        throw error;
      }

      dataRevisionRef.current.invalidate(["combos"]);
      setData((prev) => ({
        ...prev,
        combos: prev.combos.filter(
          (item) => item.id !== id,
        ),
      }));
    },
    [requireIdentity],
  );

  const addModifier = useCallback(
    async (
      modifier: Omit<
        PartnerModifier,
        'id' | 'user_id' | 'created_at'
      >,
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const payload = {
        ...modifier,
        user_id:
          currentIdentity.companyUserId,
      };

      const { data: created, error } =
        await supabase
          .from('partner_modifiers')
          .insert(payload)
          .select()
          .single();

      if (error) {
        throw error;
      }

      const createdModifier =
        created as PartnerModifier;

      dataRevisionRef.current.invalidate(["modifiers"]);
      setData((prev) => ({
        ...prev,
        modifiers: [
          createdModifier,
          ...prev.modifiers,
        ],
      }));
    },
    [requireIdentity],
  );

  const updateModifier = useCallback(
    async (
      id: string,
      modifier: Partial<PartnerModifier>,
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const { data: updated, error } =
        await supabase
          .from('partner_modifiers')
          .update(modifier)
          .eq('id', id)
          .eq(
            'user_id',
            currentIdentity.companyUserId,
          )
          .select()
          .single();

      if (error) {
        throw error;
      }

      dataRevisionRef.current.invalidate(["modifiers"]);
      setData((prev) => ({
        ...prev,
        modifiers: prev.modifiers.map(
          (item) =>
            item.id === id
              ? (updated as PartnerModifier)
              : item,
        ),
      }));

      return updated as PartnerModifier;
    },
    [requireIdentity],
  );

  const deleteModifier = useCallback(
    async (id: string) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const { error } = await supabase
        .from('partner_modifiers')
        .delete()
        .eq('id', id)
        .eq(
          'user_id',
          currentIdentity.companyUserId,
        );

      if (error) {
        throw error;
      }

      dataRevisionRef.current.invalidate(["modifiers"]);
      setData((prev) => ({
        ...prev,
        modifiers: prev.modifiers.filter(
          (item) => item.id !== id,
        ),
      }));
    },
    [requireIdentity],
  );

  const addSalesperson = useCallback(
    async (
      salesperson: SalespersonPayload,
      operatorId?: string | null,
      operatorPin?: string | null,
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      if (currentIdentity.salespersonId) {
        throw new Error(
          'Funcionários não podem cadastrar operadores.',
        );
      }

      // Assinatura em produção (verificada diretamente no PostgREST):
      // execute_partner_salesperson_mutation(p_salesperson_id, p_name,
      //   p_role, p_commission_rate, p_phone, p_email, p_is_active,
      //   p_branch_id, p_operator_id, p_operator_pin, p_new_pin)
      // p_salesperson_id = colaborador criado/editado (null na criação);
      // p_operator_id/p_operator_pin = operador que autoriza a operação;
      // p_new_pin = novo PIN do colaborador, quando aplicável.
      const { data: created, error } =
        await supabase.rpc(
          'execute_partner_salesperson_mutation',
          {
            p_salesperson_id: null,
            p_name: salesperson.name,
            p_role: salesperson.role,
            p_commission_rate:
              salesperson.commission_rate ?? 0,
            p_phone: salesperson.phone ?? null,
            p_email: normalizeSalespersonEmail(salesperson.email),
            p_is_active:
              salesperson.is_active ?? true,
            p_branch_id:
              salesperson.branch_id ?? null,
            p_operator_id: operatorId ?? null,
            p_operator_pin: operatorPin ?? null,
            p_new_pin: salesperson.new_pin ?? null,
          },
        );

      if (error) {
        throw formatSalespersonSaveError(error);
      }

      // A RPC retorna a linha completa de partner_salespeople criada,
      // não um UUID. Usamos o id e os dados retornados, apenas
      // completando campos que o banco pode não devolver.
      const returned =
        created as Partial<PartnerSalesperson> | null;

      const createdSalesperson: PartnerSalesperson = {
        // Dados enviados como base...
        ...salesperson,
        // ...sobrescritos pelo que o banco realmente persistiu.
        ...returned,
        id:
          returned?.id ?? crypto.randomUUID(),
        user_id:
          returned?.user_id ??
          currentIdentity.companyUserId,
        created_at:
          returned?.created_at ??
          new Date().toISOString(),
        // Campos protegidos: ficam DEPOIS dos spreads para que o novo PIN
        // em texto puro enviado no formulário (new_pin) nunca seja copiado
        // para o estado. Guardamos apenas se um PIN foi configurado.
        new_pin: null,
        pin_configured: !!salesperson.new_pin,
      };

      dataRevisionRef.current.invalidate(["salespeople"]);
      setData((prev) => ({
        ...prev,
        salespeople: [
          createdSalesperson,
          ...prev.salespeople,
        ],
      }));

      if (typeof window !== 'undefined' && typeof Event !== 'undefined') window.dispatchEvent(new Event('distrihub:operators-changed'));
      return createdSalesperson;
    },
    [requireIdentity],
  );

  const updateSalesperson = useCallback(
    async (
      id: string,
      salesperson: Partial<PartnerSalesperson>,
      operatorId?: string | null,
      operatorPin?: string | null,
    ) => {
      const currentIdentity = requireIdentity();

      if (salesperson.can_edit_sale_price !== undefined) {
        if (Object.keys(salesperson).some(key => key !== 'can_edit_sale_price')) throw new Error('Salve a permissão de preço separadamente dos demais dados.');
        if (!isSupabaseConfigured || !supabase) throw new Error('Supabase não configurado.');
        const existing = data.salespeople.find(item => item.id === id);
        if (!existing) throw new Error('Operador não encontrado.');
        const { data: allowed, error } = await supabase.rpc('set_partner_salesperson_price_permission', {
          p_salesperson_id: id, p_allowed: salesperson.can_edit_sale_price,
          p_operator_id: operatorId ?? null, p_operator_pin: operatorPin ?? null,
        });
        if (error) throw formatSalespersonSaveError(error);
        if (allowed !== salesperson.can_edit_sale_price) throw new Error('Não foi possível confirmar a permissão de preço.');
        const updated = { ...existing, can_edit_sale_price: allowed };
        dataRevisionRef.current.invalidate(['salespeople']);
        setData(previous => ({ ...previous, salespeople: previous.salespeople.map(person => person.id === id ? updated : person) }));
        if (typeof window !== 'undefined' && typeof Event !== 'undefined') window.dispatchEvent(new Event('distrihub:operators-changed'));
        return updated;
      }

      if (currentIdentity.salespersonId) {
        throw new Error(
          'Funcionários não podem alterar operadores.',
        );
      }

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const existing =
        data.salespeople.find(
          (item) => item.id === id,
        );

      if (!existing) {
        throw new Error(
          'Operador não encontrado.',
        );
      }

      if (salesperson.can_access_all_branches !== undefined) {
        if (Object.keys(salesperson).some(key => key !== 'can_access_all_branches')) throw new Error('Salve a autorização de filiais separadamente dos demais dados.');
        const { data: allowed, error } = await supabase.rpc('set_partner_salesperson_branch_access', {
          p_salesperson_id: id, p_allowed: salesperson.can_access_all_branches,
        });
        if (error) throw formatSalespersonSaveError(error);
        if (allowed !== salesperson.can_access_all_branches) throw new Error('Não foi possível confirmar a autorização de filiais.');
        const updated = { ...existing, can_access_all_branches: allowed };
        dataRevisionRef.current.invalidate(['salespeople']);
        setData(previous => ({ ...previous, salespeople: previous.salespeople.map(person => person.id === id ? updated : person) }));
        if (typeof window !== 'undefined' && typeof Event !== 'undefined') window.dispatchEvent(new Event('distrihub:operators-changed'));
        return updated;
      }

      // Mesma assinatura de produção da criação (11 parâmetros);
      // p_salesperson_id identifica o colaborador que está sendo editado.
      const { data: confirmedSalesperson, error } =
        await supabase.rpc(
          'update_partner_salesperson_access',
          {
            p_blocked_modules: salesperson.blocked_modules ?? existing.blocked_modules ?? [],
            p_salesperson_id: id,
            p_name:
              salesperson.name ??
              existing.name,
            p_role:
              salesperson.role ??
              existing.role,
            p_commission_rate:
              salesperson.commission_rate ??
              existing.commission_rate ??
              0,
            p_phone:
              salesperson.phone ??
              existing.phone ??
              null,
            p_email:
              salesperson.email === undefined
                ? normalizeSalespersonEmail(existing.email)
                : normalizeSalespersonEmail(salesperson.email),
            p_is_active:
              salesperson.is_active ??
              existing.is_active,
            p_branch_id:
              salesperson.branch_id ??
              existing.branch_id ??
              null,
            p_operator_id:
              operatorId ?? null,
            p_operator_pin:
              operatorPin ?? null,
            p_new_pin:
              salesperson.new_pin ?? null,
          },
        );

      if (error) {
        throw formatSalespersonSaveError(error);
      }

      // A RPC retorna o id (uuid) do colaborador, não a linha completa.
      const updatedSalesperson: PartnerSalesperson = {
        ...existing,
        ...salesperson,
        ...(confirmedSalesperson && typeof confirmedSalesperson === 'object' && !Array.isArray(confirmedSalesperson) ? confirmedSalesperson as Partial<PartnerSalesperson> : {}),
        id,
        new_pin: null,
        pin_configured: salesperson.new_pin
          ? true
          : existing.pin_configured ?? false,
      };

      dataRevisionRef.current.invalidate(["salespeople"]);
      setData((prev) => ({
        ...prev,
        salespeople:
          prev.salespeople.map(
            (item) =>
              item.id === id
                ? updatedSalesperson
                : item,
          ),
      }));

      if (typeof window !== 'undefined' && typeof Event !== 'undefined') window.dispatchEvent(new Event('distrihub:operators-changed'));
      return updatedSalesperson;
    },
    [data.salespeople, requireIdentity],
  );

  const deleteSalesperson = useCallback(
    async (
      id: string,
      operatorId?: string | null,
      operatorPin?: string | null,
    ) => {
      const currentIdentity = requireIdentity();
      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const existing = data.salespeople.find(
        (item) => item.id === id,
      );

      if (!existing) {
        throw new Error('Operador não encontrado.');
      }

      const { data: confirmed, error } = await supabase.rpc(
        'execute_partner_salesperson_mutation',
        {
          p_name: existing.name,
          p_role: existing.role,
          p_commission_rate: existing.commission_rate ?? 0,
          p_phone: existing.phone ?? null,
          p_email: normalizeSalespersonEmail(existing.email),
          p_is_active: false,
          p_branch_id: existing.branch_id ?? null,
          p_salesperson_id: id,
          p_operator_id: operatorId ?? null,
          p_operator_pin: operatorPin ?? null,
          p_new_pin: null,
        },
      );

      if (error) {
        throw formatSalespersonSaveError(error);
      }

      const confirmedRow = Array.isArray(confirmed) && confirmed.length === 1 ? confirmed[0] : confirmed;
      if (!confirmedRow || confirmedRow.id !== id || confirmedRow.user_id !== currentIdentity.companyUserId || confirmedRow.active !== false) {
        throw new Error('O servidor não confirmou a desativação. Atualize a lista antes de tentar novamente.');
      }
      if (identityScopeRef.current !== currentIdentity.authUserId + ':' + currentIdentity.companyUserId) return;

      dataRevisionRef.current.invalidate(["salespeople"]);
      setData((prev) => ({
        ...prev,
        salespeople:
          prev.salespeople.map((item) =>
            item.id === id
              ? { ...item, active: false, is_active: false }
              : item,
          ),
      }));
      if (typeof window !== 'undefined' && typeof Event !== 'undefined') window.dispatchEvent(new Event('distrihub:operators-changed'));
    },
    [data.salespeople, requireIdentity],
  );

  const createInvoice = useCallback(
    async (
      invoice: PartnerInvoice,
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      ensureEmployeeBranch(
        currentIdentity,
        invoice.branch_id,
      );

      const { data: created, error } =
        await supabase
          .from('partner_invoices')
          .insert({
            ...invoice,
            user_id:
              currentIdentity.companyUserId,
          })
          .select()
          .single();

      if (error) {
        throw error;
      }

      const createdInvoice =
        created as PartnerInvoice;

      dataRevisionRef.current.invalidate(["invoices"]);
      setData((prev) => ({
        ...prev,
        invoices: [
          createdInvoice,
          ...prev.invoices,
        ],
      }));

      return createdInvoice;
    },
    [requireIdentity],
  );

  const updateInvoice = useCallback(
    async (
      id: string,
      invoice: Partial<PartnerInvoice>,
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const existing =
        data.invoices.find(
          (item) => item.id === id,
        );

      if (!existing) {
        throw new Error(
          'Fatura não encontrada.',
        );
      }

      ensureEmployeeBranch(
        currentIdentity,
        invoice.branch_id ??
          existing.branch_id,
      );

      const { data: updated, error } =
        await supabase
          .from('partner_invoices')
          .update(invoice)
          .eq('id', id)
          .eq(
            'user_id',
            currentIdentity.companyUserId,
          )
          .select()
          .single();

      if (error) {
        throw error;
      }

      dataRevisionRef.current.invalidate(["invoices"]);
      setData((prev) => ({
        ...prev,
        invoices: prev.invoices.map(
          (item) =>
            item.id === id
              ? (updated as PartnerInvoice)
              : item,
        ),
      }));

      return updated as PartnerInvoice;
    },
    [data.invoices, requireIdentity],
  );

  const addServiceOrder = useCallback(
    async (
      serviceOrder: ServiceOrder,
    ) => {
      const currentIdentity = requireIdentity();

      if (!serviceOrder.branch_id) {
        throw new Error(
          'Ordem de serviço sem filial.',
        );
      }

      ensureEmployeeBranch(
        currentIdentity,
        serviceOrder.branch_id,
      );

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const { data: created, error } =
        await supabase
          .from('service_orders')
          .insert({
            ...serviceOrder,
            user_id:
              currentIdentity.companyUserId,
          })
          .select()
          .single();

      if (error) {
        throw error;
      }

      const createdOrder =
        created as ServiceOrder;

      dataRevisionRef.current.invalidate(["serviceOrders"]);
      setData((prev) => ({
        ...prev,
        serviceOrders: [
          createdOrder,
          ...prev.serviceOrders,
        ],
      }));

      return createdOrder;
    },
    [requireIdentity],
  );

  const updateServiceOrder = useCallback(
    async (
      id: string,
      serviceOrder: Partial<ServiceOrder>,
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const existing =
        data.serviceOrders.find(
          (item) => item.id === id,
        );

      if (!existing) {
        throw new Error(
          'Ordem de serviço não encontrada.',
        );
      }

      ensureEmployeeBranch(
        currentIdentity,
        serviceOrder.branch_id ??
          existing.branch_id,
      );

      const { data: updated, error } =
        await supabase
          .from('service_orders')
          .update(serviceOrder)
          .eq('id', id)
          .eq(
            'user_id',
            currentIdentity.companyUserId,
          )
          .select()
          .single();

      if (error) {
        throw error;
      }

      dataRevisionRef.current.invalidate(["serviceOrders"]);
      setData((prev) => ({
        ...prev,
        serviceOrders:
          prev.serviceOrders.map(
            (item) =>
              item.id === id
                ? (updated as ServiceOrder)
                : item,
          ),
      }));

      return updated as ServiceOrder;
    },
    [data.serviceOrders, requireIdentity],
  );

  const updateServiceOrderStatus = useCallback(
    async (
      id: string,
      status: ServiceOrderStatus,
    ) => {
      return updateServiceOrder(id, {
        status,
      });
    },
    [updateServiceOrder],
  );

  const updateServiceOrderApproval = useCallback(
    async (
      id: string,
      approvalStatus: ServiceOrderApprovalStatus,
    ) => {
      return updateServiceOrder(id, {
        approval_status:
          approvalStatus,
      });
    },
    [updateServiceOrder],
  );

  const addServiceOrderItem = useCallback(
    async (
      item: ServiceOrderItem,
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const order =
        data.serviceOrders.find(
          (serviceOrder) =>
            serviceOrder.id ===
            item.service_order_id,
        );

      if (!order) {
        throw new Error(
          'Ordem de serviço não encontrada.',
        );
      }

      ensureEmployeeBranch(
        currentIdentity,
        order.branch_id,
      );

      const { data: created, error } =
        await supabase
          .from('service_order_items')
          .insert({
            ...item,
            user_id:
              currentIdentity.companyUserId,
          })
          .select()
          .single();

      if (error) {
        throw error;
      }

      const createdItem =
        created as ServiceOrderItem;

      dataRevisionRef.current.invalidate(["serviceOrderItems"]);
      setData((prev) => ({
        ...prev,
        serviceOrderItems: [
          createdItem,
          ...prev.serviceOrderItems,
        ],
      }));

      return createdItem;
    },
    [data.serviceOrders, requireIdentity],
  );

  const deleteServiceOrderItem = useCallback(
    async (id: string) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const item =
        data.serviceOrderItems.find(
          (currentItem) =>
            currentItem.id === id,
        );

      if (!item) {
        throw new Error(
          'Item da ordem de serviço não encontrado.',
        );
      }

      const order =
        data.serviceOrders.find(
          (serviceOrder) =>
            serviceOrder.id ===
            item.service_order_id,
        );

      if (!order) {
        throw new Error(
          'Ordem de serviço não encontrada.',
        );
      }

      ensureEmployeeBranch(
        currentIdentity,
        order.branch_id,
      );

      const { error } = await supabase
        .from('service_order_items')
        .delete()
        .eq('id', id)
        .eq(
          'user_id',
          currentIdentity.companyUserId,
        );

      if (error) {
        throw error;
      }

      dataRevisionRef.current.invalidate(["serviceOrderItems"]);
      setData((prev) => ({
        ...prev,
        serviceOrderItems:
          prev.serviceOrderItems.filter(
            (currentItem) =>
              currentItem.id !== id,
          ),
      }));
    },
    [
      data.serviceOrderItems,
      data.serviceOrders,
      requireIdentity,
    ],
  );

  const addServiceOrderPhoto = useCallback(
    async (
      photo: ServiceOrderPhoto,
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const order =
        data.serviceOrders.find(
          (serviceOrder) =>
            serviceOrder.id ===
            photo.service_order_id,
        );

      if (!order) {
        throw new Error(
          'Ordem de serviço não encontrada.',
        );
      }

      ensureEmployeeBranch(
        currentIdentity,
        order.branch_id,
      );

      const { data: created, error } =
        await supabase
          .from('service_order_photos')
          .insert({
            ...photo,
            user_id:
              currentIdentity.companyUserId,
          })
          .select()
          .single();

      if (error) {
        throw error;
      }

      const createdPhoto =
        created as ServiceOrderPhoto;

      dataRevisionRef.current.invalidate(["serviceOrderPhotos"]);
      setData((prev) => ({
        ...prev,
        serviceOrderPhotos: [
          ...prev.serviceOrderPhotos,
          createdPhoto,
        ],
      }));

      return createdPhoto;
    },
    [data.serviceOrders, requireIdentity],
  );

  const deleteServiceOrderPhoto = useCallback(
    async (id: string) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const photo =
        data.serviceOrderPhotos.find(
          (currentPhoto) =>
            currentPhoto.id === id,
        );

      if (!photo) {
        throw new Error(
          'Foto da ordem de serviço não encontrada.',
        );
      }

      const order =
        data.serviceOrders.find(
          (serviceOrder) =>
            serviceOrder.id ===
            photo.service_order_id,
        );

      if (!order) {
        throw new Error(
          'Ordem de serviço não encontrada.',
        );
      }

      ensureEmployeeBranch(
        currentIdentity,
        order.branch_id,
      );

      const { error } = await supabase
        .from('service_order_photos')
        .delete()
        .eq('id', id)
        .eq(
          'user_id',
          currentIdentity.companyUserId,
        );

      if (error) {
        throw error;
      }

      dataRevisionRef.current.invalidate(["serviceOrderPhotos"]);
      setData((prev) => ({
        ...prev,
        serviceOrderPhotos:
          prev.serviceOrderPhotos.filter(
            (currentPhoto) =>
              currentPhoto.id !== id,
          ),
      }));
    },
    [
      data.serviceOrderPhotos,
      data.serviceOrders,
      requireIdentity,
    ],
  );

  const createB2BOrder = useCallback(
    async (order: B2BOrder) => {
      const currentIdentity = requireIdentity();

      if (!order.branch_id) {
        throw new Error(
          'Pedido sem filial selecionada.',
        );
      }

      ensureEmployeeBranch(
        currentIdentity,
        order.branch_id,
      );

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const { data: created, error } =
        await supabase
          .from('b2b_orders')
          .insert({
            ...order,
            user_id:
              currentIdentity.companyUserId,
          })
          .select()
          .single();

      if (error) {
        throw error;
      }

      const createdOrder =
        created as B2BOrder;

      dataRevisionRef.current.invalidate(["orders"]);
      setData((prev) => ({
        ...prev,
        orders: [
          createdOrder,
          ...prev.orders,
        ],
      }));

      return createdOrder;
    },
    [requireIdentity],
  );

  const updateB2BOrder = useCallback(
    async (
      id: string,
      order: Partial<B2BOrder>,
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const existing =
        data.orders.find(
          (item) => item.id === id,
        );

      if (!existing) {
        throw new Error(
          'Pedido não encontrado.',
        );
      }

      ensureEmployeeBranch(
        currentIdentity,
        order.branch_id ??
          existing.branch_id,
      );

      const { data: updated, error } =
        await supabase
          .from('b2b_orders')
          .update(order)
          .eq('id', id)
          .eq(
            'user_id',
            currentIdentity.companyUserId,
          )
          .select()
          .single();

      if (error) {
        throw error;
      }

      dataRevisionRef.current.invalidate(["orders"]);
      setData((prev) => ({
        ...prev,
        orders: prev.orders.map(
          (item) =>
            item.id === id
              ? (updated as B2BOrder)
              : item,
        ),
      }));

      return updated as B2BOrder;
    },
    [data.orders, requireIdentity],
  );

  const recordStockMovement = useCallback(
    async (
      movement: StockMovement,
      operatorId?: string | null,
      operatorPin?: string | null,
    ) => {
      // This RPC authenticates the current session; legacy operator parameters
      // are accepted for compatibility and are never persisted.
      void operatorId;
      void operatorPin;
      const currentIdentity = requireIdentity();

      if (!movement.branch_id) {
        throw new Error(
          'Movimentação sem filial.',
        );
      }

      ensureEmployeeBranch(
        currentIdentity,
        movement.branch_id,
      );

      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase não configurado.');
      }

      const { data: created, error } =
        await supabase.rpc(
          'record_partner_stock_movement',
          {
            p_product_id:
              movement.product_id,
            p_branch_id:
              movement.branch_id,
            p_type: movement.type,
            p_quantity:
              movement.quantity,
            p_reason:
              movement.reason,
          },
        );

      if (error) {
        throw error;
      }

      // A RPC retorna a linha do movimento criado. Se algum dia retornar
      // apenas o id, ainda montamos o objeto local a partir do payload.
      const returned =
        created as StockMovement | string | null;

      const createdMovement: StockMovement =
        typeof returned === 'object' &&
        returned !== null
          ? {
              ...movement,
              ...returned,
            }
          : {
              ...movement,
              id:
                typeof returned === 'string'
                  ? returned
                  : crypto.randomUUID(),
              user_id:
                currentIdentity.companyUserId,
              created_at:
                new Date().toISOString(),
            };

      dataRevisionRef.current.invalidate(["movements"]);
      setData((prev) => ({
        ...prev,
        movements: [
          createdMovement,
          ...prev.movements,
        ],
      }));

      return createdMovement;
    },
    [requireIdentity],
  );

  const recordAuditLog = useCallback(
    async (
      action: string,
      entityType: string,
      entityId: string | null,
      details: string,
      actorRole: SalespersonRole = 'administrador',
    ) => {
      const currentIdentity = requireIdentity();

      if (!isSupabaseConfigured || !supabase) {
        return;
      }

      // Nome real do ator já disponível no fluxo: o vendedor da sessão
      // autenticada ou o proprietário. A coluna actor_name é NOT NULL no
      // banco, então sem um nome real não registramos o evento.
      const actorName =
        data.salespeople.find(
          (salesperson) =>
            salesperson.id ===
            currentIdentity.salespersonId,
        )?.name ?? data.profile?.name;

      if (!actorName) {
        return;
      }

      const { data: created, error } =
        await supabase.rpc(
          'record_partner_audit_event',
          {
            p_actor_name: actorName,
            p_actor_role: actorRole,
            p_action: action,
            p_entity_type: entityType,
            p_entity_id:
              entityId ?? null,
            p_details: details,
          },
        );

      if (error) {
        throw error;
      }

      if (created) {
        const log =
          created as AuditLog;

        if (mountedRef.current) {
          dataRevisionRef.current.invalidate(["auditLogs"]);
          setData((prev) => ({
            ...prev,
            auditLogs: [
              log,
              ...prev.auditLogs,
            ],
          }));
        }
      } else {
        void currentIdentity;
      }
    },
    [data.profile?.name, data.salespeople, requireIdentity],
  );

  const prefetchModule = useCallback(async (scope: string) => {
    if (!identity || loading || prefetchInFlightRef.current || scope === resourceScopeRef.current) return;
    if (!requestedResourcesRef.current.every(key => loadCacheRef.current.has(key))) return;
    const collections = partnerResources(scope);
    if (!collections.some(key => loadCacheRef.current.needs(key))) return;
    prefetchInFlightRef.current = true;
    try { await loadData(true, collections, false); }
    finally { prefetchInFlightRef.current = false; }
  }, [identity, loading, loadData]);

  const mergeHistorySales = useCallback((rows: PartnerSale[]) => {
    const current = requireIdentity();
    dataRevisionRef.current.invalidate(['sales']);
    setData(previous => ({ ...previous, sales: rows.reduce((sales, row) => mergePartnerChange(sales, 'UPDATE', row, undefined, current.companyUserId, current.salespersonId ? current.branchId : null, true), previous.sales) }));
  }, [requireIdentity]);

  const load = useCallback(
    async () => {
      await loadData();
    },
    [loadData],
  );

  return {
    ...data,

    loading,
    error,

    isEmployee: isEmployeeIdentity(identity),
    identity,

    load,
    loadData,
    mergeHistorySales,
    prefetchModule,
    resourcesReady: partnerRequiredResources(resourceScopeRef.current).every(key => loadCacheRef.current.has(key)),
    suppliersReady: loadCacheRef.current.has('suppliers'),
    refreshCollections: (keys: PartnerCollection[]) => loadData(true, keys.filter(key => loadCacheRef.current.has(key) || requestedResourcesRef.current.includes(key))),
    synchronize,
    syncing,
    syncError,
    lastSyncedAt,

    addCustomer,
    updateCustomer,
    importStockXml,
    deleteCustomer,

    addProduct,
    findProductDuplicates,
    updateProduct,
    deleteProduct,

    addSupplier,
    updateSupplier,
    deleteSupplier,

    addCategory,
    updateCategory,
    deleteCategory,

    addBranch,
    updateBranch,
    deleteBranch,

    pdvCredits,
    pdvReturnCredits,
    pdvSyncWarning,
    pendingSale,
    refreshPdv,
    retryPendingSale,
    createSale,
    createPreSale,
    updatePreSaleItems,
    updatePreSale,
    updateOpenOrderCustomer,
    updateDelivery,
    finalizePreSale,
    mutateOpenOrder,
    cancelHistorySale,
    cancelSale,
    deleteSale,

    replenishStock,
    recordStockMovement,

    payInvoice,
    financialRecoveries,
    financialRecoveryError,
    createInvoice,
    updateInvoice,

    updateStoreSettings,
    updateProfile,

    createRma,
    updateRmaStatus,
    grantRmaCredit,
    addRmaPhotos,
    refundRma,
    applyRmaCredit,
    deleteRma,

    addCombo,
    updateCombo,
    deleteCombo,

    addModifier,
    updateModifier,
    deleteModifier,

    addSalesperson,
    updateSalesperson,
    deleteSalesperson,

    addServiceOrder,
    updateServiceOrder,
    updateServiceOrderStatus,
    updateServiceOrderApproval,

    addServiceOrderItem,
    deleteServiceOrderItem,

    addServiceOrderPhoto,
    deleteServiceOrderPhoto,

    createB2BOrder,
    updateB2BOrder,

    recordAuditLog,
  };
}

