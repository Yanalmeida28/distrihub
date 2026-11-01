import { useMemo, useRef, useState } from 'react';
import {
  ArrowRightCircle, Camera, FileText, Package, Printer, QrCode, Upload,
  Wallet, X, Trash2, AlertCircle,
} from 'lucide-react';
import type { PartnerCustomer, PartnerProduct, PartnerSale, RmaPayload, RmaRequest, RmaStatus, SalespersonRole } from '../../types';
import { rmaStatusLabels, rmaStatusColors } from '../../data';
import { money } from '../../utils';
import { supabase } from '../../lib/supabase';
import { returnedQuantity } from '../../lib/saleReturns';
import { RmaRefundForm, type RmaRefundHandler } from './RmaRefundForm';
import { RmaPhotoUpload, type RmaPhotoHandler } from './RmaPhotoUpload';
import { filterRmas, rmaControl, rmaDestination, rmaDestinations, type RmaFilters } from '../../lib/rmaControl';

type RmaModuleProps = {
  rmaRequests: RmaRequest[];
  customers: PartnerCustomer[];
  products: PartnerProduct[];
  sales: PartnerSale[];
  warrantyTerms: string;
  currentRole: SalespersonRole;
  onCreate: (rma: RmaPayload) => Promise<void>;
  onUpdateStatus: (id: string, status: RmaStatus, destination?: RmaRequest['destination']) => Promise<unknown>;
  onGrantCredit?: (id: string, amount: number) => Promise<void>;
  onRefund?: RmaRefundHandler;
  onAddPhotos?: RmaPhotoHandler;
  onDelete: (id: string) => Promise<void>;
};

const deleteAllowedRoles: SalespersonRole[] = ['administrador', 'gerente'];

function errorMessage(error: unknown, fallback: string) {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message : fallback;
}

