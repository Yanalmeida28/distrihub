import { saleRevenuePayments, salePaymentDescription } from '../../lib/pdv';
import { buildCsv, escapeHtml } from '../../lib/exportSafety';
import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Shield, BarChart3, Users, TrendingUp, TrendingDown,
  DollarSign, Wallet, Percent, AlertCircle,
  Boxes, FileText, Settings, Package,
  CreditCard, Smartphone, Receipt,
  Building2, Download, Calendar, UserCheck,
  PieChart, LineChart as LineChartIcon, MapPin, Lightbulb,
} from 'lucide-react';
import { money } from '../../utils';
import { ReportsModule } from './ReportsModule';
import { useStagnantStock } from '../../hooks/useStagnantStock';
import { usePayables } from '../../hooks/usePayables';
import { AccountsModule } from './AccountsModule';
import { CustomerAccountsModule } from './CustomerAccountsModule';
import { FinancialFlowModule } from './FinancialFlowModule';
import type { AdminCadastrosTarget } from '../../lib/cadastrosNavigation';
import { AdminFiscalModule } from './AdminFiscalModule';
import { AdminDataExports, AdminDeviceRegistry } from './AdminSettingsTools';
import { useFinancialMovements } from '../../hooks/useFinancialMovements';
import { actualFinancialFlow } from '../../lib/financialFlow';
import { getAdminPeriodRange, adminChartBuckets, adminSaleDate, type AdminPeriod } from '../../lib/adminDashboard';
import { financialAccounts, type PayableAccount } from '../../lib/accounts';
import { legacyCostSalesCount } from '../../lib/reportMetrics';
import type { FinancialRecovery } from '../../lib/invoicePayments';
import type { PartnerInvoice, RmaRequest } from '../../types';
import type {
  PartnerSale, PartnerProduct, PartnerSalesperson, SalespersonRole,
  PartnerBranch, PartnerCustomer, PartnerSupplier, PartnerCategory,
  AuditLog, SaleItem, StockMovement,
} from '../../types';

const BusinessIntelligenceModule = lazy(() => import('./BusinessIntelligenceModule').then(module => ({ default: module.BusinessIntelligenceModule })));

function safeItems(sale: PartnerSale): SaleItem[] {
  return Array.isArray(sale.items) ? sale.items : [];
}


class AdminErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="admin-error-fallback">
          <AlertCircle size={32} />
          <h3>Erro ao carregar o Painel Administrativo</h3>
          <p>Ocorreu um problema ao renderizar este módulo. Tente recarregar a página.</p>
          <small>{this.state.error?.message}</small>
        </div>
      );
    }
    return this.props.children;
  }
}

type Props = {
  canImportExport?: boolean;
  onDataScopeChange?: (tab: string) => void;
  onReportScopeChange?: (tab: string) => void;
  intelligenceAllowed?: boolean;
  intelligenceDataReady?: boolean;
  intelligenceDataError?: string | null;
  lastSyncedAt?: Date | null;
  allowedModules?: string[];
  contextKey?: string;
  isActive?: boolean;
  recoveries?: FinancialRecovery[];
  recoveryError?: string;
  renderSettings?: () => ReactNode;
  renderCadastros?: (target: AdminCadastrosTarget) => ReactNode;
  invoices?: PartnerInvoice[];
  rmas?: RmaRequest[];
  onReceiveInvoice?: (id: string, amount: number, requestId?: string) => Promise<void>;
  userId?: string;
  sales: PartnerSale[];
  products: PartnerProduct[];
  movements?: StockMovement[];
  salespeople: PartnerSalesperson[];
  branches?: PartnerBranch[];
  customers?: PartnerCustomer[];
  suppliers?: PartnerSupplier[];
  categories?: PartnerCategory[];
  selectedBranchId?: string;
  onSelectBranch?: (id: string) => void;
  onNavigate?: (tab: string) => void;
  ownerView?: boolean;
};

type AdminSection = 'dashboard' | 'cadastros' | 'relatorios' | 'inteligencia' | 'fiscal' | 'financeiro' | 'configuracoes';
type AdminTab = 'dashboard' | 'cadastros' | 'relatorios' | 'inteligencia' | 'fiscal' | 'financeiro' | 'permissoes' | 'auditoria' | 'dispositivos' | 'gestao-dados' | 'configuracoes';
type AdminPage = AdminTab;

type TimePeriod = AdminPeriod;

const roleLabels: Record<SalespersonRole, string> = {
  administrador: 'Administrador / Proprietário',
  gerente: 'Gerente',
  caixa: 'Caixa',
  vendedor: 'Vendedor / Balcão',
  tecnico: 'Técnico',
  atendente: 'Atendente',
  logistica: 'Logística / Entregador',
};

const sidebarSections: {
  id: AdminSection;
  label: string;
  icon: typeof Shield;
  items: { id: string; label: string; tab?: string; page?: AdminPage }[];
}[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: BarChart3,
    items: [{ id: 'visao-geral', label: 'Visão Geral Executiva', page: 'dashboard' }],
  },
  {
    id: 'cadastros',
    label: 'Cadastros',
    icon: Boxes,
    items: [
      { id: 'produtos', label: 'Produtos', tab: 'cadastros' },
      { id: 'servicos', label: 'Serviços', tab: 'cadastros' },
      { id: 'combos', label: 'Combo de Produtos', tab: 'cadastros' },
      { id: 'importar', label: 'Importar produtos (XLS/XML)', tab: 'cadastros' },
      { id: 'fornecedores', label: 'Fornecedores', tab: 'cadastros' },
      { id: 'estoque', label: 'Edição/Ajuste de Estoque', tab: 'cadastros' },
      { id: 'clientes', label: 'Clientes', tab: 'cadastros' },
    ],
  },
  {
    id: 'relatorios',
    label: 'Relatórios',
    icon: BarChart3,
    items: [{ id: 'vendas', label: 'Relatório detalhado de Vendas', tab: 'relatorios' }],
  },
  {
    id: 'inteligencia',
    label: 'Inteligência Empresarial',
    icon: Lightbulb,
    items: [{ id: 'inteligencia', label: 'Análise e planejamento', tab: 'inteligencia' }],
  },
  {
    id: 'fiscal',
    label: 'Área Fiscal',
    icon: FileText,
    items: [
      { id: 'emitir', label: 'Ativar/Emitir NFe e NFC-e', tab: 'fiscal' },
      { id: 'regras', label: 'Regras Tributárias', tab: 'fiscal' },
      { id: 'historico-notas', label: 'Histórico de Notas Emitidas', tab: 'fiscal' },
      { id: 'inutilizacao', label: 'Inutilização de Notas', tab: 'fiscal' },
    ],
  },
  {
    id: 'financeiro',
    label: 'Financeiro',
    icon: Wallet,
    items: [
      { id: 'pagar', label: 'Contas a Pagar', tab: 'financeiro' },
      { id: 'receber', label: 'Contas a Receber', tab: 'financeiro' },
      { id: 'cliente-fiado', label: 'Contas de Cliente (Fiado/Crediário)', tab: 'financeiro' },
      { id: 'fluxo', label: 'Fluxo Financeiro', tab: 'financeiro' },
      { id: 'pix', label: 'Área PIX', tab: 'financeiro' },
      { id: 'taxas', label: 'Taxas de Máquina/Adquirentes', tab: 'financeiro' },
    ],
  },
  {
    id: 'configuracoes',
    label: 'Configurações',
    icon: Settings,
    items: [
      { id: 'dados-negocio', label: 'Dados do Negócio', tab: 'configuracoes' },
      { id: 'gestao-dados', label: 'Exportar Dados', page: 'gestao-dados' },
      { id: 'usuarios', label: 'Usuários e permissões', page: 'permissoes' },
      { id: 'dispositivos', label: 'Dispositivos/Terminais', page: 'dispositivos' },
    ],
  },
];

