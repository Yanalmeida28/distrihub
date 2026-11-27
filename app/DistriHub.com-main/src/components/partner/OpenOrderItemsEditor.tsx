import { useRef, useState } from 'react';
import { Search, Trash2, X } from 'lucide-react';
import type { PartnerCustomer, PartnerProduct, PartnerSale } from '../../types';
import { money } from '../../utils';
import { pdvTotal, saleChargeTotal, validSalePrice, customerPriceTable, productTablePrice, type CustomPriceList } from '../../lib/pdv';
import { SalePriceInput } from './SalePriceInput';

type Props = {
  canEditPrice: boolean;
  sale: PartnerSale;
  products: PartnerProduct[];
  customers?: PartnerCustomer[];
  priceLists?: readonly CustomPriceList[];
  onSave: (id: string, items: PartnerSale['items']) => Promise<void>;
  onClose: () => void;
};

export function OpenOrderItemsEditor({ canEditPrice, sale, products, customers = [], priceLists = [], onSave, onClose }: Props) {
  const [items, setItems] = useState(() => sale.items.map(item => ({ ...item })));
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const catalog = products.filter(product => product.branch_id === sale.branch_id);
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const term = normalize(search.trim());
  const matches = term ? catalog.filter(product => normalize(product.name).includes(term) || normalize(product.sku ?? '').includes(term)) : [];
  const table = customerPriceTable(customers.find(customer => customer.id === sale.customer_id), sale.customer_type === 'atacado' ? 'atacado' : 'varejo');
  const price = (product: PartnerProduct) => productTablePrice(product, table, priceLists);
  const displayPrice = (product: PartnerProduct) => {
    try { return money.format(price(product)); }
    catch { return table === 'premium' ? 'Premium não configurado' : 'Preço indisponível'; }
  };

  function changeQuantity(productId: string, quantity: number) {
    setError(null);
    const product = catalog.find(item => item.id === productId);
    if (product && !product.is_service && quantity > product.stock) {
      setError(`Estoque insuficiente para ${product.name}: ${product.stock} un. disponíveis.`);
      return;
    }
    setItems(previous => previous.flatMap(item => item.product_id !== productId ? [item] : quantity > 0 ? [{ ...item, quantity }] : []));
  }

  function addProduct(product: PartnerProduct) {
    try { price(product); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Preço não configurado.'); return; }
    const existing = items.find(item => item.product_id === product.id);
    if (existing) changeQuantity(product.id, existing.quantity + 1);
    else if (!product.is_service && product.stock <= 0) setError('Produto sem estoque nesta filial.');
    else {
      setItems(previous => [...previous, { product_id: product.id, name: product.name, quantity: 1, unit_price: price(product) }]);
      setError(null);
    }
  }

  // Editing creates a new quote using current catalog prices; the RPC validates it.
  let priceError: string | null = null;
  const quotedItems = items.map(item => {
    const product = catalog.find(product => product.id === item.product_id);
    try {
      if (product) price(product);
      return product ? { ...item, name: product.name, unit_price: canEditPrice ? item.unit_price : price(product) } : item;
    } catch (cause) { priceError = cause instanceof Error ? cause.message : 'Preço não configurado.'; return item; }
  });
  const missingProduct = items.some(item => !catalog.some(product => product.id === item.product_id));
  async function save() {
    if (inFlight.current || !items.length || missingProduct || priceError) return;
    if (quotedItems.some(item => !validSalePrice(item.unit_price))) {
      setError('Informe preços válidos com até duas casas decimais.');
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try { await onSave(sale.id, quotedItems); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar os produtos.'); }
    finally { inFlight.current = false; setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onClick={() => { if (!saving) onClose(); }}>
      <div className="modal-content open-order-editor" role="dialog" aria-modal="true" aria-labelledby="open-order-editor-title" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <h3 id="open-order-editor-title">Editar produtos — #{sale.id.slice(0, 8).toUpperCase()}</h3>
          <button type="button" disabled={saving} onClick={onClose} aria-label="Fechar edição"><X size={18} /></button>
        </div>
        <p className="otp-description">{sale.customer_name || 'Cliente'} · {canEditPrice ? 'Você pode ajustar os preços para este pedido.' : 'Ao salvar, os preços serão atualizados conforme a tabela vigente do pedido.'}</p>
        <fieldset disabled={saving} className="open-order-editor-fields">
          <label className="pdv-search-bar">
            <Search size={18} />
            <input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar produto por nome ou código" aria-label="Buscar produto" />
          </label>
          {term && <div className="open-order-editor-results">
            {matches.length ? matches.map(product => (
              <button type="button" className="rma-advance-btn" key={product.id} onClick={() => addProduct(product)}>
                {product.name} · {displayPrice(product)} · Adicionar
              </button>
            )) : <p className="empty-row">Nenhum produto encontrado nesta filial.</p>}
          </div>}
          <div className="pdv-cart-items">
            {quotedItems.length ? quotedItems.map(item => (
              <div key={item.product_id} className="pdv-cart-item">
                <div><strong>{item.name}</strong>{canEditPrice ? <SalePriceInput value={item.unit_price} name={item.name} disabled={saving} onChange={value => setItems(previous => previous.map(row => row.product_id === item.product_id ? { ...row, unit_price: value } : row))} /> : <small>{money.format(item.unit_price)} / un.</small>}</div>
                <div className="pdv-item-controls">
                  <button type="button" aria-label={`Diminuir ${item.name}`} onClick={() => changeQuantity(item.product_id, item.quantity - 1)}>-</button>
                  <b>{item.quantity}</b>
                  <button type="button" aria-label={`Aumentar ${item.name}`} onClick={() => changeQuantity(item.product_id, item.quantity + 1)}>+</button>
                  <span>{money.format(item.unit_price * item.quantity)}</span>
                  <button type="button" aria-label={`Retirar ${item.name}`} onClick={() => changeQuantity(item.product_id, 0)}><Trash2 size={14} /></button>
                </div>
              </div>
            )) : <p className="empty-row">Adicione pelo menos um produto para salvar o pedido.</p>}
          </div>
        </fieldset>
        {missingProduct && <p className="otp-error-msg">Retire os produtos que não estão mais disponíveis no catálogo desta filial.</p>}
        {priceError && <p role="alert" className="otp-error-msg">{priceError}</p>}
        {error && <p className="otp-error-msg" role="alert">{error}</p>}
        <p>Subtotal: {money.format(pdvTotal(quotedItems))} · Frete: {money.format(sale.freight_fee ?? 0)}</p>
        <div className="pdv-total-bar"><span>Total do pedido</span><strong>{money.format(saleChargeTotal({ total: pdvTotal(quotedItems), freight_fee: sale.freight_fee }))}</strong></div>
        <div className="otp-actions">
          <button type="button" className="rma-advance-btn" disabled={saving} onClick={onClose}>Cancelar</button>
          <button type="button" className="module-submit-btn" disabled={saving || !items.length || missingProduct} onClick={save}>{saving ? 'Salvando...' : 'Salvar alterações'}</button>
        </div>
      </div>
    </div>
  );
}
