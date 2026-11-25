import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ShoppingCart, Store, MessageCircle, Search, Image as ImageIcon } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { contrastText, normalizeColor } from '../lib/storeTheme';
import type { PartnerProduct } from '../types';
import { catalogPreferences, catalogWhatsappUrl } from '../lib/personalization';
import { PublicCatalogCheckout, type CatalogCartItem } from './PublicCatalogCheckout';

import { money } from '../utils';
import './PublicCatalogPage.css';

type PublicCatalogPageProps = {
  slug: string;
  branchSlug?: string | null;
  fixedBranchId?: string | null;
  userId?: string | null;
  onSignIn?: (email: string, password: string) => Promise<{ error: string | null }>;
};

type PublicStoreSettings = {
  catalog_preferences?: unknown;
  catalog_slug: string | null;
  catalog_enabled: boolean;
  logo_url: string | null;
  banner_url: string | null;
  primary_color: string | null;
  nav_color: string | null;
  business_hours: string | null;
};

type PublicPartnerProfile = {
  business_name: string;
  account_name: string | null;
};

type PublicPartnerBranch = {
  id: string;
  name: string;
  address: string | null;
};

type PublicCatalogProduct = Pick<PartnerProduct, 'id' | 'branch_id' | 'name' | 'sale_price' | 'image_url' | 'category' | 'is_service'> & { sku?: string | null; available?: boolean };

