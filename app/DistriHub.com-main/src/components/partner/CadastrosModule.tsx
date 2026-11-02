import React, { useState, useMemo, useRef, useEffect } from 'react';
import { SessionDraftProvider, useSessionDraftScope, useSessionDraftState } from '../../hooks/useSessionDraft';
import { createPortal } from 'react-dom';
import {
  Boxes, FileText, Package, Plus, Tag, Trash2, Upload, Users,
  Building2, Layers, QrCode, X, History,
  IdCard, MapPin, Wallet, Phone, Save, UserCircle, MoreVertical, Pencil,
  Check, TrendingUp, AlertTriangle, Activity, Image as PhotoIcon,
} from 'lucide-react';
import type {
  PartnerProduct, PartnerCategory, PartnerSupplier,
  PartnerSalesperson, PartnerCombo, PartnerModifier, PartnerCustomer,
  PartnerSale, SalespersonRole, PartnerBranch,
  PersonType, RmaRequest,
} from '../../types';
import { formatCivilDate, formatCnpj, formatCpf, isValidCnpj, isValidCpf, money, normalizeDocument } from '../../utils';
import { parseStockXml, type XmlStockImport } from '../../lib/cadastroXml';
import { CustomerPhoto, CustomerPhotoViewer } from './CustomerPhoto';
import { ProductProfitPreview } from './ProductProfitPreview';
import { ProductPhotoField } from './ProductPhotoField';
import { ProductLabelModal as ThermalLabelModal } from './ProductLabelModal';
import { ImportExportModule, ExportButtons } from './ImportExportModule';
import { saleReturnLabel, saleItemDescription } from '../../lib/saleReturns';
import { normalizeProductName } from '../../lib/productNames';
import type { SaasPlanId } from '../../lib/saas';

type PartnerCustomerUpdate = Partial<
  Omit<PartnerCustomer, 'id' | 'user_id' | 'created_at' | 'updated_at'>
> & {
  photo_file?: File | null;
  remove_photo?: boolean;
};