export function RmaModule({
  rmaRequests, customers, products, sales, warrantyTerms, currentRole, onCreate, onUpdateStatus, onGrantCredit, onRefund, onAddPhotos, onDelete,
}: RmaModuleProps) {
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [manualProductId, setManualProductId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [saleId, setSaleId] = useState('');
  const [saleItemIndex, setSaleItemIndex] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [manualCustomerName, setManualCustomerName] = useState('');
  const [productName, setProductName] = useState('');
  const [productSku, setProductSku] = useState('');
  const [batchOrOrder, setBatchOrOrder] = useState('');
  const [defect, setDefect] = useState('');
  const [mediaName, setMediaName] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const photoFiles = useRef<{ before?: File; after?: File }>({});
  const createAttempt = useRef<RmaPayload | null>(null);
  const createLock = useRef(false);
  const [beforePhoto, setBeforePhoto] = useState<string | null>(null);
  const [afterPhoto, setAfterPhoto] = useState<string | null>(null);
  const [labelRmaId, setLabelRmaId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | RmaStatus>('all');
  const [controlFilters, setControlFilters] = useState<RmaFilters>({ search: '', from: '', to: '', destination: 'all', settlement: 'all', dateBasis: 'solicitacao' });
  const [creditRma, setCreditRma] = useState<RmaRequest | null>(null);
  const [refundRma, setRefundRma] = useState<RmaRequest | null>(null);
  const [photoRma, setPhotoRma] = useState<RmaRequest | null>(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditError, setCreditError] = useState<string | null>(null);
  const [destinationRma, setDestinationRma] = useState<RmaRequest | null>(null);
  const [destination, setDestination] = useState<NonNullable<RmaRequest['destination']>>('avaliacao');
  const actionLock = useRef(false);
  const destinationLabels = rmaDestinations;
  const currentDestination = rmaDestination;
  const creditBalanceKnown = rmaRequests.every(rma => !Number(rma.credit_amount) || rma.credit_used_amount != null);
  const walletBalance = rmaRequests.reduce((sum, rma) => sum + Math.max(0, Math.round(Number(rma.credit_amount ?? 0) * 100) - Math.round(Number(rma.credit_used_amount ?? 0) * 100)), 0) / 100;

  function openCredit(rma: RmaRequest) {
    const sale = sales.find(item => item.id === rma.sale_id);
    const item = sale?.items[rma.sale_item_index ?? -1];
    setCreditRma(rma);
    setCreditAmount(item ? (item.unit_price * (rma.quantity ?? 1)).toFixed(2) : '');
    setCreditError(null);
  }

  async function confirmCredit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !creditRma || !onGrantCredit) return;
    const normalized = creditAmount.trim().replace(',', '.');
    const value = Number(normalized);
    if (!/^\d+(\.\d{1,2})?$/.test(normalized) || !Number.isFinite(value) || value <= 0) {
      setCreditError('Informe um valor maior que zero, com até duas casas decimais.'); return;
    }
    setBusy(true); setCreditError(null);
    try { await onGrantCredit(creditRma.id, value); setCreditRma(null); }
    catch (error) { setCreditError(errorMessage(error, 'Não foi possível gerar o crédito.')); }
    finally { setBusy(false); }
  }

  const canDelete = deleteAllowedRoles.includes(currentRole);
  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null;
  const matchingCustomers = useMemo(() => {
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const term = normalize(customerSearch.trim());
    const digits = customerSearch.replace(/\D/g, '');
    if (!term || customerId) return [];
    return customers.filter((customer) => {
      const contact = [customer.document, customer.phone].filter(Boolean).join(' ');
      return normalize(customer.name).includes(term) || (digits.length > 0 && contact.replace(/\D/g, '').includes(digits));
    }).slice(0, 8);
  }, [customers, customerId, customerSearch]);
  const customerSales = useMemo(() => sales
    .filter((sale) => sale.customer_id === customerId && sale.status === 'concluida')
    .sort((first, second) => new Date(second.created_at).getTime() - new Date(first.created_at).getTime()), [customerId, sales]);
  const selectedSale = customerSales.find((sale) => sale.id === saleId) ?? null;
  const selectedSaleItem = selectedSale && saleItemIndex !== '' ? selectedSale.items[Number(saleItemIndex)] : null;
  const remainingQuantity = selectedSale && selectedSaleItem
    ? selectedSaleItem.quantity - returnedQuantity(selectedSale, Number(saleItemIndex), rmaRequests) : 0;

  const visibleRequests = useMemo(() => {
    const rows = filterRmas(rmaRequests, controlFilters);
    return filter === 'all' ? rows : rows.filter(request => request.status === filter);
  }, [filter, rmaRequests, controlFilters]);
  const control = useMemo(() => rmaControl(visibleRequests, products, sales), [visibleRequests, products, sales]);

  function selectCustomer(customer: PartnerCustomer) {
    setCustomerId(customer.id);
    setCustomerSearch(customer.name);
    setSaleId('');
    setSaleItemIndex('');
    setProductName('');
    setProductSku('');
    setBatchOrOrder('');
    setFormError(null);
  }

  function selectSale(id: string) {
    const sale = customerSales.find((item) => item.id === id);
    setSaleId(id);
    setSaleItemIndex('');
    setProductName('');
    setProductSku('');
    setBatchOrOrder(sale ? `Venda #${sale.id}` : '');
    setFormError(null);
  }

  function selectSaleItem(index: string) {
    setSaleItemIndex(index);
    setQuantity(1);
    const item = selectedSale && index !== '' ? selectedSale.items[Number(index)] : null;
    if (!item) {
      setProductName('');
      setProductSku('');
      return;
    }
    const product = products.find((candidate) => candidate.id === item.product_id);
    setProductName(item.name);
    setProductSku(product?.sku?.trim() || 'Sem SKU');
    setFormError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || createLock.current) return;
    if (!manualEntry && (!selectedCustomer || !selectedSale || !selectedSaleItem)) {
      setFormError('Selecione o cliente, uma venda concluída e o produto comprado.');
      return;
    }
    if (!productName.trim() || !productSku.trim() || !batchOrOrder.trim() || !defect.trim()) return;
    if (!Number.isInteger(quantity) || quantity < 1 || (!manualEntry && quantity > remainingQuantity)) {
      setFormError('Informe uma quantidade válida dentro do saldo da venda.');
      return;
    }
    const selectedFiles = [photoFiles.current.before, photoFiles.current.after, mediaFile].filter(Boolean) as File[];
    if (!createAttempt.current && selectedFiles.some(file => file.size > 20 * 1024 * 1024 || !['image/jpeg','image/png','image/webp','image/heic','video/mp4','video/webm'].includes(file.type))) {
      setFormError('Use imagem JPEG, PNG, WebP, HEIC ou vídeo MP4/WebM de até 20 MB.');
      return;
    }
    createLock.current = true;
    setBusy(true);
    setFormError(null);
    try {
      createAttempt.current ??= {
        request_id: crypto.randomUUID(),
        files: [
          ...(photoFiles.current.before ? [{ kind: 'before' as const, file: photoFiles.current.before }] : []),
          ...(photoFiles.current.after ? [{ kind: 'after' as const, file: photoFiles.current.after }] : []),
          ...(mediaFile ? [{ kind: 'defect' as const, file: mediaFile }] : []),
        ],
        sale_id: manualEntry ? null : selectedSale!.id,
        sale_item_index: manualEntry ? null : Number(saleItemIndex),
        product_id: manualEntry ? manualProductId || null : selectedSaleItem!.product_id,
        customer_id: manualEntry ? null : selectedCustomer!.id,
        quantity,
        customer_name: manualEntry ? manualCustomerName.trim() || undefined : selectedCustomer!.name,
        product_name: productName,
        product_sku: productSku,
        batch_or_order: batchOrOrder,
        defect_description: defect,
        media_url: null,
      };
      await onCreate(createAttempt.current);
      createAttempt.current = null;
      photoFiles.current = {}; setMediaFile(null);
      setCustomerSearch(''); setCustomerId(''); setSaleId(''); setSaleItemIndex(''); setManualCustomerName('');
      setProductName(''); setProductSku(''); setBatchOrOrder(''); setDefect(''); setMediaName('');
      setBeforePhoto(null); setAfterPhoto(null);
      setShowForm(false);
      setQuantity(1);
      setManualProductId('');
    } catch (error) {
      setFormError(errorMessage(error, 'Não foi possível registrar a devolução.'));
    } finally { createLock.current = false; setBusy(false); }
  }

  async function openAttachment(path: string) {
    const pendingWindow = window.open('about:blank', '_blank');
    if (pendingWindow) pendingWindow.opener = null;
    try {
      if (!supabase) throw new Error('Armazenamento indisponível.');
      const { data, error } = await supabase.storage.from('rma-attachments').createSignedUrl(path, 120);
      if (error || !data) throw error ?? new Error('Arquivo indisponível.');
      if (pendingWindow) pendingWindow.location.href = data.signedUrl;
      else setActionError('Permita abrir uma nova aba para visualizar o anexo.');
    } catch (error) { pendingWindow?.close(); setActionError(errorMessage(error, 'Não foi possível abrir o anexo.')); }
  }

  function handleMediaChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) { setMediaName(file.name); setMediaFile(file); }
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>, setter: (v: string | null) => void) {
    const file = e.target.files?.[0];
    if (!file) return;
    photoFiles.current[setter === setBeforePhoto ? 'before' : 'after'] = file;
    const reader = new FileReader();
    reader.onload = () => setter(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function confirmDestination(event: React.FormEvent) {
    event.preventDefault();
    if (busy || actionLock.current || !destinationRma) return;
    actionLock.current = true;
    setBusy(true);
    setActionError(null);
    try { await onUpdateStatus(destinationRma.id, destinationRma.status, destination); setDestinationRma(null); }
    catch (error) { setActionError(errorMessage(error, 'Não foi possível atualizar o status.')); }
    finally { actionLock.current = false; setBusy(false); }
  }

  async function confirmDelete(id: string) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try { await onDelete(id); setDeleteConfirmId(null); }
    catch (error) { setActionError(errorMessage(error, 'Não foi possível excluir.')); }
    finally { setBusy(false); }
  }

  const labelRma = rmaRequests.find((r) => r.id === labelRmaId);
  function saleReference(rma: RmaRequest) {
    if (!rma.sale_id) return rma.batch_or_order;
    const sale = sales.find(item => item.id === rma.sale_id);
    return `Venda #${sale?.sale_number ? String(sale.sale_number).padStart(6, '0') : rma.sale_id.slice(0, 8).toUpperCase()}`;
  }

  function printLabel() {
    if (!labelRma) return;
    const popup = window.open('', '_blank', 'width=420,height=600');
    if (!popup) { setActionError('Permita abrir uma nova janela para imprimir a etiqueta.'); return; }
    popup.opener = null;
    const doc = popup.document;
    doc.title = 'Etiqueta de devolução';
    const style = doc.createElement('style');
    style.textContent = '@page{size:58mm auto;margin:3mm}body{font:12px Arial;color:#000;width:52mm;margin:0}p{margin:4px 0;overflow-wrap:anywhere}button{margin:12px 0}@media print{button{display:none}}';
    doc.head.append(style);
    for (const text of ['RMA / DEVOLUÇÃO', labelRma.product_name, `SKU: ${labelRma.product_sku}`, `Origem: ${saleReference(labelRma)}`, `RMA: ${labelRma.id}`, `Quantidade: ${labelRma.quantity ?? 1}`, labelRma.customer_name ? `Cliente: ${labelRma.customer_name}` : '']) {
      if (!text) continue;
      const line = doc.createElement('p'); line.textContent = text; doc.body.append(line);
    }
    const button = doc.createElement('button'); button.textContent = 'Imprimir etiqueta';
    button.onclick = () => { popup.focus(); popup.print(); }; doc.body.append(button);
    popup.focus(); popup.print();
  }

  return (
    <div className="panel-module">
      <div className="module-header">
        <span className="module-icon"><Package size={20} /></span>
        <div>
          <h3>RMA / Devoluções</h3>
          <p>Registre itens defeituosos, acompanhe status e imprima etiquetas</p>
        </div>
      </div>

      <div className="rma-wallet-card">
        <div className="wallet-icon"><Wallet size={24} /></div>
        <div>
          <small>Créditos de devolução disponíveis aos clientes</small>
          <strong>{creditBalanceKnown ? money.format(walletBalance) : 'Saldo indisponível'}</strong>
        </div>
        <span className="wallet-hint">Abata em faturas do cliente pelo Financeiro, inclusive de novas compras faturadas.</span>
      </div>

      {creditRma && <div className="modal-overlay">
        <form className="modal-card rma-form" onSubmit={confirmCredit}>
          <h4>Gerar crédito de devolução</h4>
          <p>{creditRma.customer_name} — {creditRma.product_name} ({creditRma.quantity ?? 1} unidade(s))</p>
          <p>O crédito poderá ser usado em novas compras no PDV ou para abater faturas do mesmo cliente e filial. O valor máximo é o valor dos itens devolvidos na venda.</p>
          <label>Valor do crédito (R$)<input aria-label="Valor do crédito" inputMode="decimal" value={creditAmount} onChange={event => setCreditAmount(event.target.value)} disabled={busy} required autoFocus /></label>
          {creditError && <p className="otp-error-msg" role="alert">{creditError}</p>}
          <div className="pix-actions">
            <button type="submit" className="module-submit-btn" disabled={busy}>{busy ? 'Registrando...' : 'Confirmar crédito'}</button>
            <button type="button" className="rma-advance-btn" disabled={busy} onClick={() => setCreditRma(null)}>Cancelar</button>
          </div>
        </form>
      </div>}
      {refundRma && onRefund && <RmaRefundForm key={refundRma.id} rma={refundRma} onConfirm={onRefund} onClose={() => setRefundRma(null)} />}
      {photoRma && onAddPhotos && <RmaPhotoUpload key={photoRma.id} rma={photoRma} onSave={onAddPhotos} onClose={() => setPhotoRma(null)} />}

      {destinationRma && <div className="modal-overlay">
        <form className="modal-card rma-form" onSubmit={confirmDestination}>
          <h4>Destino da peça devolvida</h4>
          <p>{destinationRma.product_name} · {destinationRma.quantity ?? 1} unidade(s)</p>
          <label>Destino<select aria-label="Destino da peça" value={destination} disabled={busy} onChange={event => setDestination(event.target.value as NonNullable<RmaRequest['destination']>)}>
            <option value="avaliacao">Separada para avaliação</option>
            <option value="avaria">Avaria / defeito de fabricação</option>
            <option value="fornecedor">Enviar ao fornecedor</option>
            <option value="estoque" disabled={!destinationRma.product_id}>Reintegrar ao estoque disponível</option>
          </select></label>
          <p>{destination === 'estoque' ? 'Confirme apenas se a peça está apta para venda. A quantidade será adicionada ao estoque uma única vez.' : 'A peça permanece fora do estoque disponível para venda.'} Esta escolha não gera crédito nem reembolso.</p>
          {actionError && <p role="alert" className="form-error-msg">{actionError}</p>}
          <div className="pix-actions">
            <button type="submit" className="module-submit-btn" disabled={busy}>{busy ? 'Salvando...' : 'Confirmar destino'}</button>
            <button type="button" className="rma-advance-btn" disabled={busy} onClick={() => setDestinationRma(null)}>Cancelar</button>
          </div>
        </form>
      </div>}

      <div className="module-card rma-form rma-control-filters">
        <h4>Controle de devoluções</h4>
        <div className="form-row">
          <label>Buscar<input aria-label="Buscar devoluções" placeholder="Cliente, produto, SKU ou pedido" value={controlFilters.search} onChange={event => setControlFilters(previous => ({ ...previous, search: event.target.value }))} /></label>
          <label>Data considerada<select value={controlFilters.dateBasis} onChange={event => setControlFilters(previous => ({ ...previous, dateBasis: event.target.value as RmaFilters['dateBasis'] }))}><option value="solicitacao">Solicitação</option><option value="reembolso">Reembolso</option><option value="credito">Geração do crédito</option></select></label>
          <label>De<input type="date" aria-label="Início do período RMA" value={controlFilters.from} onChange={event => setControlFilters(previous => ({ ...previous, from: event.target.value }))} /></label>
          <label>Até<input type="date" aria-label="Fim do período RMA" value={controlFilters.to} onChange={event => setControlFilters(previous => ({ ...previous, to: event.target.value }))} /></label>
        </div>
        <div className="form-row">
          <label>Destino<select aria-label="Filtrar destino RMA" value={controlFilters.destination} onChange={event => setControlFilters(previous => ({ ...previous, destination: event.target.value }))}><option value="all">Todos os destinos</option>{Object.entries(rmaDestinations).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Solução financeira<select aria-label="Filtrar solução RMA" value={controlFilters.settlement} onChange={event => setControlFilters(previous => ({ ...previous, settlement: event.target.value }))}><option value="all">Todas</option><option value="pendente">Sem crédito ou reembolso</option><option value="credito">Crédito gerado</option><option value="reembolso">Reembolsado</option></select></label>
          <button type="button" className="rma-advance-btn" onClick={() => { setControlFilters({ search: '', from: '', to: '', destination: 'all', settlement: 'all', dateBasis: 'solicitacao' }); setFilter('all'); }}>Limpar filtros</button>
        </div>
        <p>{visibleRequests.length} solicitação(ões). Resumo e lista consideram os mesmos filtros e a filial selecionada. Datas no horário de São Paulo.</p>
        <div className="orders-summary rma-control-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {Object.entries(control.groups).map(([key, group]) => <div className="orders-summary-card" key={key}>
            <small>{rmaDestinations[key as keyof typeof rmaDestinations]}</small><strong>{group.quantity} peça(s)</strong>
            {canDelete && <><p>Custo: {money.format(group.cost / 100)}{group.estimated ? ' (estimado em parte)' : ''}</p>{group.unknown > 0 && <small>{group.unknown} peça(s) sem custo disponível</small>}</>}
          </div>)}
          <div className="orders-summary-card"><small>Créditos gerados</small><strong>{money.format(control.credits)}</strong><p>Utilizados: {money.format(control.used)}</p><small>Disponíveis: {control.available === null ? 'Saldo indisponível' : money.format(control.available)}</small></div>
          <div className="orders-summary-card"><small>Reembolsado aos clientes</small><strong>{money.format(control.refunded)}</strong><p>Dinheiro: {money.format(control.refunds.dinheiro ?? 0)}<br />PIX: {money.format(control.refunds.pix ?? 0)}<br />Cartão: {money.format(control.refunds.cartao ?? 0)}</p></div>
        </div>
        {canDelete && <p>Custos usam o histórico da venda quando disponível; o custo atual é uma estimativa. Peças sem custo não entram no total monetário. No fornecedor indica peças cujo retorno ainda está pendente.</p>}
      </div>

      {warrantyTerms && (
        <div className="warranty-terms-box">
          <FileText size={18} />
          <div>
            <strong>Termos de Garantia (exibido na impressão de O.S.)</strong>
            <p>{warrantyTerms}</p>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <button className="module-action-btn" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancelar' : <><FileText size={16} /> Nova Solicitação de Garantia</>}
        </button>

        <div className="orders-filter-row rma-status-filters" style={{ gap: '8px' }}>
          {(['all', 'aguardando_troca', 'retornou_fornecedor', 'reintegrado_estoque', 'credito_gerado'] as const).map((option) => (
            <button
              key={option}
              className={`rma-advance-btn ${filter === option ? 'active' : ''}`}
              onClick={() => setFilter(option)}
              style={{ minWidth: '120px' }}
            >
              {option === 'all' ? 'Todos' : rmaStatusLabels[option]}
            </button>
          ))}
        </div>
      </div>

      {showForm && (
        <form className="rma-form" onSubmit={handleSubmit}>
          <fieldset disabled={busy || Boolean(createAttempt.current)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <label className="checkbox-label">
            <input type="checkbox" checked={manualEntry} onChange={(event) => { setManualEntry(event.target.checked); setFormError(null); }} />
            Informar manualmente, sem histórico de venda
          </label>
          {!manualEntry ? (
            <>
              <div className="rma-history-selection">
                <label className="rma-customer-search-label">
                  Buscar cliente
                  <input
                    value={customerSearch}
                    onChange={(event) => {
                      setCustomerSearch(event.target.value);
                      setCustomerId('');
                      setSaleId('');
                      setSaleItemIndex('');
                      setProductName('');
                      setProductSku('');
                      setBatchOrOrder('');
                    }}
                    placeholder="Digite nome, documento ou telefone"
                    autoComplete="off"
                  />
                  {matchingCustomers.length > 0 && (
                    <div className="rma-customer-suggestions" role="listbox">
                      {matchingCustomers.map((customer) => (
                        <button key={customer.id} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => selectCustomer(customer)}>
                          <span>{customer.name}</span>
                          <small>{customer.document || customer.phone || ''}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </label>
                <label>
                  Venda concluída
                  <select value={saleId} onChange={(event) => selectSale(event.target.value)} disabled={!selectedCustomer}>
                    <option value="">{selectedCustomer ? 'Selecione uma venda...' : 'Busque e selecione um cliente'}</option>
                    {customerSales.map((sale) => (
                      <option key={sale.id} value={sale.id}>
                        {new Date(sale.created_at).toLocaleDateString('pt-BR')} · {money.format(sale.total)} · #{(sale.sale_number ? String(sale.sale_number).padStart(6, '0') : sale.id.slice(0, 8).toUpperCase())}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {selectedCustomer && customerSales.length === 0 && (
                <p className="rma-history-hint">Este cliente não tem vendas concluídas nesta filial. Ative a entrada manual para continuar.</p>
              )}
              {selectedSale && (
                <label>
                  Produto da venda
                  <select value={saleItemIndex} onChange={(event) => selectSaleItem(event.target.value)}>
                    <option value="">Selecione o produto...</option>
                    {selectedSale.items.map((item, index) => (
                      <option key={`${item.product_id}-${index}`} value={index} disabled={returnedQuantity(selectedSale, index, rmaRequests) >= item.quantity}>{item.name} · Disponível para devolução: {item.quantity - returnedQuantity(selectedSale, index, rmaRequests)}</option>
                    ))}
                  </select>
                </label>
              )}
              {selectedSaleItem && (
                <div className="rma-history-product-summary">
                  <span><small>Cliente</small><strong>{selectedCustomer?.name}</strong></span>
                  <span><small>Produto</small><strong>{productName}</strong></span>
                  <span><small>SKU</small><strong>{productSku}</strong></span>
                  <span><small>Pedido de origem</small><strong>Venda #{selectedSale?.sale_number ? String(selectedSale.sale_number).padStart(6, '0') : selectedSale?.id.slice(0, 8).toUpperCase()}</strong></span>
                </div>
              )}
            </>
          ) : (
            <>
              <label>Produto do estoque (para reintegração)
                <select value={manualProductId} onChange={event => {
                  setManualProductId(event.target.value);
                  const product = products.find(candidate => candidate.id === event.target.value);
                  if (product) { setProductName(product.name); setProductSku(product.sku?.trim() || 'Sem SKU'); }
                }}>
                  <option value="">Sem vínculo com estoque</option>
                  {products.filter(product => !product.is_service).map(product => <option key={product.id} value={product.id}>{product.name} · {product.sku || 'Sem SKU'}</option>)}
                </select>
              </label>
              <label>
                Cliente (opcional)
                <input value={manualCustomerName} onChange={(event) => setManualCustomerName(event.target.value)} placeholder="Nome do cliente" />
              </label>
          <div className="form-row">
            <label>
              Produto
              <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Ex: Display Moto G8 Power" required />
            </label>
            <label>
              SKU
              <input value={productSku} onChange={(e) => setProductSku(e.target.value)} placeholder="Ex: DH-MG8-012" required />
            </label>
          </div>
          <label>
            Número do Lote/Pedido
            <input value={batchOrOrder} onChange={(e) => setBatchOrOrder(e.target.value)} placeholder="Ex: PED-2024-0891" required />
          </label>
            </>
          )}
          <label>
            Descrição do Defeito
            <textarea value={defect} onChange={(e) => setDefect(e.target.value)} placeholder="Descreva o problema encontrado..." rows={3} required />
          </label>
          <label className="upload-label">
            Foto/Vídeo do Defeito
            <div className="media-upload">
              <Upload size={18} />
              <span>{mediaName || 'Anexar foto ou vídeo'}</span>
              <input type="file" accept="image/*,video/*" onChange={handleMediaChange} hidden />
            </div>
          </label>

          <div className="form-row">
            <label className="photo-upload-label">
              <span><Camera size={15} /> Foto da peça / produto na entrada</span>
              <div className="photo-upload-area">
                {beforePhoto ? (
                  <div className="photo-preview">
                    <img src={beforePhoto} alt="Antes" />
                    <button type="button" onClick={() => { setBeforePhoto(null); delete photoFiles.current.before; }}><X size={14} /></button>
                  </div>
                ) : (
                  <label className="photo-placeholder">
                    <Camera size={24} />
                    <span>Foto de entrada</span>
                    <small>Documente defeitos pré-existentes</small>
                    <input type="file" accept="image/*" capture="environment" onChange={(e) => handlePhotoChange(e, setBeforePhoto)} hidden />
                  </label>
                )}
              </div>
            </label>
            <label className="photo-upload-label">
              <span><Camera size={15} /> Foto da peça / produto na saída</span>
              <div className="photo-upload-area">
                {afterPhoto ? (
                  <div className="photo-preview">
                    <img src={afterPhoto} alt="Depois" />
                    <button type="button" onClick={() => { setAfterPhoto(null); delete photoFiles.current.after; }}><X size={14} /></button>
                  </div>
                ) : (
                  <label className="photo-placeholder">
                    <Camera size={24} />
                    <span>Foto de saída</span>
                    <small>Documente a qualidade da entrega</small>
                    <input type="file" accept="image/*" capture="environment" onChange={(e) => handlePhotoChange(e, setAfterPhoto)} hidden />
                  </label>
                )}
              </div>
            </label>
          </div>

          <label>Quantidade devolvida<input type="number" min="1" step="1" max={manualEntry ? undefined : remainingQuantity} value={quantity} onChange={event => setQuantity(Number(event.target.value))} required /></label>
          <p>A devolução fica no histórico da compra. A entrada no estoque ocorre ao reintegrar a peça; o reembolso financeiro é tratado separadamente.</p>
          </fieldset>
          {formError && <p className="form-error-msg" role="alert">{formError} Ao tentar novamente, será recuperada a mesma solicitação enviada.</p>}
          <button type="submit" className="module-submit-btn" disabled={busy}>{busy ? 'Salvando...' : 'Enviar solicitação'}</button>
        </form>
      )}

      {actionError && <p className="form-error-msg" role="alert">{actionError}</p>}
      <div className="rma-table-wrap mobile-record-wrap">
        <table className="rma-table mobile-record-table">
          <thead>
            <tr><th>Produto</th><th>Lote/Pedido</th><th>Status</th><th>Etiqueta</th><th>Ações</th></tr>
          </thead>
          <tbody>
            {visibleRequests.length === 0 ? (
              <tr><td colSpan={5} className="empty-row">Nenhuma solicitação de garantia registrada.</td></tr>
            ) : (
              visibleRequests.map((rma) => (
                <tr key={rma.id}>
                    <>
                      <td data-label="Produto" className="mobile-record-title">
                        <strong>{rma.product_name}</strong>
                        <small>SKU {rma.product_sku} · Qtd. {rma.quantity ?? 1}</small>
                        <small>{destinationLabels[currentDestination(rma)]}</small>
                        <details className="rma-product-details">
                          <summary>Ver detalhes{rma.attachments?.length ? ` · ${rma.attachments.length} anexo(s)` : ''}</summary>
                          {rma.customer_name && <p>Cliente: {rma.customer_name}</p>}
                          <p>Defeito: {rma.defect_description || 'Não informado'}</p>
                          {rma.stock_restored_at && <p>Entrada no estoque registrada.</p>}
                          <div className="rma-product-attachments">{(rma.attachments ?? []).map(file => <button type="button" key={file.path} className="rma-advance-btn" onClick={() => void openAttachment(file.path)}>{file.kind === 'before' ? 'Antes' : file.kind === 'after' ? 'Depois' : 'Defeito'}: {file.name}</button>)}</div>
                        </details>
                      </td>
                      <td data-label="Lote/Pedido">{saleReference(rma)}</td>
                      <td data-label="Status">
                        <span className="rma-status-badge" style={{ color: rmaStatusColors[rma.status], borderColor: rmaStatusColors[rma.status] }}>
                          {rmaStatusLabels[rma.status]}
                        </span>
                      </td>
                      <td data-label="Etiqueta">
                        <button className="rma-advance-btn" onClick={() => setLabelRmaId(rma.id)} title="Imprimir Etiqueta">
                          <QrCode size={14} /> Etiqueta
                        </button>
                      </td>
                      <td data-label="Ações" className="mobile-record-actions">
                        <div className="row-action-group">
                          {onAddPhotos && <button type="button" className="rma-advance-btn" disabled={busy || (rma.attachments?.length??0)>=20} onClick={()=>setPhotoRma(rma)}><Camera size={14} /> Adicionar fotos</button>}
                          {currentDestination(rma) !== 'estoque' && (
                            <button className="rma-advance-btn" disabled={busy} onClick={() => { setDestinationRma(rma); setDestination(currentDestination(rma)); setActionError(null); }} title="Escolher destino">
                              <ArrowRightCircle size={13} /> Escolher destino
                            </button>
                          )}
                          {!Number(rma.credit_amount) && !Number(rma.refund_amount) && canDelete && onGrantCredit && (
                            <button className="rma-advance-btn" disabled={busy || !rma.customer_id || !rma.sale_id} onClick={() => openCredit(rma)}>Gerar crédito</button>
                          )}
                          {!Number(rma.credit_amount) && !Number(rma.refund_amount) && canDelete && onRefund && <button type="button" className="rma-advance-btn" disabled={busy || !rma.customer_id || !rma.sale_id} onClick={() => setRefundRma(rma)}>Reembolsar cliente</button>}
                          {Number(rma.refund_amount) > 0 && <small>Reembolsado: {money.format(Number(rma.refund_amount))} · {rma.refund_method === 'dinheiro' ? 'Dinheiro' : rma.refund_method === 'pix' ? 'PIX' : 'Cartão'}{rma.refunded_at ? ` · ${new Date(rma.refunded_at).toLocaleDateString('pt-BR')}` : ''}</small>}
                          {Number(rma.credit_amount) > 0 && <small>Crédito: {money.format(Number(rma.credit_amount))} · Saldo: {rma.credit_used_amount == null ? 'indisponível' : money.format(Number(rma.credit_amount) - Number(rma.credit_used_amount))}</small>}
                          {!rma.customer_id && (rma.status === 'reintegrado_estoque' || rma.status === 'credito_gerado') && <small>Crédito exige uma devolução vinculada à venda do cliente.</small>}
                          {canDelete && !rma.sale_id && !rma.stock_restored_at && (
                            <>
                              {deleteConfirmId === rma.id ? (
                                <button className="rma-advance-btn danger" onClick={() => confirmDelete(rma.id)} title="Confirmar exclusão">
                                  <AlertCircle size={14} /> Confirmar
                                </button>
                              ) : (
                                <button className="rma-advance-btn danger" onClick={() => setDeleteConfirmId(rma.id)} title="Excluir">
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </>
                          )}
                          {deleteConfirmId === rma.id && (
                            <button className="rma-advance-btn" onClick={() => setDeleteConfirmId(null)} title="Cancelar exclusão">
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </>

                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!canDelete && (
        <div className="rma-delete-restricted">
          <AlertCircle size={14} />
          <span>Exclusão de solicitações restrita a Administrador e Gerente.</span>
        </div>
      )}

      {labelRmaId && labelRma && (
        <div className="modal-backdrop" onClick={() => setLabelRmaId(null)}>
          <div className="modal-content thermal-label-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Imprimir etiqueta de devolução</h3>
              <button onClick={() => setLabelRmaId(null)}><X size={18} /></button>
            </div>
            <div className="thermal-label-preview size-58">
              <div className="thermal-label-content">
                <div className="thermal-qr-area">
                  <QrCode size={48} />
                </div>
                <div className="thermal-label-info">
                  <strong>{labelRma.product_name}</strong>
                  <small>SKU: {labelRma.product_sku}</small>
                  <small>Origem: {saleReference(labelRma)}</small>
                </div>
              </div>
            </div>
            <button className="module-submit-btn" onClick={printLabel}>
              <Printer size={16} /> Imprimir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