export function PublicCatalogPage({ slug, branchSlug, fixedBranchId, userId = null, onSignIn }: PublicCatalogPageProps) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<PublicPartnerProfile | null>(null);
  const [settings, setSettings] = useState<PublicStoreSettings | null>(null);
  const [branch, setBranch] = useState<PublicPartnerBranch | null>(null);
  const [products, setProducts] = useState<PublicCatalogProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<PublicPartnerBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [cart, setCart] = useState<CatalogCartItem[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [requestedBranch, setRequestedBranch] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [productsLoading, setProductsLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const appliedSearch = useRef('');
  const [checkoutBlocked, setCheckoutBlocked] = useState(false);
  const checkoutBlockedRef = useRef(false);
  const onCheckoutBlocked = useCallback((blocked: boolean) => { checkoutBlockedRef.current = blocked; setCheckoutBlocked(blocked); }, []);
  const previousUser = useRef(userId);
  useEffect(() => {
    if (previousUser.current && previousUser.current !== userId) setCart([]);
    previousUser.current = userId;
  }, [userId]);

  useEffect(() => {
    setCart([]); setRequestedBranch(null); setSearch(''); setDebouncedSearch(''); appliedSearch.current = ''; setOffset(0); setLoading(true);
    setSettings(null); setProfile(null); setBranch(null); setBranches([]); setSelectedBranch('');
    setNextOffset(null); setTotal(0);
  }, [slug, branchSlug, fixedBranchId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim();
      if (next === appliedSearch.current) return;
      appliedSearch.current = next;
      // Reset pagination together with the applied term so the old term is never requested at offset 0.
      setOffset(0); setDebouncedSearch(next);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    async function loadCatalog() {
      setProductsLoading(true); setError(null);
      if (offset === 0) setProducts([]);
      if (!isSupabaseConfigured || !supabase || !slug) {
        setError('Catálogo indisponível no momento.'); setLoading(false); setProductsLoading(false); return;
      }
      if (fixedBranchId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fixedBranchId)) {
        setError('Filial indisponível. Confira o link do catálogo.'); setLoading(false); setProductsLoading(false); return;
      }
      try {
        const { data, error: catalogError } = await supabase.rpc('read_public_catalog_page', {
          p_slug: slug, p_branch_slug: fixedBranchId ? null : branchSlug ?? null, p_branch_id: fixedBranchId ?? requestedBranch,
          p_search: debouncedSearch, p_offset: offset, p_limit: 48,
        });
        if (catalogError) throw new Error(catalogError.message);
        if (!active) return;
        if (!data) { setError('Este catálogo está indisponível no momento.'); return; }
        const catalog = data as { settings: PublicStoreSettings; profile: PublicPartnerProfile | null; branch: PublicPartnerBranch | null; branches: PublicPartnerBranch[]; products: PublicCatalogProduct[]; selected_branch_id: string | null; total: number; next_offset: number | null };
        if (fixedBranchId && catalog.selected_branch_id !== fixedBranchId) {
          setSettings(null); setProfile(null); setProducts([]); setError('Filial indisponível. Confira o link do catálogo.'); return;
        }
        if (fixedBranchId) catalog.branch = catalog.branches?.find(unit => unit.id === fixedBranchId) ?? null;
        setSettings(catalog.settings); setProfile(catalog.profile); setBranch(catalog.branch);
        setProducts(previous => offset === 0 ? catalog.products : [...previous, ...catalog.products.filter(product => !previous.some(item => item.id === product.id))]);
        setBranches(catalog.branches ?? (catalog.branch ? [catalog.branch] : []));
        setSelectedBranch(catalog.selected_branch_id ?? '');
        setTotal(catalog.total); setNextOffset(catalog.next_offset);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Erro ao carregar catálogo.');
      } finally { if (active) { setLoading(false); setProductsLoading(false); } }
    }
    void loadCatalog();
    return () => { active = false; };
  }, [branchSlug, fixedBranchId, slug, requestedBranch, debouncedSearch, offset, retry]);

  const primaryBrandName = profile?.business_name ?? profile?.account_name ?? 'Loja';
  const logoUrl = settings?.logo_url ?? null;
  const preferences = catalogPreferences(settings?.catalog_preferences);
  const visibleProducts = products;
  function addProduct(product: PublicCatalogProduct) {
    if (product.available === false || checkoutBlockedRef.current) return;
    setCart(previous => {
      const current = previous.find(item => item.id === product.id);
      if (current) return previous.map(item => item.id === product.id ? { ...item, quantity: Math.min(item.quantity + 1, Number.MAX_SAFE_INTEGER) } : item);
      return [...previous, { id: product.id, name: product.name, sale_price: Number(product.sale_price), quantity: 1 }];
    });
  }
  const whatsappUrl = preferences.show_whatsapp ? catalogWhatsappUrl(preferences.whatsapp_phone) : null;
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartQuantities = new Map(cart.map(item => [item.id, item.quantity]));
  const brand = normalizeColor(settings?.primary_color, '#1673c9');
  const nav = normalizeColor(settings?.nav_color, '#0b1927');
  const palette = {
    '--catalog-action': brand,
    '--catalog-on-action': contrastText(brand),
    '--catalog-nav': nav,
    '--catalog-on-nav': contrastText(nav),
    '--catalog-banner-height': `${preferences.banner_height}px`,
  } as CSSProperties;

  if (loading || (error && !settings)) {
    return <div className="public-storefront">
      <main className="public-catalog-shell public-catalog-state">
        {loading ? <p role="status">Carregando catálogo...</p> : <>
          <h1>Catálogo indisponível</h1>
          <p role="alert">{error}</p>
          <button className="public-catalog-action" type="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button>
        </>}
      </main>
    </div>;
  }

  return (
    <div className="public-storefront" style={palette} data-compact={preferences.card_size === 'compact'} data-has-cart={cartCount > 0}>
      <header className="public-catalog-header">
        <div className="public-catalog-shell public-catalog-header-inner">
          <div className="public-catalog-brand">
            <div className="public-catalog-logo">
              {logoUrl ? <img src={logoUrl} alt="" /> : <Store size={24} aria-hidden="true" />}
            </div>
            <div>
              <h1>{primaryBrandName}</h1>
              <small>{branch?.name ?? 'Catálogo'}</small>
            </div>
          </div>
          <a href="#pedido" className="public-order-link"><ShoppingCart size={19} aria-hidden="true" /> Seu pedido ({cartCount})</a>
        </div>
      </header>

      <main className="public-catalog-shell public-catalog-content">
        {settings?.banner_url && <img className="public-catalog-banner" src={settings.banner_url} alt="Banner da loja" />}
        {preferences.welcome_message && <p className="public-catalog-welcome">{preferences.welcome_message}</p>}

        <section aria-labelledby="catalog-products-title">
          <div className="public-catalog-products-heading">
            <h2 id="catalog-products-title">Produtos</h2>
            <span>{total} {total === 1 ? 'produto' : 'produtos'}</span>
          </div>

          <div className="public-catalog-filters">
            <label>Buscar produto<span className="public-catalog-search">
              <Search size={18} aria-hidden="true" />
              <input type="search" placeholder={preferences.show_sku ? "Nome do produto ou SKU" : "Nome do produto"} value={search} onChange={e => setSearch(e.target.value)} />
            </span></label>
            {!fixedBranchId && !branchSlug && !branch && branches.length > 1 && <label>Filial
              <select disabled={checkoutBlocked} value={selectedBranch} onChange={e => { setSelectedBranch(e.target.value); setRequestedBranch(e.target.value); setOffset(0); setCart([]); }}>
                {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>}
          </div>

          {error && <div className="public-catalog-state" role="alert"><p>{error}</p><button type="button" className="public-catalog-action" disabled={productsLoading} onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>}

          <div className="public-catalog-grid" aria-busy={productsLoading}>
            {visibleProducts.map(product => {
              const price = Number(product.sale_price ?? 0);
              const quantity = cartQuantities.get(product.id) ?? 0;
              return <article key={product.id} className="public-product-card">
                <div className="public-product-image">
                  {product.image_url ? <img src={product.image_url} alt={product.name} loading="lazy" decoding="async" /> : <ImageIcon size={28} aria-hidden="true" />}
                  {product.category && <span className="public-product-category">{product.category}</span>}
                </div>
                <div className="public-product-details">
                  <h3>{product.name}</h3>
                  {preferences.show_sku && product.sku && <span className="public-product-sku">SKU {product.sku}</span>}
                  <div className="public-product-summary">
                    <strong>{price > 0 ? money.format(price) : 'Consulte a loja'}</strong>
                    {preferences.show_stock && <span className="public-product-stock" data-unavailable={product.available === false}>
                      {product.available === false ? 'Indisponível' : 'Disponível'}
                    </span>}
                    {quantity > 0 && <span className="public-product-quantity">{quantity} no pedido</span>}
                  </div>
                  <button className="public-catalog-action" type="button" disabled={checkoutBlocked || product.available === false || price <= 0} onClick={() => addProduct(product)}>
                    <ShoppingCart size={16} aria-hidden="true" /> Adicionar ao pedido
                  </button>
                </div>
              </article>;
            })}
          </div>
          {productsLoading && <p className="public-catalog-state" role="status">Carregando produtos...</p>}
          {!productsLoading && !error && !visibleProducts.length && <p className="public-catalog-state">Nenhum produto nesta seleção.</p>}
          {!error && nextOffset !== null && <button className="public-catalog-more" type="button" disabled={productsLoading} onClick={() => setOffset(nextOffset)}>Carregar mais produtos</button>}
        </section>
        <div id="pedido"><PublicCatalogCheckout branchSlug={branchSlug} key={`${userId}:${slug}:${selectedBranch}`} slug={settings?.catalog_slug ?? slug} branchId={selectedBranch} cart={cart} userId={userId} onSignIn={onSignIn} onQuantity={(id, amount) => { if (!Number.isSafeInteger(amount) || amount < 0) return; setCart(previous => previous.flatMap(item => item.id !== id ? [item] : amount === 0 ? [] : [{ ...item, quantity: amount }])); }} onBlockedChange={onCheckoutBlocked} onComplete={(items) => setCart(previous => previous.flatMap(item => { const quantity = item.quantity - (items.find(sent => sent.id === item.id)?.quantity ?? 0); return quantity > 0 ? [{ ...item, quantity }] : []; }))} /></div>
      </main>
      {(branch?.address || settings?.business_hours || whatsappUrl) && <footer className="public-catalog-shell public-catalog-footer">
        <div>
          {branch?.address && <p>{branch.address}</p>}
          {settings?.business_hours && <p>{settings.business_hours}</p>}
        </div>
        {whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={20} aria-hidden="true" /> Falar com a loja</a>}
      </footer>}
      {cartCount > 0 && <div className="public-catalog-mobile-order">
        <a href="#pedido" className="public-catalog-action">
          <ShoppingCart size={19} aria-hidden="true" /> Seu pedido ({cartCount})
        </a>
      </div>}
    </div>
  );
}
