import { useSupportUnread } from '../hooks/useSupportUnread';
import { SupportUnreadBadge } from './SupportUnreadBadge';
import { ModuleBoundary } from './ModuleBoundary';
import { moduleLoader } from '../lib/moduleLoading';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeft,
  Boxes,
  ShoppingCart,
  Wallet,
  Package,
  BarChart3,
  Wand2,
  Settings,
  Menu,
  X,
  Store,
  Truck,
  ClipboardList,
  FileText,
  Shield,
  Headphones,
  Wrench,
  UserCheck,
  Lock,
  RefreshCw,
  BookOpen,
} from 'lucide-react';

import type { User } from '@supabase/supabase-js';
import type { PartnerSale, SalePayment } from '../types';

import { usePartnerData } from '../hooks/usePartnerData';
import { branchDirectoryRows } from '../lib/partnerSync';
import { useSaasSubscription } from '../hooks/useSaasSubscription';
import { canUseSaasFeature } from '../lib/saas';
import { DeviceAccessGate } from './partner/DeviceSessions';
import { canViewBusinessIntelligence } from '../lib/businessIntelligence';
import { useDeviceHeartbeat } from '../hooks/useDeviceHeartbeat';

import { pdvErrorMessage } from '../lib/pdv';
import { panelStyle } from '../lib/personalization';
import { storeTheme } from '../lib/storeTheme';
import { cadastroDestination, type AdminCadastrosTarget } from '../lib/cadastrosNavigation';
import type { PinOperator } from '../lib/partnerAccess';
import { BranchSelector } from './partner/BranchSelector';
import { useCheckoutCash } from '../hooks/useCheckoutCash';
import { SessionDraftProvider, useSessionDraftState, clearConfirmedPdvDraft } from '../hooks/useSessionDraft';
import { OperatorSelectionStore } from '../lib/checkoutCash';

const loadCadastrosModule = moduleLoader(() => import('./partner/CadastrosModule').then((module) => ({ default: module.CadastrosModule })));
const CadastrosModule = lazy(loadCadastrosModule);
const HelpModule = lazy(() => import('./partner/HelpModule').then(module => ({default:module.HelpModule})));
const loadPdvModule = moduleLoader(() => import('./partner/PdvModule').then((module) => ({ default: module.PdvModule })));
const PdvModule = lazy(loadPdvModule);
const loadCashRegisterModule = moduleLoader(() => import('./partner/CashRegisterModule').then((module) => ({ default: module.CashRegisterModule })));
const CashRegisterModule = lazy(loadCashRegisterModule);
const loadFinancialModule = moduleLoader(() => import('./partner/FinancialModule').then((module) => ({ default: module.FinancialModule })));
const FinancialModule = lazy(loadFinancialModule);
const loadRmaModule = moduleLoader(() => import('./partner/RmaModule').then((module) => ({ default: module.RmaModule })));
const RmaModule = lazy(loadRmaModule);
const loadReportsModule = moduleLoader(() => import('./partner/ReportsModule').then((module) => ({ default: module.ReportsModule })));
const ReportsModule = lazy(loadReportsModule);
const loadWhiteLabelModule = moduleLoader(() => import('./partner/WhiteLabelModule').then((module) => ({ default: module.WhiteLabelModule })));
const WhiteLabelModule = lazy(loadWhiteLabelModule);
const loadMultiStoreModule = moduleLoader(() => import('./partner/MultiStoreModule').then((module) => ({ default: module.MultiStoreModule })));
const MultiStoreModule = lazy(loadMultiStoreModule);
const loadDeliveryModule = moduleLoader(() => import('./partner/DeliveryModule').then((module) => ({ default: module.DeliveryModule })));
const DeliveryModule = lazy(loadDeliveryModule);
const loadSettingsModule = moduleLoader(() => import('./partner/SettingsModule').then((module) => ({ default: module.SettingsModule })));
const SettingsModule = lazy(loadSettingsModule);
const loadOpenOrdersModule = moduleLoader(() => import('./partner/OpenOrdersModule').then((module) => ({ default: module.OpenOrdersModule })));
const OpenOrdersModule = lazy(loadOpenOrdersModule);
const loadFiscalModule = moduleLoader(() => import('./partner/FiscalModule').then((module) => ({ default: module.FiscalModule })));
const FiscalModule = lazy(loadFiscalModule);
const loadAdminModule = moduleLoader(() => import('./partner/AdminModule').then((module) => ({ default: module.AdminModule })));
const AdminModule = lazy(loadAdminModule);
const loadSalesHistoryModule = moduleLoader(() => import('./partner/SalesHistoryModule').then((module) => ({ default: module.SalesHistoryModule })));
const SalesHistoryModule = lazy(loadSalesHistoryModule);
const loadOrderHistoryModule = moduleLoader(() => import('./partner/OrderHistoryModule').then((module) => ({ default: module.OrderHistoryModule })));
const OrderHistoryModule = lazy(loadOrderHistoryModule);
const loadSupportChatModule = moduleLoader(() => import('./partner/SupportChatModule').then((module) => ({ default: module.SupportChatModule })));
const SupportChatModule = lazy(loadSupportChatModule);
const loadServiceOrdersModule = moduleLoader(() => import('./partner/ServiceOrdersModule').then((module) => ({ default: module.ServiceOrdersModule })));
const ServiceOrdersModule = lazy(loadServiceOrdersModule);
const loadCatalogOrdersModule = moduleLoader(() => import('./partner/CatalogOrdersModule').then(module => ({ default: module.CatalogOrdersModule })));
const CatalogOrdersModule = lazy(loadCatalogOrdersModule);

import type {
  StoreSettings,
  BusinessSegment,
  SalespersonRole,
  PartnerProduct,
  PartnerCustomer,
  PartnerSupplier,
  PartnerSalesperson,
  RmaPayload,
  SaleItem,
  CustomerType,
  DeliveryType,
  PartnerIdentity,
} from '../types';

type PartnerPanelProps = {
  accessLocked?: boolean;
  onBack: () => void;
  pinOperator: PinOperator | null;
  onRequestAccess: (mode: 'employee' | 'owner') => void;
  onSelectOperatorBranch?: (id: string) => Promise<void>;
  user: User | null;
  identity: PartnerIdentity | null;
  identityError: string | null;
  onRetryIdentity?: () => void;
  segment: BusinessSegment;
  initialTab?: string;
  onConsumeInitialTab?: () => void;
};

type Tab =
  | 'cadastros'
  | 'pdv'
  | 'caixa'
  | 'pedidos'
  | 'os'
  | 'historico'
  | 'suporte'
  | 'fiscal'
  | 'administrativo'
  | 'financeiro'
  | 'rma'
  | 'relatorios'
  | 'white-label'
  | 'configuracoes'
  | 'entregas';

const tabCodeLoaders: Record<Tab, () => Promise<unknown>> = {
  'cadastros': loadCadastrosModule,
  'pdv': loadPdvModule,
  'caixa': loadCashRegisterModule,
  'pedidos': loadOpenOrdersModule,
  'os': loadServiceOrdersModule,
  'historico': loadSalesHistoryModule,
  'suporte': loadSupportChatModule,
  'fiscal': loadFiscalModule,
  'administrativo': loadAdminModule,
  'financeiro': loadFinancialModule,
  'rma': loadRmaModule,
  'relatorios': loadReportsModule,
  'white-label': loadWhiteLabelModule,
  'configuracoes': loadSettingsModule,
  'entregas': loadDeliveryModule,
};

const allTabs: {
  id: Tab;
  label: string;
  icon: typeof Boxes;
}[] = [
  {
    id: 'cadastros',
    label: 'Cadastros',
    icon: Boxes,
  },
  {
    id: 'pdv',
    label: 'PDV & Vendas',
    icon: ShoppingCart,
  },
  {
    id: 'caixa',
    label: 'Caixa',
    icon: Wallet,
  },
  {
    id: 'pedidos',
    label: 'Pedidos em Aberto',
    icon: ClipboardList,
  },
  {
    id: 'os',
    label: 'Ordens de Serviço',
    icon: Wrench,
  },
  {
    id: 'historico',
    label: 'Histórico',
    icon: FileText,
  },
  {
    id: 'suporte',
    label: 'Suporte',
    icon: Headphones,
  },
  {
    id: 'fiscal',
    label: 'Nota Fiscal',
    icon: FileText,
  },
  {
    id: 'administrativo',
    label: 'Administrativo',
    icon: Shield,
  },
  {
    id: 'entregas',
    label: 'Gestão de Entregas',
    icon: Truck,
  },
  {
    id: 'financeiro',
    label: 'Financeiro',
    icon: Wallet,
  },
  {
    id: 'rma',
    label: 'RMA & Devoluções',
    icon: Package,
  },
  {
    id: 'relatorios',
    label: 'Relatórios & CRM',
    icon: BarChart3,
  },
  {
    id: 'white-label',
    label: 'Personalização',
    icon: Wand2,
  },
  {
    id: 'configuracoes',
    label: 'Configurações',
    icon: Settings,
  },
];

const gerenteBlockedTabs: Tab[] = [
  'financeiro',
  'white-label',
  'configuracoes',
];

