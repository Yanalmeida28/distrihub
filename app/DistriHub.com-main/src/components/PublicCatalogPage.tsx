import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingCart, Store, MessageCircle, Image as ImageIcon } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { contrastText, normalizeColor } from '../lib/storeTheme';
import type { PartnerProduct } from '../types';
import { catalogPreferences, catalogWhatsappUrl } from '../lib/personalization';
import { PublicCatalogCheckout, type CatalogCartItem } from './PublicCatalogCheckout';

const DEFAULT_CATALOG = {
  name: 'DistriHub',
  description: 'Catálogo público da loja.',
};

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
  const summary = useMemo(() => ({
    title: primaryBrandName,
    address: branch?.address ?? DEFAULT_CATALOG.description,
  }), [branch, primaryBrandName]);

  if (loading) {
    return <div style={{ padding: 32, textAlign: 'center' }}>Carregando catálogo...</div>;
  }

  if (error && !settings) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'sans-serif' }}>
        <h2>Catálogo indisponível</h2>
        <p>{error}</p>
        <button type="button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#102638', color: '#edf5fc', fontFamily: 'sans-serif' }}>
      <header style={{ background: normalizeColor(settings?.nav_color, '#0b1927'), color: contrastText(normalizeColor(settings?.nav_color, '#0b1927')), padding: '20px 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {logoUrl ? <img src={logoUrl} alt={summary.title} style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover' }} /> : <Store size={26} />}
            <div>
              <strong style={{ display: 'block', fontSize: 22 }}>{summary.title}</strong>
              <small>{branch ? branch.name : 'Catálogo público'}</small>
            </div>
          </div>
          <div style={{ opacity: 0.9, fontSize: 13 }}>{settings?.business_hours ?? 'Atendimento conforme disponibilidade da loja'}</div>
          <a href="#pedido" className="public-order-link">Seu pedido ({cart.reduce((sum, item) => sum + item.quantity, 0)})</a>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 20px 48px' }}>
        {settings?.banner_url && (
          <div style={{ marginBottom: 24, borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 24px rgba(15,23,42,0.08)' }}>
            <img src={settings.banner_url} alt="Banner da loja" style={{ width: '100%', height: preferences.banner_height, objectFit: 'cover', display: 'block' }} />
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 24 }}>
          <div style={{ background: '#102638', borderRadius: 16, padding: 18, boxShadow: '0 8px 24px rgba(15,23,42,0.06)' }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>Identidade da loja</strong>
            <div style={{ fontSize: 14, color: '#adc2d6' }}>{summary.address}</div>
          </div>
          <div style={{ background: '#102638', borderRadius: 16, padding: 18, boxShadow: '0 8px 24px rgba(15,23,42,0.06)' }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>Produtos ativos</strong>
            <div style={{ fontSize: 14, color: '#adc2d6' }}>{total} produtos nesta seleção</div>
          </div>
        </div>

        {preferences.welcome_message && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: '16px 20px', background: '#102638', borderRadius: 12 }}>{preferences.welcome_message}</p>}
        <div className="public-catalog-filters"><label>Buscar produto<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>{!fixedBranchId && !branchSlug && !branch && branches.length > 1 && <label>Filial<select disabled={checkoutBlocked} value={selectedBranch} onChange={e => { setSelectedBranch(e.target.value); setRequestedBranch(e.target.value); setOffset(0); setCart([]); }}>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}</div>
        {error && <div role="alert"><p>{error}</p><button type="button" disabled={productsLoading} onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${preferences.card_size === 'compact' ? 220 : 280}px), 1fr))`, gap: preferences.card_size === 'compact' ? 12 : 20 }}>
          {visibleProducts.map((product) => (
            <article key={product.id} style={{ background: '#102638', borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 24px rgba(15,23,42,0.06)' }}>
              <div style={{ position: 'relative', background: '#132f4d', minHeight: 180 }}>
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name} style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }} />
                ) : (
                  <div style={{ width: '100%', height: 180, display: 'grid', placeItems: 'center', color: '#adc2d6' }}><ImageIcon size={36} /></div>
                )}
                <span style={{ position: 'absolute', top: 12, left: 12, background: '#0f172a', color: '#fff', fontSize: 11, borderRadius: 999, padding: '6px 10px' }}>
                  {product.category ?? 'Produto'}
                </span>
              </div>
              <div style={{ padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                  <strong style={{ fontSize: 18 }}>{product.name}</strong>
                  {preferences.show_sku && <span style={{ fontSize: 12, color: '#adc2d6' }}>SKU {product.sku ?? 'N/A'}</span>}
                </div>
                <p style={{ color: '#adc2d6', minHeight: 48, margin: '8px 0 14px' }}>{product.category ?? 'Produto da loja'}</p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <strong style={{ color: '#edf5fc', fontSize: 22 }}>R$ {Number(product.sale_price ?? 0).toFixed(2).replace('.', ',')}</strong>
                  {preferences.show_stock && <span style={{ color: product.available !== false ? '#adc2d6' : '#fda4af', fontSize: 12, fontWeight: 700 }}>
                    {product.available !== false ? 'Disponível' : 'Indisponível'}
                  </span>}
                </div>
                <button type="button" disabled={checkoutBlocked || product.available === false || Number(product.sale_price) <= 0} onClick={() => addProduct(product)} style={{ width: '100%', border: 'none', background: normalizeColor(settings?.primary_color), color: contrastText(normalizeColor(settings?.primary_color)), borderRadius: 10, padding: '12px 14px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <ShoppingCart size={16} /> Adicionar ao pedido
                </button>
              </div>
            </article>
          ))}
        </div>
        {productsLoading && <p role="status">Carregando produtos...</p>}
        {!productsLoading && !error && !visibleProducts.length && <p>Nenhum produto nesta seleção.</p>}
        {!error && nextOffset !== null && <button type="button" disabled={productsLoading} onClick={() => setOffset(nextOffset)}>Carregar mais produtos</button>}
        <div id="pedido"><PublicCatalogCheckout branchSlug={branchSlug} key={`${userId}:${slug}:${selectedBranch}`} slug={settings?.catalog_slug ?? slug} branchId={selectedBranch} cart={cart} userId={userId} onSignIn={onSignIn} onQuantity={(id, amount) => { if (!Number.isSafeInteger(amount) || amount < 0) return; setCart(previous => previous.flatMap(item => item.id !== id ? [item] : amount === 0 ? [] : [{ ...item, quantity: amount }])); }} onBlockedChange={onCheckoutBlocked} onComplete={(items) => setCart(previous => previous.flatMap(item => { const quantity = item.quantity - (items.find(sent => sent.id === item.id)?.quantity ?? 0); return quantity > 0 ? [{ ...item, quantity }] : []; }))} /></div>
      </main>
      {whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" style={{ position: 'fixed', right: 20, bottom: 20, display: 'flex', gap: 8, alignItems: 'center', background: '#15803d', color: '#fff', padding: '12px 18px', borderRadius: 24, boxShadow: '0 4px 16px #0003' }}><MessageCircle size={20} /> Falar com a loja</a>}
    </div>
  );
}