export function AdminModule({
  canImportExport = false,
  onDataScopeChange, onReportScopeChange,
  intelligenceAllowed = false, intelligenceDataReady = false, intelligenceDataError, lastSyncedAt,
  renderSettings,
  renderCadastros,
  invoices = [], rmas, onReceiveInvoice, allowedModules = [], contextKey, isActive = true, recoveries, recoveryError,
  userId, sales = [], products = [], movements = [], salespeople = [], branches = [], customers = [], suppliers = [], categories = [],
  selectedBranchId = '', onSelectBranch, onNavigate, ownerView = false,
}: Props) {
  return (
    <AdminErrorBoundary>
      <AdminModuleInner onDataScopeChange={onDataScopeChange} onReportScopeChange={onReportScopeChange} intelligenceAllowed={intelligenceAllowed} intelligenceDataReady={intelligenceDataReady} intelligenceDataError={intelligenceDataError} lastSyncedAt={lastSyncedAt} allowedModules={allowedModules} key={contextKey} contextKey={contextKey} isActive={isActive} recoveries={recoveries} recoveryError={recoveryError}
        renderSettings={renderSettings}
        renderCadastros={renderCadastros}
        invoices={invoices}
        rmas={rmas}
        onReceiveInvoice={onReceiveInvoice}
        userId={userId}
        sales={sales}
        products={products}
        movements={movements}
        salespeople={salespeople}
        branches={branches}
        customers={customers}
        suppliers={suppliers}
        categories={categories}
        selectedBranchId={selectedBranchId}
        onSelectBranch={onSelectBranch}
        onNavigate={onNavigate}
        ownerView={ownerView}
        canImportExport={canImportExport}
      />
    </AdminErrorBoundary>
  );
}