const vendedorBlockedTabs: Tab[] = [
  'financeiro',
  'white-label',
  'configuracoes',
  'entregas',
  'fiscal',
];

const atendenteBlockedTabs: Tab[] = [
  'caixa',
  'financeiro',
  'white-label',
  'configuracoes',
  'entregas',
  'fiscal',
  'rma',
];

const tecnicoBlockedTabs: Tab[] = [
  'caixa',
  'cadastros',
  'pdv',
  'financeiro',
  'white-label',
  'configuracoes',
  'entregas',
  'relatorios',
  'fiscal',
];

const logisticaBlockedTabs: Tab[] = [
  'caixa',
  'cadastros',
  'pdv',
  'financeiro',
  'rma',
  'white-label',
  'configuracoes',
  'relatorios',
  'fiscal',
];

export function PartnerPanel({
  accessLocked = false,
  onBack,
  pinOperator,
  onRequestAccess,
  onSelectOperatorBranch,
  user,
  identity: authenticatedIdentity,
  identityError,
  onRetryIdentity,
  segment,
  initialTab,
  onConsumeInitialTab,
}: PartnerPanelProps) {
  const identity = useMemo(() => accessLocked ? null : authenticatedIdentity && pinOperator ? {
    ...authenticatedIdentity, salespersonId: pinOperator.id, branchId: pinOperator.branchId, role: pinOperator.role,
  } : authenticatedIdentity, [authenticatedIdentity, pinOperator, accessLocked]);
  const [activeTab, setActiveTab] = useSessionDraftState<Tab>(
    'partner:active-tab',
    'cadastros',
    `user:${user?.id ?? identity?.authUserId ?? 'pending'}`,
  );
  const supportUnread = useSupportUnread(accessLocked ? undefined : user?.id);
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(() => new Set(['cadastros']));
  useEffect(() => {
    setVisitedTabs((current) => current.has(activeTab) ? current : new Set(current).add(activeTab));
  }, [activeTab, setVisitedTabs]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>(() => {
    if (!identity || identity.salespersonId) return '';
    try { return new OperatorSelectionStore(sessionStorage, `${identity.authUserId}:${identity.companyUserId}`).read()?.branchId ?? ''; }
    catch { return ''; }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const [branchAccessError, setBranchAccessError] = useState<string | null>(null);
  useEffect(() => {
    if (!sidebarOpen) return;
    const mobile = window.matchMedia('(max-width: 900px)');
    if (!mobile.matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    const closeOnDesktop = () => { if (!mobile.matches) setSidebarOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    mobile.addEventListener('change', closeOnDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
      mobile.removeEventListener('change', closeOnDesktop);
    };
  }, [sidebarOpen]);

  useEffect(() => {
    setVisitedTabs((current) => current.has(activeTab) ? current : new Set(current).add(activeTab));
  }, [activeTab]);

  const [adminDataScope, setAdminDataScope] = useState('dashboard');
  const [reportDataScope, setReportDataScope] = useState('vendas');
  const [cadastroDataScope, setCadastroDataScope] = useState('produtos');
  const deviceSession = useDeviceHeartbeat(identity?.companyUserId, identity?.salespersonId ? identity.branchId : selectedBranchId || null);
  const partner = usePartnerData(deviceSession.ready ? identity : null, identity?.salespersonId ? identity.branchId : selectedBranchId || null, activeTab === 'cadastros' || (activeTab === 'administrativo' && adminDataScope === 'cadastros') ? 'cadastros:' + cadastroDataScope : activeTab === 'relatorios' || (activeTab === 'administrativo' && adminDataScope === 'relatorios') ? 'relatorios:' + reportDataScope : activeTab === 'administrativo' ? 'administrativo:' + adminDataScope : activeTab);
  const saas = useSaasSubscription(identity?.companyUserId);
  const [pdvRevision, setPdvRevision] = useState(0);
  const [preSaleToCheckout, setPreSaleToCheckout] = useState<PartnerSale | null>(null);
  const [pdvReadError, setPdvReadError] = useState<string | null>(null);
  const [recoveringSale, setRecoveringSale] = useState(false);
  const [recoveredSaleNotice, setRecoveredSaleNotice] = useState<string | null>(null);
  useEffect(() => setRecoveredSaleNotice(null), [identity?.authUserId, identity?.companyUserId]);
  const [refreshingPdv, setRefreshingPdv] = useState(false);
  const [managedCashSession, setManagedCashSession] = useState<{ id: string; operator_name: string } | null>(null);
  const { refreshPdv } = partner;

  const activeSalesperson = identity?.salespersonId
    ? partner.salespeople.find(
        (salesperson) =>
          salesperson.id === identity.salespersonId,
      ) ?? {
        id: identity.salespersonId,
        user_id: identity.companyUserId,
        name: pinOperator?.name ?? 'Funcionário',
        role: identity.role,
        commission_rate: 0,
        phone: null,
        email: null,
        is_active: true,
        branch_id: identity.branchId,
        created_at: '',
        updated_at: '',
      }
    : null;

  const isEmployeeRestricted = Boolean(identity?.salespersonId);

  const lockedBranchId = isEmployeeRestricted
    ? identity?.branchId ?? null
    : null;

  const effectiveBranchId = accessLocked ? '' :
    isEmployeeRestricted ? lockedBranchId ?? '' : selectedBranchId;
  useEffect(() => {
    if (!effectiveBranchId || partner.loading || (activeTab !== 'pdv' && activeTab !== 'pedidos')) return;
    let active = true;
    setPdvReadError(null);
    void refreshPdv(effectiveBranchId).catch(error => { if (active) setPdvReadError(pdvErrorMessage(error)); });
    return () => { active = false; };
  }, [effectiveBranchId, activeTab, partner.loading, refreshPdv]);

  async function handleRefreshPdv() {
    if (!effectiveBranchId || refreshingPdv) return;
    setRefreshingPdv(true);
    try { await refreshPdv(effectiveBranchId); setPdvReadError(null); }
    catch (error) { setPdvReadError(pdvErrorMessage(error)); }
    finally { setRefreshingPdv(false); }
  }

  async function handleRecoverSale() {
    if (recoveringSale) return;
    setRecoveringSale(true);
    try {
      const { operatorId, operatorPin } = getOperatorContext();
      const confirmed = await partner.retryPendingSale(operatorId, operatorPin);
      const sourceScope = confirmed.draft_scope ?? `${identity?.authUserId}:${identity?.companyUserId}:workspace:${confirmed.branch_id}:pdv:${confirmed.branch_id}`;
      clearConfirmedPdvDraft(sourceScope, confirmed.status === 'pre_venda' ? 'presale' : 'checkout');
      setRecoveredSaleNotice(`${confirmed.status === 'pre_venda' ? 'Pré-venda' : 'Venda'} #${confirmed.sale_number ?? confirmed.id.slice(0, 8).toUpperCase()} recuperada e confirmada. O rascunho desta operação foi limpo.`);
      setPdvReadError(null);
      // Clear the original cart only after this same sale has been confirmed.
      setPdvRevision(value => value + 1);
    } catch (error) { setPdvReadError(pdvErrorMessage(error)); }
    finally { setRecoveringSale(false); }
  }

  const effectiveRole: SalespersonRole = activeSalesperson
    ? activeSalesperson.role
    : 'administrador';

  const operatorScope = `${identity?.authUserId}:${identity?.companyUserId}`;
  useEffect(() => { setManagedCashSession(null); }, [operatorScope, effectiveBranchId]);
  useEffect(() => {
    if (!identity || isEmployeeRestricted) return;
    try { new OperatorSelectionStore(sessionStorage, operatorScope).save({ branchId: selectedBranchId, operatorId: null }); }
    catch { /* Storage does not change account authorization. */ }
  }, [identity, isEmployeeRestricted, operatorScope, selectedBranchId]);

  const checkoutCash = useCheckoutCash(effectiveBranchId, pinOperator?.id ?? null, pinOperator?.pin ?? null, managedCashSession?.operator_name ?? activeSalesperson?.name ?? 'Proprietário / Administrador', operatorScope, !accessLocked && ['pdv', 'pedidos', 'caixa'].includes(activeTab), managedCashSession?.id ?? null, activeTab === 'pedidos' ? 'pedidos' : activeTab === 'caixa' ? 'caixa' : 'pdv');
  const refreshCash = checkoutCash.refresh;
  useEffect(() => {
    if (!accessLocked && (activeTab === 'pdv' || activeTab === 'pedidos' || activeTab === 'caixa')) void refreshCash().catch(() => {});
  }, [activeTab, refreshCash, partner.sales, accessLocked]);

  useEffect(() => {
    if (
      isEmployeeRestricted &&
      lockedBranchId &&
      selectedBranchId !== lockedBranchId
    ) {
      setSelectedBranchId(lockedBranchId);
    }
  }, [
    isEmployeeRestricted,
    lockedBranchId,
    selectedBranchId,
  ]);

  useEffect(() => {
    if (initialTab) {
      const validTab = allTabs.find(
        (tab) => tab.id === (initialTab === 'filiais' ? 'configuracoes' : initialTab),
      );

      if (validTab) {
        setActiveTab(validTab.id);
      }

      onConsumeInitialTab?.();
    }
  }, [initialTab, onConsumeInitialTab, setActiveTab]);

  const roleBlockedTabs = useMemo(() => {
    switch (effectiveRole) {
      case 'gerente':
        return gerenteBlockedTabs;

      case 'vendedor':
        return vendedorBlockedTabs;

      case 'caixa':
        return vendedorBlockedTabs;

      case 'atendente':
        return atendenteBlockedTabs;

      case 'tecnico':
        return tecnicoBlockedTabs;

      case 'logistica':
        return logisticaBlockedTabs;

      default:
        return [];
    }
  }, [effectiveRole]);

  const blockedTabs = useMemo(() => [...new Set<Tab>([
    ...roleBlockedTabs,
    ...(activeSalesperson?.blocked_modules ?? []).filter((module): module is Tab => allTabs.some(tab => tab.id === module)),
  ])], [roleBlockedTabs, activeSalesperson?.blocked_modules]);

  const visibleTabs = useMemo(() => {
    if (accessLocked) return allTabs;
    return allTabs.filter((tab) =>
      !blockedTabs.includes(tab.id) && canUseSaasFeature(saas.subscription, tab.id),
    );
  }, [blockedTabs, saas.subscription, accessLocked]);

  useEffect(() => {
    if (!identity?.companyUserId || partner.loading || saas.loading || (!saas.subscription && !saas.error)) return;
    if (
      !visibleTabs.some(
        (tab) => tab.id === activeTab,
      )
    ) {
      setActiveTab(
        visibleTabs[0]?.id ?? 'suporte',
      );
    }
  }, [visibleTabs, activeTab, identity?.companyUserId, partner.loading, saas.loading, saas.subscription, saas.error, setActiveTab]);

  const lockedBranch = useMemo(() => {
    if (!lockedBranchId) {
      return null;
    }

    return (
      partner.branches.find(
        (branch) => branch.id === lockedBranchId,
      ) ?? null
    );
  }, [partner.branches, lockedBranchId]);

  const filteredSuppliers = branchDirectoryRows(partner.suppliers, effectiveBranchId);
  const filteredCategories = branchDirectoryRows(partner.categories, effectiveBranchId);

  const filteredProducts = useMemo(() => {
    if (!effectiveBranchId) {
      return partner.products;
    }

    return partner.products.filter(
      (product) =>
        product.branch_id === effectiveBranchId,
    );
  }, [partner.products, effectiveBranchId]);

  const filteredMovements = useMemo(() => {
    if (!effectiveBranchId) {
      return partner.movements;
    }

    return partner.movements.filter(
      (movement) =>
        movement.branch_id === effectiveBranchId,
    );
  }, [partner.movements, effectiveBranchId]);

  const filteredSales = useMemo(() => {
    if (!effectiveBranchId) {
      return partner.sales;
    }

    return partner.sales.filter(
      (sale) =>
        sale.branch_id === effectiveBranchId,
    );
  }, [partner.sales, effectiveBranchId]);

  const filteredCustomers = useMemo(() => {
    if (!effectiveBranchId) {
      return partner.customers;
    }

    return partner.customers.filter(
      (customer) =>
        !customer.branch_id ||
        customer.branch_id === effectiveBranchId,
    );
  }, [partner.customers, effectiveBranchId]);

  const filteredRmaRequests = useMemo(() => {
    if (!effectiveBranchId) {
      return partner.rmas;
    }

    return partner.rmas.filter(
      (request) =>
        !request.branch_id ||
        request.branch_id === effectiveBranchId,
    );
  }, [partner.rmas, effectiveBranchId]);

  const filteredInvoices = useMemo(() => {
    if (!effectiveBranchId) {
      return partner.invoices;
    }

    return partner.invoices.filter(
      (invoice) =>
        !invoice.branch_id ||
        invoice.branch_id === effectiveBranchId,
    );
  }, [partner.invoices, effectiveBranchId]);

  const filteredOrders = useMemo(() => {
    if (!effectiveBranchId) {
      return partner.orders;
    }

    return partner.orders.filter(
      (order) =>
        !order.branch_id ||
        order.branch_id === effectiveBranchId,
    );
  }, [partner.orders, effectiveBranchId]);

  const filteredSalespeople = useMemo(() => {
    if (!effectiveBranchId) {
      return partner.salespeople;
    }

    return partner.salespeople.filter(
      (salesperson) =>
        !salesperson.branch_id ||
        salesperson.can_access_all_branches === true ||
        salesperson.branch_id === effectiveBranchId,
    );
  }, [partner.salespeople, effectiveBranchId]);

  function getOperatorContext() {
    return { operatorId: pinOperator?.id ?? null, operatorPin: pinOperator?.pin ?? null };
  }

  function handleSelectBranch(id: string) {
    if (isEmployeeRestricted && pinOperator?.canAccessAllBranches && onSelectOperatorBranch) {
      if (!id || switchingBranch) return;
      setSwitchingBranch(true); setBranchAccessError(null);
      void onSelectOperatorBranch(id).catch(error => setBranchAccessError(error instanceof Error ? error.message : 'Não foi possível mudar de filial.'))
        .finally(() => setSwitchingBranch(false));
      return;
    }
    if (isEmployeeRestricted) {
      if (
        !lockedBranchId
      ) {
        window.alert(
          'Acesso negado: seu usuário não possui uma filial vinculada.',
        );
        return;
      }

      if (id !== lockedBranchId) {
        window.alert(
          'Acesso negado: você só pode acessar a filial vinculada ao seu usuário.',
        );
        return;
      }
    }

    /*
     * ID vazio representa Visão Consolidada.
     * Isso é permitido apenas para proprietário/admin.
     */
    if (!id) {
      if (isEmployeeRestricted) {
        return;
      }

      setSelectedBranchId('');
      return;
    }

    const branchExists = partner.branches.some(
      (branch) => branch.id === id,
    );

    if (!branchExists) {
      window.alert(
        'A filial selecionada não foi encontrada.',
      );
      return;
    }

    setSelectedBranchId(id);

  }

  async function handleAddProduct(
    product: Omit<
      PartnerProduct,
      'id' | 'user_id' | 'created_at' | 'updated_at'
    >,
  ) {
    const targetBranch = isEmployeeRestricted
      ? effectiveBranchId
      : product.branch_id || effectiveBranchId;

    if (!targetBranch) {
      window.alert(
        'Selecione uma filial antes de cadastrar produtos.',
      );
      return;
    }

    if (
      isEmployeeRestricted &&
      targetBranch !== effectiveBranchId
    ) {
      window.alert(
        'Acesso negado: você só pode cadastrar produtos na sua filial vinculada.',
      );
      return;
    }

    const {
      operatorId,
      operatorPin,
    } = getOperatorContext();

    await partner.addProduct(
      {
        ...product,
        branch_id: targetBranch,
      },
      operatorId,
      operatorPin,
    );
  }

  async function handleDeleteProduct(
    id: string,
  ) {
    const target = partner.products.find(
      (product) => product.id === id,
    );

    if (
      isEmployeeRestricted &&
      target &&
      target.branch_id &&
      target.branch_id !== effectiveBranchId
    ) {
      window.alert(
        'Acesso negado: você não tem permissão para excluir produtos de outra filial.',
      );
      return;
    }

    const {
      operatorId,
      operatorPin,
    } = getOperatorContext();

    await partner.deleteProduct(
      id,
      operatorId,
      operatorPin,
    );
  }

  async function handleUpdateProduct(
    id: string,
    updates: Partial<PartnerProduct>,
  ) {
    const target = partner.products.find(
      (product) => product.id === id,
    );

    if (!target) {
      throw new Error(
        'Produto não encontrado.',
      );
    }

    if (
      isEmployeeRestricted &&
      target.branch_id &&
      target.branch_id !== effectiveBranchId
    ) {
      throw new Error(
        'Acesso negado: você não pode alterar produtos de outra filial.',
      );
    }

    const {
      operatorId,
      operatorPin,
    } = getOperatorContext();

    await partner.updateProduct(
      id,
      {
        ...updates,
        branch_id:
          target.branch_id ??
          effectiveBranchId,
      },
      operatorId,
      operatorPin,
    );
  }

  async function handleReplenishStock(
    productId: string,
    branchId: string,
    quantity: number,
    unitCost?: number | null,
    reason?: string,
  ) {
    if (
      isEmployeeRestricted &&
      (!lockedBranchId ||
        branchId !== lockedBranchId)
    ) {
      throw new Error(
        'Acesso negado: você só pode repor estoque na filial vinculada ao seu usuário.',
      );
    }

    if (!branchId) {
      throw new Error(
        'Filial inválida para reposição de estoque.',
      );
    }

    const {
      operatorId,
      operatorPin,
    } = getOperatorContext();

    return partner.replenishStock(
      productId,
      branchId,
      quantity,
      unitCost,
      reason,
      operatorId,
      operatorPin,
    );
  }

  async function handleAddCustomer(
    customer: Omit<
      PartnerCustomer,
      'id' | 'user_id' | 'created_at'
    >,
  ) {
    const targetBranch = isEmployeeRestricted
      ? effectiveBranchId
      : customer.branch_id ||
        effectiveBranchId;

    if (!targetBranch) {
      throw new Error('Selecione a filial do cliente antes de salvar.');
    }

    if (
      isEmployeeRestricted &&
      targetBranch !== effectiveBranchId
    ) {
      throw new Error('Acesso negado: você só pode cadastrar clientes na sua filial vinculada.');
    }

    const {
      operatorId,
      operatorPin,
    } = getOperatorContext();

    await partner.addCustomer(
      {
        ...customer,
        branch_id: targetBranch,
      },
      operatorId,
      operatorPin,
    );
  }

  async function handleUpdateCustomer(
    id: string,
    updates: Partial<PartnerCustomer>,
  ) {
    const target = partner.customers.find(
      (customer) => customer.id === id,
    );

    if (
      isEmployeeRestricted &&
      target &&
      target.branch_id &&
      target.branch_id !== effectiveBranchId
    ) {
      throw new Error('Acesso negado: você não tem permissão para alterar clientes de outra filial.');
    }

    const {
      operatorId,
      operatorPin,
    } = getOperatorContext();

    await partner.updateCustomer(
      id,
      isEmployeeRestricted
        ? {
            ...updates,
            branch_id: effectiveBranchId,
          }
        : updates,
      operatorId,
      operatorPin,
    );
  }

  async function handleLoadCustomer(
    id: string,
  ) {
    const target = partner.customers.find(
      (customer) => customer.id === id,
    );

    if (!target) {
      throw new Error(
        'Cliente não encontrado.',
      );
    }

    if (
      isEmployeeRestricted &&
      target.branch_id &&
      target.branch_id !== effectiveBranchId
    ) {
      throw new Error(
        'Acesso negado: você não tem permissão para ver clientes desta filial.',
      );
    }

    return target;
  }

  async function handleDeleteCustomer(
    id: string,
  ) {
    const target = partner.customers.find(
      (customer) => customer.id === id,
    );

    if (
      isEmployeeRestricted &&
      target &&
      target.branch_id &&
      target.branch_id !== effectiveBranchId
    ) {
      window.alert(
        'Acesso negado: você não tem permissão para excluir clientes desta filial.',
      );
      return;
    }

    const {
      operatorId,
      operatorPin,
    } = getOperatorContext();

    await partner.deleteCustomer(
      id,
      operatorId,
      operatorPin,
    );
  }

  async function handleAddSupplier(
    supplier: Omit<
      PartnerSupplier,
      'id' | 'user_id' | 'created_at' | 'payable_balance'
    >,
  ) {
    const {
      operatorId,
      operatorPin,
    } = getOperatorContext();

    return await partner.addSupplier(
      supplier,
      operatorId,
      operatorPin,
    );
  }

  async function handleUpdateSupplier(
    id: string,
    updates: Partial<PartnerSupplier>,
  ) {
    const {
      operatorId,
      operatorPin,
    } = getOperatorContext();

    await partner.updateSupplier(
      id,
      updates,
      operatorId,
      operatorPin,
    );
  }

  async function handleDeleteSupplier(
    id: string,
  ) {
    const {
      operatorId,
      operatorPin,
    } = getOperatorContext();

    await partner.deleteSupplier(
      id,
      operatorId,
      operatorPin,
    );
  }

  async function handleAddSalesperson(
    salesperson: Omit<
      PartnerSalesperson,
      'id' | 'user_id' | 'created_at'
    >,
  ) {
    const {
      operatorId,
      operatorPin,
    } = getOperatorContext();

    return partner.addSalesperson(
      salesperson,
      operatorId,
      operatorPin,
    );
  }

  async function handleUpdateSalesperson(
    id: string,
    updates: Partial<PartnerSalesperson>,
  ) {
    const {
      operatorId,
      operatorPin,
    } = getOperatorContext();

    await partner.updateSalesperson(
      id,
      updates,
      operatorId,
      operatorPin,
    );
  }

  async function handleDeleteSalesperson(
    id: string,
  ) {
    const {
      operatorId,
      operatorPin,
    } = getOperatorContext();

    await partner.deleteSalesperson(
      id,
      operatorId,
      operatorPin,
    );
  }

  async function handleCreateSale(
    sale: {
      customer_id: string | null;
      customer_name: string;
      items: SaleItem[];
      total: number;
      customer_type: CustomerType;
      delivery_type: DeliveryType;
      imei?: string;
      serial_number?: string;
      payment_method?: string; payment_splits?: SalePayment[]; rma_credit_id?: string | null;
      salesperson_id?: string | null;
      draft_scope?: string;
      branch_id?: string | null;
    },
  ) {
    const targetBranch = isEmployeeRestricted
      ? effectiveBranchId
      : sale.branch_id ||
        effectiveBranchId;

    if (!targetBranch) {
      throw new Error('Selecione uma filial para realizar a venda.');
    }

    if (
      isEmployeeRestricted &&
      targetBranch !== effectiveBranchId
    ) {
      throw new Error('Acesso negado: você só pode realizar vendas na sua filial vinculada.');
    }

    const {
      operatorId,
      operatorPin,
    } = getOperatorContext();

    if (!partner.pendingSale) await checkoutCash.assertOpen();
    return await partner.createSale(
      {
        ...sale,
        branch_id: targetBranch,
        cash_session_id: managedCashSession?.id ?? null,
        salesperson_id: activeSalesperson
          ? activeSalesperson.id
          : sale.salesperson_id || null,
      },
      operatorId,
      operatorPin,
    );
  }

  async function handleCreatePreSale(
    sale: {
      customer_id: string | null;
      customer_name: string;
      items: SaleItem[];
      total: number;
      customer_type: CustomerType;
      delivery_type: DeliveryType;
      payment_method?: string | null;
      imei?: string;
      serial_number?: string;
      salesperson_id?: string | null;
      draft_scope?: string;
      branch_id?: string | null;
    },
  ) {
    const targetBranch = isEmployeeRestricted
      ? effectiveBranchId
      : sale.branch_id ||
        effectiveBranchId;

    if (!targetBranch) {
      throw new Error('Selecione uma filial para criar a pré-venda.');
    }

    if (
      isEmployeeRestricted &&
      targetBranch !== effectiveBranchId
    ) {
      throw new Error('Acesso negado: você só pode criar pré-vendas na sua filial vinculada.');
    }

    const {
      operatorId,
      operatorPin,
    } = getOperatorContext();

    return await partner.createPreSale(
      {
        ...sale,
        branch_id: targetBranch,
        salesperson_id: activeSalesperson
          ? activeSalesperson.id
          : sale.salesperson_id || null,
      },
      operatorId,
      operatorPin,
    );
  }

  async function handleFinalizePreSale(
    id: string,
    paymentMethod: string,
    paymentSplits?: SalePayment[],
    edits?: Parameters<typeof handleCreateSale>[0],
  ) {
    const sale = partner.sales.find(
      (item) => item.id === id,
    );

    if (!sale) {
      throw new Error('Pré-venda não encontrada. Sincronize os pedidos antes de tentar novamente.');
    }

    if (
      isEmployeeRestricted &&
      (!lockedBranchId ||
        sale.branch_id !== lockedBranchId)
    ) {
      throw new Error('Acesso negado: você só pode finalizar pré-vendas da sua filial vinculada.');
    }

    const {
      operatorId,
      operatorPin,
    } = getOperatorContext();

    if (!partner.pendingSale) await checkoutCash.assertOpen();
    await partner.finalizePreSale(
      id,
      paymentMethod,
      operatorId,
      operatorPin,
      paymentSplits,
      managedCashSession?.id ?? null,
      edits,
    );
  }

  async function handleCancelSale(
    id: string,
    overrideOperatorId?: string | null,
    overrideOperatorPin?: string | null,
  ) {
    const sale = partner.sales.find(
      (item) => item.id === id,
    );

    if (!sale) {
      window.alert(
        'Venda não encontrada.',
      );
      return;
    }

    if (
      isEmployeeRestricted &&
      (!lockedBranchId ||
        sale.branch_id !== lockedBranchId)
    ) {
      window.alert(
        'Acesso negado: você não pode cancelar vendas de outra filial.',
      );
      return;
    }

    // Cancelar venda exige autorização de Administrador ou Gerente digitada
    // na hora (ver PdvModule). Quando o modal informa quem está autorizando,
    // usamos exatamente essa identidade — nunca a de quem já está logado.
    const { operatorId, operatorPin } =
      overrideOperatorId !== undefined
        ? { operatorId: overrideOperatorId, operatorPin: overrideOperatorPin ?? null }
        : getOperatorContext();

    await partner.cancelSale(
      id,
      operatorId,
      operatorPin,
    );
  }

  async function handleDeleteSale(
    id: string,
    overrideOperatorId?: string | null,
    overrideOperatorPin?: string | null,
  ) {
    const sale = partner.sales.find(
      (item) => item.id === id,
    );

    if (!sale) {
      window.alert(
        'Venda não encontrada.',
      );
      return;
    }

    if (
      isEmployeeRestricted &&
      (!lockedBranchId ||
        sale.branch_id !== lockedBranchId)
    ) {
      window.alert(
        'Acesso negado: você não pode excluir vendas de outra filial.',
      );
      return;
    }

    const { operatorId, operatorPin } =
      overrideOperatorId !== undefined
        ? { operatorId: overrideOperatorId, operatorPin: overrideOperatorPin ?? null }
        : getOperatorContext();

    await partner.deleteSale(
      id,
      operatorId,
      operatorPin,
    );
  }

  async function handleCreateRma(
    rma: RmaPayload,
  ) {
    const targetBranch = isEmployeeRestricted
      ? effectiveBranchId
      : rma.branch_id ||
        effectiveBranchId;

    if (isEmployeeRestricted && !targetBranch) {
      window.alert(
        'Acesso negado: seu usuário não possui uma filial válida vinculada.',
      );
      return;
    }

    if (
      isEmployeeRestricted &&
      targetBranch !== effectiveBranchId
    ) {
      window.alert(
        'Acesso negado: você só pode criar RMA na sua filial vinculada.',
      );
      return;
    }

    await partner.createRma({
      ...rma,
      branch_id: targetBranch || null,
    });
  }

  async function handleAddBranch(
    name: string,
    address: string,
  ) {
    if (isEmployeeRestricted) {
      window.alert(
        'Funcionários não têm permissão para adicionar novas filiais.',
      );
      return;
    }

    await partner.addBranch(
      name,
      address,
    );
  }

  async function handleUpdateBranch(
    id: string,
    name: string,
    address: string,
  ) {
    if (isEmployeeRestricted) {
      window.alert(
        'Funcionários não têm permissão para alterar filiais.',
      );
      return;
    }

    await partner.updateBranch(
      id,
      {
        name,
        address,
      },
    );
  }

  async function handleDeleteBranch(
    id: string,
  ) {
    if (isEmployeeRestricted) {
      window.alert(
        'Funcionários não têm permissão para excluir filiais.',
      );
      return;
    }

    await partner.deleteBranch(id);

    if (selectedBranchId === id) {
      setSelectedBranchId('');
    }
  }

  const defaultSettings: StoreSettings = {
    id: 'default',
    user_id:
      identity?.companyUserId ?? '',
    logo_url: null,
    banner_url: null,
    primary_color: '#3193e5',
    nav_color: '#0b1927',
    internal_notice: '',
    warranty_terms: '',
    receipt_footer_text: '',
    show_logo_on_receipt: true,
    show_cnpj_on_receipt: true,
    updated_at:
      new Date().toISOString(),
  };

  const storeSettings =
    partner.settings ??
    defaultSettings;

  if (identityError) {
    return (
      <div className="partner-panel">
        <p className="partner-loading" role="alert">
          {identityError}
        </p>
        {onRetryIdentity && <button type="button" className="module-submit-btn" onClick={onRetryIdentity}>Tentar novamente</button>}
        <button type="button" className="rma-advance-btn" onClick={onBack}>Sair da conta</button>
      </div>
    );
  }

  if (isEmployeeRestricted && !identity?.branchId) {
    return (
      <div className="partner-panel">
        <section className="module-card" role="alert">
          <h3>Filial não vinculada</h3>
          <p>Seu acesso precisa estar vinculado a uma filial. Peça ao proprietário para atualizar seu cadastro antes de continuar.</p>
        </section>
        <button type="button" className="rma-advance-btn" onClick={onBack}>Sair da conta</button>
      </div>
    );
  }

  if (identity && !deviceSession.ready) {
    return <DeviceAccessGate companyId={identity.companyUserId} branchId={identity.salespersonId ? identity.branchId ?? '' : selectedBranchId}
      error={deviceSession.error} onBranchChange={pinOperator?.canAccessAllBranches ? handleSelectBranch : setSelectedBranchId} onRetry={deviceSession.retry} onLogout={onBack} />;
  }

  function preloadTab(tab: Tab) {
    if (accessLocked) return;
    if (blockedTabs.includes(tab) || !canUseSaasFeature(saas.subscription, tab)) return;
    void tabCodeLoaders[tab]().catch(() => {});
    void partner.prefetchModule(tab === 'cadastros' ? 'cadastros:' + cadastroDataScope : tab === 'administrativo' ? 'administrativo:' + adminDataScope : tab === 'relatorios' ? 'relatorios:' + reportDataScope : tab);
    if (tab === 'historico') void loadOrderHistoryModule().catch(() => {});
    if (tab === 'pedidos') void loadCatalogOrdersModule().catch(() => {});
  }

  function handleTabClick(tab: Tab) {
    if (blockedTabs.includes(tab)) return;
    setHelpOpen(false);
    setVisitedTabs((current) => current.has(tab) ? current : new Set(current).add(tab));
    setActiveTab(tab);
    setSidebarOpen(false);
  }

  function renderTab(tab: Tab, content: ReactNode, instance = '') {
    if (accessLocked) return null;
    if (!visitedTabs.has(tab) || blockedTabs.includes(tab) || !canUseSaasFeature(saas.subscription, tab)) return null;
    return (
      <div key={tab + instance} hidden={activeTab !== tab}>
        <ModuleBoundary>
        <Suspense fallback={<div className="partner-loading" role="status">Carregando módulo...</div>}>
          {activeTab === tab && (partner.resourcesReady === false || partner.loading) && (
            partner.error || partner.syncError ? <div role="alert" className="module-card">
              <p>Não foi possível concluir o carregamento desta tela.</p>
              <p>{partner.error || partner.syncError}</p>
              <button type="button" className="rma-advance-btn" disabled={partner.loading} onClick={() => void partner.loadData(false, undefined, false)}>Tentar carregar novamente</button>
            </div> : <p role="status" className="partner-loading">Carregando dados da tela...</p>
          )}
          <div hidden={activeTab === tab && (partner.resourcesReady === false || partner.loading)}>{content}</div>
        </Suspense>
        </ModuleBoundary>
      </div>
    );
  }

  function renderCadastros(target?: AdminCadastrosTarget) {
    if (target !== 'vendedores' && (blockedTabs.includes('cadastros') || !canUseSaasFeature(saas.subscription, 'cadastros'))) return <p role="alert">Acesso a Cadastros indisponível para este usuário ou assinatura.</p>;
    if (target === 'vendedores' && (blockedTabs.includes('administrativo') || !['administrador', 'gerente'].includes(effectiveRole))) {
      return <p role="alert">A gestão de colaboradores está disponível somente no Administrativo para administradores e gerentes.</p>;
    }
    return (
              <CadastrosModule
                key={target ?? 'principal'}
                isActive={activeTab === (target ? 'administrativo' : 'cadastros')}
                canManageSalespeople={Boolean(identity && !identity.salespersonId)}
                planId={saas.subscription?.effective_plan}
                findProductDuplicates={partner.findProductDuplicates}
                onDataScopeChange={setCadastroDataScope}
                suppliersReady={partner.suppliersReady}
                adminTarget={target}
                initialTab={cadastroDestination(target).tab}
                productType={cadastroDestination(target).productType}
                rmaRequests={partner.rmas}
                products={
                  filteredProducts
                }
                branches={
                  partner.branches
                }
                selectedBranchId={
                  effectiveBranchId
                }
                categories={
                  filteredCategories
                }
                suppliers={
                  filteredSuppliers
                }
                salespeople={
                  filteredSalespeople
                }
                combos={
                  partner.combos
                }
                modifiers={
                  partner.modifiers
                }
                customers={
                  filteredCustomers
                }
                sales={
                  filteredSales
                }
                allSales={
                  partner.sales
                }
                segment={segment}
                onAddProduct={
                  handleAddProduct
                }
                onUpdateProduct={
                  handleUpdateProduct
                }
                onReplenishStock={
                  handleReplenishStock
                }
                onDeleteProduct={
                  handleDeleteProduct
                }
                onImportXml={async (invoice, branchId) => {
                  const { operatorId, operatorPin } = getOperatorContext();
                  await partner.importStockXml(invoice, branchId, operatorId, operatorPin);
                }}
                onAddCategory={
                  partner.addCategory
                }
                onUpdateCategory={partner.updateCategory}
                onDeleteCategory={
                  partner.deleteCategory
                }
                onAddSupplier={
                  handleAddSupplier
                }
                onUpdateSupplier={
                  handleUpdateSupplier
                }
                onDeleteSupplier={
                  handleDeleteSupplier
                }
                onAddSalesperson={
                  handleAddSalesperson
                }
                onUpdateSalesperson={
                  handleUpdateSalesperson
                }
                onDeleteSalesperson={
                  handleDeleteSalesperson
                }
                onAddCombo={
                  partner.addCombo
                }
                onDeleteCombo={
                  partner.deleteCombo
                }
                onAddModifier={
                  partner.addModifier
                }
                onDeleteModifier={
                  partner.deleteModifier
                }
                onAddCustomer={
                  handleAddCustomer
                }
                onUpdateCustomer={
                  handleUpdateCustomer
                }
                onLoadCustomer={
                  handleLoadCustomer
                }
                onDeleteCustomer={
                  handleDeleteCustomer
                }
              />
    );
  }

  return (
    <div className={`partner-panel sidebar-layout${activeTab === 'pdv' ? ' partner-pdv-mode' : ''}`} data-personalized-panel={storeSettings.personalization?.panel ? 'true' : undefined} style={{ ...storeTheme(storeSettings.primary_color, storeSettings.nav_color), ...(storeSettings.personalization?.panel ? panelStyle(storeSettings.personalization.panel) : {}) } as React.CSSProperties}>
      <div className="sidebar-mobile-bar">
        <button
          className="sidebar-toggle"
          onClick={() =>
            setSidebarOpen(
              !sidebarOpen,
            )
          }
          aria-label="Menu"
          aria-expanded={sidebarOpen}
          aria-controls="partner-navigation"
        >
          {sidebarOpen ? (
            <X size={22} />
          ) : (
            <Menu size={22} />
          )}
        </button>

        <span className="sidebar-mobile-title">
          <Store size={18} />

          {
            visibleTabs.find(
              (tab) =>
                tab.id === activeTab,
            )?.label
          }
        </span>

        <button
          className="partner-back-btn compact"
          aria-label="Sair do app"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
      </div>

      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() =>
            setSidebarOpen(false)
          }
        />
      )}

      <aside
        id="partner-navigation"
        className={`partner-sidebar ${
          sidebarOpen ? 'open' : ''
        }`}
      >
        <div className="sidebar-header">
          <button type="button" className="sidebar-mobile-close" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)}><X size={22} /></button>
          <div className="sidebar-brand">
            <span className="sidebar-brand-mark">
              {storeSettings.logo_url ? <img src={storeSettings.logo_url} alt="Logo da loja" style={{ width: 36, height: 36, objectFit: 'contain' }} /> : <Store size={22} />}
            </span>

            <div>
              <strong>
                Painel do Lojista
              </strong>
            </div>
          </div>

          <button
            className="partner-back-btn"
            onClick={onBack}
          >
            <ArrowLeft size={16} />
            Sair do app
          </button>
        </div>

        <div
          className="sidebar-operator"
          style={{
            padding: '10px 12px',
            margin: '8px 12px',
            borderRadius: '8px',
            background:
              isEmployeeRestricted
                ? 'rgba(59,155,237,0.12)'
                : '#102433',
            border:
              '1px solid #1d3445',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent:
                'space-between',
              gap: '8px',
            }}
          >
            <div
              style={{
                minWidth: 0,
              }}
            >
              <small
                style={{
                  color: '#6e8799',
                  display: 'block',
                  fontSize: '11px',
                }}
              >
                Operador Ativo:
              </small>

              <strong
                style={{
                  color: '#eaf1f6',
                  fontSize: '13px',
                  display: 'block',
                  whiteSpace:
                    'nowrap',
                  overflow: 'hidden',
                  textOverflow:
                    'ellipsis',
                }}
              >
                {activeSalesperson
                  ? activeSalesperson.name
                  : accessLocked ? 'Selecione seu operador' : 'Proprietário (Admin)'}
              </strong>

              {lockedBranch ? (
                <span
                  style={{
                    display:
                      'inline-flex',
                    alignItems:
                      'center',
                    gap: '4px',
                    color: '#5cb5f1',
                    fontSize: '11px',
                    marginTop: '2px',
                  }}
                >
                  <Lock size={12} />
                  {lockedBranch.name}
                </span>
              ) : (
                <span
                  style={{
                    display: 'block',
                    color: '#889eaf',
                    fontSize: '11px',
                    marginTop: '2px',
                  }}
                >
                  {accessLocked ? 'Confirme o PIN para carregar sua filial' : effectiveBranchId
                    ? partner.branches.find(
                        (branch) =>
                          branch.id ===
                          effectiveBranchId,
                      )?.name ??
                      'Filial selecionada'
                    : 'Todas as filiais'}
                </span>
              )}
            </div>

            <button
              onClick={
                () => onRequestAccess('employee')
              }
              className="rma-advance-btn"
              style={{
                fontSize: '11px',
                padding: '4px 8px',
              }}
              title="Trocar operador por PIN"
              aria-label="Trocar operador por PIN"
            >
              <UserCheck size={14} />
            </button>
          </div>
        </div>

        <button type="button" className="rma-advance-btn" style={{ margin: '0 12px 12px' }}
          onClick={() => onRequestAccess('owner')}>
          <Shield size={14} /> Área do proprietário
        </button>

          {!accessLocked && <BranchSelector
            branches={pinOperator?.canAccessAllBranches ? pinOperator.allowedBranches ?? [] : partner.branches}
            selectedBranchId={effectiveBranchId}
            onSelectBranch={handleSelectBranch}
            isEmployeeLocked={isEmployeeRestricted && !pinOperator?.canAccessAllBranches}
            allowConsolidated={!isEmployeeRestricted}
            disabled={switchingBranch}
            lockedBranchName={lockedBranch?.name}
          />}
        {branchAccessError && <p role="alert">{branchAccessError}</p>}

        <nav className="sidebar-nav">
          {visibleTabs.map(
            ({
              id,
              label,
              icon: Icon,
            }) => (
              <button
                key={id}
                title={label}
                onPointerEnter={() => preloadTab(id)}
                onFocus={() => preloadTab(id)}
                onTouchStart={() => preloadTab(id)}
                aria-label={label}
                className={`sidebar-nav-item ${
                  !helpOpen && activeTab === id
                    ? 'active'
                    : ''
                }`}
                onClick={() =>
                  handleTabClick(id)
                }
              >
                <Icon size={20} />
                <span className="sidebar-nav-label">{label}</span>{id === 'suporte' && <SupportUnreadBadge count={supportUnread.total} />}
              </button>
            ),
          )}
          <button type="button" aria-label="Ajuda" aria-current={helpOpen?'page':undefined} className={'sidebar-nav-item '+(helpOpen?'active':'')} onClick={()=>{setHelpOpen(true);setSidebarOpen(false);}}>
            <BookOpen size={20}/><span className="sidebar-nav-label">Ajuda</span>
          </button>
          <button
            type="button"
            className="sidebar-nav-item"
            onClick={() => void partner.synchronize()}
            disabled={accessLocked || partner.loading || partner.syncing}
            aria-label={partner.syncing ? 'Sincronizando' : 'Sincronizar'}
            aria-busy={partner.syncing}
          >
            <RefreshCw size={20} />
            <span className="sidebar-nav-label">{partner.syncing ? 'Sincronizando...' : 'Sincronizar'}</span>
          </button>
          <span role="status" className="sidebar-sync-status">
            {partner.syncError
              ? `Falha ao sincronizar: ${partner.syncError}`
              : partner.lastSyncedAt
                ? `Atualizado às ${partner.lastSyncedAt.toLocaleTimeString('pt-BR')}`
                : ''}
          </span>
        </nav>

        {partner.loading && (
          <div className="sidebar-footer">
            <span className="partner-loading">
              Carregando...
            </span>
          </div>
        )}
      </aside>

      <div className="sidebar-main">
        <div className="sidebar-main-inner">
          {partner.error && (
            <p className="partner-loading">
              {partner.error}
            </p>
          )}

          {helpOpen && <ModuleBoundary><Suspense fallback={<p role="status">Carregando ajuda…</p>}>
            <HelpModule planId={saas.subscription?.effective_plan} features={saas.subscription?.features} plans={saas.subscription?.plans}
              allowedModules={accessLocked?[]:visibleTabs.map(tab=>tab.id)}
              onBack={()=>setHelpOpen(false)} onNavigate={module=>{if(!accessLocked&&visibleTabs.some(tab=>tab.id===module))handleTabClick(module as Tab);}}/>
          </Suspense></ModuleBoundary>}
          <div hidden={helpOpen}>
          {accessLocked ? <div className="partner-content"><p role="status">Selecione seu operador no menu e confirme o PIN para visualizar os dados da sua filial.</p></div> : <SessionDraftProvider
            key={`${identity?.authUserId ?? user?.id ?? 'pending'}:${identity?.companyUserId ?? 'pending'}:workspace:${effectiveBranchId || 'all'}`}
            scope={`${identity?.authUserId ?? user?.id ?? 'pending'}:${identity?.companyUserId ?? 'pending'}:workspace:${effectiveBranchId || 'all'}`}
            legacyScope={`${identity?.authUserId ?? user?.id ?? 'pending'}:${identity?.companyUserId ?? 'pending'}:${identity?.salespersonId ?? 'owner'}:${effectiveBranchId || 'all'}`}
          >
          <div className="partner-content">
            {storeSettings.internal_notice && <div role="note" className="store-internal-notice">{storeSettings.internal_notice}</div>}
            {saas.error && <div role="alert"><p>{saas.error}</p><button className="rma-advance-btn" onClick={() => { void saas.refresh(); }}>Verificar assinatura novamente</button></div>}
            {!saas.loading && saas.subscription && !saas.subscription.can_access && <p role="status">A assinatura está sem acesso operacional. Regularize em Configurações ou entre em contato com o suporte.</p>}
            {!partner.loading && !saas.loading && saas.subscription?.can_access && !visibleTabs.some((tab) => tab.id === activeTab) && (
              <p role="status">{blockedTabs.includes(activeTab)
                ? visibleTabs.length === 0
                  ? 'Seu operador está sem módulos liberados. Solicite ao proprietário a liberação em Usuários e permissões.'
                  : 'Seu operador não tem permissão para acessar este módulo. Solicite a liberação ao proprietário.'
                : 'Este módulo não está disponível na assinatura atual.'}</p>
            )}
            {renderTab('cadastros', renderCadastros())}

            {(activeTab === 'pdv' || activeTab === 'pedidos' || activeTab === 'historico') &&
              (pdvReadError || partner.pdvSyncWarning || partner.pendingSale || recoveredSaleNotice) && (
              <div role="status">
                {recoveredSaleNotice && <p>{recoveredSaleNotice} <button type="button" className="rma-advance-btn" onClick={() => setRecoveredSaleNotice(null)}>Fechar</button></p>}
                {(pdvReadError || partner.pdvSyncWarning) && (
                  <>
                    <p className="otp-error-msg">{pdvReadError || partner.pdvSyncWarning}</p>
                    <button className="rma-advance-btn" onClick={handleRefreshPdv} disabled={refreshingPdv}>
                      {refreshingPdv ? 'Sincronizando...' : 'Tentar sincronizar novamente'}
                    </button>
                  </>
                )}
                {partner.pendingSale && <>
                  <p>Venda com resultado pendente. Recupere esta tentativa antes de iniciar outra venda.</p>
                  <button className="module-submit-btn" disabled={recoveringSale} onClick={handleRecoverSale}>
                    {recoveringSale ? 'Recuperando...' : 'Recuperar venda pendente'}
                  </button>
                </>}
              </div>
            )}
            {visitedTabs.has('pdv') && !blockedTabs.includes('pdv') && canUseSaasFeature(saas.subscription, 'pdv') && (
              <div hidden={activeTab !== 'pdv'}>
              {renderTab('pdv', <PdvModule
                isActive={activeTab === 'pdv' && partner.resourcesReady !== false && !partner.loading}
                preSaleToCheckout={preSaleToCheckout}
                onRequestPreSale={setPreSaleToCheckout}
                onConsumePreSale={() => setPreSaleToCheckout(null)}
                cashContext={checkoutCash}
                onOpenCash={() => setActiveTab('caixa')}
                onOpenOrders={() => setActiveTab('pedidos')}
                onConfirmCashOperator={() => onRequestAccess('employee')}
                canEditPrice={effectiveRole === 'gerente' || ((!isEmployeeRestricted || Boolean(pinOperator)) && effectiveRole === 'administrador')}
                key={`${pdvRevision}:${effectiveBranchId}`}
                hasPendingSale={Boolean(partner.pendingSale)}
                barcodeScannerEnabled={storeSettings.personalization?.pdv?.barcode_scanner_enabled !== false}
                cameraScannerEnabled={storeSettings.personalization?.pdv?.camera_scanner_enabled === true}
                products={
                  filteredProducts
                }
                customers={
                  filteredCustomers
                }
                sales={
                  filteredSales
                }
                credits={partner.pdvCredits}
                rmaRequests={partner.pdvReturnCredits}
                salespeople={
                  filteredSalespeople
                }
                activeSalespersonId={
                  activeSalesperson?.id ?? null
                }
                activeBranchName={
                  effectiveBranchId
                    ? partner.branches.find((branch) => branch.id === effectiveBranchId)?.name ?? 'Filial selecionada'
                    : 'Todas as filiais'
                }
                segment={segment}
                selectedBranchId={
                  effectiveBranchId ||
                  null
                }
                currentRole={
                  effectiveRole
                }
                receiptDetails={{ settings: storeSettings, companyName: partner.profile?.account_name || partner.profile?.name, companyDocument: partner.profile?.document, branches: partner.branches }}
                onCreateSale={
                  handleCreateSale
                }
                onCreatePreSale={
                  handleCreatePreSale
                }
                onUpdatePreSale={async (id, edits) => {
                  const { operatorId, operatorPin } = getOperatorContext();
                  await partner.updatePreSale(id, edits, operatorId, operatorPin);
                }}
                onFinalizePreSale={
                  handleFinalizePreSale
                }
                onCancelSale={
                  handleCancelSale
                }
                onDeleteSale={
                  handleDeleteSale
                }
              />)}
              </div>
            )}

            {visitedTabs.has('caixa') && (
              <div hidden={activeTab !== 'caixa'}>
              {renderTab('caixa',
              <CashRegisterModule
                isActive={activeTab === 'caixa'}
                managedSessionId={managedCashSession?.id ?? null}
                onManageSession={setManagedCashSession}
                onGoToPdv={!blockedTabs.includes('pdv') ? () => setActiveTab('pdv') : undefined}
                branchId={effectiveBranchId}
                sales={partner.sales}
                scopeKey={`${identity?.authUserId}:${identity?.companyUserId}:${activeSalesperson?.id ?? 'owner'}:${effectiveBranchId}`}
                branchName={partner.branches.find(branch => branch.id === effectiveBranchId)?.name ?? 'Filial'}
                operatorId={getOperatorContext().operatorId}
                operatorPin={getOperatorContext().operatorPin}
                salespeople={filteredSalespeople}
              />)}
              </div>
            )}

            {visitedTabs.has('pedidos') && (
              <div hidden={activeTab !== 'pedidos'}>
              {renderTab('pedidos', <CatalogOrdersModule companyId={identity?.companyUserId ?? null} branchId={effectiveBranchId} />, ':catalog')}
              {renderTab('pedidos',
              <OpenOrdersModule
                key={`${identity?.authUserId}:${identity?.companyUserId}:${effectiveBranchId}`}
                isActive={activeTab === 'pedidos'}
                onPullToPdv={(sale) => {
                  if (sale.status !== 'pre_venda' || !sale.branch_id || blockedTabs.includes('pdv')) return;
                  if (lockedBranchId && sale.branch_id !== lockedBranchId) return;
                  setSelectedBranchId(sale.branch_id);
                  setPreSaleToCheckout(sale);
                  setActiveTab('pdv');
                }}
                onUpdateCustomer={async (id, customerId) => {
                  const { operatorId, operatorPin } = getOperatorContext();
                  await partner.updateOpenOrderCustomer(id, customerId, operatorId, operatorPin);
                }}
                canEditPrice={effectiveRole === 'gerente' || ((!isEmployeeRestricted || Boolean(pinOperator)) && effectiveRole === 'administrador')}
                products={filteredProducts}
                onUpdateItems={async (id, items) => {
                  const { operatorId, operatorPin } = getOperatorContext();
                  await partner.updatePreSaleItems(id, items, operatorId, operatorPin);
                }}
                receiptDetails={{ settings: storeSettings, companyName: partner.profile?.account_name || partner.profile?.name, companyDocument: partner.profile?.document, branches: partner.branches }}
                sales={
                  filteredSales
                }
                customers={
                  filteredCustomers
                }
                salespeople={
                  filteredSalespeople
                }
                currentRole={
                  effectiveRole
                }
                onFinalizePreSale={
                  handleFinalizePreSale
                }
                onCancelSale={async (id, supervisorId, supervisorPin) => {
                  const { operatorId, operatorPin } = getOperatorContext();
                  await partner.mutateOpenOrder(id, 'cancel', operatorId, operatorPin, supervisorId, supervisorPin);
                }}
                onDeleteSale={async (id, supervisorId, supervisorPin) => {
                  const { operatorId, operatorPin } = getOperatorContext();
                  await partner.mutateOpenOrder(id, 'delete', operatorId, operatorPin, supervisorId, supervisorPin);
                }}
              />)}
              </div>
            )}

            {visitedTabs.has('os') && (
              <div hidden={activeTab !== 'os'}>
              {renderTab('os',
              <ServiceOrdersModule
                printDetails={{ companyName: partner.profile?.account_name || partner.profile?.name, companyDocument: partner.profile?.document, branches: partner.branches }}
                isActive={activeTab === 'os'}
                authUserId={user?.id}
                onChanged={() => { void partner.refreshCollections(['products', 'movements', 'invoices']); }}
                userId={
                  identity?.companyUserId
                }
                segment={segment}
                branches={
                  partner.branches
                }
                customers={
                  filteredCustomers
                }
                products={
                  filteredProducts
                }
                selectedBranchId={
                  effectiveBranchId
                }
                warrantyTerms={
                  storeSettings.service_warranty_terms ??
                  ''
                }
                onUpdateWarrantyTerms={(
                  value,
                ) =>
                  partner.updateStoreSettings(
                    {
                      service_warranty_terms:
                        value,
                    },
                  )
                }
              />)}
              </div>
            )}

            {visitedTabs.has('historico') && (
              <div hidden={activeTab !== 'historico'}>
              {renderTab('historico',
              <OrderHistoryModule
                salesHistory={!blockedTabs.includes('pdv') ? <SalesHistoryModule
                  companyId={identity?.companyUserId}
                  branchId={effectiveBranchId}
                  currentRole={effectiveRole}
                  operatorKey={`${user?.id}:${identity?.salespersonId}:${activeSalesperson?.id ?? ''}`}
                  isActive={activeTab === 'historico'}
                  onPageLoaded={partner.mergeHistorySales}
                  rmaRequests={partner.rmas}
                  sales={filteredSales}
                  customers={filteredCustomers}
                  salespeople={filteredSalespeople}
                  segment={segment}
                  receiptDetails={{ settings: storeSettings, companyName: partner.profile?.account_name || partner.profile?.name, companyDocument: partner.profile?.document, branches: partner.branches }}
                  onCancelSale={async (id, supervisorId, supervisorPin) => {
                    const { operatorId, operatorPin } = getOperatorContext();
                    await partner.cancelHistorySale(id, effectiveBranchId, operatorId, operatorPin, supervisorId, supervisorPin);
                  }}
                /> : undefined}
                orders={
                  filteredOrders
                }
              />)}
              </div>
            )}

            {visitedTabs.has('suporte') && (
              <div hidden={activeTab !== 'suporte'}>
              {renderTab('suporte',
              <SupportChatModule
                user={user}
                isActive={activeTab === 'suporte'}
              />)}
              </div>
            )}

            {visitedTabs.has('fiscal') && (
              <div hidden={activeTab !== 'fiscal'}>
              {renderTab('fiscal',
              <FiscalModule
                products={
                  filteredProducts
                }
                sales={
                  filteredSales
                }
                customers={
                  filteredCustomers
                }
                profile={
                  partner.profile
                }
                currentRole={
                  effectiveRole
                }
                selectedBranchId={
                  effectiveBranchId
                }
              />)}
              </div>
            )}

            {visitedTabs.has('administrativo') && (
              <div hidden={activeTab !== 'administrativo'}>
              {renderTab('administrativo',
              <AdminModule
                onDataScopeChange={setAdminDataScope}
                onReportScopeChange={setReportDataScope}
                intelligenceAllowed={canViewBusinessIntelligence(Boolean(identity && !identity.salespersonId && identity.authUserId === identity.companyUserId), !identity?.salespersonId,
                  ['administrativo', 'relatorios', 'financeiro'].filter(module => !blockedTabs.includes(module as Tab) && canUseSaasFeature(saas.subscription, module)))}
                intelligenceDataReady={partner.resourcesReady && !partner.loading && !partner.syncing}
                intelligenceDataError={partner.error || partner.syncError}
                lastSyncedAt={partner.lastSyncedAt}
                allowedModules={['cadastros', 'relatorios', 'fiscal', 'financeiro', 'configuracoes'].filter(module => !blockedTabs.includes(module as Tab) && canUseSaasFeature(saas.subscription, module))}
                contextKey={[identity?.authUserId, identity?.companyUserId].join(':')}
                isActive={activeTab === 'administrativo'}
                recoveries={partner.financialRecoveries}
                recoveryError={partner.financialRecoveryError}
                renderSettings={() => <SettingsModule canManageAccount={!isEmployeeRestricted && !pinOperator} canManageOwnerPassword={!isEmployeeRestricted && !pinOperator} user={user} profile={partner.profile} onProfileUpdate={partner.updateProfile} />}
                renderCadastros={renderCadastros}
                invoices={filteredInvoices}
                rmas={partner.rmas}
                onReceiveInvoice={identity?.salespersonId ? undefined : partner.payInvoice}
                movements={
                  filteredMovements
                }
                userId={
                  identity?.companyUserId
                }
                sales={
                  filteredSales
                }
                products={
                  filteredProducts
                }
                salespeople={
                  filteredSalespeople
                }
                branches={
                  partner.branches
                }
                customers={
                  filteredCustomers
                }
                suppliers={
                  filteredSuppliers
                }
                categories={
                  filteredCategories
                }
                selectedBranchId={
                  effectiveBranchId
                }
                onSelectBranch={
                  handleSelectBranch
                }
                onNavigate={(tab) =>
                  handleTabClick(
                    tab as Tab,
                  )
                }
                ownerView={Boolean(
                  identity &&
                  !identity.salespersonId &&
                  identity.authUserId === identity.companyUserId
                )}
              />)}
              </div>
            )}

            {visitedTabs.has('entregas') && (
              <div hidden={activeTab !== 'entregas'}>
              {renderTab('entregas',
              <DeliveryModule
                companyId={identity?.companyUserId}
                operatorKey={identity?.authUserId + ':' + (identity?.salespersonId ?? '') + ':' + (activeSalesperson?.id ?? '')}
                operatorId={getOperatorContext().operatorId}
                operatorPin={getOperatorContext().operatorPin}
                currentRole={effectiveRole}
                isActive={activeTab === 'entregas'}
                customers={filteredCustomers}
                sales={
                  filteredSales
                }
                salespeople={
                  filteredSalespeople
                }
                selectedBranchId={
                  effectiveBranchId ||
                  null
                }
                onUpdateDelivery={(saleId, _status, _driverId, _details, operation) => {
                  if (!operation) throw new Error('Operação de entrega inválida.');
                  const { operatorId, operatorPin } = getOperatorContext();
                  return partner.updateDelivery(saleId, operation, operatorId, operatorPin);
                }}
              />)}
              </div>
            )}

            {visitedTabs.has('financeiro') && (
              <div hidden={activeTab !== 'financeiro'}>
              {renderTab('financeiro',
              <FinancialModule
                contextKey={[identity?.authUserId, identity?.companyUserId, effectiveBranchId].join(':')}
                isActive={activeTab === 'financeiro'}
                recoveries={partner.financialRecoveries}
                recoveryError={partner.financialRecoveryError}
                rmaRequests={filteredRmaRequests}
                onApplyCredit={partner.applyRmaCredit}
                invoices={
                  filteredInvoices
                }
                creditLimit={
                  filteredCustomers.reduce(
                    (
                      sum,
                      customer,
                    ) =>
                      sum +
                      Number(
                        customer.credit_limit ??
                          0,
                      ),
                    0,
                  )
                }
                creditUsed={
                  filteredInvoices
                    .filter(
                      (invoice) =>
                        invoice.status ===
                        'aberta' || invoice.status === 'parcial',
                    )
                    .reduce(
                      (
                        sum,
                        invoice,
                      ) =>
                        sum +
                        Number(
                          invoice.amount,
                        ) -
                        Number(
                          invoice.paid_amount ??
                            0,
                        ),
                      0,
                    )
                }
                onPayInvoice={
                  partner.payInvoice
                }
              />)}
              </div>
            )}

            {visitedTabs.has('rma') && (
              <div hidden={activeTab !== 'rma'}>
              {renderTab('rma',
              <RmaModule
                onAddPhotos={partner.addRmaPhotos}
                onRefund={async (id, amount, method, reason, requestId) => {
                  const { operatorId, operatorPin } = getOperatorContext();
                  await partner.refundRma(id, amount, method, reason, requestId, operatorId, operatorPin);
                }}
                onGrantCredit={partner.grantRmaCredit}
                rmaRequests={
                  filteredRmaRequests
                }
                customers={
                  filteredCustomers
                }
                products={
                  filteredProducts
                }
                sales={
                  filteredSales
                }
                warrantyTerms={
                  storeSettings.warranty_terms ??
                  ''
                }
                currentRole={
                  effectiveRole
                }
                onCreate={
                  handleCreateRma
                }
                onUpdateStatus={
                  partner.updateRmaStatus
                }
                onDelete={
                  partner.deleteRma
                }
              />)}
              </div>
            )}

            {visitedTabs.has('relatorios') && (
              <div hidden={activeTab !== 'relatorios'}>
              {renderTab('relatorios',
              <ReportsModule
                isActive={activeTab === 'relatorios'}
                onDataScopeChange={setReportDataScope}
                invoices={filteredInvoices}
                branchId={effectiveBranchId || null}
                companyUserId={identity?.companyUserId ?? null}
                movements={
                  filteredMovements
                }
                sales={
                  filteredSales
                }
                products={
                  filteredProducts
                }
                customers={
                  filteredCustomers
                }
                salespeople={
                  filteredSalespeople
                }
              />)}
              </div>
            )}

            {visitedTabs.has('white-label') && (
              <div hidden={activeTab !== 'white-label'}>
              {renderTab('white-label',
              <WhiteLabelModule
                receiptDetails={{ companyName: partner.branches.find(branch => branch.id === effectiveBranchId)?.name || partner.profile?.account_name || partner.profile?.name, companyDocument: partner.profile?.document, companyAddress: partner.branches.find(branch => branch.id === effectiveBranchId)?.address }}
                settings={
                  storeSettings
                }
                onUpdate={
                  partner.updateStoreSettings
                }
              />)}
              </div>
            )}

            {visitedTabs.has('configuracoes') && (
              <div hidden={activeTab !== 'configuracoes'}>
              {renderTab('configuracoes',
              <SettingsModule
                canManageAccount={!isEmployeeRestricted && !pinOperator}
                canManageOwnerPassword={Boolean(identity && !isEmployeeRestricted && !pinOperator)}
                onSubscriptionChanged={() => { void saas.refresh(); }}
                branchManagement={!isEmployeeRestricted ? <MultiStoreModule
                  branches={partner.branches}
                  selectedBranchId={effectiveBranchId || null}
                  onAddBranch={handleAddBranch}
                  onUpdateBranch={handleUpdateBranch}
                  onDeleteBranch={handleDeleteBranch}
                /> : undefined}
                user={user}
                profile={
                  partner.profile
                }
                onProfileUpdate={
                  partner.updateProfile
                }
              />)}
              </div>
            )}
          </div>
          </SessionDraftProvider>}
          </div>
        </div>
      </div>

    </div>
  );
}