type Props = {
  suppliersReady?: boolean;
  findProductDuplicates: (name: string, branchId: string) => Promise<PartnerProduct[]>;
  canManageSalespeople?: boolean;
  planId?: SaasPlanId;
  adminTarget?: string;
  initialTab?: SubTab;
  isActive?: boolean;
  onDataScopeChange?: (tab: string) => void;
  productType?: 'produto' | 'servico' | 'todos';
  products: PartnerProduct[];
  branches: PartnerBranch[];
  selectedBranchId: string | null;
  categories: PartnerCategory[];
  suppliers: PartnerSupplier[];
  salespeople: PartnerSalesperson[];
  combos: PartnerCombo[];
  modifiers: PartnerModifier[];
  customers: PartnerCustomer[];
  sales: PartnerSale[];
  /** Todas as vendas da empresa (sem filtro de filial ativa), usadas no histórico de compras do cliente. */
  allSales: PartnerSale[];
  rmaRequests?: RmaRequest[];
  segment: string;
  onAddProduct: (p: Omit<PartnerProduct, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<void>;
  onUpdateProduct: (id: string, updates: Partial<PartnerProduct>) => Promise<void>;
  onReplenishStock: (productId: string, branchId: string, quantity: number, unitCost?: number | null, reason?: string) => Promise<{ newStock: number }>;
  onDeleteProduct: (id: string) => Promise<void>;
  onImportXml: (invoice: XmlStockImport, branchId: string) => Promise<void>;
  onAddCategory: (name: string, branchId?: string) => Promise<void>;
  onUpdateCategory?: (id: string, updates: Partial<PartnerCategory>) => Promise<unknown>;
  onDeleteCategory: (id: string) => Promise<void>;
  onAddSupplier: (s: Omit<PartnerSupplier, 'id' | 'user_id' | 'created_at' | 'payable_balance'>) => Promise<PartnerSupplier>;
  onUpdateSupplier: (id: string, updates: Partial<PartnerSupplier>) => Promise<void>;
  onDeleteSupplier: (id: string) => Promise<void>;
  onAddSalesperson: (
  sp: Omit<PartnerSalesperson, 'id' | 'user_id' | 'created_at'>
) => Promise<PartnerSalesperson>;
  onUpdateSalesperson: (id: string, updates: Partial<PartnerSalesperson>) => Promise<void>;
  onDeleteSalesperson: (id: string) => Promise<void>;
  onAddCombo: (c: Omit<PartnerCombo, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
  onDeleteCombo: (id: string) => Promise<void>;
  onAddModifier: (m: Omit<PartnerModifier, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
  onDeleteModifier: (id: string) => Promise<void>;
  onAddCustomer: (c: Omit<PartnerCustomer, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
  onUpdateCustomer: (id: string, updates: PartnerCustomerUpdate) => Promise<void>;
  onLoadCustomer: (id: string) => Promise<PartnerCustomer>;
  onDeleteCustomer: (id: string) => Promise<void>;
};

type SubTab = 'produtos' | 'categorias' | 'xml' | 'combos' | 'modificadores' | 'clientes' | 'fornecedores' | 'vendedores' | 'importar' | 'reposicao';

const subTabs: { id: SubTab; label: string; icon: typeof Package }[] = [
  { id: 'produtos', label: 'Produtos & Serviços', icon: Package },
  { id: 'categorias', label: 'Categorias', icon: Tag },
  { id: 'xml', label: 'Entrada via XML (NF-e)', icon: FileText },
  { id: 'combos', label: 'Combos / Kits', icon: Boxes },
  { id: 'modificadores', label: 'Modificadores', icon: Layers },
  { id: 'clientes', label: 'Clientes', icon: Users },
  { id: 'fornecedores', label: 'Fornecedores', icon: Building2 },
  { id: 'reposicao', label: 'Reposição de Estoque', icon: Activity },
  { id: 'importar', label: 'Importar / Exportar', icon: Upload },
];

function getActionPopoverPosition(event: React.MouseEvent<HTMLButtonElement>, width: number, height: number): React.CSSProperties {
  const rect = event.currentTarget.getBoundingClientRect();
  const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
  const openUp = rect.bottom + height + 8 > window.innerHeight;
  const top = openUp ? Math.max(8, rect.top - height - 6) : Math.min(window.innerHeight - height - 8, rect.bottom + 6);
  return { position: 'fixed', left, top, width, zIndex: 1000 };
}

export function CadastrosModule({
  adminTarget,
  canManageSalespeople = false,
  planId,
  findProductDuplicates,
  initialTab = 'produtos', productType = 'todos',
  isActive = true, onDataScopeChange, suppliersReady = true,
  products, branches, selectedBranchId, categories, suppliers, salespeople, combos, modifiers, customers, sales,
  allSales, rmaRequests = [], segment, onAddProduct, onUpdateProduct, onDeleteProduct,
  onReplenishStock, onImportXml,
  onAddCategory, onUpdateCategory, onDeleteCategory, onAddSupplier, onUpdateSupplier, onDeleteSupplier, onAddSalesperson,
  onUpdateSalesperson, onDeleteSalesperson,
  onAddCombo, onDeleteCombo, onAddModifier, onDeleteModifier, onAddCustomer,
  onUpdateCustomer, onLoadCustomer, onDeleteCustomer,
}: Props) {
  const parentDraftScope = useSessionDraftScope();
  const [subTab, setSubTab] = useSessionDraftState<SubTab>(`cadastros:${adminTarget ?? 'principal'}:active-subtab`, initialTab);
  const showSalespeopleOutsideAdmin = canManageSalespeople && planId === 'basico';
  const visibleSubTabs = showSalespeopleOutsideAdmin
    ? [...subTabs, { id: 'vendedores' as const, label: 'Colaboradores', icon: Users }]
    : subTabs;
  useEffect(() => {
    if (!adminTarget && subTab === 'vendedores' && !showSalespeopleOutsideAdmin) setSubTab('produtos');
  }, [adminTarget, subTab, showSalespeopleOutsideAdmin, setSubTab]);
  useEffect(() => { if (isActive) onDataScopeChange?.(subTab); }, [isActive, subTab, onDataScopeChange]);
  const [visitedSubTabs, setVisitedSubTabs] = useState<Set<SubTab>>(() => new Set([initialTab]));
  useEffect(() => {
    setVisitedSubTabs((current) => current.has(subTab) ? current : new Set(current).add(subTab));
  }, [subTab, setVisitedSubTabs]);
  const filteredProducts = selectedBranchId
    ? products.filter((product) => product.branch_id === selectedBranchId)
    : [];

  return (
    <SessionDraftProvider
      key={`${parentDraftScope}:cadastros:${adminTarget ?? 'principal'}`}
      scope={`${parentDraftScope}:cadastros:${adminTarget ?? 'principal'}`}
    >
    <div className="panel-module cadastros-scope">
      <div className="module-header">
        <span className="module-icon"><Boxes size={20} /></span>
        <div>
          <h3>{adminTarget ? ({ produtos: 'Produtos', servicos: 'Serviços', combos: 'Combos de Produtos', importar: 'Importar / Exportar', fornecedores: 'Fornecedores', estoque: 'Ajuste de Estoque', vendedores: 'Usuários e permissões', clientes: 'Clientes' } as Record<string, string>)[adminTarget] : 'Cadastros Essenciais & Entrada Automática'}</h3>
          <p>{adminTarget === 'vendedores' ? 'Cadastre usuários e edite os acessos, a função, a filial e o PIN da equipe.' : adminTarget ? 'Cadastre e gerencie os registros da opção selecionada no Administrativo.' : 'Produtos, serviços, categorias, clientes e fornecedores'}</p>
        </div>
      </div>

      {!adminTarget && <div className="subtab-bar cadastros-subtab-bar">
        {visibleSubTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`subtab ${subTab === id ? 'active' : ''}`}
            onClick={() => {
              setVisitedSubTabs((current) => current.has(id) ? current : new Set(current).add(id));
              setSubTab(id);
            }}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>}

      <div className="subtab-content">
        {adminTarget === 'estoque' && <StockAdjustmentSubTab products={filteredProducts.filter(p => !p.is_service)} branchId={selectedBranchId} onUpdate={onUpdateProduct} />}
        {adminTarget !== 'estoque' && (adminTarget ? subTab === 'produtos' : visitedSubTabs.has('produtos')) && (
          <div hidden={subTab !== 'produtos'}>
          <ProductsSubTab
            products={filteredProducts.filter(product => productType === 'todos' || product.is_service === (productType === 'servico'))}
            isActive={isActive && subTab === 'produtos'}
            defaultIsService={productType === 'servico'}
            allProducts={products}
            branches={branches}
            selectedBranchId={selectedBranchId}
            categories={categories}
            suppliersReady={suppliersReady}
            suppliers={suppliers}
            onAddSupplier={onAddSupplier}
            segment={segment}
            onAddProduct={onAddProduct}
            findProductDuplicates={findProductDuplicates}
            onUpdateProduct={onUpdateProduct}
            onDeleteProduct={onDeleteProduct}
          />
          </div>
        )}
        {(adminTarget ? subTab === 'categorias' : visitedSubTabs.has('categorias')) && (
          <div hidden={subTab !== 'categorias'}>
          <CategoriesSubTab categories={categories} branches={branches} selectedBranchId={selectedBranchId} products={filteredProducts} onAdd={onAddCategory} onAssign={onUpdateCategory} onDelete={onDeleteCategory} />
          </div>
        )}
        {(adminTarget ? subTab === 'xml' : visitedSubTabs.has('xml')) && <div hidden={subTab !== 'xml'}><XmlSubTab selectedBranchId={selectedBranchId} onImport={onImportXml} /></div>}
        {(adminTarget ? subTab === 'combos' : visitedSubTabs.has('combos')) && (
          <div hidden={subTab !== 'combos'}>
          <CombosSubTab combos={combos.filter(combo => combo.items.every(item => filteredProducts.some(product => product.id === item.product_id)))} products={filteredProducts} onAdd={onAddCombo} onDelete={onDeleteCombo} />
          </div>
        )}
        {(adminTarget ? subTab === 'modificadores' : visitedSubTabs.has('modificadores')) && (
          <div hidden={subTab !== 'modificadores'}>
          <ModifiersSubTab modifiers={modifiers.filter(modifier => filteredProducts.some(product => product.id === modifier.product_id))} products={filteredProducts} onAdd={onAddModifier} onDelete={onDeleteModifier} />
          </div>
        )}
        {(adminTarget ? subTab === 'clientes' : visitedSubTabs.has('clientes')) && (
          <div hidden={subTab !== 'clientes'}>
          <CustomersSubTab
            customers={customers}
            branches={branches}
            isActive={isActive && subTab === 'clientes'}
            sales={allSales}
            rmaRequests={rmaRequests}
            salespeople={salespeople}
            onLoadCustomer={onLoadCustomer}
            selectedBranchId={selectedBranchId}
            onAdd={onAddCustomer}
            onUpdate={onUpdateCustomer}
            onDelete={onDeleteCustomer}
          />
          </div>
        )}
        {(adminTarget ? subTab === 'fornecedores' : visitedSubTabs.has('fornecedores')) && (
          <div hidden={subTab !== 'fornecedores'}>
          <SuppliersSubTab suppliers={suppliers} branches={branches} selectedBranchId={selectedBranchId} onAdd={onAddSupplier} onUpdate={onUpdateSupplier} onDelete={onDeleteSupplier} />
          </div>
        )}
        {subTab === 'vendedores' && (adminTarget === 'vendedores' || (!adminTarget && showSalespeopleOutsideAdmin)) && (
          <SalespeopleSubTab
            salespeople={salespeople}
            branches={branches}
            selectedBranchId={selectedBranchId}
            onAdd={onAddSalesperson}
            onUpdate={onUpdateSalesperson}
            onDelete={onDeleteSalesperson}
          />
        )}
        {(adminTarget ? subTab === 'reposicao' : visitedSubTabs.has('reposicao')) && (
          <div hidden={subTab !== 'reposicao'}>
          <ReplenishmentSubTab products={products} sales={sales} selectedBranchId={selectedBranchId} onReplenishStock={onReplenishStock} />
          </div>
        )}
        {(adminTarget ? subTab === 'importar' : visitedSubTabs.has('importar')) && (
          <div hidden={subTab !== 'importar'}>
          <ImportExportModule
            products={products}
            customers={customers}
            selectedBranchId={selectedBranchId}
            onAddProduct={onAddProduct}
            onUpdateProduct={onUpdateProduct}
            onAddCustomer={onAddCustomer}
          />
          </div>
        )}
      </div>
    </div>
    </SessionDraftProvider>
  );
}

function StockAdjustmentSubTab({ products, branchId, onUpdate }: {
  products: PartnerProduct[]; branchId: string | null; onUpdate: Props['onUpdateProduct'];
}) {
  const [query, setQuery] = useSessionDraftState('stock-adjustment:query', '');
  const [editing, setEditing] = useSessionDraftState<{ id: string; stock: string } | null>('stock-adjustment:editing', null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || !editing) return;
    const stock = Number(editing.stock);
    if (!branchId || !editing.stock.trim() || !Number.isInteger(stock) || stock < 0) { setError('Selecione uma filial e informe um saldo inteiro maior ou igual a zero.'); return; }
    lock.current = true; setSaving(true); setError(''); setNotice('');
    try { await onUpdate(editing.id, { stock }); setEditing(null); setNotice('Saldo de estoque atualizado.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível ajustar o estoque.'); }
    finally { lock.current = false; setSaving(false); }
  }
  if (!branchId) return <p role="alert">Selecione uma filial para consultar e ajustar seu estoque.</p>;
  const rows = products.filter(p => `${p.name} ${p.sku ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="module-card">
    <p>Informe o saldo total contado no estoque. Este ajuste usa o cadastro do produto e registra a diferença como ajuste de estoque.</p>
    <input aria-label="Buscar produto no estoque" type="search" placeholder="Nome ou SKU" value={query} onChange={e => setQuery(e.target.value)} />
    {error && <p role="alert" className="otp-error-msg">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="stock-table-wrap"><table className="rma-table"><thead><tr><th>Produto</th><th>SKU</th><th>Saldo atual</th><th>Mínimo</th><th>Ajustar</th></tr></thead>
      <tbody>{rows.length === 0 ? <tr><td colSpan={5} className="empty-row">Nenhum produto nesta seleção.</td></tr> : rows.map(p => <tr key={p.id}>
        <td>{p.name}</td><td>{p.sku || '—'}</td><td>{p.stock}</td><td>{p.min_stock}</td><td>{editing?.id === p.id ? <form onSubmit={save}>
          <input aria-label={`Novo saldo de ${p.name}`} type="number" min="0" step="1" required disabled={saving} value={editing.stock} onChange={e => setEditing({ ...editing, stock: e.target.value })} />
          <button type="submit" className="module-submit-btn" disabled={saving}>{saving ? 'Salvando…' : 'Salvar saldo'}</button>
          <button type="button" className="rma-advance-btn" disabled={saving} onClick={() => setEditing(null)}>Cancelar</button>
        </form> : <button type="button" className="rma-advance-btn" disabled={saving} onClick={() => { setEditing({ id: p.id, stock: String(p.stock) }); setError(''); setNotice(''); }}>Ajustar saldo</button>}</td>
      </tr>)}</tbody></table></div>
  </div>;
}

function ProductsSubTab({ suppliersReady = true, defaultIsService = false, isActive = true, products, allProducts, branches, selectedBranchId, categories, suppliers, onAddSupplier, onAddProduct, findProductDuplicates, onUpdateProduct, onDeleteProduct }: {
  suppliersReady?: boolean;
  defaultIsService?: boolean;
  isActive?: boolean;
  products: PartnerProduct[];
  allProducts: PartnerProduct[];
  branches: PartnerBranch[];
  selectedBranchId: string | null;
  categories: PartnerCategory[];
  suppliers: PartnerSupplier[];
  onAddSupplier: Props['onAddSupplier'];
  segment: string;
  onAddProduct: (p: Omit<PartnerProduct, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => Promise<void>;
  findProductDuplicates: (name: string, branchId: string) => Promise<PartnerProduct[]>;
  onUpdateProduct: (id: string, updates: Partial<PartnerProduct>) => Promise<void>;
  onDeleteProduct: (id: string) => Promise<void>;
}) {
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [showForm, setShowForm] = useSessionDraftState('products:show-form', false);
  const [productSearch, setProductSearch] = useState('');
  const matchingProducts = useMemo(() => {
    const term = normalizeProductName(productSearch);
    return products.filter((product) =>
      normalizeProductName(product.name).includes(term) ||
      normalizeProductName(product.sku).includes(term) ||
      normalizeProductName(product.barcode).includes(term),
    );
  }, [products, productSearch]);
  const [name, setName] = useSessionDraftState('products:name', '');
  const [sku, setSku] = useSessionDraftState('products:sku', '');
  const [barcode, setBarcode] = useSessionDraftState('products:barcode', '');
  const [cost, setCost] = useSessionDraftState('products:cost', '');
  const [sale, setSale] = useSessionDraftState('products:sale', '');
  const [wholesale, setWholesale] = useSessionDraftState('products:wholesale', '');
  const [premium, setPremium] = useSessionDraftState('products:premium', '');
  const [stock, setStock] = useSessionDraftState('products:stock', '');
  const [minStock, setMinStock] = useSessionDraftState('products:min-stock', '5');
  const [category, setCategory] = useSessionDraftState('products:category', '');
  const [supplierId, setSupplierId] = useSessionDraftState('products:supplier', '');
  const [isService, setIsService] = useSessionDraftState('products:is-service', defaultIsService);
  const [ncm, setNcm] = useSessionDraftState('products:ncm', '');
  const [cfop, setCfop] = useSessionDraftState('products:cfop', '');
  const [cstCsosn, setCstCsosn] = useSessionDraftState('products:cst-csosn', '');
  const [icmsRate, setIcmsRate] = useSessionDraftState('products:icms-rate', '');
  const [pisRate, setPisRate] = useSessionDraftState('products:pis-rate', '');
  const [cofinsRate, setCofinsRate] = useSessionDraftState('products:cofins-rate', '');
  const [labelProductId, setLabelProductId] = useState<string | null>(null);
  const [photoProduct, setPhotoProduct] = useState<PartnerProduct | null>(null);
  const [availabilityProductId, setAvailabilityProductId] = useState<string | null>(null);
  const [editProduct, setEditProduct] = useState<PartnerProduct | null>(null);
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const [productActionPosition, setProductActionPosition] = useState<React.CSSProperties | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const deleteLock = useRef(false);
  useEffect(() => {
    if (isActive) return;
    setOpenActionId(null);
    setProductActionPosition(null);
    setPhotoProduct(null);
  }, [isActive]);
  const [formError, setFormError] = useState<string | null>(null);
  const [potentialDuplicates, setPotentialDuplicates] = useState<PartnerProduct[]>([]);
  const [saving, setSaving] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [productNotice, setProductNotice] = useState('');
  const [imageUrl, setImageUrl] = useSessionDraftState<string | null>('products:image-url', null, undefined, value => value === null || typeof value === 'string');
  const [photoBusy, setPhotoBusy] = useState(false);

  async function deleteProduct(product: PartnerProduct) {
    if (deleteLock.current) return;
    setOpenActionId(null); setDeleteError(null);
    if (!window.confirm(`Excluir o produto "${product.name}"?`)) return;
    deleteLock.current = true; setDeletingProductId(product.id);
    try { await onDeleteProduct(product.id); }
    catch (cause) {
      const message = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : 'Não foi possível excluir o produto. Tente novamente.';
      if (message.includes('Produto com estoque')) {
        setDeleteError(`Não foi possível excluir "${product.name}": o produto ainda tem saldo em estoque. Transfira o saldo ou registre a saída correspondente em Estoque antes de excluir.`);
      } else if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '23503') {
        setDeleteError(`Não foi possível excluir "${product.name}": há registros vinculados ao produto, como devoluções ou ordens de serviço. O histórico precisa ser preservado.`);
      } else setDeleteError(message);
    } finally { deleteLock.current = false; setDeletingProductId(null); }
  }


  function productPayload(): Omit<PartnerProduct, 'id' | 'user_id' | 'created_at' | 'updated_at'> {
    return {
      name, sku: sku.trim() || null, barcode: barcode.trim() || null, cost_price: Number(cost) || 0, sale_price: Number(sale) || 0,
      wholesale_price: Number(wholesale) || 0, premium_price: premium.trim() ? Number(premium) : null,
      stock: Number(stock) || 0, min_stock: Number(minStock) || 0,
      image_url: imageUrl, supplier_id: supplierId || null, category: category || null, is_service: isService, branch_id: selectedBranchId,
      ncm: ncm || null, cfop: cfop || null, cst_csosn: cstCsosn || null,
      icms_rate: Number(icmsRate) || 0, pis_rate: Number(pisRate) || 0, cofins_rate: Number(cofinsRate) || 0,
      brand: undefined,
      active: undefined,
      price: undefined,
      image: undefined,
      description: undefined,
    };
  }

  function clearNewProductForm() {
    setName(''); setSku(''); setBarcode(''); setCost(''); setSale(''); setWholesale(''); setPremium(''); setStock(''); setMinStock('5'); setCategory(''); setSupplierId(''); setIsService(defaultIsService);
    setNcm(''); setCfop(''); setCstCsosn(''); setIcmsRate(''); setPisRate(''); setCofinsRate('');
    setShowForm(false);
    setImageUrl(null);
    setPotentialDuplicates([]);
  }

  async function persistNewProduct() {
    await onAddProduct(productPayload());
    clearNewProductForm();
  }

  async function handleSubmit(e: React.FormEvent | React.MouseEvent, allowPossibleDuplicate = false) {
    e.preventDefault();
    if (saving || photoBusy || !suppliersReady) return;
    if (!name.trim() || !sale) return;
    if (!selectedBranchId) {
      window.alert('Selecione uma filial antes de cadastrar produtos para manter o estoque separado por filial.');
      return;
    }
    setSaving(true);
    setFormError(null);
    setPotentialDuplicates([]);
    try {
      if (!allowPossibleDuplicate) {
        const duplicates = await findProductDuplicates(name, selectedBranchId);
        if (duplicates.length) {
          setPotentialDuplicates(duplicates);
          return;
        }
      }
      await persistNewProduct();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível salvar o produto.');
    } finally {
      setSaving(false);
    }
  }

  const itemLabel = 'Produto / Serviço';

  const selectedProduct = products.find((p) => p.id === availabilityProductId) ?? null;
  const currentBranch = branches.find((branch) => branch.id === selectedBranchId);

  const productMatches = selectedProduct
    ? allProducts.filter((product) => {
        if (!product.branch_id || product.branch_id === selectedBranchId) return false;
        const sameName = product.name.trim().toLowerCase() === selectedProduct.name.trim().toLowerCase();
        const sameSku = !!selectedProduct.sku && !!product.sku && product.sku.trim().toLowerCase() === selectedProduct.sku.trim().toLowerCase();
        const sameFallback = !selectedProduct.sku && !product.sku && sameName;
        return sameName && (sameSku || sameFallback);
      })
    : [];

  function beginEdit(product: PartnerProduct) {
    setEditError(null);
    setProductNotice('');
    setEditProduct(product);
    setOpenActionId(null);
  }

  async function saveEdit(updates: Partial<PartnerProduct>) {
    if (!editProduct) return;
    setProductNotice('');
    setSavingEdit(true);
    setEditError(null);
    try {
      await onUpdateProduct(editProduct.id, updates);
      setEditProduct(null);
      setProductNotice(updates.image_url ? 'Produto e foto salvos.' : 'Produto salvo.');
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Não foi possível salvar o produto.');
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div>
      <div className="action-row product-list-toolbar">
        <button className="module-action-btn" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancelar' : <><Plus size={16} /> Novo {itemLabel}</>}
        </button>
        <ExportButtons target="produtos" products={products} customers={[]} />
      </div>
      {deleteError && <p role="alert" className="otp-error-msg">{deleteError}</p>}
      {productNotice && <p role="status">{productNotice}</p>}
      {deletingProductId && <p role="status">Excluindo produto...</p>}
      {showForm && (
        <form className="rma-form product-entry-form" onSubmit={handleSubmit}>
          <div className="product-registration-header">
          <ProductPhotoField value={imageUrl} onChange={setImageUrl} disabled={saving} onBusyChange={setPhotoBusy} />
          <section className="product-form-section">
            <h4>Identificação</h4>
          <div className="form-row product-form-row product-identity-row">
            <label>
              Nome
                <input value={name} onChange={(e) => { setName(e.target.value); setPotentialDuplicates([]); }} placeholder="Nome do produto ou serviço" required />
            </label>
            <label>
              SKU
              <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Código do produto. Ex: PROD-001" />
            </label>
            <label>
              Código de barras
              <input type="text" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Clique aqui e passe o leitor" autoComplete="off" onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} />
              <small>Leia a etiqueta ou digite o código de barras para usar no PDV.</small>
            </label>
          </div>
          </section>
          </div>
          <section className="product-form-section">
            <h4>Preços e rentabilidade</h4>
          <div className="form-row product-form-row">
            <label>
              Preço de Custo
              <input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0,00" />
            </label>
            <label>
              Preço Varejo
              <input type="number" step="0.01" value={sale} onChange={(e) => setSale(e.target.value)} placeholder="0,00" required />
            </label>
            <label>
              Preço Atacado
              <input type="number" step="0.01" value={wholesale} onChange={(e) => setWholesale(e.target.value)} placeholder="0,00" />
            </label>
          </div>
          <label>Preço Premium (opcional)<input aria-label="Preço Premium" type="number" min="0" max="99999999.99" step="0.01" value={premium} onChange={event => setPremium(event.target.value)} placeholder="Não configurado" /></label>
          <ProductProfitPreview cost={cost} retail={sale} wholesale={wholesale} />
          </section>
          <section className="product-form-section">
            <h4>Estoque e categoria</h4>
          <div className="form-row product-form-row product-stock-row">
            <label>
              Estoque
              <input type="number" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="0" />
            </label>
            <label>
              Alerta Mínimo
              <input type="number" value={minStock} onChange={(e) => setMinStock(e.target.value)} placeholder="5" />
            </label>
            <label>
              Categoria
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Selecione...</option>
                {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={isService} onChange={(e) => setIsService(e.target.checked)} />
              É um serviço (sem estoque)
            </label>
          </div>
          </section>
          {!suppliersReady && <p role="status">Aguarde o carregamento dos fornecedores para salvar. Se houver falha, use Sincronizar no painel.</p>}
          <SupplierField suppliers={suppliers} value={supplierId} onChange={setSupplierId} onAdd={onAddSupplier} disabled={saving || !suppliersReady} onBusyChange={setSupplierSaving} />
          <section className="product-form-section">
            <h4>Dados fiscais</h4>
          <div className="form-row product-form-row">
            <label>
              NCM
              <input value={ncm} onChange={(e) => setNcm(e.target.value)} placeholder="0000.00.00" />
            </label>
            <label>
              CFOP
              <input value={cfop} onChange={(e) => setCfop(e.target.value)} placeholder="5102" />
            </label>
            <label>
              CST/CSOSN
              <input value={cstCsosn} onChange={(e) => setCstCsosn(e.target.value)} placeholder="102" />
            </label>
          </div>
          <div className="form-row">
            <label>
              ICMS (%)
              <input type="number" step="0.01" value={icmsRate} onChange={(e) => setIcmsRate(e.target.value)} placeholder="0" />
            </label>
            <label>
              PIS (%)
              <input type="number" step="0.01" value={pisRate} onChange={(e) => setPisRate(e.target.value)} placeholder="0" />
            </label>
            <label>
              COFINS (%)
              <input type="number" step="0.01" value={cofinsRate} onChange={(e) => setCofinsRate(e.target.value)} placeholder="0" />
            </label>
          </div>
          </section>
          {formError && <p className="form-error-msg" style={{ color: '#e3829b', fontSize: '13px' }}>{formError}</p>}
          {potentialDuplicates.length > 0 && <div className="branch-action-error" role="alert">
            <p>Encontramos produto(s) com o mesmo nome nesta filial, considerando espaços, acentos e maiúsculas/minúsculas. Confira antes de continuar. O estoque não será somado.</p>
            <ul>{potentialDuplicates.map((product) => <li key={product.id}>
              {product.name} · SKU: {product.sku ?? '—'} · Estoque: {product.stock}
              <button type="button" className="rma-advance-btn" disabled={saving} onClick={() => beginEdit(product)}>Ver cadastro</button>
            </li>)}</ul>
            <button type="button" className="rma-advance-btn" disabled={saving} onClick={(event) => { void handleSubmit(event, true); }}>Cadastrar mesmo assim</button>
          </div>}
          <button type="submit" className="module-submit-btn" disabled={saving || supplierSaving || photoBusy || !suppliersReady}>{saving ? 'Salvando...' : 'Cadastrar'}</button>
        </form>
      )}

      <div className="pdv-search-bar">
        <input
          type="search"
          value={productSearch}
          onChange={(event) => setProductSearch(event.target.value)}
          placeholder="Pesquisar produto, modelo, SKU ou código de barras..."
          aria-label="Pesquisar produto, modelo, SKU ou código de barras"
        />
      </div>
      <div className="stock-table-wrap directory-card-wrap">
        <table className="rma-table directory-card-table product-list-table" aria-label={defaultIsService ? 'Serviços cadastrados' : 'Produtos cadastrados'}>
          <thead>
            <tr>
              <th>Produto / SKU</th><th>Custo</th><th>Varejo</th><th>Atacado</th><th>Estoque</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {matchingProducts.length === 0 ? (
              <tr><td colSpan={7} className="empty-row">Nenhum produto encontrado.</td></tr>
            ) : (
              matchingProducts.map((p) => (
                <tr key={p.id} className={p.image_url ? 'product-with-photo' : undefined}>
                  <td className="directory-card-title"><div className="product-identity">{p.image_url && <img className="product-list-photo" src={p.image_url} alt={p.name} loading="lazy" />}<div className="product-identity-text"><strong>{p.name}</strong><small>SKU: {p.sku ?? '—'}</small>{p.barcode && <small>Código de barras: {p.barcode}</small>}{p.is_service && <small className="tag-service">Serviço</small>}</div></div></td>
                  <td data-label="Custo">{money.format(p.cost_price)}</td>
                  <td data-label="Varejo">{money.format(p.sale_price)}</td>
                  <td data-label="Atacado">{p.wholesale_price > 0 ? money.format(p.wholesale_price) : '—'}</td>
                  <td data-label="Estoque">{p.is_service ? 'Não se aplica' : p.stock}</td>
                  <td data-label="Status">
                    {p.is_service && <span className="rma-status-badge">Serviço</span>}
                    {!p.is_service && p.stock <= (p.min_stock || 0) && p.stock > 0 && (
                      <span className="rma-status-badge stock-low">Estoque baixo</span>
                    )}
                    {!p.is_service && p.stock === 0 && (
                      <span className="rma-status-badge stock-empty">Sem estoque</span>
                    )}
                    {!p.is_service && p.stock > (p.min_stock || 0) && (
                      <span className="rma-status-badge stock-ok">OK</span>
                    )}
                  </td>
                  <td className="product-actions-cell directory-card-actions" data-label="Ações">
                    <div className="product-actions-menu product-photo-actions">
                      <button type="button" className="customer-photo-view-btn" title="Visualizar foto" aria-label={`Visualizar foto de ${p.name}`} onClick={() => { setOpenActionId(null); setPhotoProduct(p); }}><PhotoIcon size={20} aria-hidden="true" /></button>
                      <button type="button" className="product-actions-trigger" onClick={(event) => { setOpenActionId(openActionId === p.id ? null : p.id); setProductActionPosition(openActionId === p.id ? null : getActionPopoverPosition(event, 220, 190)); }} aria-label={`Ações de ${p.name}`} aria-expanded={openActionId === p.id}>
                        <MoreVertical size={18} />
                      </button>
                      {openActionId === p.id && productActionPosition && createPortal(
                        <div className="product-actions-popover" style={productActionPosition} role="menu">
                          <button type="button" onClick={() => beginEdit(p)}><Pencil size={15} /> Editar</button>
                          <button type="button" onClick={() => { setLabelProductId(p.id); setOpenActionId(null); }}><QrCode size={15} /> Imprimir etiquetas</button>
                          <button type="button" onClick={() => { setAvailabilityProductId(p.id); setOpenActionId(null); }}><Building2 size={15} /> Consultar em outras filiais</button>
                          <button type="button" className="danger" disabled={Boolean(deletingProductId)} onClick={() => void deleteProduct(p)}><Trash2 size={15} /> Excluir</button>
                        </div>, document.body
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {photoProduct && <CustomerPhotoViewer name={photoProduct.name} imageUrl={photoProduct.image_url ?? null} entityLabel="produto" onClose={() => setPhotoProduct(null)} />}

      {labelProductId && (
        <ThermalLabelModal
          key={labelProductId}
          product={products.find((p) => p.id === labelProductId)}
          products={allProducts}
          onSaveBarcode={async code=>{await onUpdateProduct(labelProductId,{barcode:code});}}
          onClose={() => setLabelProductId(null)}
        />
      )}

      {availabilityProductId && selectedProduct && (
        <ProductBranchAvailabilityModal
          product={selectedProduct}
          currentBranchName={currentBranch?.name ?? 'Minha filial'}
          currentBranchStock={selectedProduct.stock}
          currentBranchPrice={selectedProduct.sale_price}
          otherBranches={productMatches.map((product) => ({
            branchId: product.branch_id!,
            branchName: branches.find((branch) => branch.id === product.branch_id)?.name ?? 'Filial',
            stock: product.stock,
            salePrice: product.sale_price,
          }))}
          onClose={() => setAvailabilityProductId(null)}
        />
      )}

      {editProduct && (
        <ProductEditModal
          suppliersReady={suppliersReady}
          product={editProduct}
          categories={categories}
          suppliers={suppliers}
          onAddSupplier={onAddSupplier}
          saving={savingEdit}
          error={editError}
          onClose={() => !savingEdit && setEditProduct(null)}
          onSave={saveEdit}
        />
      )}
    </div>
  );
}


function SupplierField({ suppliers, value, onChange, onAdd, disabled, onBusyChange }: {
  suppliers: PartnerSupplier[];
  value: string;
  onChange: (id: string) => void;
  onAdd: Props['onAddSupplier'];
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    if (!name.trim() || saving) return;
    setSaving(true);
    onBusyChange(true);
    setError(null);
    try {
      const supplier = await onAdd({ name: name.trim(), phone: phone.trim() || null, notes: null, status: undefined, zip_code: undefined, state: undefined });
      onChange(supplier.id);
      setAdding(false);
      setName('');
      setPhone('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível cadastrar o fornecedor.');
    } finally { setSaving(false); onBusyChange(false); }
  }
  return <section className="product-form-section">
    <h4>Fornecedor</h4>
    <div className="form-row">
      <label>Fornecedor do produto<select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || saving}>
        <option value="">Sem fornecedor</option>
        {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
      </select></label>
      <button type="button" className="rma-advance-btn" disabled={disabled || saving} onClick={() => { setAdding(!adding); setError(null); }}><Plus size={16} /> {adding ? 'Cancelar novo fornecedor' : 'Novo fornecedor'}</button>
    </div>
    {adding && <div className="form-row">
      <label>Nome do fornecedor<input value={name} onChange={(event) => setName(event.target.value)} disabled={disabled || saving} /></label>
      <label>Telefone (opcional)<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} disabled={disabled || saving} /></label>
      <button type="button" className="module-submit-btn" disabled={disabled || saving || !name.trim()} onClick={add}>{saving ? 'Salvando...' : 'Adicionar fornecedor'}</button>
    </div>}
    {error && <p className="branch-action-error" role="alert">{error}</p>}
  </section>;
}

function ProductEditModal({ suppliersReady = true, product, categories, suppliers, onAddSupplier, saving, error, onClose, onSave }: {
  suppliersReady?: boolean;
  product: PartnerProduct;
  categories: PartnerCategory[];
  suppliers: PartnerSupplier[];
  onAddSupplier: Props['onAddSupplier'];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (updates: Partial<PartnerProduct>) => Promise<void>;
}) {
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [imageUrl, setImageUrl] = useState(product.image_url);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [name, setName] = useState(product.name);
  const [sku, setSku] = useState(product.sku ?? '');
  const [barcode, setBarcode] = useState(product.barcode ?? '');
  const [cost, setCost] = useState(String(product.cost_price));
  const [sale, setSale] = useState(String(product.sale_price));
  const [wholesale, setWholesale] = useState(String(product.wholesale_price));
  const [premium, setPremium] = useState(product.premium_price == null ? '' : String(product.premium_price));
  const [stock, setStock] = useState(String(product.stock));
  const [minStock, setMinStock] = useState(String(product.min_stock));
  const [category, setCategory] = useState(product.category ?? '');
  const [supplierId, setSupplierId] = useState(product.supplier_id ?? '');
  const [isService, setIsService] = useState(product.is_service);
  const [ncm, setNcm] = useState(product.ncm ?? '');
  const [cfop, setCfop] = useState(product.cfop ?? '');
  const [cstCsosn, setCstCsosn] = useState(product.cst_csosn ?? '');
  const [icmsRate, setIcmsRate] = useState(String(product.icms_rate ?? 0));
  const [pisRate, setPisRate] = useState(String(product.pis_rate ?? 0));
  const [cofinsRate, setCofinsRate] = useState(String(product.cofins_rate ?? 0));



  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || photoBusy) return;
    if (!name.trim() || !sale) return;
    if (!suppliersReady) return;
    await onSave({
      image_url: imageUrl,
      name: name.trim(), sku: sku.trim() || null, barcode: barcode.trim() || null, cost_price: Number(cost) || 0,
      sale_price: Number(sale) || 0, wholesale_price: Number(wholesale) || 0, premium_price: premium.trim() ? Number(premium) : null,
      stock: Math.max(0, Number(stock) || 0), min_stock: Math.max(0, Number(minStock) || 0),
      supplier_id: supplierId || null, category: category || null, is_service: isService, ncm: ncm || null,
      cfop: cfop || null, cst_csosn: cstCsosn || null, icms_rate: Number(icmsRate) || 0,
      pis_rate: Number(pisRate) || 0, cofins_rate: Number(cofinsRate) || 0,
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card product-edit-modal" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header"><h4>Editar produto</h4><button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">×</button></div>
        <div className="product-edit-body">
          <div className="product-registration-header">
          <ProductPhotoField value={imageUrl} onChange={setImageUrl} disabled={saving} onBusyChange={setPhotoBusy} />
          <div className="form-row product-registration-fields">
            <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label>SKU<input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Código do produto" /></label>
            <label>Código de barras<input type="text" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Clique aqui e passe o leitor" autoComplete="off" onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }} /><small>Leia a etiqueta ou digite o código de barras para usar no PDV.</small></label>
          </div>
          </div>
          <h4>Preços e rentabilidade</h4>
          <div className="form-row"><label>Preço de custo<input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></label><label>Preço varejo<input type="number" min="0" step="0.01" value={sale} onChange={(e) => setSale(e.target.value)} required /></label><label>Preço atacado<input type="number" min="0" step="0.01" value={wholesale} onChange={(e) => setWholesale(e.target.value)} /></label></div>
          <label>Preço Premium (opcional)<input aria-label="Preço Premium" type="number" min="0" max="99999999.99" step="0.01" value={premium} onChange={event => setPremium(event.target.value)} placeholder="Não configurado" /></label>
          <ProductProfitPreview cost={cost} retail={sale} wholesale={wholesale} />
          <div className="form-row"><label>Estoque<input type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} /></label><label>Estoque mínimo<input type="number" min="0" step="1" value={minStock} onChange={(e) => setMinStock(e.target.value)} /></label><label>Categoria<select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Selecione...</option>{categories.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label></div>
          {!suppliersReady && <p role="status">Aguarde o carregamento dos fornecedores para salvar. Se houver falha, use Sincronizar no painel.</p>}
          <SupplierField suppliers={suppliers} value={supplierId} onChange={setSupplierId} onAdd={onAddSupplier} disabled={saving || !suppliersReady} onBusyChange={setSupplierSaving} />
          <label className="checkbox-label"><input type="checkbox" checked={isService} onChange={(e) => setIsService(e.target.checked)} /> É um serviço (sem estoque)</label>
          <div className="form-row"><label>NCM<input value={ncm} onChange={(e) => setNcm(e.target.value)} /></label><label>CFOP<input value={cfop} onChange={(e) => setCfop(e.target.value)} /></label><label>CST/CSOSN<input value={cstCsosn} onChange={(e) => setCstCsosn(e.target.value)} /></label></div>
          <div className="form-row"><label>ICMS (%)<input type="number" min="0" step="0.01" value={icmsRate} onChange={(e) => setIcmsRate(e.target.value)} /></label><label>PIS (%)<input type="number" min="0" step="0.01" value={pisRate} onChange={(e) => setPisRate(e.target.value)} /></label><label>COFINS (%)<input type="number" min="0" step="0.01" value={cofinsRate} onChange={(e) => setCofinsRate(e.target.value)} /></label></div>
          {error && <div className="branch-action-error" role="alert">{error}</div>}
        </div>
        <div className="product-edit-footer"><button type="button" className="rma-advance-btn" onClick={onClose} disabled={saving || photoBusy}>Cancelar</button><button type="submit" className="module-submit-btn" disabled={saving || supplierSaving || photoBusy || !suppliersReady}>{saving ? 'Salvando...' : 'Salvar alterações'}</button></div>
      </form>
    </div>
  );
}

function ProductBranchAvailabilityModal({
  product,
  currentBranchName,
  currentBranchStock,
  currentBranchPrice,
  otherBranches,
  onClose,
}: {
  product: PartnerProduct;
  currentBranchName: string;
  currentBranchStock: number;
  currentBranchPrice: number;
  otherBranches: { branchId: string; branchName: string; stock: number; salePrice: number }[];
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3>Ver disponibilidade em outras filiais</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          <div className="partner-card" style={{ padding: 16 }}>
            <strong>Produto: {product.name}</strong>
            <div style={{ marginTop: 8 }}>
              <div><strong>Minha filial</strong></div>
              <div>{currentBranchName}</div>
              <small>Estoque: {currentBranchStock} unidades</small><br />
              <small>Preço de venda: {money.format(currentBranchPrice)}</small>
            </div>
          </div>

          <div className="partner-card" style={{ padding: 16 }}>
            <strong>Outras filiais</strong>
            {otherBranches.length === 0 ? (
              <div style={{ marginTop: 12 }}>Sem estoque em outras filiais.</div>
            ) : (
              <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                {otherBranches.map((branch) => (
                  <div key={branch.branchId} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10 }}>
                    <div><strong>{branch.branchName}</strong></div>
                    <small>Estoque: {branch.stock} unidades</small><br />
                    <small>Preço de venda: {money.format(branch.salePrice)}</small>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


function CategoriesSubTab({ categories, products, onAdd, onDelete, branches = [], selectedBranchId, onAssign }: {
  categories: PartnerCategory[];
  products: PartnerProduct[];
  onAdd: (name: string, branchId?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  branches?: PartnerBranch[];
  selectedBranchId?: string | null;
  onAssign?: (id: string, updates: Partial<PartnerCategory>) => Promise<unknown>;
}) {
  const actionLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  async function runAction(action: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setActionError(null);
    try { await action(); }
    catch (cause) { setActionError(cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : 'Não foi possível concluir. Tente novamente.'); }
    finally { actionLock.current = false; setBusy(false); }
  }

  const [name, setName] = useSessionDraftState('categories:name', '');
  const [draftBranchId, setDraftBranchId] = useSessionDraftState('categories:branch', '');
  const [selectedCategoryId, setSelectedCategoryId] = useSessionDraftState<string | null>('categories:selected-id', null, undefined, value => value === null || typeof value === 'string');
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) ?? null;
  const categoryProducts = selectedCategory
    ? products.filter((product) => product.category === selectedCategory.name)
    : [];

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await runAction(async () => {
    const branchId = selectedBranchId || draftBranchId;
    if (branches.length && !branches.some(branch => branch.id === branchId)) throw new Error('Selecione a filial da categoria.');
    await onAdd(name.trim(), branchId || undefined);
    setName('');
    });
  }
  return (
    <div>
      {actionError && <p role="alert" className="otp-error-msg">{actionError}</p>}
      <form className="rma-form inline" onSubmit={handleAdd}>
        {!selectedBranchId && branches.length > 0 && <label>Filial<select aria-label="Filial da categoria" value={draftBranchId} onChange={event => setDraftBranchId(event.target.value)} required><option value="">Selecione</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
        <label>
          Nova Categoria
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da categoria" required />
        </label>
        <button type="submit" disabled={busy} className="module-submit-btn"><Plus size={16} /> Adicionar</button>
      </form>
      <div className="category-browser-list">
        {categories.length === 0 ? (
          <p className="empty-row">Nenhuma categoria cadastrada.</p>
        ) : (
          categories.map((category) => {
            const productCount = products.filter((product) => product.category === category.name).length;
            const isSelected = selectedCategoryId === category.id;
            return (
              <div key={category.id} className={`category-browser-item ${isSelected ? 'active' : ''}`}>
                <button
                  type="button"
                  className="category-browser-select"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedCategoryId(isSelected ? null : category.id)}
                >
                  <Tag size={14} />
                  <span>{category.name}</span>
                  <small>{productCount}</small>
                </button>
                {!selectedBranchId && !category.branch_id && onAssign && <select aria-label={`Definir filial de ${category.name}`} disabled={busy} value="" onChange={event => { const id = event.target.value; if (id) void runAction(async () => { await onAssign(category.id, { branch_id: id }); }); }}><option value="">Sem filial: definir</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>}
                {!selectedBranchId && category.branch_id && <small>{branches.find(branch => branch.id === category.branch_id)?.name}</small>}
                <button
                  type="button"
                  className="category-browser-delete"
                  aria-label={`Excluir categoria ${category.name}`}
                  title="Excluir categoria"
                  disabled={busy} onClick={() => runAction(() => onDelete(category.id))}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })
        )}
      </div>
      {selectedCategory && (
        <section className="category-product-results">
          <div className="category-product-heading">
            <h4>{selectedCategory.name}</h4>
            <span>{categoryProducts.length} {categoryProducts.length === 1 ? 'produto' : 'produtos'}</span>
          </div>
          <div className="stock-table-wrap">
            <table className="rma-table">
              <thead>
                <tr><th>Produto</th><th>SKU</th><th>Varejo</th><th>Atacado</th><th>Estoque</th></tr>
              </thead>
              <tbody>
                {categoryProducts.length === 0 ? (
                  <tr><td colSpan={5} className="empty-row">Nenhum produto nesta categoria.</td></tr>
                ) : (
                  categoryProducts.map((product) => (
                    <tr key={product.id}>
                      <td><strong>{product.name}</strong>{product.is_service && <small className="tag-service">Serviço</small>}</td>
                      <td>{product.sku ?? '—'}</td>
                      <td>{money.format(product.sale_price)}</td>
                      <td>{product.wholesale_price > 0 ? money.format(product.wholesale_price) : '—'}</td>
                      <td>{product.is_service ? '—' : product.stock}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function XmlSubTab({ selectedBranchId, onImport }: {
  selectedBranchId: string | null;
  onImport: (invoice: XmlStockImport, branchId: string) => Promise<void>;
}) {
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<XmlStockImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState(false);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const fileVersion = useRef(0);
  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || lock.current) return;
    const version = ++fileVersion.current;
    setFileName(file.name); setParsed(null); setError(null); setImported(false);
    try {
      const invoice = parseStockXml(await file.text());
      if (version === fileVersion.current) setParsed(invoice);
    } catch (cause) {
      if (version === fileVersion.current) setError(cause instanceof Error ? cause.message : 'Não foi possível ler a NF-e.');
    }
  }
  async function handleImport() {
    if (lock.current || !parsed) return;
    if (!selectedBranchId) { setError('Selecione uma filial antes de importar a NF-e.'); return; }
    lock.current = true; setSaving(true); setError(null); setImported(false);
    try {
      await onImport(parsed, selectedBranchId);
      setImported(true); setParsed(null); setFileName('');
    } catch (cause) {
      setError(cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : 'Não foi possível importar. Você pode tentar novamente com a mesma nota.');
    } finally { lock.current = false; setSaving(false); }
  }
  return <div>
    <div className="xml-info-banner"><FileText size={20} /><div><strong>Entrada Automática via XML (NF-e)</strong><p>Confira os itens e importe a nota para cadastrar o fornecedor e dar entrada no estoque da filial selecionada. Uma nota já importada não gera outra entrada.</p></div></div>
    <label className="upload-label"><div className="media-upload"><Upload size={18} /><span>{fileName || 'Selecionar arquivo XML da NF-e'}</span><input type="file" accept=".xml,application/xml,text/xml" onChange={handleFile} disabled={saving} hidden /></div></label>
    {error && <div role="alert" className="xml-error-message"><AlertTriangle size={16} /> {error}</div>}
    {parsed && <div className="stock-table-wrap"><p>Fornecedor: {parsed.supplier.name} — {parsed.supplier.document}</p><small>NF-e: {parsed.invoiceKey}</small><table className="rma-table"><thead><tr><th>Produto</th><th>SKU</th><th>Qtd.</th><th>Custo Unit.</th><th>Custo Total</th></tr></thead><tbody>{parsed.items.map((item, index) => <tr key={index}><td>{item.name}</td><td>{item.sku}</td><td>{item.qty}</td><td>{money.format(item.cost)}</td><td>{money.format(item.cost * item.qty)}</td></tr>)}</tbody></table><button className="module-submit-btn" onClick={handleImport} disabled={saving}>{saving ? 'Importando...' : 'Dar entrada no estoque (' + parsed.items.length + ' itens)'}</button></div>}
    {imported && <div className="sent-message">NF-e processada. Estoque e fornecedor atualizados sem duplicar entradas anteriores.</div>}
  </div>;
}

function CombosSubTab({ combos, products, onAdd, onDelete }: {
  combos: PartnerCombo[];
  products: PartnerProduct[];
  onAdd: (c: Omit<PartnerCombo, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const actionLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  async function runAction(action: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setActionError(null);
    try { await action(); }
    catch (cause) { setActionError(cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : 'Não foi possível concluir. Tente novamente.'); }
    finally { actionLock.current = false; setBusy(false); }
  }

  const [showForm, setShowForm] = useSessionDraftState('combos:show-form', false);
  const [name, setName] = useSessionDraftState('combos:name', '');
  const [price, setPrice] = useSessionDraftState('combos:price', '');
  const [selected, setSelected] = useSessionDraftState<string[]>('combos:selected-products', []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !price || selected.length === 0) return;
    if (!Number.isFinite(Number(price)) || Number(price) < 0 || selected.some(id => !products.some(product => product.id === id))) { setActionError('Informe um preço não negativo e produtos da filial atual.'); return; }
    const items = selected.map((pid) => {
      const p = products.find((x) => x.id === pid);
      return { product_id: pid, name: p?.name ?? '', quantity: 1 };
    });
    await runAction(async () => { await onAdd({ name: name.trim(), price: Number(price), items, active: true });
    setName(''); setPrice(''); setSelected([]); setShowForm(false);
    });
  }

  function toggleProduct(id: string) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  return (
    <div>
      {actionError && <p role="alert" className="otp-error-msg">{actionError}</p>}
      <button className="module-action-btn" onClick={() => setShowForm(!showForm)}>
        {showForm ? 'Cancelar' : <><Plus size={16} /> Novo Combo / Kit</>}
      </button>
      {showForm && (
        <form className="rma-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label>
              Nome do Combo
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Kit Troca de Tela + Películula" required />
            </label>
            <label>
              Preço Fechado
              <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" required />
            </label>
          </div>
          <div className="product-picker">
            <small>Selecione os itens do combo:</small>
            <div className="product-picker-grid">
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`picker-item ${selected.includes(p.id) ? 'selected' : ''}`}
                  onClick={() => toggleProduct(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" disabled={busy} className="module-submit-btn">Criar combo</button>
        </form>
      )}
      <div className="combo-list">
        {combos.length === 0 ? (
          <p className="empty-row">Nenhum combo cadastrado.</p>
        ) : (
          combos.map((c) => (
            <div key={c.id} className="combo-card">
              <div>
                <strong>{c.name}</strong>
                <small>{c.items.length} itens • {money.format(c.price)}</small>
              </div>
              <button className="rma-advance-btn danger" disabled={busy} onClick={() => runAction(() => onDelete(c.id))}><Trash2 size={14} /></button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ModifiersSubTab({ modifiers, products, onAdd, onDelete }: {
  modifiers: PartnerModifier[];
  products: PartnerProduct[];
  onAdd: (m: Omit<PartnerModifier, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const actionLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  async function runAction(action: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setActionError(null);
    try { await action(); }
    catch (cause) { setActionError(cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : 'Não foi possível concluir. Tente novamente.'); }
    finally { actionLock.current = false; setBusy(false); }
  }

  const [name, setName] = useSessionDraftState('modifiers:name', '');
  const [adj, setAdj] = useSessionDraftState('modifiers:price-adjustment', '');
  const [productId, setProductId] = useSessionDraftState('modifiers:product-id', '');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !productId) return;
    if (!Number.isFinite(Number(adj || 0)) || !products.some(product => product.id === productId)) { setActionError('Informe um ajuste válido e um produto da filial atual.'); return; }
    await runAction(async () => { await onAdd({ name: name.trim(), price_adjustment: Number(adj) || 0, product_id: productId });
    setName(''); setAdj(''); setProductId('');
    });
  }

  return (
    <div>
      {actionError && <p role="alert" className="otp-error-msg">{actionError}</p>}
      <form className="rma-form" onSubmit={handleSubmit}>
        <div className="form-row">
          <label>
            Produto Base
            <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
              <option value="">Selecione...</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>
            Nome do Modificador
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Com aro / Sem aro" required />
          </label>
          <label>
            Ajuste de Preço (+/-)
            <input type="number" step="0.01" value={adj} onChange={(e) => setAdj(e.target.value)} placeholder="0,00" />
          </label>
        </div>
        <button type="submit" disabled={busy} className="module-submit-btn"><Plus size={16} /> Adicionar modificador</button>
      </form>
      <div className="stock-table-wrap">
        <table className="rma-table">
          <thead><tr><th>Produto</th><th>Modificador</th><th>Ajuste</th><th></th></tr></thead>
          <tbody>
            {modifiers.length === 0 ? (
              <tr><td colSpan={4} className="empty-row">Nenhum modificador cadastrado.</td></tr>
            ) : (
              modifiers.map((m) => (
                <tr key={m.id}>
                  <td>{products.find((p) => p.id === m.product_id)?.name ?? '—'}</td>
                  <td>{m.name}</td>
                  <td>{m.price_adjustment >= 0 ? '+' : ''}{money.format(m.price_adjustment)}</td>
                  <td><button className="rma-advance-btn danger" disabled={busy} onClick={() => runAction(() => onDelete(m.id))}><Trash2 size={14} /></button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomersSubTab({ isActive = true, customers, branches, sales, rmaRequests, salespeople, selectedBranchId, onAdd, onUpdate, onDelete, onLoadCustomer }: {
  isActive?: boolean;
  rmaRequests: RmaRequest[];
  customers: PartnerCustomer[];
  branches: PartnerBranch[];
  sales: PartnerSale[];
  salespeople: PartnerSalesperson[];
  onLoadCustomer: (id: string) => Promise<PartnerCustomer>;
  selectedBranchId: string | null;
  onAdd: (c: Omit<PartnerCustomer, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
  onUpdate: (id: string, updates: Partial<PartnerCustomer>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [showForm, setShowForm] = useSessionDraftState('customers:show-form', false);
  const [editingCustomerId, setEditingCustomerId] = useSessionDraftState<string | null>('customers:editing-id', null, undefined, value => value === null || typeof value === 'string');
  const [name, setName] = useSessionDraftState('customers:name', '');
  const [customerBranchId, setCustomerBranchId] = useSessionDraftState('customers:branch-id', '');
  const [branchError, setBranchError] = useState<string | null>(null);
  const editingCustomer = editingCustomerId ? customers.find(customer => customer.id === editingCustomerId) : null;
  const existingBranchId = editingCustomer?.branch_id;
  const isSharedCustomer = Boolean(editingCustomer && !existingBranchId);
  const validDraftBranchId = branches.some(branch => branch.id === customerBranchId) ? customerBranchId : '';
  const targetBranchId = existingBranchId || selectedBranchId || validDraftBranchId || (branches.length === 1 ? branches[0].id : '');
  const [document, setDocument] = useSessionDraftState('customers:document', '');
  const [personType, setPersonType] = useSessionDraftState<PersonType | ''>('customers:person-type', 'PF');
  const [phone, setPhone] = useSessionDraftState('customers:phone', '');
  const [email, setEmail] = useSessionDraftState('customers:email', '');
  const [birthday, setBirthday] = useSessionDraftState('customers:birthday', '');
  const [address, setAddress] = useSessionDraftState('customers:address', '');
  const [neighborhood, setNeighborhood] = useSessionDraftState('customers:neighborhood', '');
  const [city, setCity] = useSessionDraftState('customers:city', '');
  const [device, setDevice] = useSessionDraftState('customers:device', '');
  const [notes, setNotes] = useSessionDraftState('customers:notes', '');
  const [customerType, setCustomerType] = useSessionDraftState<'varejo' | 'atacado'>('customers:type', 'varejo');
  const [customerSearch, setCustomerSearch] = useSessionDraftState('customers:search', '');
  const [historyCustomerId, setHistoryCustomerId] = useState<string | null>(null);
  const [profileCustomerId, setProfileCustomerId] = useState<string | null>(null);
  const [photoCustomer, setPhotoCustomer] = useState<PartnerCustomer | null>(null);
  const [openCustomerActionId, setOpenCustomerActionId] = useState<string | null>(null);
  const [customerActionPosition, setCustomerActionPosition] = useState<React.CSSProperties | null>(null);
  useEffect(() => {
    if (isActive) return;
    setOpenCustomerActionId(null);
    setCustomerActionPosition(null);
    setPhotoCustomer(null);
  }, [isActive]);

  function resetForm() {
    setCustomerBranchId(''); setBranchError(null);
    setName(''); setDocument(''); setPersonType('PF'); setPhone(''); setEmail(''); setBirthday(''); setAddress('');
    setNeighborhood(''); setCity(''); setDevice(''); setNotes(''); setCustomerType('varejo');
    setEditingCustomerId(null); setShowForm(false);
  }

  function openEditForm(customer: PartnerCustomer) {
    setCustomerBranchId(''); setBranchError(null);
    setEditingCustomerId(customer.id);
    setName(customer.name ?? '');
    const normDoc = customer.document ? normalizeDocument(customer.document) : '';
    setDocument(normDoc);
    const inferredType: PersonType = customer.person_type || (normDoc.length > 11 ? 'PJ' : 'PF');
    setPersonType(inferredType);
    setPhone(customer.phone ?? '');
    setEmail(customer.email ?? '');
    setBirthday(customer.birthday ?? '');
    setAddress(customer.address ?? '');
    setNeighborhood(customer.neighborhood ?? '');
    setCity(customer.city ?? '');
    setDevice(customer.device_model ?? '');
    setNotes(customer.notes ?? '');
    setCustomerType(customer.customer_type ?? 'varejo');
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (!targetBranchId && !isSharedCustomer) {
      setBranchError(branches.length ? 'Selecione a filial do cliente no campo abaixo para salvar.' : 'Cadastre uma filial em Configurações antes de salvar o cliente.');
      return;
    }
    setBranchError(null);

    const normalizedDocument = normalizeDocument(document);
    let effectivePersonType = personType;
    if (!effectivePersonType) {
      effectivePersonType = normalizedDocument.length > 11 ? 'PJ' : 'PF';
    }

    if (normalizedDocument) {
      if (effectivePersonType === 'PF') {
        if (normalizedDocument.length !== 11) {
          window.alert('O CPF deve conter exatamente 11 dígitos.');
          return;
        }
        if (!isValidCpf(normalizedDocument)) {
          window.alert('Informe um CPF válido.');
          return;
        }
      } else if (effectivePersonType === 'PJ') {
        if (normalizedDocument.length !== 14) {
          window.alert('O CNPJ deve conter exatamente 14 dígitos.');
          return;
        }
        if (!isValidCnpj(normalizedDocument)) {
          window.alert('Informe um CNPJ válido.');
          return;
        }
      }
    }

    const payload = {
      name,
      document: normalizedDocument || null,
      person_type: effectivePersonType,
      phone: phone || null,
      email: email || null,
      birthday: birthday || null,
      address: address || null,
      neighborhood: neighborhood || null,
      city: city || null,
      device_model: device || null,
      notes: notes || null,
      customer_type: customerType,
      branch_id: isSharedCustomer ? null : targetBranchId,
    };

    if (!payload.branch_id && !isSharedCustomer) {
      window.alert('Não foi possível localizar a filial atual do cliente. Selecione uma filial antes de salvar.');
      return;
    }

    try {
      if (editingCustomerId) {
        await onUpdate(editingCustomerId, payload);
      } else {
        await onAdd(payload as Omit<PartnerCustomer, 'id' | 'user_id' | 'created_at'>);
      }
        } catch (error) {
      if (error && typeof error === 'object') {
        const err = error as {
          message?: unknown;
          code?: unknown;
          details?: unknown;
          hint?: unknown;
        };

        const parts = [
          typeof err.message === 'string' ? err.message : null,
          typeof err.code === 'string' ? `Código: ${err.code}` : null,
          typeof err.details === 'string' ? `Detalhes: ${err.details}` : null,
          typeof err.hint === 'string' ? `Dica: ${err.hint}` : null,
        ].filter(Boolean);

        if (parts.length > 0) {
          window.alert(parts.join('\n'));
          return;
        }
      }

      window.alert(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar o cliente.'
      );
      return;
    }

    resetForm();
  }

  const historyCustomer = customers.find((c) => c.id === historyCustomerId);
  const historySales = sales.filter((s) => s.customer_id === historyCustomerId);
  const profileCustomer = customers.find((c) => c.id === profileCustomerId);
  const normalizedSearch = normalizeDocument(customerSearch);
  const visibleCustomers = customers.filter((customer) => {
    const searchTerm = customerSearch.trim().toLowerCase();
    if (!searchTerm) return true;
    const docDigits = normalizeDocument(customer.document ?? '');
    const isPj = customer.person_type === 'PJ' || docDigits.length > 11;
    const formattedDoc = docDigits ? (isPj ? formatCnpj(docDigits) : formatCpf(docDigits)) : '';
    return (
      (customer.name ?? '').toLowerCase().includes(searchTerm) ||
      (customer.email ?? '').toLowerCase().includes(searchTerm) ||
      (customer.phone ?? '').toLowerCase().includes(searchTerm) ||
      formattedDoc.toLowerCase().includes(searchTerm) ||
      (normalizedSearch && docDigits.includes(normalizedSearch))
    );
  });

  return (
    <div>
      <div className="action-row">
        <button className="module-action-btn" onClick={() => {
          if (showForm && editingCustomerId) {
            resetForm();
            return;
          }
          setShowForm(!showForm);
          if (!showForm) {
            setCustomerBranchId(''); setBranchError(null);
            setName(''); setDocument(''); setPersonType('PF'); setPhone(''); setEmail(''); setBirthday(''); setAddress('');
            setNeighborhood(''); setCity(''); setDevice(''); setNotes(''); setCustomerType('varejo');
            setEditingCustomerId(null);
          }
        }}>
          {showForm ? 'Cancelar' : <><Plus size={16} /> Novo Cliente</>}
        </button>
        <ExportButtons target="clientes" products={[]} customers={customers} />
      </div>
      <input
        type="search"
        autoComplete="off"
        value={customerSearch}
        onChange={(e) => setCustomerSearch(e.target.value)}
        placeholder="Buscar por nome, CPF/CNPJ, telefone ou e-mail"
        aria-label="Buscar clientes"
        style={{ width: '100%', marginBottom: '12px' }}
      />
      {showForm && (
        <form className="rma-form" onSubmit={handleSubmit}>
          {isSharedCustomer ? <p>Cliente compartilhado entre filiais. O vínculo será preservado ao salvar.</p> : <label>Filial do cliente
            <select aria-label="Filial do cliente" value={targetBranchId} disabled={Boolean(existingBranchId || selectedBranchId)}
              onChange={event => { setCustomerBranchId(event.target.value); setBranchError(null); }}>
              <option value="">Selecione uma filial</option>
              {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>}
          {branchError && <p className="otp-error-msg" role="alert">{branchError}</p>}
          <div className="form-row">
            <label>
              Nome Completo / Razão Social
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: João Silva ou Silva Tech LTDA" required />
            </label>
            <label>
              Tipo de pessoa
              <select
                value={personType}
                onChange={(e) => {
                  const nextType = e.target.value as PersonType;
                  setPersonType(nextType);
                }}
                required
              >
                <option value="PF">Pessoa Física (CPF)</option>
                <option value="PJ">Pessoa Jurídica (CNPJ)</option>
              </select>
            </label>
            <label>
              Documento ({personType === 'PJ' ? 'CNPJ' : 'CPF'})
              <input
                value={
                  document
                    ? (personType === 'PJ' || (!personType && document.length > 11) ? formatCnpj(document) : formatCpf(document))
                    : ''
                }
                onChange={(e) => {
                  const raw = normalizeDocument(e.target.value);
                  setDocument(raw);
                  if (raw.length > 11) {
                    setPersonType('PJ');
                  } else if (raw.length > 0 && !personType) {
                    setPersonType('PF');
                  }
                }}
                placeholder={personType === 'PJ' ? '00.000.000/0000-00' : '000.000.000-00'}
                inputMode="numeric"
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              WhatsApp
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" />
            </label>
            <label>
              E-mail
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}  />
            </label>
            <label>
              Data de Nascimento
              <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
            </label>
          </div>
          <div className="form-row">
            <label>
              Endereço Completo
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, número, complemento" />
            </label>
            <label>
              Bairro
              <input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Ex: Centro" />
            </label>
            <label>
              Cidade
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex: São Paulo, SP" />
            </label>
          </div>
          <div className="form-row">
            <label>
              Equipamento / Observações
              <input value={device} onChange={(e) => setDevice(e.target.value)} placeholder="Tipo, modelo ou observações do equipamento" />
            </label>
            <label>
              Tipo de Cliente
              <select value={customerType} onChange={(e) => setCustomerType(e.target.value as 'varejo' | 'atacado')}>
                <option value="varejo">Varejo</option>
                <option value="atacado">Atacado</option>
              </select>
            </label>
          </div>
          <label>
            Observações Adicionais
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas sobre o cliente..." rows={2} />
          </label>
          <button type="submit" className="module-submit-btn">{editingCustomerId ? 'Salvar alterações' : 'Cadastrar cliente'}</button>
        </form>
      )}

      <div className="stock-table-wrap customer-list-wrap">
        <table className="rma-table customer-list-table" aria-label="Clientes cadastrados">
          <colgroup><col className="customer-col-name" /><col className="customer-col-document" /><col className="customer-col-phone" /><col className="customer-col-location" /><col className="customer-col-birthday" /><col className="customer-col-actions" /></colgroup>
          <thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>WhatsApp</th><th>Bairro/Cidade</th><th>Aniversário</th><th className="customer-actions-heading">Ações</th></tr></thead>
          <tbody>
            {visibleCustomers.length === 0 ? (
              <tr><td colSpan={6} className="empty-row">Nenhum cliente cadastrado.</td></tr>
            ) : (
              visibleCustomers.map((c) => {
                const normDoc = c.document ? normalizeDocument(c.document) : '';
                const isPj = c.person_type === 'PJ' || normDoc.length > 11;
                const formattedDoc = normDoc ? (isPj ? formatCnpj(normDoc) : formatCpf(normDoc)) : '—';

                return (
                  <tr key={c.id}>
                    <td data-label="Nome">
                      <strong>{c.name}</strong>
                      {c.customer_type === 'atacado' && <small className="tag-service">Atacado</small>}
                    </td>
                    <td data-label="CPF/CNPJ">
                      <div>
                        <span>{formattedDoc}</span>
                        {normDoc && (
                          <small style={{ display: 'block', color: '#475569', fontSize: '12px' }}>
                            {isPj ? 'PJ' : 'PF'}
                          </small>
                        )}
                      </div>
                    </td>
                    <td data-label="WhatsApp">{c.phone ?? '—'}</td>
                    <td data-label="Bairro/Cidade">{[c.neighborhood, c.city].filter(Boolean).join(', ') || '—'}</td>
                    <td data-label="Aniversário">{c.birthday ? formatCivilDate(c.birthday) : '—'}</td>
                    <td className="customer-actions-cell" data-label="Ações">
                      <div className="product-actions-menu customer-row-actions">
                        <button type="button" className="customer-photo-view-btn" title="Visualizar foto" aria-label={`Visualizar foto de ${c.name}`} onClick={async () => { setOpenCustomerActionId(null); try { setPhotoCustomer(await onLoadCustomer(c.id)); } catch (error) { window.alert(error instanceof Error ? error.message : 'Não foi possível carregar a foto do cliente.'); } }}><PhotoIcon size={20} aria-hidden="true" /></button>
                        <button type="button" className="product-actions-trigger" onClick={(event) => { setOpenCustomerActionId(openCustomerActionId === c.id ? null : c.id); setCustomerActionPosition(openCustomerActionId === c.id ? null : getActionPopoverPosition(event, 245, 204)); }} aria-label={`Ações de ${c.name}`} aria-expanded={openCustomerActionId === c.id}>
                          <MoreVertical size={18} />
                        </button>
                        {openCustomerActionId === c.id && customerActionPosition && createPortal(
                          <div className="product-actions-popover customer-actions-popover" style={customerActionPosition} role="menu">
                            <button type="button" onClick={() => { openEditForm(c); setOpenCustomerActionId(null); }}><Pencil size={15} /> Editar</button>
                            <button type="button" onClick={async () => { setOpenCustomerActionId(null); try { await onLoadCustomer(c.id); setProfileCustomerId(c.id); } catch (error) { window.alert(error instanceof Error ? error.message : 'Não foi possível carregar os dados do cliente.'); } }}><UserCircle size={15} /> Detalhes</button>
                            <button type="button" onClick={() => { setHistoryCustomerId(c.id); setOpenCustomerActionId(null); }}><History size={15} /> Histórico de Compras / Extrato</button>
                            <button type="button" className="danger" onClick={async () => { setOpenCustomerActionId(null); if (!window.confirm(`Deseja excluir o cliente "${c.name}"?`)) return; try { await onDelete(c.id); } catch (error) { window.alert(error instanceof Error ? error.message : 'Não foi possível excluir o cliente.'); } }}><Trash2 size={15} /> Excluir</button>
                          </div>, globalThis.document.body
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {photoCustomer && <CustomerPhotoViewer name={photoCustomer.name} path={photoCustomer.photo_url} onClose={() => setPhotoCustomer(null)} />}

      {historyCustomerId && (
        <div className="modal-backdrop" onClick={() => setHistoryCustomerId(null)}>
          <div className="modal-content customer-history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Histórico de Compras & Serviços</h3>
              <button onClick={() => setHistoryCustomerId(null)}><X size={18} /></button>
            </div>
            {historyCustomer && (
              <div className="customer-info-block">
                <strong>{historyCustomer.name}</strong>
                <small>{historyCustomer.document ?? '—'} • {historyCustomer.phone ?? '—'}</small>
                <small>{historyCustomer.email ?? '—'}</small>
              </div>
            )}
            <div className="stock-table-wrap">
              <table className="rma-table">
                <thead><tr><th>Data</th><th>Itens</th><th>Total</th><th>Pagamento</th><th>Série / IMEI</th></tr></thead>
                <tbody>
                  {historySales.length === 0 ? (
                    <tr><td colSpan={5} className="empty-row">Nenhuma compra registrada.</td></tr>
                  ) : (
                    historySales.map((s) => (
                      <tr key={s.id}>
                        <td>{new Date(s.created_at).toLocaleDateString('pt-BR')}</td>
                        <td>{saleItemDescription(s, rmaRequests)}{saleReturnLabel(s, rmaRequests) && <small>{saleReturnLabel(s, rmaRequests)}</small>}</td>
                        <td>{money.format(s.total)}</td>
                        <td>{s.payment_method ?? '—'}</td>
                        <td>{s.imei ?? s.serial_number ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {profileCustomerId && profileCustomer && (
        <CustomerProfileModal customer={profileCustomer} sales={sales} rmaRequests={rmaRequests} salespeople={salespeople} onUpdate={onUpdate} onClose={() => setProfileCustomerId(null)} />
      )}
    </div>
  );
}

type CustomerTab = 'cadastrais' | 'enderecos' | 'observacoes' | 'financeiros' | 'contatos' | 'historico';
type CustomerForm = Omit<PartnerCustomer, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

function CustomerProfileModal({ customer, sales, rmaRequests, salespeople, onUpdate, onClose }: {
  rmaRequests: RmaRequest[];
  customer: PartnerCustomer;
  sales: PartnerSale[];
  salespeople: PartnerSalesperson[];
  onUpdate: (id: string, updates: PartnerCustomerUpdate) => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<CustomerTab>('cadastrais');
  const [form, setForm] = useState<CustomerForm>(() => ({
    ...customer,
    name: customer.name,
    branch_id: customer.branch_id ?? null,
    convenio: customer.convenio === true || String(customer.convenio) === 'true',
  }));
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const [photoPasting, setPhotoPasting] = useState(false);
  const [creditLimitInput, setCreditLimitInput] = useState(() => String(customer.credit_limit ?? 0));
  const [removePhoto, setRemovePhoto] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const customerSales = sales.filter((sale) => sale.customer_id === customer.id);
  const completedPurchases = customerSales.filter(sale => sale.status === 'concluida');
  const totalPurchases = completedPurchases.reduce((total, sale) => {
    const returned = rmaRequests.filter(request => request.sale_id === sale.id && request.user_id === sale.user_id)
      .reduce((sum, request) => sum + Math.max(Number(request.credit_amount ?? 0), Number(request.refund_amount ?? 0)), 0);
    return total + Math.max(0, sale.total - returned);
  }, 0);
  const tabs: { id: CustomerTab; label: string; icon: typeof UserCircle }[] = [
    { id: 'cadastrais', label: 'Dados Cadastrais', icon: IdCard },
    { id: 'enderecos', label: 'Outros Endereços', icon: MapPin },
    { id: 'observacoes', label: 'Observações', icon: FileText },
    { id: 'financeiros', label: 'Dados Financeiros', icon: Wallet },
    { id: 'contatos', label: 'Contatos', icon: Phone },
    { id: 'historico', label: 'Histórico', icon: History },
  ];

  function setField<K extends keyof CustomerForm>(field: K, value: CustomerForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setSuccess(false);
  }

  function textField(field: keyof CustomerForm, label: string, placeholder = '') {
    return (
      <label>
        <span className="social-label">{label}</span>
        <input value={String(form[field] ?? '')} onChange={(event) => setField(field, event.target.value as CustomerForm[typeof field])} placeholder={placeholder} />
      </label>
    );
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (isSaving || photoPasting) return;
    const creditLimit = Number(creditLimitInput || 0);
    if (!form.name?.trim()) { setError('Nome ou razão social é obrigatório.'); return; }
    if (!Number.isFinite(creditLimit) || creditLimit < 0) { setError('O limite de crédito não pode ser negativo.'); return; }
    const doc = normalizeDocument(form.document ?? '');
    if (doc && (form.person_type === 'PJ' ? !isValidCnpj(doc) : !isValidCpf(doc))) { setError('Informe um CPF/CNPJ válido para o tipo de pessoa selecionado.'); return; }
    setIsSaving(true); setError(null); setSuccess(false);
    try {
      await onUpdate(customer.id, { ...form, name: form.name.trim(), credit_limit: creditLimit, photo_file: photoFile, remove_photo: removePhoto });
      setSuccess(true);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : (saveError && typeof saveError === 'object' && 'message' in saveError && typeof saveError.message === 'string' ? saveError.message : 'Não foi possível salvar o cliente.'));
    } finally {
      setIsSaving(false);
    }
  }

  function pastePhoto(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError('Cole uma foto JPG, PNG ou WebP de até 2 MB.');
      return;
    }
    setPhotoFile(file); setRemovePhoto(false); setSuccess(false); setError(null); setPhotoMenuOpen(false);
  }

  async function readPhotoClipboard() {
    if (isSaving || photoPasting) return;
    setPhotoPasting(true); setError(null);
    try {
      if (!navigator.clipboard?.read) throw new Error('Copie uma imagem e use Ctrl+V (⌘V no Mac) sobre o ícone da câmera.');
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find(value => ['image/png', 'image/jpeg', 'image/webp'].includes(value));
        if (!type) continue;
        const blob = await item.getType(type);
        pastePhoto(new File([blob], 'foto-colada.' + (type === 'image/jpeg' ? 'jpg' : type.split('/')[1]), { type }));
        return;
      }
      setError('Nenhuma imagem encontrada. Copie a foto e tente colar novamente.');
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== 'NotAllowedError' ? cause.message : 'Não foi possível acessar a imagem copiada. Use Ctrl+V (⌘V no Mac) sobre o ícone da câmera.');
    } finally { setPhotoPasting(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-content customer-profile-modal" onClick={(event) => event.stopPropagation()} onSubmit={handleSave}>
        <div className="modal-header">
          <h3>Perfil do Cliente - {customer.name}</h3>
          <button type="button" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="customer-profile-header">
          <div className="customer-avatar" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPhotoMenuOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setPhotoMenuOpen(false); } }} onPaste={event => {
            if (isSaving || photoPasting) return;
            event.preventDefault();
            const file = Array.from(event.clipboardData.files).find(item => item.type.startsWith('image/'));
            if (file) pastePhoto(file);
            else setError('Copie uma imagem para colar a foto do cliente.');
          }}>
            <button type="button" className="customer-photo-picker" aria-label="Opções da foto do cliente" aria-haspopup="menu" aria-expanded={photoMenuOpen} title="Foto do cliente: colar ou remover" disabled={isSaving || photoPasting} onClick={() => setPhotoMenuOpen(open => !open)}>
              <CustomerPhoto path={customer.photo_url} file={photoFile} removed={removePhoto} />
            </button>
            {photoMenuOpen && <div className="customer-photo-menu" role="menu" aria-label="Ações da foto do cliente">
              <button type="button" role="menuitem" disabled={isSaving || photoPasting} onClick={() => void readPhotoClipboard()}>{photoPasting ? 'Colando...' : 'Colar foto'}</button>
              <button type="button" role="menuitem" disabled={isSaving || photoPasting || removePhoto || (!customer.photo_url && !photoFile)} onClick={() => { setRemovePhoto(true); setPhotoFile(null); setSuccess(false); setPhotoMenuOpen(false); }}>Remover foto</button>
            </div>}
          </div>
          <div className="customer-profile-summary">
            <strong>{form.name}</strong>
            <small>{form.document || 'Sem documento'} - {form.customer_group ?? 'Varejo'}</small>
            <small>Total em compras: {money.format(totalPurchases)} ({completedPurchases.length} compras concluídas)</small>
          </div>
        </div>
        <div className="subtab-bar customer-profile-tabs">
          {tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={`subtab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}><Icon size={14} /> {label}</button>)}
        </div>
        <div className="customer-profile-body">
          {tab === 'cadastrais' && <div className="rma-form">
            <div className="form-row">
              {textField('name', form.person_type === 'PJ' ? 'Razão Social' : 'Nome Completo', 'Nome / Razão Social')}
              {textField('trade_name', 'Nome Fantasia', 'Nome Fantasia')}
            </div>
            <div className="form-row">
              <label><span className="social-label">Tipo de Pessoa</span><select value={form.person_type ?? 'PF'} onChange={(event) => setField('person_type', event.target.value as PartnerCustomer['person_type'])}><option value="PF">Pessoa Física</option><option value="PJ">Pessoa Jurídica</option></select></label>
              {textField('document', form.person_type === 'PJ' ? 'CNPJ' : 'CPF', 'Documento')}
              {textField('rg', 'RG', 'Identidade')}
            </div>
            <div className="form-row">
              {textField('municipal_registration', 'Inscrição Municipal')}
              <label><span className="social-label">Inscrição Estadual</span><input value={form.ie_isento ? 'ISENTO' : String(form.state_registration ?? '')} disabled={Boolean(form.ie_isento)} onChange={(event) => setField('state_registration', event.target.value)} /></label>
              {textField('suframa_id', 'SUFRAMA ID')}
            </div>
            <label className="checkbox-label"><input type="checkbox" checked={Boolean(form.ie_isento)} onChange={(event) => setField('ie_isento', event.target.checked)} /> Isento de Inscrição Estadual</label>
            <div className="form-row">
              <label><span className="social-label">Sexo</span><select value={form.sex ?? ''} onChange={(event) => setField('sex', event.target.value)}><option value="">Selecione...</option><option value="M">Masculino</option><option value="F">Feminino</option><option value="O">Outro</option></select></label>
              <label><span className="social-label">Data de Nascimento</span><input type="date" value={form.birthday ?? ''} onChange={(event) => setField('birthday', event.target.value)} /></label>
            </div>
          </div>}
          {tab === 'enderecos' && <div className="rma-form">
            <div className="form-row">{textField('address', 'Logradouro', 'Rua / Avenida')}{textField('address_number', 'Número', 'Nº')}</div>
            <div className="form-row">{textField('zip_code', 'CEP', '00000-000')}{textField('neighborhood', 'Bairro', 'Bairro')}</div>
            <div className="form-row">{textField('city', 'Cidade', 'Cidade')} {textField('state', 'UF', 'UF')}</div>
            <div className="form-row">{textField('complement', 'Complemento', 'Apto, casa, sala')}{textField('reference_point', 'Ponto de Referência', 'Próximo a...')}</div>
            {textField('country', 'País', 'Brasil')}
          </div>}
          {tab === 'observacoes' && <div className="rma-form">
            <label><span className="social-label">Observações do Cliente</span><textarea value={form.notes ?? ''} onChange={(event) => setField('notes', event.target.value)} rows={4} placeholder="Notas gerais sobre o cliente..." /></label>
            {textField('device_model', 'Equipamento / Modelo', 'Tipo e modelo do equipamento')}
          </div>}
          {tab === 'financeiros' && <div className="rma-form">
            <div className="form-row">
              <label><span className="social-label">Grupo de Clientes</span><select value={form.customer_group ?? 'Varejo'} onChange={(event) => setField('customer_group', event.target.value as CustomerForm['customer_group'])}><option value="Varejo">Varejo</option><option value="Atacado">Atacado</option><option value="Premium">Premium</option></select></label>
              <label><span className="social-label">Tipo usado pelo PDV</span><select value={form.customer_type ?? 'varejo'} onChange={(event) => setField('customer_type', event.target.value as CustomerForm['customer_type'])}><option value="varejo">Varejo</option><option value="atacado">Atacado</option></select></label>
            </div>
            <div className="form-row">
              <label><span className="social-label">Vendedor Responsável</span><select value={form.salesperson_id ?? ''} onChange={(event) => setField('salesperson_id', event.target.value || null)}><option value="">Nenhum</option>{salespeople.filter((person) => !person.branch_id || person.branch_id === form.branch_id).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
              <label><span className="social-label">Tabela de Preços</span><select value={form.price_table ?? 'varejo'} onChange={(event) => setField('price_table', event.target.value)}><option value="varejo">Varejo</option><option value="atacado">Atacado</option><option value="premium">Premium</option></select></label>
            </div>
            <div className="form-row"><label><span className="social-label">Limite de Crédito (R$)</span><input type="number" min="0" step="0.01" aria-label="Limite de crédito (R$)" value={creditLimitInput} onChange={(event) => { setCreditLimitInput(event.target.value); setSuccess(false); }} /></label><label><span className="social-label">Venda Faturada / Crediário</span><select aria-label="Permitir venda faturada" value={form.allow_credit ? 'sim' : 'nao'} onChange={(event) => setField('allow_credit', event.target.value === 'sim')}><option value="nao">Não Permitido</option><option value="sim">Permitido</option></select></label></div>
            <div className="customer-compliance-grid">
              <label className="checkbox-label"><input type="checkbox" checked={Boolean(form.convenio)} onChange={(event) => setField('convenio', event.target.checked)} /> Ativar Vendas em Convênio</label>
              <label className="checkbox-label"><input type="checkbox" checked={Boolean(form.simples_nacional)} onChange={(event) => setField('simples_nacional', event.target.checked)} /> Simples Nacional</label>
              <label className="checkbox-label"><input type="checkbox" checked={Boolean(form.reter_iss)} onChange={(event) => setField('reter_iss', event.target.checked)} /> Reter ISS</label>
              <label className="checkbox-label"><input type="checkbox" checked={form.is_active !== false} onChange={(event) => setField('is_active', event.target.checked)} /> Cliente ativo</label>
              <label className="checkbox-label"><input type="checkbox" checked={Boolean(form.is_store_admin)} onChange={(event) => setField('is_store_admin', event.target.checked)} /> Administrador da Loja Virtual</label>
            </div>
          </div>}
          {tab === 'contatos' && <div className="rma-form"><div className="form-row">{textField('phone', 'Celular Principal', '(92) 99999-9999')}{textField('phone_commercial_1', 'Fone Comercial 1')}</div><div className="form-row">{textField('phone_commercial_2', 'Fone Comercial 2')}<label><span className="social-label">E-mail</span><input type="email" value={form.email ?? ''} onChange={(event) => setField('email', event.target.value)} /></label></div></div>}
          {tab === 'historico' && <div className="customer-history-tab"><p>Total em compras: <strong>{money.format(totalPurchases)}</strong></p><div className="stock-table-wrap"><table className="rma-table"><thead><tr><th>Data</th><th>Pedido</th><th>Total</th><th>Status</th></tr></thead><tbody>{customerSales.length === 0 ? <tr><td colSpan={4} className="empty-row">Nenhuma compra registrada.</td></tr> : customerSales.map((sale) => <tr key={sale.id}><td>{new Date(sale.created_at).toLocaleDateString('pt-BR')}</td><td>#{sale.id.slice(0, 8).toUpperCase()}</td><td>{money.format(sale.total)}</td><td>{saleReturnLabel(sale, rmaRequests) || sale.status}<small>{saleItemDescription(sale, rmaRequests)}</small></td></tr>)}</tbody></table></div></div>}
        </div>
        {error && <p className="otp-error-msg">{error}</p>}
        {success && <p style={{ color: '#15803D' }}>Cliente salvo com sucesso.</p>}
        <div className="fiscal-modal-actions"><button type="button" className="rma-advance-btn" onClick={onClose} disabled={isSaving}>Cancelar</button><button type="submit" className="module-submit-btn" disabled={isSaving || photoPasting}><Save size={16} /> {isSaving ? 'Salvando...' : 'Salvar Alterações'}</button></div>
      </form>
    </div>
  );
}

function SuppliersSubTab({ suppliers, onAdd, onUpdate, onDelete, branches = [], selectedBranchId }: {
  suppliers: PartnerSupplier[];
  onAdd: Props['onAddSupplier'];
  onUpdate: (id: string, updates: Partial<PartnerSupplier>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  branches?: PartnerBranch[];
  selectedBranchId?: string | null;
}) {
  const [name, setName] = useSessionDraftState('suppliers:name', '');
  const [phone, setPhone] = useSessionDraftState('suppliers:phone', '');
  const [notes, setNotes] = useSessionDraftState('suppliers:notes', '');
  const [draftBranchId, setDraftBranchId] = useSessionDraftState('suppliers:branch', '');
  const [editingId, setEditingId] = useSessionDraftState<string | null>('suppliers:editing-id', null, undefined, value => value === null || typeof value === 'string');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const existingBranch = suppliers.find(supplier => supplier.id === editingId)?.branch_id;
  const targetBranch = existingBranch || selectedBranchId || draftBranchId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      if (branches.length && !branches.some(branch => branch.id === targetBranch)) throw new Error('Selecione a filial do fornecedor.');
      if (editingId) {
        await onUpdate(editingId, { name: name.trim(), phone: phone || null, notes: notes || null, branch_id: targetBranch || null });
      } else {
        await onAdd({
          name, phone: phone || null, notes: notes || null, branch_id: targetBranch || null,
          status: undefined,
          zip_code: undefined,
          state: undefined
        });
      }
      setName(''); setPhone(''); setNotes('');
      setEditingId(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível salvar o fornecedor.');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(supplier: PartnerSupplier) {
    setEditingId(supplier.id);
    setName(supplier.name);
    setPhone(supplier.phone ?? '');
    setNotes(supplier.notes ?? '');
  }

  function cancelEdit() {
    setEditingId(null); setName(''); setPhone(''); setNotes('');
  }

  return (
    <div>
      <form className="rma-form" onSubmit={handleSubmit}>
        {!selectedBranchId && branches.length > 0 && <label>Filial do fornecedor<select aria-label="Filial do fornecedor" value={targetBranch} disabled={Boolean(existingBranch) || saving} onChange={event => setDraftBranchId(event.target.value)} required><option value="">Selecione</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
        <div className="form-row">
          <label>
            Nome do Fornecedor
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: TechParts Distribuidora" required />
          </label>
          <label>
            Telefone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 3333-3333" />
          </label>
        </div>
        <label>
          Observações
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas sobre prazos, condições..." rows={2} />
        </label>
        {formError && <p className="form-error-msg" style={{ color: '#e3829b', fontSize: '13px' }}>{formError}</p>}
        <div className="supplier-form-actions"><button type="submit" className="module-submit-btn" disabled={saving}>{saving ? 'Salvando...' : editingId ? <><Save size={16} /> Salvar alterações</> : <><Plus size={16} /> Adicionar fornecedor</>}</button>{editingId && <button type="button" className="rma-advance-btn" onClick={cancelEdit} disabled={saving}>Cancelar</button>}</div>
      </form>
      <div className="stock-table-wrap directory-card-wrap">
        <table className="rma-table directory-card-table" aria-label="Fornecedores cadastrados">
          <thead><tr><th>Fornecedor</th><th>Telefone</th><th>Contas a Pagar</th><th className="supplier-actions-heading">Ações</th></tr></thead>
          <tbody>
            {suppliers.length === 0 ? (
              <tr><td colSpan={4} className="empty-row">Nenhum fornecedor cadastrado.</td></tr>
            ) : (
              suppliers.map((s) => (
                <tr key={s.id}>
                  <td className="directory-card-title"><strong>{s.name}</strong>{!selectedBranchId && <small style={{ display: 'block' }}>{branches.find(branch => branch.id === s.branch_id)?.name || 'Sem filial: editar para definir'}</small>}</td>
                  <td data-label="Telefone">{s.phone ?? '—'}</td>
                  <td data-label="Contas a pagar">{money.format(s.payable_balance)}</td>
                  <td className="supplier-actions-cell directory-card-actions" data-label="Ações"><div className="row-action-group"><button type="button" className="rma-advance-btn" onClick={() => startEdit(s)}><Pencil size={14} /> Editar</button><button type="button" className="rma-advance-btn danger" onClick={async () => { if (!window.confirm(`Excluir o fornecedor "${s.name}"?`)) return; try { await onDelete(s.id); } catch (error) { window.alert(error instanceof Error ? error.message : 'Não foi possível excluir o fornecedor.'); } }}><Trash2 size={14} /> Excluir</button></div></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const roleLabels: Record<SalespersonRole, string> = {
  administrador: 'Administrador',
  gerente: 'Gerente',
  caixa: 'Caixa',
  vendedor: 'Vendedor / Balcão',
  tecnico: 'Técnico',
  atendente: 'Atendente',
  logistica: 'Logística / Entregador',
};

const roleColors: Record<SalespersonRole, string> = {
  administrador: '#15803D',
  gerente: '#A16207',
  caixa: '#1D4ED8',
  vendedor: '#2563EB',
  tecnico: '#B45309',
  atendente: '#0F766E',
  logistica: '#6D28D9',
};

function SalespeopleSubTab({
  salespeople,
  branches,
  selectedBranchId,
  onAdd,
  onUpdate,
  onDelete,
}: {
  salespeople: PartnerSalesperson[];
  branches: PartnerBranch[];
  selectedBranchId: string | null;
  onAdd: (
    sp: Omit<PartnerSalesperson, 'id' | 'user_id' | 'created_at'>
  ) => Promise<PartnerSalesperson>;
  onUpdate: (
    id: string,
    updates: Partial<PartnerSalesperson>
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useSessionDraftState('salespeople:name', '');
  const [email, setEmail] = useSessionDraftState('salespeople:email', '');
  const [rate, setRate] = useSessionDraftState('salespeople:rate', '');
  const [pin, setPin] = useState('');
  const [role, setRole] = useSessionDraftState<SalespersonRole>('salespeople:role', 'vendedor');
  const [branchId, setBranchId] = useSessionDraftState('salespeople:branch-id', '');

  const [editingId, setEditingId] = useSessionDraftState<string | null>('salespeople:editing-id', null, undefined, value => value === null || typeof value === 'string');
  const [editName, setEditName] = useSessionDraftState('salespeople:edit-name', '');
  const [editEmail, setEditEmail] = useSessionDraftState('salespeople:edit-email', '');
  const [editRate, setEditRate] = useSessionDraftState('salespeople:edit-rate', '');
  const [editPin, setEditPin] = useState('');
  const [editRole, setEditRole] = useSessionDraftState<SalespersonRole>('salespeople:edit-role', 'vendedor');
  const [editBranchId, setEditBranchId] = useSessionDraftState('salespeople:edit-branch-id', '');
  const [editActive, setEditActive] = useSessionDraftState('salespeople:edit-active', true);
  const [savingBranchAccess, setSavingBranchAccess] = useState<string | null>(null);
  const [editBlockedModules, setEditBlockedModules] = useSessionDraftState<string[]>('salespeople:edit-blocked-modules', []);
  const roleRestrictedModules: Record<SalespersonRole, string[]> = {
    administrador: [],
    gerente: ['financeiro','white-label','configuracoes'],
    vendedor: ['financeiro','white-label','configuracoes','entregas','fiscal'],
    caixa: ['financeiro','white-label','configuracoes','entregas','fiscal'],
    atendente: ['caixa','financeiro','white-label','configuracoes','entregas','fiscal','rma'],
    tecnico: ['caixa','cadastros','pdv','financeiro','white-label','configuracoes','entregas','relatorios','fiscal'],
    logistica: ['caixa','cadastros','pdv','financeiro','rma','white-label','configuracoes','relatorios','fiscal'],
  };

  const [formError, setFormError] =
    useState<string | null>(null);
  const [editError, setEditError] =
    useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const visibleSalespeople = selectedBranchId
    ? salespeople.filter(salesperson => !salesperson.branch_id || salesperson.branch_id === selectedBranchId || salesperson.can_access_all_branches)
    : salespeople;

  useEffect(() => {
    setBranchId(selectedBranchId ?? '');
  }, [selectedBranchId, setBranchId]);

  async function handleSubmit(
    e: React.FormEvent
  ) {
    e.preventDefault();

    const normalizedName = name.trim();
    const normalizedEmail =
      email.trim().toLowerCase();

    if (!normalizedName) {
      setFormError(
        'Informe o nome do colaborador.'
      );
      return;
    }
    if (!branchId) {
      setFormError('Selecione a filial em que o colaborador poderá acessar o sistema.');
      return;
    }

    if (!normalizedEmail) {
      setFormError(
        'Informe o e-mail do colaborador para criar o acesso ao sistema.'
      );
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      await onAdd({
        name: normalizedName,
        commission_rate: Number(rate) || 0,
        active: false,
        new_pin: pin || null,
        role,
        branch_id: branchId || null,
        phone: null,
        email: normalizedEmail,
        is_active: false,
      });

      setName('');
      setEmail('');
      setRate('');
      setPin('');
      setRole('vendedor');
      setBranchId(selectedBranchId ?? '');
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar o colaborador.'
      );
    } finally {
      setSaving(false);
    }
  }

  function startEdit(
    salesperson: PartnerSalesperson
  ) {
    setEditingId(salesperson.id);
    setEditBlockedModules(salesperson.blocked_modules ?? []);
    setEditName(salesperson.name);
    setEditEmail(salesperson.email ?? '');
    setEditRate(
      String(salesperson.commission_rate)
    );
    setEditPin('');
    setEditRole(salesperson.role);
    setEditBranchId(
      salesperson.branch_id ?? ''
    );
    setEditActive(
      salesperson.active ??
        salesperson.is_active ??
        true
    );
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function setBranchAccess(id: string, allowed: boolean) {
    if (savingBranchAccess) return;
    setSavingBranchAccess(id); setEditError(null);
    try { await onUpdate(id, { can_access_all_branches: allowed }); }
    catch (error) { setEditError(error instanceof Error ? error.message : 'Não foi possível alterar o acesso às filiais.'); }
    finally { setSavingBranchAccess(null); }
  }

  async function saveEdit(id: string) {
    setEditError(null);

    const normalizedName =
      editName.trim();
    const normalizedEmail =
      editEmail.trim().toLowerCase();

    if (!normalizedName) {
      setEditError(
        'Informe o nome do colaborador.'
      );
      return;
    }
    if (!editBranchId) {
      setEditError('Selecione uma filial para este colaborador.');
      return;
    }

    if (!normalizedEmail) {
      setEditError(
        'Informe o e-mail do colaborador.'
      );
      return;
    }

    try {
      await onUpdate(id, {
        name: normalizedName,
        email: normalizedEmail,
        commission_rate:
          Number(editRate) || 0,
        new_pin: editPin || null,
        role: editRole,
        branch_id:
          editBranchId || null,
        active: editActive,
        is_active: editActive,
        blocked_modules: editBlockedModules,
      });

      setEditingId(null);
    } catch (error) {
      setEditError(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar as alterações do colaborador.'
      );
    }
  }

  async function handleDelete(
    id: string,
    salespersonName: string
  ) {
    if (
      !window.confirm(
        `Desativar o acesso de "${salespersonName}"? O histórico do colaborador será preservado.`
      )
    ) {
      return;
    }

    try {
      await onDelete(id);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : 'Não foi possível desativar o acesso do colaborador.'
      );
    }
  }

  return (
    <div>
      <form
        className="rma-form"
        onSubmit={handleSubmit}
      >
        <div className="form-row">
          <label>
            Nome do colaborador
            <input
              value={name}
              onChange={(e) =>
                setName(e.target.value)
              }
              placeholder="Ex: João Silva"
              required
            />
          </label>

          <label>
            E-mail de acesso
            <input
              type="email"
              value={email}
              onChange={(e) =>
                setEmail(e.target.value)
              }
              required
            />
          </label>

          <label>
            Taxa de Comissão (%)
            <input
              type="number"
              step="0.01"
              value={rate}
              onChange={(e) =>
                setRate(e.target.value)
              }
              placeholder="Ex: 5"
            />
          </label>

          <label>
            PIN de Acesso
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) =>
                setPin(
                  e.target.value
                    .replace(/\D/g, '')
                    .slice(0, 4)
                )
              }
              maxLength={4}
            />
          </label>
        </div>

        <div className="form-row">
          <label>
            Função / Permissões
            <select
              value={role}
              onChange={(e) =>
                setRole(
                  e.target.value as SalespersonRole
                )
              }
            >
              <option value="administrador">
                Administrador (Permissões administrativas da filial)
              </option>
              <option value="gerente">
                Gerente (Operacional & Vendas)
              </option>
              <option value="caixa">
                Caixa (Finalizar Vendas & Pré-Vendas)
              </option>
              <option value="vendedor">
                Vendedor / Balcão
              </option>
              <option value="tecnico">
                Técnico
              </option>
              <option value="atendente">
                Atendente
              </option>
              <option value="logistica">
                Logística / Entregador
              </option>
            </select>
          </label>

          <label>
            Filial Vinculada
            <select
              required
              value={branchId}
              onChange={(e) =>
                setBranchId(e.target.value)
              }
            >
              <option value="" disabled>Selecione uma filial</option>
              {branches.map((branch) => (
                <option
                  key={branch.id}
                  value={branch.id}
                >
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="otp-description">
          Novos colaboradores ficam inativos e sem acesso aos módulos até o administrador liberar as permissões.
        </p>

        {formError && (
          <p
            className="form-error-msg"
            style={{
              color: '#e3829b',
              fontSize: '13px',
            }}
          >
            {formError}
          </p>
        )}

        <button
          type="submit"
          className="module-submit-btn"
          disabled={saving}
        >
          <Plus size={16} />

          {saving
            ? 'Salvando...'
            : 'Adicionar colaborador'}
        </button>
      </form>

      <div className="stock-table-wrap">
        <table className="rma-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Função</th>
              <th>Filial Vinculada</th>
              <th>Comissão</th>
              <th>PIN</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {visibleSalespeople.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="empty-row"
                >
                  Nenhum colaborador cadastrado.
                </td>
              </tr>
            ) : (
              visibleSalespeople.map((salesperson) => {
                const branch =
                  branches.find(
                    (item) =>
                      item.id ===
                      salesperson.branch_id
                  );

                if (
                  editingId ===
                  salesperson.id
                ) {
                  return (
                    <tr key={salesperson.id} className="salesperson-edit-row">
                      <td colSpan={8}>
                        <div className="salesperson-edit-panel">
                          <div className="salesperson-edit-fields">
                            <label>
                              Nome do colaborador
                              <input
                                className="rma-edit-input"
                                value={editName}
                                onChange={event => setEditName(event.target.value)}
                                placeholder="Nome"
                              />
                            </label>

                            <label>
                              E-mail de acesso
                              <input
                                className="rma-edit-input"
                                type="email"
                                value={editEmail}
                                onChange={event => setEditEmail(event.target.value)}
                              />
                            </label>

                            <label>
                              Função
                              <select
                                className="rma-edit-input"
                                value={editRole}
                                onChange={event => setEditRole(event.target.value as SalespersonRole)}
                              >
                                <option value="administrador">Administrador</option>
                                <option value="gerente">Gerente</option>
                                <option value="caixa">Caixa</option>
                                <option value="vendedor">Vendedor / Balcão</option>
                                <option value="tecnico">Técnico</option>
                                <option value="atendente">Atendente</option>
                                <option value="logistica">Logística / Entregador</option>
                              </select>
                            </label>

                            <label>
                              Filial vinculada
                              <select
                                className="rma-edit-input"
                                required
                                value={editBranchId}
                                onChange={event => setEditBranchId(event.target.value)}
                              >
                                <option value="" disabled>Selecione uma filial</option>
                                {branches.map(branch => (
                                  <option key={branch.id} value={branch.id}>
                                    {branch.name}
                                  </option>
                                ))}
                              </select>
                            </label>

                            {['administrador', 'gerente'].includes(salesperson.role) && <label>
                              <span><input type="checkbox" aria-label={`Autorizar todas as filiais para ${salesperson.name}`}
                                checked={salesperson.can_access_all_branches === true}
                                disabled={savingBranchAccess !== null || editRole !== salesperson.role}
                                onChange={event => void setBranchAccess(salesperson.id, event.target.checked)} /> Permitir acesso a todas as filiais</span>
                              <small>A autorização é salva ao marcar ou desmarcar. A filial vinculada continua sendo a filial inicial.</small>
                            </label>}

                            <label>
                              Taxa de comissão (%)
                              <input
                                className="rma-edit-input"
                                type="number"
                                step="0.01"
                                value={editRate}
                                onChange={event => setEditRate(event.target.value)}
                              />
                            </label>

                            <label>
                              PIN de acesso
                              <input
                                className="rma-edit-input"
                                type="password"
                                inputMode="numeric"
                                value={editPin}
                                onChange={event => setEditPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                                maxLength={4}
                              />
                            </label>

                            <label className="salesperson-edit-active">
                              <input
                                type="checkbox"
                                checked={editActive}
                                onChange={event => setEditActive(event.target.checked)}
                              />
                              Acesso {editActive ? 'ativo' : 'inativo'}
                            </label>
                          </div>

                          <fieldset className="salesperson-edit-permissions">
                            <legend>Acessos aos módulos</legend>
                            <p className="otp-description">
                              Marque os módulos liberados. Opções desabilitadas são restritas pela função; altere a função para habilitá-las.
                            </p>
                            <div className="salesperson-module-grid">
                              {Object.entries({
                                cadastros: 'Cadastros',
                                pdv: 'PDV',
                                caixa: 'Caixa',
                                pedidos: 'Pedidos',
                                os: 'Ordens de Serviço',
                                historico: 'Histórico',
                                suporte: 'Suporte',
                                fiscal: 'Nota Fiscal',
                                administrativo: 'Administrativo',
                                entregas: 'Entregas',
                                financeiro: 'Financeiro',
                                rma: 'RMA e Devoluções',
                                relatorios: 'Relatórios',
                                'white-label': 'Personalização',
                                configuracoes: 'Configurações',
                              }).map(([module, label]) => {
                                const restricted = roleRestrictedModules[editRole].includes(module);

                                return (
                                  <label
                                    key={module}
                                    className={`salesperson-module-option${restricted ? ' restricted' : ''}`}
                                  >
                                    <input
                                      type="checkbox"
                                      aria-label={`Acesso a ${label}`}
                                      disabled={restricted}
                                      checked={!editBlockedModules.includes(module) && !restricted}
                                      onChange={event => setEditBlockedModules(previous => (
                                        event.target.checked
                                          ? previous.filter(item => item !== module)
                                          : [...previous, module]
                                      ))}
                                    />
                                    <span>{label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </fieldset>

                          {editError && (
                            <p className="form-error-msg salesperson-edit-error" role="alert">
                              {editError}
                            </p>
                          )}

                          <div className="salesperson-edit-actions">
                            <button
                              type="button"
                              className="rma-advance-btn"
                              onClick={cancelEdit}
                            >
                              <X size={14} /> Cancelar
                            </button>
                            <button
                              type="button"
                              className="module-submit-btn"
                              title="Salvar alterações"
                              onClick={() => saveEdit(salesperson.id)}
                            >
                              <Check size={14} /> Salvar alterações
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={salesperson.id}
                  >
                    <td>
                      <strong>
                        {salesperson.name}
                      </strong>
                    </td>

                    <td>
                      {salesperson.email ||
                        '—'}
                    </td>

                    <td>
                      <span
                        className="rma-status-badge"
                        style={{
                          color:
                            roleColors[
                              salesperson.role
                            ],
                          borderColor:
                            roleColors[
                              salesperson.role
                            ],
                        }}
                      >
                        {
                          roleLabels[
                            salesperson.role
                          ]
                        }
                      </span>
                    </td>

                    <td>
                      {salesperson.can_access_all_branches ? `Todas as filiais · Base: ${branch?.name ?? 'Filial não definida'}` : branch ? (
                        branch.name
                      ) : (
                        <small
                          style={{
                            color:
                              '#475569',
                          }}
                        >
                          Filial não definida
                        </small>
                      )}
                    </td>

                    <td>
                      {
                        salesperson.commission_rate
                      }%
                    </td>

                    <td>
                      {salesperson.pin_configured
                        ? 'Configurado'
                        : '—'}
                    </td>

                    <td>
                      {salesperson.active ??
                      salesperson.is_active
                        ? 'Ativo'
                        : 'Inativo'}
                    </td>

                    <td>
                      <div className="row-action-group">
                        <button
                          type="button"
                          className="rma-advance-btn"
                          onClick={() =>
                            startEdit(
                              salesperson
                            )
                          }
                          title="Editar"
                        >
                          <History size={14} />
                        </button>

                        <button
                          type="button"
                          className="rma-advance-btn danger"
                          onClick={() =>
                            handleDelete(
                              salesperson.id,
                              salesperson.name
                            )
                          }
                          title="Desativar acesso"
                          aria-label={`Desativar acesso de ${salesperson.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReplenishmentSubTab({ products, sales, selectedBranchId, onReplenishStock }: {
  products: PartnerProduct[];
  sales: PartnerSale[];
  selectedBranchId: string | null;
  onReplenishStock: (productId: string, branchId: string, quantity: number, unitCost?: number | null, reason?: string) => Promise<{ newStock: number }>;
}) {
  const [selectedProduct, setSelectedProduct] = useSessionDraftState<PartnerProduct | null>('replenishment:product', null);
  const [quantity, setQuantity] = useSessionDraftState('replenishment:quantity', '');
  const [unitCost, setUnitCost] = useSessionDraftState('replenishment:unit-cost', '');
  const [reason, setReason] = useSessionDraftState('replenishment:reason', '');
  const [expandedClass, setExpandedClass] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const abcAnalysis = useMemo(() => {
    const completedSales = sales.filter((s) => s.status === 'concluida');
    const productStats: Record<string, { name: string; sku: string | null; stock: number; minStock: number; totalSold: number; revenue: number; isService: boolean }> = {};

    for (const product of products) {
      productStats[product.id] = {
        name: product.name,
        sku: product.sku,
        stock: product.stock,
        minStock: product.min_stock,
        totalSold: 0,
        revenue: 0,
        isService: product.is_service,
      };
    }

    for (const sale of completedSales) {
      for (const item of sale.items) {
        if (productStats[item.product_id]) {
          productStats[item.product_id].totalSold += item.quantity;
          productStats[item.product_id].revenue += item.unit_price * item.quantity;
        }
      }
    }

    const ranked = Object.entries(productStats)
      .filter(([, s]) => !s.isService)
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => b.revenue - a.revenue);

    const totalRevenue = ranked.reduce((sum, r) => sum + r.revenue, 0);
    let cumulative = 0;
    const withClass = ranked.map((r) => {
      const previousPct = totalRevenue > 0 ? (cumulative / totalRevenue) * 100 : 0;
      let abcClass: 'A' | 'B' | 'C' | 'N' = 'N';
      if (r.revenue > 0) abcClass = previousPct < 70 ? 'A' : previousPct < 90 ? 'B' : 'C';
      cumulative += r.revenue;
      const pct = totalRevenue > 0 ? (cumulative / totalRevenue) * 100 : 0;
      return { ...r, abcClass, cumulativePct: pct };
    });

    return withClass;
  }, [products, sales]);

  const lowStockHighDemand = abcAnalysis.filter(
    (p) => p.stock <= (p.minStock || 0) && p.totalSold > 0,
  );
  const criticalAlerts = abcAnalysis.filter(
    (p) => p.abcClass === 'A' && p.stock <= (p.minStock || 0),
  );
  const classA = abcAnalysis.filter((p) => p.abcClass === 'A');
  const classB = abcAnalysis.filter((p) => p.abcClass === 'B');
  const classC = abcAnalysis.filter((p) => p.abcClass === 'C');
  const classUnclassified = abcAnalysis.filter((p) => p.abcClass === 'N');



  const replenishLock = useRef(false);
  async function handleReplenish(e: React.FormEvent) {
    e.preventDefault();
    if (replenishLock.current) return;
    if (!selectedProduct || !selectedBranchId) {
      setError('Selecione uma filial e um produto válidos.');
      return;
    }
    const parsedQuantity = Number(quantity);
    const parsedCost = unitCost.trim() ? Number(unitCost) : null;
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      setError('Informe uma quantidade inteira maior que zero.');
      return;
    }
    if (parsedCost !== null && (!Number.isFinite(parsedCost) || parsedCost < 0)) {
      setError('Informe um custo unitário válido.');
      return;
    }
    replenishLock.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await onReplenishStock(selectedProduct.id, selectedBranchId, parsedQuantity, parsedCost, reason);
      setSuccess(`${selectedProduct.name} reposto com sucesso. Novo estoque: ${result.newStock}.`);
      setSelectedProduct(null);
      setQuantity(''); setUnitCost(''); setReason('');
    } catch (saveError) {
      console.error('Falha ao salvar reposição de estoque.', saveError);
      setError(saveError && typeof saveError === 'object' && 'message' in saveError
        ? String(saveError.message)
        : 'Não foi possível salvar a reposição.');
    } finally {
      replenishLock.current = false;
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="admin-permissions-info">
        <Activity size={16} />
        <span>
          Análise preditiva de reposição baseada na Curva ABC de vendas. Itens Classe A com estoque baixo são prioridade de reposição.
        </span>
      </div>

      {criticalAlerts.length > 0 && (
        <div className="replenishment-critical-banner">
          <AlertTriangle size={20} />
          <div>
            <strong>{criticalAlerts.length} produto(s) Classe A com estoque crítico!</strong>
            <span>Reponha urgentemente para não perder vendas de alto giro.</span>
          </div>
        </div>
      )}

      {success && <div className="sent-message" role="status">{success}</div>}
      {error && !selectedProduct && <div className="branch-action-error" role="alert">{error}</div>}

      <div className="report-cards replenishment-kpi-grid">
        <div className="report-card">
          <small><TrendingUp size={13} /> Itens Classe A (Alto Giro)</small>
          <strong className="text-green">{classA.length}</strong>
          <small>70% da receita</small>
        </div>
        <div className="report-card">
          <small><Activity size={13} /> Itens Classe B (Médio Giro)</small>
          <strong style={{ color: '#B45309' }}>{classB.length}</strong>
          <small>20% da receita</small>
        </div>
        <div className="report-card">
          <small><Package size={13} /> Itens Classe C (Baixo Giro)</small>
          <strong style={{ color: '#7bc8ff' }}>{classC.length}</strong>
          <small>10% da receita</small>
        </div>
        <div className="report-card">
          <small><AlertTriangle size={13} /> Alertas de Reposição</small>
          <strong className="text-red">{lowStockHighDemand.length}</strong>
          <small>estoque baixo + demanda</small>
        </div>
      </div>

      <h4 className="report-section-title">
        <AlertTriangle size={16} /> Alertas de Reposição — Baixo Estoque & Alta Demanda
      </h4>
      {lowStockHighDemand.length === 0 ? (
        <p className="admin-empty-hint">Nenhum alerta de reposição no momento. Todos os produtos com demanda estão com estoque adequado.</p>
      ) : (
        <div className="stock-table-wrap replenishment-alert-table">
          <table className="rma-table">
            <thead>
              <tr>
                <th>Produto</th><th>SKU</th><th>Classe ABC</th><th>Estoque</th><th>Mínimo</th><th>Vendidos</th><th>Receita</th><th>Recomendação</th><th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {lowStockHighDemand.map((p) => {
                const suggestedQty = Math.max(p.totalSold, p.minStock * 2) - p.stock;
                return (
                  <tr key={p.id} className={p.abcClass === 'A' ? 'replenishment-row-critical' : ''}>
                    <td><strong>{p.name}</strong></td>
                    <td>{p.sku ?? '—'}</td>
                    <td>
                      <span className={`rma-status-badge status-${p.abcClass === 'A' ? 'success' : p.abcClass === 'B' ? 'warning' : 'info'}`}>
                        Classe {p.abcClass}
                      </span>
                    </td>
                    <td className={p.stock <= 0 ? 'stock-empty-value' : 'stock-low-value'}><strong>{p.stock}</strong></td>
                    <td>{p.minStock}</td>
                    <td>{p.totalSold}</td>
                    <td>{money.format(p.revenue)}</td>
                    <td>
                      <span className="replenishment-suggestion">
                        Repor {suggestedQty > 0 ? `+${suggestedQty}` : '—'} un.
                      </span>
                    </td>
                    <td><button type="button" className="module-submit-btn compact" onClick={() => { setSelectedProduct(products.find((product) => product.id === p.id) ?? null); setError(null); setSuccess(null); }}>Repor estoque</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedProduct && (
        <div className="modal-overlay replenishment-modal-overlay" onClick={() => !saving && setSelectedProduct(null)}>
          <form className="modal-card replenishment-modal" onSubmit={handleReplenish} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header"><h4>Repor estoque</h4><button type="button" className="modal-close" onClick={() => !saving && setSelectedProduct(null)} aria-label="Fechar">×</button></div>
            <div className="modal-body replenishment-modal-body">
              <label>Produto<input value={selectedProduct.name} readOnly /></label>
              <label>Estoque atual<input value={selectedProduct.stock} readOnly /></label>
              <label>Quantidade a repor<input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required autoFocus /></label>
              <label>Custo unitário (opcional)<input type="number" min="0" step="0.01" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} placeholder="Não alterar custo" /></label>
              <label>Observação / motivo<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="Ex.: Compra do fornecedor" /></label>
              {error && <div className="branch-action-error" role="alert">{error}</div>}
            </div>
            <div className="replenishment-modal-footer"><button type="button" className="rma-advance-btn" onClick={() => setSelectedProduct(null)} disabled={saving}>Cancelar</button><button type="submit" className="module-submit-btn" disabled={saving}>{saving ? 'Salvando...' : 'Concluir e Salvar'}</button></div>
          </form>
        </div>
      )}

      <h4 className="report-section-title">
        <TrendingUp size={16} /> Análise Completa — Curva ABC de Vendas
      </h4>
      {abcAnalysis.length === 0 ? (
        <p className="admin-empty-hint">Nenhuma venda registrada para análise. Conclua vendas no PDV para gerar dados preditivos.</p>
      ) : (
        <>
        <div className="replenishment-class-cards">
          {([
            { label: 'A', description: 'Alto Giro', items: classA },
            { label: 'B', description: 'Médio Giro', items: classB },
            { label: 'C', description: 'Baixo Giro', items: classC },
            { label: 'N', description: 'Sem receita registrada', items: classUnclassified },
          ] as const).map(({ label, description, items }) => (
            <section key={label} className={`replenishment-class-card replenishment-class-${label.toLowerCase()}`} aria-label={`Produtos Classe ${label}`}>
              <button type="button" className="replenishment-class-header" aria-expanded={expandedClass === label}
                aria-controls={`abc-products-${label}`} onClick={() => setExpandedClass(current => current === label ? null : label)}>
                <div><h5>{label === 'N' ? 'Sem classificação' : `Classe ${label}`}</h5><span>{description}</span></div>
                <span className="replenishment-class-count">{items.length} {items.length === 1 ? 'produto' : 'produtos'}</span>
                <span className="replenishment-class-toggle" aria-hidden="true">{expandedClass === label ? '−' : '+'}</span>
              </button>
              <div id={`abc-products-${label}`} hidden={expandedClass !== label}>
              {expandedClass === label && (items.length === 0 ? <p className="admin-empty-hint">Nenhum produto nesta classe.</p> : (
                <div className="replenishment-class-products">
                  {items.map((p) => {
                    const lowStock = p.stock <= (p.minStock || 0);
                    const suggestedQty = Math.max(p.totalSold, p.minStock * 2) - p.stock;
                    return (
                      <article key={p.id} className="replenishment-product-card">
                        <div className="replenishment-product-heading">
                          <div><strong>{p.name}</strong><small>SKU: {p.sku || '—'}</small></div>
                          <span className={`rma-status-badge ${p.stock <= 0 ? 'stock-empty' : lowStock ? 'stock-low' : 'stock-ok'}`}>
                            {p.stock <= 0 ? 'Sem estoque' : lowStock ? 'Baixo' : 'OK'}
                          </span>
                        </div>
                        <dl className="replenishment-product-stats">
                          <div><dt>Estoque</dt><dd className={lowStock ? 'stock-low-value' : ''}>{p.stock}</dd></div>
                          <div><dt>Mínimo</dt><dd>{p.minStock}</dd></div>
                          <div><dt>Vendidos</dt><dd>{p.totalSold}</dd></div>
                          <div><dt>Receita</dt><dd>{money.format(p.revenue)}</dd></div>
                        </dl>
                        {lowStock && p.totalSold > 0 && suggestedQty > 0 && <p className="replenishment-suggestion">Reposição sugerida: +{suggestedQty} un.</p>}
                        <button type="button" className="module-submit-btn" onClick={() => { setSelectedProduct(products.find((product) => product.id === p.id) ?? null); setError(null); setSuccess(null); }}>Repor estoque</button>
                      </article>
                    );
                  })}
                </div>
              ))}
              </div>
            </section>
          ))}
        </div>
        <div className="stock-table-wrap replenishment-analysis-table">
          <table className="rma-table">
            <thead>
              <tr>
                <th>Produto</th><th>SKU</th><th>Classe</th><th>Vendidos</th><th>Receita</th><th>% Acum.</th><th>Estoque</th><th>Status</th><th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {abcAnalysis.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.sku ?? '—'}</td>
                  <td>
                    <span className={`rma-status-badge status-${p.abcClass === 'A' ? 'success' : p.abcClass === 'B' ? 'warning' : 'info'}`}>
                      {p.abcClass === 'N' ? 'Sem receita' : p.abcClass}
                    </span>
                  </td>
                  <td>{p.totalSold}</td>
                  <td>{money.format(p.revenue)}</td>
                  <td>{p.cumulativePct.toFixed(1)}%</td>
                  <td>{p.stock}</td>
                  <td>
                    {p.stock === 0 ? (
                      <span className="rma-status-badge stock-empty">Sem estoque</span>
                    ) : p.stock <= (p.minStock || 0) ? (
                      <span className="rma-status-badge stock-low">Baixo</span>
                    ) : (
                      <span className="rma-status-badge stock-ok">OK</span>
                    )}
                  </td>
                  <td><button type="button" className="module-submit-btn compact" onClick={() => { setSelectedProduct(products.find((product) => product.id === p.id) ?? null); setError(null); setSuccess(null); }}>Repor estoque</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