function AdminModuleInner({
  canImportExport = false,
  onDataScopeChange, onReportScopeChange,
  intelligenceAllowed = false, intelligenceDataReady = false, intelligenceDataError, lastSyncedAt,
  renderSettings,
  renderCadastros,
  invoices = [], rmas, onReceiveInvoice, allowedModules = [], contextKey, isActive = true, recoveries, recoveryError,
  userId, sales, products, movements = [], salespeople, branches = [], customers = [], suppliers = [], categories = [],
  selectedBranchId = '', onSelectBranch, ownerView = false,
}: Props) {
  const allowed = (module: string) => module === 'inteligencia'
    ? intelligenceAllowed && ownerView && Boolean(userId) && ['relatorios', 'financeiro'].every(feature => allowedModules.includes(feature))
    : module === 'dashboard' || allowedModules.includes(module);
  const ownerPages = ['permissoes', 'dispositivos'];
  const visibleSections = sidebarSections.filter(section => allowed(section.id)).map(section => ({
    ...section, items: section.items.filter(item =>
      (ownerView || !('page' in item && ownerPages.includes(item.page ?? '')))
      && (canImportExport || (item.id !== 'importar' && item.page !== 'gestao-dados'))),
  }));
  const [expandedSection, setExpandedSection] = useState<AdminSection>('dashboard');
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>('dashboard');
  const [activeItemId, setActiveItemId] = useState('visao-geral');
  const currentModule = ['dashboard', 'cadastros', 'relatorios', 'inteligencia', 'fiscal', 'financeiro'].includes(activeAdminTab) ? activeAdminTab : 'configuracoes';
  const canViewCurrent = allowed(currentModule) && (ownerView || !ownerPages.includes(activeAdminTab))
    && (canImportExport || (activeItemId !== 'importar' && activeAdminTab !== 'gestao-dados'));
  const [branchFilter, setBranchFilter] = useState(selectedBranchId);
  const [reportsInitialTab, setReportsInitialTab] = useState<'vendas' | 'financeiro' | 'estoque' | 'sem-giro' | 'crm'>('vendas');
  useEffect(() => { if (isActive) onDataScopeChange?.(activeAdminTab); }, [activeAdminTab, isActive, onDataScopeChange]);
  const payables = usePayables(userId);
  const scopedInvoices = invoices.filter(invoice => !branchFilter || invoice.branch_id === branchFilter);
  const scopedPayables = payables.accounts.filter(account => !branchFilter || account.branch_id === branchFilter);

  useEffect(() => {
    setBranchFilter(selectedBranchId);
  }, [selectedBranchId]);

  function handleBranchChange(id: string) {
    setBranchFilter(id);
    if (onSelectBranch) onSelectBranch(id);
  }

  function handleItemClick(item: { id: string; label: string; tab?: string; page?: AdminPage }) {
    if (!canImportExport && (item.id === 'importar' || item.page === 'gestao-dados')) return;
    const module = item.tab ?? (item.page === 'dashboard' ? 'dashboard' : 'configuracoes');
    if (!allowed(module) || (!ownerView && ownerPages.includes(item.page ?? ''))) return;
    onDataScopeChange?.(item.tab ?? item.page ?? 'dashboard');
    setActiveItemId(item.id);
    if (item.tab === 'relatorios') {
      const reportTab = ['vendas', 'financeiro', 'estoque', 'sem-giro', 'crm'].find(tab => tab === item.id) ?? 'vendas';
      setReportsInitialTab(reportTab as typeof reportsInitialTab);
      onReportScopeChange?.(reportTab);
    }
    if (item.tab) {
      setActiveAdminTab(item.tab as AdminTab);
    } else if (item.page) {
      setActiveAdminTab(item.page as AdminTab);
    }
  }

  function toggleSection(section: AdminSection) {
    setExpandedSection(section);
    const firstItem = visibleSections.find((entry) => entry.id === section)?.items[0];
    if (firstItem) handleItemClick(firstItem);
  }

  return (
    <div className="panel-module admin-module-layout">
      {legacyCostSalesCount(sales, products) > 0 && <p role="status" className="admin-context-note">{legacyCostSalesCount(sales, products)} venda(s) deste histórico não possuem custo original completo. Custos, lucros e margens dessas vendas são estimados pelo cadastro atual.</p>}
      <div className="module-header">
        <span className="module-icon"><Shield size={20} /></span>
        <div>
          <h3>Painel Administrativo</h3>
          <p>Dashboard executivo, cadastros, fiscal, financeiro e configurações do sistema</p>
        </div>
      </div>

      <div className="admin-sidebar-content-wrapper">
        <nav className="admin-top-navigation" aria-label="Navegação do Administrativo">
          <div className="admin-top-sections">
          {visibleSections.map((section) => {
            const isExpanded = expandedSection === section.id;
            const SectionIcon = section.icon;
            return (
                <button
                  key={section.id}
                  type="button"
                  className={`admin-sidebar-section-header ${isExpanded ? 'expanded' : ''}`}
                  aria-pressed={isExpanded}
                  onClick={() => toggleSection(section.id)}
                >
                  <span className="admin-sidebar-section-title">
                    <SectionIcon size={16} /> {section.label}
                  </span>
                </button>
            );
          })}
          </div>
          <div className="admin-top-items" aria-label="Opções da seção selecionada">
            {visibleSections.find((section) => section.id === expandedSection)?.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`admin-sidebar-item ${activeItemId === item.id ? 'active' : ''}`}
                aria-current={activeItemId === item.id ? 'page' : undefined}
                onClick={() => handleItemClick(item)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="admin-content-area">
          {!canViewCurrent ? <p role="alert">Acesso a esta seção indisponível para este usuário ou assinatura. Selecione outra seção.</p> : <>
          {activeAdminTab === 'dashboard' && (
            <ExecutiveDashboard
              canExport={canImportExport}
              isActive={isActive}
              sales={sales}
              products={products}
              movements={movements}
              salespeople={salespeople}
              customers={customers}
              branches={branches}
              branchFilter={branchFilter}
              onBranchChange={handleBranchChange}
              onOpenStagnantStock={() => {
                setExpandedSection('relatorios');
                setActiveItemId('vendas');
                setActiveAdminTab('relatorios');
                setReportsInitialTab('sem-giro');
              }}
            />
          )}
          {activeAdminTab === 'relatorios' && (
            <ReportsModule
              canExport={canImportExport}
              isActive={isActive}
              onDataScopeChange={onReportScopeChange}
              companyUserId={userId ?? null}
              branchId={branchFilter || null}
              invoices={scopedInvoices}
              key={reportsInitialTab}
              initialTab={reportsInitialTab}
              movements={movements}
              sales={sales}
              products={products}
              customers={customers}
              salespeople={salespeople}
            />
          )}
          {activeAdminTab === 'inteligencia' && allowed('inteligencia') && userId && (
            <Suspense fallback={<p role="status">Carregando Inteligência Empresarial…</p>}>
              <BusinessIntelligenceModule key={`${contextKey}:${branchFilter}`} companyId={userId} branchId={branchFilter}
                branches={branches} isActive={isActive} dataReady={intelligenceDataReady} dataError={intelligenceDataError}
                lastSyncedAt={lastSyncedAt} sales={sales} products={products} customers={customers} movements={movements}
                invoices={invoices} rmas={rmas} payables={payables.accounts} payablesLoading={payables.loading} payablesError={payables.error} onRefreshPayables={payables.reload}
                onBranchChange={handleBranchChange} onNavigate={section => {
                  if (!allowed(section)) return;
                  setExpandedSection(section); setActiveAdminTab(section); setActiveItemId(section === 'financeiro' ? 'pagar' : 'vendas');
                  if (section === 'relatorios') setReportsInitialTab('vendas');
                }} />
            </Suspense>
          )}
          {activeAdminTab === 'financeiro' && (
            <>
            {payables.loading && <p role="status">Carregando Contas a Pagar…</p>}
            {payables.error && <p role="alert">{payables.error}</p>}
            {activeItemId !== 'pagar' && activeItemId !== 'receber' && activeItemId !== 'cliente-fiado' && activeItemId !== 'fluxo' && (
            <AdminFinancialSummary
              key={[contextKey, branchFilter].join(':')}
              userId={userId}
              isActive={isActive}
              movements={movements}
              invoices={scopedInvoices}
              payables={scopedPayables}
              payablesUnavailable={payables.loading || Boolean(payables.error)}
              sales={sales}
              products={products}
              branches={branches}
              branchFilter={branchFilter}
              onBranchChange={handleBranchChange}
            />
            )}
            {(activeItemId === 'pagar' || activeItemId === 'receber') && (
              <AccountsModule
                key={[activeItemId, branchFilter, contextKey].join(':')}
                isActive={isActive}
                recoveries={recoveries}
                recoveryError={recoveryError}
                kind={activeItemId === 'pagar' ? 'pagar' : 'receber'}
                invoices={scopedInvoices}
                payables={payables}
                branches={branches}
                suppliers={suppliers}
                branchId={branchFilter}
                onReceive={onReceiveInvoice}
              />
            )}
            {activeItemId === 'cliente-fiado' && <CustomerAccountsModule key={[contextKey, branchFilter].join(':')} isActive={isActive} recoveries={recoveries} recoveryError={recoveryError} customers={customers} invoices={scopedInvoices} payables={payables} branches={branches} suppliers={suppliers} branchId={branchFilter} onReceive={onReceiveInvoice} />}
            {activeItemId === 'fluxo' && <FinancialFlowModule key={[contextKey, branchFilter].join(':')} isActive={isActive} userId={userId} branchId={branchFilter} invoices={scopedInvoices} payables={scopedPayables} sales={sales} movements={movements} payablesUnavailable={payables.loading || Boolean(payables.error)} />}
            </>
          )}
          {activeAdminTab === 'fiscal' && (
            <AdminFiscalModule
              key={`${activeItemId}:${branchFilter}`}
              section={activeItemId}
              userId={userId}
              branchId={branchFilter || null}
              sales={sales}
              branches={branches}
              ownerView={ownerView}
            />
          )}
          {activeAdminTab === 'cadastros' && (
            renderCadastros ? renderCadastros(activeItemId as AdminCadastrosTarget) :
            <InlineCadastrosView
              products={products}
              customers={customers}
              suppliers={suppliers}
              salespeople={salespeople}
              categories={categories}
            />
          )}
          {activeAdminTab === 'permissoes' && (ownerView ? <><p>Gerencie a equipe, os acessos aos módulos, a função, a filial e o PIN de cada usuário. Clique em Editar para marcar os módulos permitidos e salve as alterações. As ações continuam limitadas pela função.</p>{renderCadastros?.('vendedores')}</> : <p role="alert">Somente o proprietário pode administrar os acessos.</p>)}
          {activeAdminTab === 'auditoria' && <AuditTrail sales={sales} salespeople={salespeople} />}
          {activeAdminTab === 'dispositivos' && (ownerView ? <AdminDeviceRegistry isActive={isActive} userId={userId} branchId={branchFilter} branches={branches} /> : <p role="alert">Somente o proprietário pode consultar os terminais da loja.</p>)}
          {activeAdminTab === 'gestao-dados' && (canImportExport ? <AdminDataExports allowed products={products} sales={sales} customers={customers} branchId={branchFilter} extra={{ branches, suppliers, categories, invoices: scopedInvoices, stock_movements: movements, payables: scopedPayables }} /> : <p role="alert">Somente o proprietário e administradores podem exportar os dados administrativos.</p>)}
          {activeAdminTab === 'configuracoes' && (
            renderSettings?.()
          )}
          </>}
        </div>
      </div>
    </div>
  );
}

/* ============ Date Range Helpers ============ */

function getPeriodRange(period: TimePeriod, customStart?: string, customEnd?: string) {
  return getAdminPeriodRange(period, customStart, customEnd);
}

function growthPct(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}

function GrowthBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="growth-badge neutral">Novo</span>;
  const isPositive = pct >= 0;
  return (
    <span className={`growth-badge ${isPositive ? 'positive' : 'negative'}`}>
      {isPositive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {isPositive ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}

/* ============ Executive Dashboard ============ */

function ExecutiveDashboard({
  canExport = false,
  isActive = true, sales, products, movements = [], salespeople = [], customers, branches, branchFilter, onBranchChange, onOpenStagnantStock,
}: {
  canExport?: boolean;
  isActive?: boolean;
  sales: PartnerSale[];
  products: PartnerProduct[];
  movements?: StockMovement[];
  salespeople: PartnerSalesperson[];
  customers: PartnerCustomer[];
  branches: PartnerBranch[];
  branchFilter: string;
  onBranchChange: (id: string) => void;
  onOpenStagnantStock?: () => void;
}) {
  const scopedProducts = useMemo(() => branchFilter ? products.filter((p) => p.branch_id === branchFilter) : products, [products, branchFilter]);
  const stagnant = useStagnantStock(scopedProducts, sales, movements, isActive);

  const [period, setPeriod] = useState<TimePeriod>('30dias');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const range = useMemo(() => getPeriodRange(period, customStart, customEnd), [period, customStart, customEnd]);

  const branchFilteredSales = useMemo(() => {
    const completed = sales.filter((s) => s.status === 'concluida');
    if (!branchFilter) return completed;
    return completed.filter((s) => !s.branch_id || s.branch_id === branchFilter);
  }, [sales, branchFilter]);

  const currentSales = useMemo(() => {
    return branchFilteredSales.filter((s) => {
      const d = new Date(adminSaleDate(s));
      return d >= range.start && d < range.end;
    });
  }, [branchFilteredSales, range]);

  const previousSales = useMemo(() => {
    return branchFilteredSales.filter((s) => {
      const d = new Date(adminSaleDate(s));
      return d >= range.prevStart && d < range.prevEnd;
    });
  }, [branchFilteredSales, range]);

  const productCostMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of products) map[p.id] = p.cost_price;
    return map;
  }, [products]);

  const computeMetrics = useCallback((salesList: PartnerSale[]) => {
    const grossRevenue = salesList.reduce((s, x) => s + (x.total ?? 0), 0);
    let totalCost = 0;
    for (const sale of salesList) {
      for (const item of safeItems(sale)) {
        totalCost += (sale.cost_snapshot?.[item.product_id] ?? productCostMap[item.product_id] ?? 0) * item.quantity;
      }
    }
    const netRevenue = grossRevenue - totalCost;
    const profitMargin = grossRevenue > 0 ? (netRevenue / grossRevenue) * 100 : 0;
    const averageTicket = salesList.length > 0 ? grossRevenue / salesList.length : 0;
    return { grossRevenue, totalCost, netRevenue, profitMargin, averageTicket, count: salesList.length };
  }, [productCostMap]);

  const current = useMemo(() => computeMetrics(currentSales), [currentSales, computeMetrics]);
  const previous = useMemo(() => computeMetrics(previousSales), [previousSales, computeMetrics]);

  const revenueGrowth = growthPct(current.grossRevenue, previous.grossRevenue);
  const costGrowth = growthPct(current.totalCost, previous.totalCost);
  const profitGrowth = growthPct(current.netRevenue, previous.netRevenue);
  const marginGrowth = growthPct(current.profitMargin, previous.profitMargin);
  const ticketGrowth = growthPct(current.averageTicket, previous.averageTicket);

  // Daily revenue line chart data
  const dailyData = useMemo(() => {
    const days: { date: Date; gross: number; net: number }[] = [];
    for (const bucket of adminChartBuckets(range.start, range.end)) {
      const dayStart = bucket.start;
      const dayEnd = bucket.end;
      const daySales = currentSales.filter((s) => {
        const d = new Date(adminSaleDate(s));
        return d >= dayStart && d < dayEnd;
      });
      const gross = daySales.reduce((s, x) => s + (x.total ?? 0), 0);
      let cost = 0;
      for (const sale of daySales) {
        for (const item of safeItems(sale)) {
          cost += (sale.cost_snapshot?.[item.product_id] ?? productCostMap[item.product_id] ?? 0) * item.quantity;
        }
      }
      days.push({ date: dayStart, gross, net: gross - cost });
    }
    return days;
  }, [currentSales, range, productCostMap]);

  // Profit by category
  const profitByCategory = useMemo(() => {
    const map: Record<string, { name: string; revenue: number; cost: number; profit: number }> = {};
    for (const sale of currentSales) {
      for (const item of safeItems(sale)) {
        const product = products.find((p) => p.id === item.product_id);
        const catName = product?.category ?? 'Sem categoria';
        if (!map[catName]) map[catName] = { name: catName, revenue: 0, cost: 0, profit: 0 };
        const rev = item.unit_price * item.quantity;
        const cost = (sale.cost_snapshot?.[item.product_id] ?? productCostMap[item.product_id] ?? 0) * item.quantity;
        map[catName].revenue += rev;
        map[catName].cost += cost;
        map[catName].profit += rev - cost;
      }
    }
    return Object.values(map).sort((a, b) => b.profit - a.profit).slice(0, 8);
  }, [currentSales, products, productCostMap]);

  // Top SKUs
  const topSkus = useMemo(() => {
    const map: Record<string, { name: string; sku: string | null; quantity: number; revenue: number }> = {};
    for (const sale of currentSales) {
      for (const item of safeItems(sale)) {
        const product = products.find((p) => p.id === item.product_id);
        if (!map[item.product_id]) {
          map[item.product_id] = { name: item.name, sku: product?.sku ?? null, quantity: 0, revenue: 0 };
        }
        map[item.product_id].quantity += item.quantity;
        map[item.product_id].revenue += item.unit_price * item.quantity;
      }
    }
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [currentSales, products]);

  // Payment distribution
  const paymentDistribution = useMemo(() => {
    const map: Record<string, number> = {};
    for (const sale of currentSales) {
      for (const payment of saleRevenuePayments(sale)) {
        map[payment.method] = (map[payment.method] ?? 0) + payment.amount;
      }
    }
    const total = Object.values(map).reduce((s, v) => s + v, 0) || 1;
    return Object.entries(map)
      .map(([method, amount]) => ({ method, amount, percentage: (amount / total) * 100 }))
      .sort((a, b) => b.amount - a.amount);
  }, [currentSales]);

  const paymentColors = ['#3b9bed', '#5bbc87', '#e6a06d', '#a78bfa', '#e3829b', '#5cb5f1'];
  const paymentIcons: Record<string, typeof CreditCard> = {
    pix: Smartphone, cartao: CreditCard, boleto: Receipt, faturado: Wallet,
  };

  // CRM metrics
  const crmMetrics = useMemo(() => {
    const customerRevenue: Record<string, { name: string; total: number; count: number; lastPurchase: Date }> = {};
    for (const sale of branchFilteredSales) {
      const key = sale.customer_id ?? sale.customer_name ?? 'Consumidor';
      const name = sale.customer_name ?? 'Consumidor';
      if (!customerRevenue[key]) customerRevenue[key] = { name, total: 0, count: 0, lastPurchase: new Date(0) };
      customerRevenue[key].total += (sale.total ?? 0);
      customerRevenue[key].count += 1;
      const d = new Date(adminSaleDate(sale));
      if (d > customerRevenue[key].lastPurchase) customerRevenue[key].lastPurchase = d;
    }

    const sorted = Object.values(customerRevenue).sort((a, b) => b.total - a.total);
    const topCustomers = sorted.slice(0, 5);
    const avgLtv = sorted.length > 0 ? sorted.reduce((s, c) => s + c.total, 0) / sorted.length : 0;

    const now = new Date();
    const inactiveCustomers = customers.filter((c) => {
      const key = c.id;
      const data = customerRevenue[key];
      if (!data) return true;
      const daysSince = (now.getTime() - data.lastPurchase.getTime()) / 86400000;
      return daysSince > 30;
    });

    return { topCustomers, avgLtv, inactiveCount: inactiveCustomers.length, totalActive: sorted.filter(customer => (now.getTime() - customer.lastPurchase.getTime()) / 86400000 <= 30).length };
  }, [branchFilteredSales, customers]);

  // Seller performance
  const sellerPerf = useMemo(() => {
    const map: Record<string, { name: string; revenue: number; count: number }> = {};
    for (const sale of currentSales) {
      const sp = salespeople.find((s) => s.id === sale.salesperson_id);
      const key = sale.salesperson_id ?? 'none';
      const name = sp?.name ?? 'Sem vendedor';
      if (!map[key]) map[key] = { name, revenue: 0, count: 0 };
      map[key].revenue += (sale.total ?? 0);
      map[key].count += 1;
    }
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }, [currentSales, salespeople]);

  function exportCSV() {
    if (!canExport) return;
    const headers = ['Data', 'Cliente', 'Total', 'Custo', 'Lucro estimado', 'Pagamento', 'Vendedor', 'Custo histórico'];
    const rows = currentSales.map((s) => {
      const sp = salespeople.find((p) => p.id === s.salesperson_id);
      let cost = 0;
      for (const item of safeItems(s)) cost += (s.cost_snapshot?.[item.product_id] ?? productCostMap[item.product_id] ?? 0) * item.quantity;
      return [
        new Date(adminSaleDate(s)).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        s.customer_name ?? '—',
        (s.total ?? 0).toFixed(2),
        cost.toFixed(2),
        (s.total - cost).toFixed(2),
        salePaymentDescription(s),
        sp?.name ?? '—',
        legacyCostSalesCount([s], products) ? 'Estimado pelo cadastro atual' : 'Registrado na venda',
      ];
    });
    const csv = buildCsv([headers, ...rows]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-vendas-${period}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPDF() {
    if (!canExport) return;
    const win = window.open('', '_blank');
    if (!win) return;
    const html = `
      <html><head><title>Relatório Executivo DistriHub</title>
      <style>body{font-family:Arial,sans-serif;padding:40px;color:#1a2b3c}h1{color:#3b9bed}
      table{width:100%;border-collapse:collapse;margin:20px 0}td,th{border:1px solid #ddd;padding:8px;text-align:left}
      th{background:#f0f5f9}.kpi{display:inline-block;margin:10px 20px 10px 0;padding:15px;border:1px solid #ddd;border-radius:8px}
      .kpi strong{font-size:24px;display:block}.kpi small{color:#888}</style></head>
      <body><h1>Relatório Executivo — DistriHub</h1>
      <p>${legacyCostSalesCount(currentSales, products)} venda(s) sem custo histórico completo. Nesses casos, CMV e margem são estimativas pelo cadastro atual.</p>
      <p>Período: ${range.start.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} a ${new Date(range.end.getTime() - 1).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
      <div>
        <div class="kpi"><small>Receita Bruta</small><strong>${money.format(current.grossRevenue)}</strong></div>
        <div class="kpi"><small>Custo dos Produtos</small><strong>${money.format(current.totalCost)}</strong></div>
        <div class="kpi"><small>Lucro bruto estimado</small><strong>${money.format(current.netRevenue)}</strong></div>
        <div class="kpi"><small>Margem</small><strong>${current.profitMargin.toFixed(1)}%</strong></div>
        <div class="kpi"><small>Ticket Médio</small><strong>${money.format(current.averageTicket)}</strong></div>
        <div class="kpi"><small>Vendas</small><strong>${current.count}</strong></div>
      </div>
      <h2>Top SKUs</h2><table><tr><th>Produto</th><th>SKU</th><th>Qtd</th><th>Receita</th></tr>
      ${topSkus.map((s) => `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.sku ?? '—')}</td><td>${escapeHtml(s.quantity)}</td><td>${money.format(s.revenue)}</td></tr>`).join('')}
      </table>
      <h2>Lucro por Categoria</h2><table><tr><th>Categoria</th><th>Receita</th><th>Lucro</th></tr>
      ${profitByCategory.map((c) => `<tr><td>${escapeHtml(c.name)}</td><td>${money.format(c.revenue)}</td><td>${money.format(c.profit)}</td></tr>`).join('')}
      </table>
      <p style="margin-top:40px;color:#888">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
      </body></html>`;
    win.document.write(html);
    win.document.close();
    win.print();
  }

  const periodLabels: Record<TimePeriod, string> = {
    hoje: 'Hoje', '7dias': '7 dias', '30dias': '30 dias', mes: 'Mês Atual', custom: 'Personalizado',
  };

  return (
    <div>
      {/* Filter Bar */}
      <div className="admin-filter-bar">
        <div className="admin-period-filters">
          <Calendar size={15} />
          {(['hoje', '7dias', '30dias', 'mes', 'custom'] as TimePeriod[]).map((p) => (
            <button
              key={p}
              className={`period-pill ${period === p ? 'active' : ''}`}
              onClick={() => setPeriod(p)}
            >
              {periodLabels[p]}
            </button>
          ))}
        </div>
        <div className="admin-filter-right">
          {branches.length > 0 && (
            <div className="admin-branch-selector">
              <MapPin size={14} />
              <select value={branchFilter} onChange={(e) => onBranchChange(e.target.value)}>
                <option value="">Visão Consolidada</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
          {period === 'custom' && (
            <>
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="admin-date-input" />
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="admin-date-input" />
            </>
          )}
          {canExport && <button className="admin-export-btn" disabled={Boolean(range.error)} onClick={exportPDF}>
            <FileText size={14} /> PDF
          </button>}
          {canExport && <button className="admin-export-btn" disabled={Boolean(range.error)} onClick={exportCSV}>
            <Download size={14} /> Excel
          </button>}
        </div>
      </div>

      {range.error && <p role="alert">{range.error}</p>}
      <div hidden={Boolean(range.error)}>
      {stagnant.count > 0 && onOpenStagnantStock ? (
        <button
          type="button"
          className="report-card stagnant-stock-card"
          onClick={onOpenStagnantStock}
        >
          <small><Package size={13} /> ESTOQUE SEM GIRO</small>
          <strong>
            {stagnant.count} {stagnant.count === 1 ? 'produto há mais de 30 dias' : 'produtos há mais de 30 dias'}
          </strong>
          <span>{stagnant.totalUnits} {stagnant.totalUnits === 1 ? 'unidade parada' : 'unidades paradas'}</span>
          <span>{money.format(stagnant.totalValue)} em capital parado</span>
          <span className={stagnant.criticalCount > 0 ? 'text-red' : undefined}>
            {stagnant.criticalCount} {stagnant.criticalCount === 1 ? 'produto crítico' : 'produtos críticos'} (+90 dias)
          </span>
          <small>Ver produtos →</small>
        </button>
      ) : products.some((p) => !p.is_service && p.stock > 0) ? (
        <div className="report-card stagnant-stock-card healthy">
          <small><Package size={13} /> ESTOQUE SEM GIRO</small>
          <strong>Nenhum produto parado há mais de 30 dias</strong>
        </div>
      ) : null}

      {/* Executive KPI Cards */}
      <div className="report-cards admin-kpi-grid">
        <div className="report-card admin-kpi-card">
          <small><DollarSign size={13} /> Receita Bruta</small>
          <strong>{money.format(current.grossRevenue)}</strong>
          <div className="kpi-footer">
            <GrowthBadge pct={revenueGrowth} />
            <small>{current.count} vendas</small>
          </div>
        </div>
        <div className="report-card admin-kpi-card">
          <small><Wallet size={13} /> Custo dos Produtos</small>
          <strong className="text-red">{money.format(current.totalCost)}</strong>
          <div className="kpi-footer">
            <GrowthBadge pct={costGrowth} />
            <small>CMV no período</small>
          </div>
        </div>
        <div className="report-card admin-kpi-card">
          <small><TrendingUp size={13} /> Lucro bruto estimado</small>
          <strong className="text-green">{money.format(current.netRevenue)}</strong>
          <div className="kpi-footer">
            <GrowthBadge pct={profitGrowth} />
            <small>após custo</small>
          </div>
        </div>
        <div className="report-card admin-kpi-card">
          <small><Percent size={13} /> Margem de Lucro</small>
          <strong className={current.profitMargin >= 30 ? 'text-green' : current.profitMargin >= 15 ? '' : 'text-red'}>
            {current.profitMargin.toFixed(1)}%
          </strong>
          <div className="kpi-footer">
            <GrowthBadge pct={marginGrowth} />
            <small>margem operacional</small>
          </div>
        </div>
        <div className="report-card admin-kpi-card">
          <small><Receipt size={13} /> Ticket Médio</small>
          <strong>{money.format(current.averageTicket)}</strong>
          <div className="kpi-footer">
            <GrowthBadge pct={ticketGrowth} />
            <small>por venda</small>
          </div>
        </div>
      </div>

      {/* Daily Revenue Line Chart */}
      <h4 className="report-section-title"><LineChartIcon size={16} /> Faturamento × Lucro bruto estimado</h4>
      {range.end.getTime() - range.start.getTime() > 90 * 86400000 && <p>Período agrupado em até 90 intervalos. Cada ponto soma todas as vendas do intervalo, cobrindo o período inteiro.</p>}
      <DailyRevenueChart data={dailyData} grossTotal={current.grossRevenue} profitTotal={current.netRevenue} />
      <p className="admin-empty-hint">Lucro bruto estimado = faturamento menos o custo dos produtos vendidos. Não desconta impostos e despesas operacionais.</p>

      {/* Profit by Category + Payment Donut */}
      <div className="admin-dashboard-row">
        <div className="admin-dashboard-card">
          <h4 className="report-section-title"><BarChart3 size={16} /> Lucro por Categoria</h4>
          {profitByCategory.length === 0 ? (
            <p className="admin-empty-hint">Sem dados para o período selecionado.</p>
          ) : (
            <div className="admin-bar-chart">
              {profitByCategory.map((c, i) => {
                const maxProfit = Math.max(...profitByCategory.map((x) => Math.abs(x.profit)), 1);
                const pct = (Math.abs(c.profit) / maxProfit) * 100;
                return (
                  <div key={i} className="admin-bar-row">
                    <span className="admin-bar-label">{c.name}</span>
                    <div className="admin-bar-track">
                      <div
                        className="admin-bar-fill"
                        style={{ width: `${pct}%`, background: c.profit >= 0 ? '#5bbc87' : '#e3829b' }}
                      />
                    </div>
                    <strong className="admin-bar-value">{money.format(c.profit)}</strong>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="admin-dashboard-card">
          <h4 className="report-section-title"><PieChart size={16} /> Vendas por Pagamento</h4>
          {paymentDistribution.length === 0 ? (
            <p className="admin-empty-hint">Sem dados para o período selecionado.</p>
          ) : (
            <div className="admin-donut-container">
              <PaymentDonut data={paymentDistribution} colors={paymentColors} />
              <div className="admin-donut-legend">
                {paymentDistribution.map((p, i) => {
                  const Icon = paymentIcons[p.method] ?? CreditCard;
                  return (
                    <div key={p.method} className="admin-legend-row">
                      <span className="admin-legend-dot" style={{ background: paymentColors[i % paymentColors.length] }} />
                      <Icon size={13} />
                      <span className="admin-legend-label">{p.method}</span>
                      <strong>{money.format(p.amount)}</strong>
                      <small>{p.percentage.toFixed(1)}%</small>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top SKUs + CRM */}
      <div className="admin-dashboard-row">
        <div className="admin-dashboard-card">
          <h4 className="report-section-title"><Package size={16} /> Top SKUs Mais Vendidos</h4>
          {topSkus.length === 0 ? (
            <p className="admin-empty-hint">Sem vendas no período.</p>
          ) : (
            <div className="stock-table-wrap">
              <table className="rma-table admin-top-items-table">
                <thead><tr><th>Produto</th><th>SKU</th><th>Qtd</th><th>Receita</th></tr></thead>
                <tbody>
                  {topSkus.map((item, i) => (
                    <tr key={i}>
                      <td><strong>{item.name}</strong></td>
                      <td>{item.sku ?? '—'}</td>
                      <td>{item.quantity}</td>
                      <td><strong>{money.format(item.revenue)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="admin-dashboard-card">
          <h4 className="report-section-title"><Users size={16} /> CRM — Clientes & LTV</h4>
          <p>Histórico de compras disponível nesta filial. Inatividade considera a última compra em todo esse histórico.</p>
          <div className="report-cards admin-crm-metrics">
            <div className="report-card">
              <small>LTV Médio (histórico)</small>
              <strong>{money.format(crmMetrics.avgLtv)}</strong>
            </div>
            <div className="report-card">
              <small>Clientes Ativos</small>
              <strong className="text-green">{crmMetrics.totalActive}</strong>
            </div>
            <div className="report-card">
              <small>Inativos (30d+)</small>
              <strong className="text-red">{crmMetrics.inactiveCount}</strong>
            </div>
          </div>
          {crmMetrics.topCustomers.length > 0 && (
            <div className="stock-table-wrap">
              <table className="rma-table admin-top-items-table">
                <thead><tr><th>Cliente</th><th>Compras</th><th>Total</th></tr></thead>
                <tbody>
                  {crmMetrics.topCustomers.map((c, i) => (
                    <tr key={i}>
                      <td><strong>{c.name}</strong></td>
                      <td>{c.count}</td>
                      <td><strong>{money.format(c.total)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Seller Performance */}
      <h4 className="report-section-title"><TrendingUp size={16} /> Performance de Vendedores</h4>
      {sellerPerf.length === 0 ? (
        <p className="admin-empty-hint">Sem vendas registradas no período.</p>
      ) : (
        <div className="stock-table-wrap admin-compact-wrap">
          <table className="rma-table admin-compact-table" aria-label="Performance de vendedores">
            <thead><tr><th>Vendedor</th><th>Vendas</th><th>Receita</th><th>Ticket Médio</th><th>Participação</th></tr></thead>
            <tbody>
              {sellerPerf.map((s, i) => {
                const totalRev = sellerPerf.reduce((sum, x) => sum + x.revenue, 0) || 1;
                const share = (s.revenue / totalRev) * 100;
                return (
                  <tr key={i}>
                    <td className="admin-compact-title"><strong>{s.name}</strong></td>
                    <td data-label="Vendas">{s.count}</td>
                    <td data-label="Receita"><strong>{money.format(s.revenue)}</strong></td>
                    <td data-label="Ticket médio">{money.format(s.revenue / Math.max(s.count, 1))}</td>
                    <td data-label="Participação">
                      <div className="admin-bar-track" style={{ maxWidth: '120px' }}>
                        <div className="admin-bar-fill" style={{ width: `${share}%`, background: '#3b9bed' }} />
                      </div>
                      <small>{share.toFixed(1)}%</small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Operational Summary */}
      <h4 className="report-section-title">Resumo Operacional</h4>
      <div className="stock-table-wrap admin-compact-wrap">
        <table className="rma-table admin-compact-table admin-operational-table" aria-label="Resumo operacional">
          <thead><tr><th>Indicador</th><th>Período Atual</th><th>Período Anterior</th><th>Variação</th></tr></thead>
          <tbody>
            <tr>
              <td className="admin-compact-title">Receita Bruta</td>
              <td data-label="Período atual"><strong>{money.format(current.grossRevenue)}</strong></td>
              <td data-label="Período anterior">{money.format(previous.grossRevenue)}</td>
              <td data-label="Variação">{revenueGrowth !== null ? <span className={revenueGrowth >= 0 ? 'text-green' : 'text-red'}>{revenueGrowth >= 0 ? '+' : ''}{revenueGrowth.toFixed(1)}%</span> : '—'}</td>
            </tr>
            <tr>
              <td className="admin-compact-title">Custo de Mercadorias (CMV)</td>
              <td data-label="Período atual">{money.format(current.totalCost)}</td>
              <td data-label="Período anterior">{money.format(previous.totalCost)}</td>
              <td data-label="Variação">{costGrowth !== null ? <span className={costGrowth <= 0 ? 'text-green' : 'text-red'}>{costGrowth >= 0 ? '+' : ''}{costGrowth.toFixed(1)}%</span> : '—'}</td>
            </tr>
            <tr>
              <td className="admin-compact-title">Lucro Bruto</td>
              <td data-label="Período atual"><strong className="text-green">{money.format(current.netRevenue)}</strong></td>
              <td data-label="Período anterior">{money.format(previous.netRevenue)}</td>
              <td data-label="Variação">{profitGrowth !== null ? <span className={profitGrowth >= 0 ? 'text-green' : 'text-red'}>{profitGrowth >= 0 ? '+' : ''}{profitGrowth.toFixed(1)}%</span> : '—'}</td>
            </tr>
            <tr>
              <td className="admin-compact-title">Margem de Lucro (%)</td>
              <td data-label="Período atual"><strong>{current.profitMargin.toFixed(1)}%</strong></td>
              <td data-label="Período anterior">{previous.profitMargin.toFixed(1)}%</td>
              <td data-label="Variação">{marginGrowth !== null ? <span className={marginGrowth >= 0 ? 'text-green' : 'text-red'}>{marginGrowth >= 0 ? '+' : ''}{marginGrowth.toFixed(1)}pp</span> : '—'}</td>
            </tr>
            <tr>
              <td className="admin-compact-title">Ticket Médio</td>
              <td data-label="Período atual"><strong>{money.format(current.averageTicket)}</strong></td>
              <td data-label="Período anterior">{money.format(previous.averageTicket)}</td>
              <td data-label="Variação">{ticketGrowth !== null ? <span className={ticketGrowth >= 0 ? 'text-green' : 'text-red'}>{ticketGrowth >= 0 ? '+' : ''}{ticketGrowth.toFixed(1)}%</span> : '—'}</td>
            </tr>
            <tr>
              <td className="admin-compact-title">Número de Vendas</td>
              <td data-label="Período atual"><strong>{current.count}</strong></td>
              <td data-label="Período anterior">{previous.count}</td>
              <td data-label="Variação">{previous.count > 0 ? <span className={current.count >= previous.count ? 'text-green' : 'text-red'}>{current.count >= previous.count ? '+' : ''}{current.count - previous.count}</span> : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}

/* ============ Daily Revenue SVG Line Chart ============ */

function DailyRevenueChart({ data, grossTotal, profitTotal }: { data: { date: Date; gross: number; net: number }[]; grossTotal: number; profitTotal: number }) {
  const width = 800;
  const height = 240;
  const labelWidth = Math.max(70, ...data.map(day => Math.max(money.format(day.gross).length, money.format(day.net).length) * 6 + 16));
  const padding = { top: 20, right: 20, bottom: 30, left: Math.min(labelWidth, 180) };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const legend = <div className="admin-chart-legend" aria-label="Totais do período selecionado">
    <span><span className="legend-dot inflow" /> Faturamento: <strong>{money.format(grossTotal)}</strong></span>
    <span><span className="legend-dot" style={{ background: '#5bbc87' }} /> Lucro bruto estimado: <strong>{money.format(profitTotal)}</strong></span>
  </div>;

  if (data.length === 0 || data.every((d) => d.gross === 0 && d.net === 0)) {
    return <><div className="admin-chart-empty"><LineChartIcon size={32} /><p>Sem dados de receita para o período selecionado.</p></div>{legend}</>;
  }

  const maxVal = Math.max(...data.map((d) => Math.max(d.gross, d.net)), 1);
  const minVal = Math.min(...data.map((d) => Math.min(d.gross, d.net)), 0);
  const valueRange = maxVal - minVal;
  const chartY = (value: number) => padding.top + chartH - ((value - minVal) / valueRange) * chartH;
  const stepX = data.length > 1 ? chartW / (data.length - 1) : chartW;

  function pointPath(values: number[]): string {
    return values.map((v, i) => {
      const x = padding.left + i * stepX;
      const y = chartY(v);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  }

  function areaPath(values: number[]): string {
    const linePath = pointPath(values);
    const lastX = padding.left + (values.length - 1) * stepX;
    const baseY = chartY(0);
    return `${linePath} L ${lastX.toFixed(1)} ${baseY} L ${padding.left} ${baseY} Z`;
  }

  const grossPath = pointPath(data.map((d) => d.gross));
  const netPath = pointPath(data.map((d) => d.net));
  const grossArea = areaPath(data.map((d) => d.gross));

  const yTicks = 4;
  const tickLabels: number[] = [];
  for (let i = 0; i <= yTicks; i++) tickLabels.push(minVal + (valueRange / yTicks) * i);

  const xLabelInterval = Math.max(1, Math.floor(data.length / 8));

  return (
    <div className="admin-chart-container">
      <svg viewBox={`0 0 ${width} ${height}`} className="admin-line-chart" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="grossGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b9bed" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#3b9bed" stopOpacity="0" />
          </linearGradient>
        </defs>

        {tickLabels.map((t, i) => {
          const y = chartY(t);
          return (
            <g key={i}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#1d3445" strokeWidth="1" strokeDasharray="3 3" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="#6e8799" fontSize="10">
                {money.format(t).replace(',00', '')}
              </text>
            </g>
          );
        })}

        <path d={grossArea} fill="url(#grossGradient)" />
        <path d={grossPath} fill="none" stroke="#3b9bed" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={netPath} fill="none" stroke="#5bbc87" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="4 3" />

        {data.map((d, i) => {
          if (i % xLabelInterval !== 0 && i !== data.length - 1) return null;
          const x = padding.left + i * stepX;
          return (
            <text key={i} x={x} y={height - 8} textAnchor="middle" fill="#6e8799" fontSize="10">
              {d.date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })}
            </text>
          );
        })}

        {data.map((d, i) => {
          const x = padding.left + i * stepX;
          const yGross = chartY(d.gross);
          const yNet = chartY(d.net);
          return (
            <g key={i} className="chart-tooltip-group">
              <circle cx={x} cy={yGross} r="3" fill="#3b9bed" className="chart-dot" />
              <circle cx={x} cy={yNet} r="3" fill="#5bbc87" className="chart-dot" />
              <title>{`${d.date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} — Faturamento: ${money.format(d.gross)} | Lucro bruto estimado: ${money.format(d.net)}`}</title>
            </g>
          );
        })}
      </svg>
      {legend}
    </div>
  );
}

/* ============ Payment Donut Chart ============ */

function PaymentDonut({ data, colors }: { data: { method: string; amount: number; percentage: number }[]; colors: string[] }) {
  const size = 160;
  const radius = 60;
  const strokeWidth = 28;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const total = data.reduce((s, d) => s + d.percentage, 0) || 100;

  return (
    <div className="admin-donut-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} className="admin-donut-chart">
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#152739" strokeWidth={strokeWidth} />
        {data.map((d, i) => {
          const pct = (d.percentage / total) * 100;
          const dash = (pct / 100) * circumference;
          const seg = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={colors[i % colors.length]}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              className="donut-seg"
            >
              <title>{`${d.method}: ${money.format(d.amount)} (${d.percentage.toFixed(1)}%)`}</title>
            </circle>
          );
          offset += dash;
          return seg;
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#eaf1f6" fontSize="14" fontWeight="700">
          {data.length}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill="#6e8799" fontSize="9">
          métodos
        </text>
      </svg>
    </div>
  );
}

/* ============ Audit Trail ============ */

function AuditTrail({ sales, salespeople }: { sales: PartnerSale[]; salespeople: PartnerSalesperson[] }) {
  const [filter, setFilter] = useState('all');

  const auditLogs = useMemo<AuditLog[]>(() => {
    const logs: AuditLog[] = [];

    for (const sale of sales) {
      const sp = salespeople.find((s) => s.id === sale.salesperson_id);
      const actorName = sp?.name ?? 'Sistema';
      const actorRole = sp?.role ?? 'sistema';

      if (sale.status === 'cancelada') {
        logs.push({
          id: `cancel-${sale.id}`,
          user_id: sale.user_id,
          actor_name: actorName,
          actor_role: actorRole,
          action: 'Venda Cancelada',
          entity_type: 'venda',
          entity_id: sale.id,
          details: `Pedido #${(sale.sale_number ? String(sale.sale_number).padStart(6, '0') : sale.id.slice(0, 8).toUpperCase())} cancelado — Cliente: ${sale.customer_name ?? '—'} — Total: ${money.format(sale.total)}`,
          created_at: sale.created_at,
        });
      }

      if (sale.status === 'concluida') {
        logs.push({
          id: `sale-${sale.id}`,
          user_id: sale.user_id,
          actor_name: actorName,
          actor_role: actorRole,
          action: 'Venda Finalizada',
          entity_type: 'venda',
          entity_id: sale.id,
          details: `Pedido #${(sale.sale_number ? String(sale.sale_number).padStart(6, '0') : sale.id.slice(0, 8).toUpperCase())} concluído — Cliente: ${sale.customer_name ?? '—'} — Total: ${money.format(sale.total)} — Pagamento: ${salePaymentDescription(sale)}`,
          created_at: sale.created_at,
        });
      }

      if (sale.status === 'pre_venda') {
        logs.push({
          id: `presale-${sale.id}`,
          user_id: sale.user_id,
          actor_name: actorName,
          actor_role: actorRole,
          action: 'Pré-Venda Criada',
          entity_type: 'pre_venda',
          entity_id: sale.id,
          details: `Orçamento #${(sale.sale_number ? String(sale.sale_number).padStart(6, '0') : sale.id.slice(0, 8).toUpperCase())} gerado — Cliente: ${sale.customer_name ?? '—'} — Total: ${money.format(sale.total)}`,
          created_at: sale.created_at,
        });
      }
    }

    return logs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [sales, salespeople]);

  const filteredLogs = filter === 'all' ? auditLogs : auditLogs.filter((l) => l.action.toLowerCase().includes(filter));

  const actionColors: Record<string, string> = {
    'Venda Finalizada': '#5bbc87',
    'Venda Cancelada': '#e3829b',
    'Pré-Venda Criada': '#e6a06d',
  };

  return (
    <div>
      <div className="admin-audit-filters">
        <button className={`rma-advance-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>Todos</button>
        <button className={`rma-advance-btn ${filter === 'cancelada' ? 'active' : ''}`} onClick={() => setFilter('cancelada')}>Cancelamentos</button>
        <button className={`rma-advance-btn ${filter === 'finalizada' ? 'active' : ''}`} onClick={() => setFilter('finalizada')}>Vendas Finalizadas</button>
        <button className={`rma-advance-btn ${filter === 'pré-venda' || filter === 'pre-venda' ? 'active' : ''}`} onClick={() => setFilter('pré-venda')}>Pré-Vendas</button>
      </div>

      <div className="stock-table-wrap">
        <table className="rma-table">
          <thead>
            <tr><th>Data/Hora</th><th>Responsável</th><th>Função</th><th>Ação</th><th>Detalhes</th></tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr><td colSpan={5} className="empty-row">Nenhum registro de auditoria encontrado.</td></tr>
            ) : (
              filteredLogs.slice(0, 50).map((log) => (
                <tr key={log.id}>
                  <td><small>{new Date(log.created_at).toLocaleString('pt-BR')}</small></td>
                  <td><strong>{log.actor_name}</strong></td>
                  <td>
                    <span className="rma-status-badge" style={{ color: '#7f97a9', borderColor: '#3a4d5e' }}>
                      {roleLabels[log.actor_role as SalespersonRole] ?? log.actor_role}
                    </span>
                  </td>
                  <td>
                    <span className="rma-status-badge" style={{ color: actionColors[log.action] ?? '#7f97a9', borderColor: actionColors[log.action] ?? '#3a4d5e' }}>
                      {log.action}
                    </span>
                  </td>
                  <td><small>{log.details}</small></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filteredLogs.length > 50 && (
        <p className="admin-audit-footer">Exibindo os 50 registros mais recentes de {filteredLogs.length} total.</p>
      )}
    </div>
  );
}

/* ============ Inline Financial Summary ============ */

function AdminFinancialSummary({
  userId, isActive = true, movements = [],
  invoices, payables, payablesUnavailable,
  sales, products, branches, branchFilter, onBranchChange,
}: {
  userId?: string;
  isActive?: boolean;
  movements?: StockMovement[];
  invoices: PartnerInvoice[];
  payables: PayableAccount[];
  payablesUnavailable: boolean;
  sales: PartnerSale[];
  products: PartnerProduct[];
  branches: PartnerBranch[];
  branchFilter: string;
  onBranchChange: (id: string) => void;
}) {
  const completed = useMemo(() => {
    const c = sales.filter((s) => s.status === 'concluida');
    if (!branchFilter) return c;
    return c.filter((s) => !s.branch_id || s.branch_id === branchFilter);
  }, [sales, branchFilter]);

  const productCostMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of products) map[p.id] = p.cost_price;
    return map;
  }, [products]);

  const grossRevenue = completed.reduce((s, x) => s + (x.total ?? 0), 0);
  let totalCost = 0;
  for (const sale of completed) {
    for (const item of safeItems(sale)) {
      totalCost += (sale.cost_snapshot?.[item.product_id] ?? productCostMap[item.product_id] ?? 0) * item.quantity;
    }
  }
  const netRevenue = grossRevenue - totalCost;
  const margin = grossRevenue > 0 ? (netRevenue / grossRevenue) * 100 : 0;

  const accounts = financialAccounts(invoices, payables);
  const accountsReceivable = accounts.receivable;
  const accountsPayable = accounts.payable;
  const ledger = useFinancialMovements(userId, branchFilter, invoices, payables, isActive);
  const records = actualFinancialFlow(completed, movements, ledger.receipts, ledger.payments, payables, invoices, ledger.refunds);
  const sum = (prefix: string) => records.filter(row => row.id.startsWith(prefix)).reduce((cents, row) => cents + Math.round(row.amount * 100), 0) / 100;
  const immediateReceipts = sum('sale-');
  const received = sum('receipt-');
  const paid = -sum('payment-');
  const refunded = -sum('rma-refund-');
  const cashBalance = (Math.round(immediateReceipts * 100) + Math.round(received * 100) - Math.round(paid * 100) - Math.round(refunded * 100)) / 100;
  const movementsUnavailable = payablesUnavailable || ledger.loading || Boolean(ledger.error);

  const dreRows = [
    { label: 'Receita Bruta de Vendas', value: grossRevenue, bold: true },
    { label: '(-) Deduções e Impostos (estimado: 8%)', value: -grossRevenue * 0.08, bold: false },
    { label: 'Receita Líquida', value: grossRevenue * 0.92, bold: true },
    { label: '(-) Custo dos Produtos Vendidos (CMV)', value: -totalCost, bold: false },
    { label: 'Lucro Bruto', value: grossRevenue * 0.92 - totalCost, bold: true },
    { label: '(-) Despesas Operacionais (estimado)', value: -grossRevenue * 0.12, bold: false },
    { label: 'Lucro Operacional (EBIT)', value: grossRevenue * 0.92 - totalCost - grossRevenue * 0.12, bold: true },
    { label: '(-) Imposto de Renda (estimado)', value: -(grossRevenue * 0.92 - totalCost - grossRevenue * 0.12) * 0.15, bold: false },
    { label: 'Resultado líquido simulado', value: (grossRevenue * 0.92 - totalCost - grossRevenue * 0.12) * 0.85, bold: true },
  ];

  const cashFlowRows = [
    { label: 'Saldo Inicial', value: 0, bold: false },
    { label: '(+) Vendas à vista', value: immediateReceipts, bold: false },
    { label: '(+) Recebimentos de Faturas', value: received, bold: false },
    { label: '(-) Pagamentos de Contas Registrados', value: -paid, bold: false },
    { label: '(-) Reembolsos de Devoluções', value: -refunded, bold: false },
    { label: 'Saldo dos Movimentos Registrados', value: cashBalance, bold: true },
  ];

  return (
    <div className="admin-financial-summary">
      {ledger.loading && <p role="status">Carregando movimentos confirmados…</p>}
      {ledger.error && <p role="alert">{ledger.error} <button type="button" onClick={ledger.reload}>Tentar novamente</button></p>}
      <div className="admin-filter-bar">
        <h4 className="admin-section-heading"><Wallet size={16} /> Resumo Financeiro Executivo</h4>
        {branches.length > 0 && (
          <div className="admin-branch-selector">
            <MapPin size={14} />
            <select value={branchFilter} onChange={(e) => onBranchChange(e.target.value)}>
              <option value="">Visão Consolidada</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="report-cards admin-kpi-grid">
        <div className="report-card admin-kpi-card">
          <small><DollarSign size={13} /> Receita Bruta</small>
          <strong>{money.format(grossRevenue)}</strong>
          <small>{completed.length} vendas</small>
        </div>
        <div className="report-card admin-kpi-card">
          <small><Wallet size={13} /> Contas a Pagar</small>
          <strong>{payablesUnavailable ? 'Indisponível' : money.format(accountsPayable)}</strong>
          <small>saldo pendente das contas cadastradas</small>
        </div>
        <div className="report-card admin-kpi-card">
          <small><CreditCard size={13} /> Contas a Receber</small>
          <strong>{money.format(accountsReceivable)}</strong>
          <small>saldo pendente após recebimentos</small>
        </div>
        <div className="report-card admin-kpi-card">
          <small><Percent size={13} /> Margem Líquida</small>
          <strong>{margin.toFixed(1)}%</strong>
          <small>lucro / receita</small>
        </div>
        <div className="report-card admin-kpi-card">
          <small><Wallet size={13} /> Saldo dos Movimentos</small>
          <strong>{movementsUnavailable ? 'Indisponível' : money.format(cashBalance)}</strong>
          <small>vendas e baixas registradas</small>
        </div>
      </div>

      <div className="admin-dre-grid">
        <div className="module-card">
          <h4 className="report-section-title"><FileText size={16} /> DRE — Simulação de resultado</h4>
          <div className="stock-table-wrap">
            <table className="rma-table">
              <thead><tr><th>Descrição</th><th>Valor</th></tr></thead>
              <tbody>
                {dreRows.map((row, i) => (
                  <tr key={i} className={row.bold ? 'admin-dre-bold' : ''}>
                    <td>{row.label}</td>
                    <td>{money.format(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="module-card">
          <h4 className="report-section-title"><Wallet size={16} /> Fluxo de Caixa</h4>
          <p>Movimentos registrados desde o início. Valores a receber ainda não recebidos não entram no saldo. Não inclui saldo bancário inicial ou movimentações externas. {payablesUnavailable ? 'Contas a Pagar indisponíveis: saldo incompleto.' : ''}</p>
          <div className="stock-table-wrap">
            <table className="rma-table">
              <thead><tr><th>Descrição</th><th>Valor</th></tr></thead>
              <tbody>
                {cashFlowRows.map((row, i) => (
                  <tr key={i} className={row.bold ? 'admin-dre-bold' : ''}>
                    <td>{row.label}</td>
                    <td>{movementsUnavailable ? 'Indisponível' : money.format(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ Inline Cadastros View ============ */

function InlineCadastrosView({ products, customers, suppliers, salespeople, categories }: {
  products: PartnerProduct[];
  customers: PartnerCustomer[];
  suppliers: PartnerSupplier[];
  salespeople: PartnerSalesperson[];
  categories: PartnerCategory[];
}) {
  return (
    <div className="admin-inline-cadastros">
      <div className="admin-permissions-info">
        <Boxes size={16} />
        <span>Resumo de cadastros — para edição completa, acesse o módulo Cadastros na barra lateral principal.</span>
      </div>
      <div className="report-cards">
        <div className="report-card">
          <small><Package size={13} /> Produtos</small>
          <strong>{products.length}</strong>
          <small>{products.filter((p) => !p.is_service).length} produtos • {products.filter((p) => p.is_service).length} serviços</small>
        </div>
        <div className="report-card">
          <small><Users size={13} /> Clientes</small>
          <strong>{customers.length}</strong>
          <small>cadastrados</small>
        </div>
        <div className="report-card">
          <small><Building2 size={13} /> Fornecedores</small>
          <strong>{suppliers.length}</strong>
          <small>fornecedores</small>
        </div>
        <div className="report-card">
          <small><UserCheck size={13} /> Vendedores</small>
          <strong>{salespeople.length}</strong>
          <small>equipe</small>
        </div>
        <div className="report-card">
          <small><Boxes size={13} /> Categorias</small>
          <strong>{categories.length}</strong>
          <small>classificações</small>
        </div>
      </div>
      <div className="stock-table-wrap">
        <h4 className="report-section-title"><Package size={16} /> Produtos Cadastrados</h4>
        <table className="rma-table">
          <thead><tr><th>Nome</th><th>SKU</th><th>Custo</th><th>Varejo</th><th>Estoque</th></tr></thead>
          <tbody>
            {products.length === 0 ? (
              <tr><td colSpan={5} className="empty-row">Nenhum produto cadastrado.</td></tr>
            ) : (
              products.slice(0, 20).map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.sku ?? '—'}</td>
                  <td>{money.format(p.cost_price)}</td>
                  <td>{money.format(p.sale_price)}</td>
                  <td>{p.is_service ? '—' : p.stock}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
