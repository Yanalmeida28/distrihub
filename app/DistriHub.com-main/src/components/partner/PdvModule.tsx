import { directReceiptEnabled, printSale, type ReceiptDetails } from '../../lib/salePrint';
import { SplitPaymentFields } from './SplitPaymentFields';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Trash2, ShoppingCart, Check, Printer, Camera,
  X, ClipboardList, Lock as LockIcon,
} from 'lucide-react';
import type { IScannerControls } from '@zxing/browser';
import type { DeliveryType, PartnerProduct, PartnerCustomer, PartnerSale, SalePayment, PartnerSalesperson, SaleItem, SalespersonRole, RmaRequest } from '../../types';
import { SalePriceInput } from './SalePriceInput';
import { money } from '../../utils';
import { draftPayments, emptySplitPaymentDraft, splitPaymentDraft, splitPaymentError, billedSaleError, pdvErrorMessage, pdvTotal, saleChargeTotal, validSalePrice, type CustomerCredit, customerPriceTable, productTablePrice, type PriceTable } from '../../lib/pdv';
import { SessionDraftProvider, useSessionDraftScope, useSessionDraftState, clearConfirmedPdvDraft } from '../../hooks/useSessionDraft';

type ClientType = 'varejo' | 'atacado';

function BarcodeCameraDialog({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbacksRef = useRef({ onDetected, onClose });
  callbacksRef.current = { onDetected, onClose };
  const [error, setError] = useState<string | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);

  useEffect(() => {
    let cancelled = false;
    let controls: IScannerControls | null = null;

    async function startScanner() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('A leitura pela câmera exige uma conexão HTTPS e um navegador com suporte à câmera.');
        return;
      }

      try {
        const [{ BrowserMultiFormatReader }, { DecodeHintType }] = await Promise.all([
          import('@zxing/browser'), import('@zxing/library'),
        ]);
        if (cancelled || !videoRef.current) return;

        // Accuracy mode tries QR before 1D formats and spends more time on small labels.
        const hints = new Map([[DecodeHintType.TRY_HARDER, true]]);
        controls = await new BrowserMultiFormatReader(hints).decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
          videoRef.current,
          (result, _error, activeControls) => {
            if (!result || cancelled) return;
            cancelled = true;
            activeControls.stop();
            callbacksRef.current.onDetected(result.getText());
          },
        );

        if (cancelled) controls.stop();
        else {
          scannerControlsRef.current = controls;
          // This is an optional improvement: unsupported focus settings must not stop reading.
          try {
            const stream = videoRef.current?.srcObject;
            if (stream && 'getVideoTracks' in stream) {
              const track = (stream as MediaStream).getVideoTracks()[0];
              const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
              if (capabilities?.focusMode?.includes('continuous')) {
                void track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
              }
            }
          } catch { /* Camera focus capability inspection is optional. */ }
        }
      } catch (cause) {
        if (cancelled) return;
        const name = cause && typeof cause === 'object' && 'name' in cause ? String(cause.name) : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setError('Permita o acesso à câmera nas configurações do navegador e tente novamente.');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setError('Não foi encontrada uma câmera disponível neste dispositivo.');
        } else if (name === 'NotReadableError') {
          setError('A câmera está em uso por outro aplicativo. Feche-o e tente novamente.');
        } else {
          setError('Não foi possível iniciar a câmera. Verifique a permissão e tente novamente.');
        }
      }
    }

    void startScanner();
    return () => {
      cancelled = true;
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
      controls?.stop();
    };
  }, []);

  return (
    <div className="modal-overlay" onClick={() => callbacksRef.current.onClose()}>
      <section className="modal-content pdv-camera-dialog" role="dialog" aria-modal="true" aria-labelledby="pdv-camera-title" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <h3 id="pdv-camera-title">Ler código pela câmera</h3>
          <button type="button" className="modal-close" aria-label="Fechar leitor de câmera" onClick={() => callbacksRef.current.onClose()}><X size={18} /></button>
        </div>
        <video ref={videoRef} className="pdv-camera-video" autoPlay muted playsInline aria-label="Visualização da câmera para leitura do código de barras" />
        {error ? <p role="alert" className="otp-error-msg">{error}</p> : <p role="status">Aponte a câmera para o QR code ou código de barras. Mantenha o código inteiro visível, com boa luz, e afaste um pouco para focar.</p>}
      </section>
    </div>
  );
}

function CustomerSearchPicker({ id, customers, customerId, clientType, onSelect }: {
  id: string;
  customers: PartnerCustomer[];
  customerId: string;
  clientType: ClientType;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null;
  const selectedCustomerName = selectedCustomer?.name;

  useEffect(() => {
    if (selectedCustomerName) setQuery(selectedCustomerName);
    else if (!isOpen) setQuery('');
  }, [selectedCustomerName, isOpen]);

  const filteredCustomers = useMemo(() => {
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const term = normalize(query.trim());
    const digits = query.replace(/\D/g, '');
    if (!term) return [];
    return customers.filter((customer) => {
      if (customer.is_active === false || (customer.customer_type ?? 'varejo') !== clientType) return false;
      const contact = [customer.phone, customer.phone_commercial_1, customer.phone_commercial_2].filter(Boolean).join(' ');
      return normalize(customer.name).includes(term) || (digits.length > 0 && contact.replace(/\D/g, '').includes(digits));
    }).slice(0, 8);
  }, [customers, clientType, query]);

  function selectCustomer(customer: PartnerCustomer) {
    onSelect(customer.id);
    setQuery(customer.name);
    setIsOpen(false);
  }

  return (
    <div className="pdv-search-picker">
      <label htmlFor={id}>Cliente</label>
      <div className="pdv-search-control">
        <div className="pdv-search-input-row">
          <Search size={16} aria-hidden="true" />
          <input
            id={id}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isOpen && query.trim().length > 0}
            aria-controls={`${id}-results`}
            value={query}
            placeholder={`Buscar cliente ${clientType}...`}
            onFocus={() => setIsOpen(true)}
            onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
            onChange={(event) => {
              if (customerId) onSelect('');
              setQuery(event.target.value);
              setIsOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setIsOpen(false);
              if (event.key === 'Enter' && filteredCustomers.length === 1) {
                event.preventDefault();
                selectCustomer(filteredCustomers[0]);
              }
            }}
          />
          {customerId && (
            <button
              type="button"
              className="pdv-search-clear"
              aria-label="Limpar cliente e continuar sem cadastro"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelect('');
                setQuery('');
                setIsOpen(false);
              }}
            >
              <X size={15} />
            </button>
          )}
        </div>
        {isOpen && query.trim() && (
          <div id={`${id}-results`} className="pdv-search-results" role="listbox">
            {filteredCustomers.length > 0 ? filteredCustomers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                role="option"
                aria-selected={customer.id === customerId}
                className="pdv-search-result"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectCustomer(customer)}
              >
                <span>{customer.name}</span>
                {customer.phone && <small>{customer.phone}</small>}
              </button>
            )) : (
              <div className="pdv-search-no-results">Nenhum cliente encontrado.</div>
            )}
          </div>
        )}
      </div>
      {!customerId && <small className="pdv-search-hint">Sem cliente selecionado: venda avulsa.</small>}
    </div>
  );
}

function SalespersonSearchPicker({ id, salespeople, salespersonId, onSelect }: {
  id: string;
  salespeople: PartnerSalesperson[];
  salespersonId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const selectedSalesperson = salespeople.find((salesperson) => salesperson.id === salespersonId) ?? null;
  const selectedSalespersonName = selectedSalesperson?.name;

  useEffect(() => {
    if (selectedSalespersonName) setQuery(selectedSalespersonName);
    else if (!isOpen) setQuery('');
  }, [selectedSalespersonName, isOpen]);

  const filteredSalespeople = useMemo(() => {
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const term = normalize(query.trim());
    if (!term) return [];
    return salespeople.filter((salesperson) => normalize(`${salesperson.name} ${salesperson.email ?? ''}`).includes(term)).slice(0, 8);
  }, [salespeople, query]);

  function selectSalesperson(salesperson: PartnerSalesperson) {
    onSelect(salesperson.id);
    setQuery(salesperson.name);
    setIsOpen(false);
  }

  return (
    <div className="pdv-search-picker">
      <label htmlFor={id}>Vendedor responsável</label>
      <div className="pdv-search-control">
        <div className="pdv-search-input-row">
          <Search size={16} aria-hidden="true" />
          <input
            id={id}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isOpen && query.trim().length > 0}
            aria-controls={`${id}-results`}
            value={query}
            placeholder="Buscar colaborador..."
            onFocus={() => setIsOpen(true)}
            onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
            onChange={(event) => {
              if (salespersonId) onSelect('');
              setQuery(event.target.value);
              setIsOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setIsOpen(false);
              if (event.key === 'Enter' && filteredSalespeople.length === 1) {
                event.preventDefault();
                selectSalesperson(filteredSalespeople[0]);
              }
            }}
          />
          {salespersonId && (
            <button
              type="button"
              className="pdv-search-clear"
              aria-label="Limpar colaborador responsável"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelect('');
                setQuery('');
                setIsOpen(false);
              }}
            >
              <X size={15} />
            </button>
          )}
        </div>
        {isOpen && query.trim() && (
          <div id={`${id}-results`} className="pdv-search-results" role="listbox">
            {filteredSalespeople.length > 0 ? filteredSalespeople.map((salesperson) => (
              <button
                key={salesperson.id}
                type="button"
                role="option"
                aria-selected={salesperson.id === salespersonId}
                className="pdv-search-result"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSalesperson(salesperson)}
              >
                <span>{salesperson.name}</span>
              </button>
            )) : (
              <div className="pdv-search-no-results">Nenhum colaborador encontrado.</div>
            )}
          </div>
        )}
      </div>
      {!salespersonId && <small className="pdv-search-hint">Sem atribuição de colaborador.</small>}
    </div>
  );
}

type Props = {
  cashContext?: { status: string; message: string; others: { id: string; operator_id: string | null; operator_name: string }[] };
  onOpenCash?: () => void;
  onOpenOrders?: () => void;
  onConfirmCashOperator?: (operatorId?: string | null) => void;
  canEditPrice: boolean;
  products: PartnerProduct[];
  customers: PartnerCustomer[];
  sales: PartnerSale[];
  credits: CustomerCredit[];
  rmaRequests?: RmaRequest[];
  hasPendingSale?: boolean;
  isActive?: boolean;
  barcodeScannerEnabled?: boolean;
  cameraScannerEnabled?: boolean;
  preSaleToCheckout?: PartnerSale | null;
  onConsumePreSale?: () => void;
  onRequestPreSale?: (sale: PartnerSale) => void;
  salespeople: PartnerSalesperson[];
  activeSalespersonId?: string | null;
  activeBranchName: string;
  segment: string;
  selectedBranchId: string | null;
  currentRole: SalespersonRole;
  receiptDetails?: ReceiptDetails;
  onCreateSale: (sale: {
    customer_id: string | null;
    customer_name: string;
    items: { product_id: string; name: string; quantity: number; unit_price: number }[];
    total: number;
    freight_fee?: number;
    customer_type: ClientType;
    delivery_type: DeliveryType;
    imei?: string;
    serial_number?: string;
    payment_method?: string; payment_splits?: SalePayment[]; rma_credit_id?: string | null;
    salesperson_id?: string | null;
    draft_scope?: string; branch_id?: string | null;
  }) => Promise<PartnerSale>;
  onCreatePreSale: (sale: {
    customer_id: string | null;
    customer_name: string;
    items: { product_id: string; name: string; quantity: number; unit_price: number }[];
    total: number;
    freight_fee?: number;
    customer_type: ClientType;
    delivery_type: DeliveryType;
    payment_method?: string | null;
    imei?: string;
    serial_number?: string;
    salesperson_id?: string | null;
    draft_scope?: string; branch_id?: string | null;
  }) => Promise<PartnerSale | void>;
  onFinalizePreSale: (id: string, paymentMethod: string, paymentSplits?: SalePayment[], edits?: Parameters<Props['onCreateSale']>[0]) => Promise<void>;
  onUpdatePreSale?: (id: string, edits: Parameters<Props['onCreateSale']>[0]) => Promise<void>;
  onCancelSale: (id: string, operatorId?: string | null, operatorPin?: string | null) => Promise<void>;
  onDeleteSale: (id: string, operatorId?: string | null, operatorPin?: string | null) => Promise<void>;
};

const cashierRoles: SalespersonRole[] = ['administrador', 'gerente', 'caixa', 'vendedor'];
const PRODUCT_PAGE_SIZE = 30;

export function PdvModule({
  cashContext, onOpenCash, onOpenOrders, onConfirmCashOperator,
  products, customers, sales, credits, rmaRequests = [], hasPendingSale, isActive = true, salespeople, segment, selectedBranchId,
  barcodeScannerEnabled = true, cameraScannerEnabled = false,
  preSaleToCheckout, onConsumePreSale,
  activeSalespersonId, activeBranchName, receiptDetails, currentRole, canEditPrice, onCreateSale, onCreatePreSale, onFinalizePreSale, onUpdatePreSale,
}: Props) {
  const parentDraftScope = useSessionDraftScope();
  const legacyParentDraftScope = useSessionDraftScope(true);
  const contextKey = `${selectedBranchId ?? 'all'}`;
  const [checkoutPreSale, setCheckoutPreSale] = useState<PartnerSale | null>(null);
  const [savedRescueNotice, setSavedRescueNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!preSaleToCheckout) return;
    setSavedRescueNotice(null);
    setCheckoutPreSale(preSaleToCheckout);
  }, [preSaleToCheckout]);
  const moduleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = moduleRef.current;
    if (!element) return;
    const updateHeight = () => {
      const top = element.getBoundingClientRect().top;
      element.style.setProperty('--pdv-height', `${Math.max(420, window.innerHeight - top)}px`);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    if (element.parentElement) observer.observe(element.parentElement);
    const toolbar = element.closest('.sidebar-main-inner')?.querySelector('.branch-toolbar');
    if (toolbar) observer.observe(toolbar);
    const cashContext = element.querySelector('.pdv-cash-context');
    if (cashContext) observer.observe(cashContext);
    window.addEventListener('resize', updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, []);

  const canCheckout = cashierRoles.includes(currentRole);

  return (
    <SessionDraftProvider
      key={`${parentDraftScope}:pdv:${contextKey}`}
      scope={`${parentDraftScope}:pdv:${contextKey}`}
      legacyScope={`${legacyParentDraftScope}:pdv:${contextKey}:${activeSalespersonId ?? 'owner'}`}
    >
    <div ref={moduleRef} className={`panel-module pdv-workspace pdv-workspace-checkout`}>
      <div className="module-header">
        <span className="module-icon"><ShoppingCart size={20} /></span>
        <div>
          <h3>PDV</h3>
          <small className="pdv-branch-context">{activeBranchName}</small>
        </div>
      </div>

      <div className="pdv-subtabs">
      {cashContext && <div className="pdv-cash-context" role="status">
        <span>{cashContext.message}</span>
        {cashContext.status === 'authorize' && onConfirmCashOperator && <button type="button" className="rma-advance-btn" onClick={() => onConfirmCashOperator()}>Confirmar operador</button>}
        {cashContext.status === 'closed' && <>
          {onOpenCash && <button type="button" className="rma-advance-btn" onClick={onOpenCash}>Ir ao caixa</button>}
          {onConfirmCashOperator && cashContext.others.map(session => <button key={session.id} type="button" className="rma-advance-btn" onClick={() => onConfirmCashOperator(session.operator_id)}>Operar como {session.operator_name}</button>)}
        </>}
        {cashContext.status === 'error' && onOpenCash && <button type="button" className="rma-advance-btn" onClick={onOpenCash}>Conferir caixa</button>}
      </div>}
      </div>

      {savedRescueNotice && <p className="sent-message" role="status">{savedRescueNotice}</p>}
      {checkoutPreSale && (
        <SessionDraftProvider key={checkoutPreSale.id} scope={`${parentDraftScope}:pdv:${contextKey}:rescued:${checkoutPreSale.id}`}>
        <PdvCheckout
          rescuedSale={checkoutPreSale}
          products={products}
          customers={customers}
          credits={credits}
          rmaRequests={rmaRequests}
          salespeople={salespeople}
          activeSalespersonId={activeSalespersonId}
          segment={segment}
          selectedBranchId={selectedBranchId}
          canCheckout={canCheckout}
          canEditPrice={canEditPrice}
          hasPendingSale={hasPendingSale}
          isActive={isActive}
          barcodeScannerEnabled={barcodeScannerEnabled}
          cameraScannerEnabled={cameraScannerEnabled}
          receiptDetails={receiptDetails}
          onExitRescue={() => { setCheckoutPreSale(null); onConsumePreSale?.(); }}
          onSavePreSale={onUpdatePreSale ? async edits => {
            const current = sales.find(sale => sale.id === checkoutPreSale.id) ?? checkoutPreSale;
            if (current.status !== 'pre_venda' || current.branch_id !== selectedBranchId) throw new Error('Pré-venda indisponível nesta filial. Atualize os pedidos.');
            await onUpdatePreSale(current.id, edits);
          } : undefined}
          onPreSaleSaved={() => {
            setSavedRescueNotice('Pré-venda atualizada. O pedido continua em aberto, sem registrar pagamento.');
            setCheckoutPreSale(null); onConsumePreSale?.();
          }}
          onCreateSale={async (edits) => {
            const current = sales.find(sale => sale.id === checkoutPreSale.id) ?? checkoutPreSale;
            if (current.status !== 'pre_venda' || current.branch_id !== selectedBranchId) throw new Error('Pré-venda indisponível nesta filial. Atualize os pedidos.');
            await onFinalizePreSale(current.id, edits.payment_method || 'pix', edits.payment_splits, edits);
            return { ...current, ...edits, status: 'concluida', completed_at: new Date().toISOString(), payment_status: edits.payment_method === 'faturado' ? 'pendente' : 'pago' };
          }}
        />
        </SessionDraftProvider>
      )}
      {(
        <div className="pdv-checkout-slot" hidden={Boolean(checkoutPreSale)}>
        <PdvCheckout
          products={products}
          customers={customers}
          credits={credits}
          hasPendingSale={hasPendingSale}
          rmaRequests={rmaRequests}
          isActive={isActive && !checkoutPreSale}
          barcodeScannerEnabled={barcodeScannerEnabled}
          cameraScannerEnabled={cameraScannerEnabled}
          salespeople={salespeople}
          activeSalespersonId={activeSalespersonId}
          segment={segment}
          selectedBranchId={selectedBranchId}
          canCheckout={canCheckout}
          canEditPrice={canEditPrice}
          receiptDetails={receiptDetails}
          onCreateSale={onCreateSale}
          onCreatePreSale={onCreatePreSale}
          onOpenOrders={onOpenOrders}
        />
        </div>
      )}
    </div>
    </SessionDraftProvider>
  );
}

/* ============ PDV Checkout ============ */

function PdvCheckout({ products, customers, credits, rmaRequests = [], hasPendingSale, isActive = true, barcodeScannerEnabled = true, cameraScannerEnabled = false, salespeople, activeSalespersonId, selectedBranchId, canCheckout, canEditPrice, receiptDetails, onCreateSale, onCreatePreSale, onOpenOrders, rescuedSale, onExitRescue, onSavePreSale, onPreSaleSaved }: {
  onCreatePreSale?: Props['onCreatePreSale'];
  onOpenOrders?: () => void;
  rescuedSale?: PartnerSale;
  onExitRescue?: () => void;
  onSavePreSale?: (edits: Parameters<Props['onCreateSale']>[0]) => Promise<void>;
  onPreSaleSaved?: () => void;
  products: PartnerProduct[];
  customers: PartnerCustomer[];
  credits: CustomerCredit[];
  rmaRequests?: RmaRequest[];
  canEditPrice: boolean;
  hasPendingSale?: boolean;
  isActive?: boolean;
  barcodeScannerEnabled?: boolean;
  cameraScannerEnabled?: boolean;
  salespeople: PartnerSalesperson[];
  activeSalespersonId?: string | null;
  segment: string;
  selectedBranchId: string | null;
  canCheckout: boolean;
  receiptDetails?: ReceiptDetails;
  onCreateSale: (sale: { customer_id: string | null; customer_name: string; items: SaleItem[]; total: number; freight_fee?: number; customer_type: ClientType; delivery_type: DeliveryType; imei?: string; serial_number?: string; payment_method?: string; payment_splits?: SalePayment[]; rma_credit_id?: string | null; salesperson_id?: string | null; draft_scope?: string; branch_id?: string | null }) => Promise<PartnerSale>;
}) {
  const draftScope = useSessionDraftScope();
  const [search, setSearch] = useSessionDraftState('checkout:product-search', '');
  const [visibleProductCount, setVisibleProductCount] = useState(PRODUCT_PAGE_SIZE);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const cartSectionRef = useRef<HTMLElement>(null);
  const paymentSectionRef = useRef<HTMLDivElement>(null);
  function goToSaleSection(target: HTMLElement | null) {
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    target.focus({ preventScroll: true });
  }
  const [cameraOpen, setCameraOpen] = useState(false);
  useEffect(() => {
    setVisibleProductCount(PRODUCT_PAGE_SIZE);
  }, [search, selectedBranchId]);
  const [cart, setCart] = useSessionDraftState<{ product_id: string; name: string; quantity: number; unit_price: number }[]>('checkout:cart', rescuedSale?.items ?? []);
  const cartRef = useRef(cart);
  cartRef.current = cart;
  function updateCart(update: typeof cart | ((previous: typeof cart) => typeof cart), force = false) {
    if (!force && !canChangeCart()) return;
    const changed = typeof update === 'function' ? update(cartRef.current) : update;
    const next = changed.map(item => 'subtotal' in item
      ? { ...item, subtotal: Math.round(item.unit_price * 100) * item.quantity / 100 }
      : item);
    cartRef.current = next;
    setCart(next);
  }
  const previousBranchId = useRef(selectedBranchId);
  const [branchChangedWithCart, setBranchChangedWithCart] = useState(false);
  useEffect(() => {
    if (previousBranchId.current !== selectedBranchId && cart.length > 0) {
      setBranchChangedWithCart(true);
    }
    if (cart.length === 0) setBranchChangedWithCart(false);
    previousBranchId.current = selectedBranchId;
  }, [cart.length, selectedBranchId]);
  const cartHasWrongBranch = Boolean(selectedBranchId && cart.some((item) => {
    const product = products.find((candidate) => candidate.id === item.product_id);
    return !product || (product.branch_id != null && product.branch_id !== selectedBranchId);
  }));
  const [customerId, setCustomerId] = useSessionDraftState('checkout:customer-id', rescuedSale?.customer_id ?? '');
  const [customerName, setCustomerName] = useSessionDraftState('checkout:customer-name', rescuedSale?.customer_name ?? '');
  const [clientType, setClientType] = useSessionDraftState<ClientType>('checkout:client-type', rescuedSale?.customer_type ?? 'varejo');
  const [paymentMethod, setPaymentMethod] = useSessionDraftState('checkout:payment-method', rescuedSale?.payment_method || 'pix');
  const [paymentDraft, setPaymentDraft] = useSessionDraftState('checkout:split-payments', rescuedSale ? splitPaymentDraft(rescuedSale.payment_splits) : { ...emptySplitPaymentDraft });
  const [rmaCreditId, setRmaCreditId] = useSessionDraftState('checkout:rma-credit-id', '');
  const [rmaCreditAmount, setRmaCreditAmount] = useSessionDraftState('checkout:rma-credit-amount', '');
  const [deliveryType, setDeliveryType] = useSessionDraftState<DeliveryType>('checkout:delivery-type', rescuedSale?.delivery_type ?? 'balcao');
  const [freightFee, setFreightFee] = useSessionDraftState<number | string>('checkout:freight-fee', rescuedSale?.freight_fee ?? 0, undefined, value => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)));
  const freightAmount = freightFee === '' ? 0 : Number(freightFee);
  const [salespersonId, setSalespersonId] = useSessionDraftState('checkout:salesperson-id', rescuedSale?.salesperson_id ?? '');
  const [completed, setCompleted] = useState(false);
  const [orderSaved, setOrderSaved] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [isSavingPreSale, setIsSavingPreSale] = useState(false);
  const checkoutInFlight = useRef(false);
  const checkoutMounted = useRef(true);
  useEffect(() => { checkoutMounted.current = true; return () => { checkoutMounted.current = false; }; }, []);
  const activityRef = useRef({ isActive, hasPendingSale });
  activityRef.current = { isActive, hasPendingSale };
  const cartLocked = isCheckingOut || Boolean(hasPendingSale) || !isActive;
  function canChangeCart() {
    return !checkoutInFlight.current && !activityRef.current.hasPendingSale && activityRef.current.isActive
      && (typeof document === 'undefined' || document.visibilityState !== 'hidden');
  }
  useEffect(() => {
    setCameraOpen(false);
  }, [isActive, hasPendingSale, isCheckingOut, cameraScannerEnabled, selectedBranchId]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const closeHiddenCamera = () => { if (document.visibilityState === 'hidden') setCameraOpen(false); };
    document.addEventListener('visibilitychange', closeHiddenCamera);
    return () => document.removeEventListener('visibilitychange', closeHiddenCamera);
  }, []);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [priceTable, setPriceTable] = useSessionDraftState<PriceTable>('checkout:price-table', customerPriceTable(customers.find(customer => customer.id === rescuedSale?.customer_id), rescuedSale?.customer_type ?? 'varejo'));
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const lastClickRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });
  const addedTimeoutRef = useRef<number | null>(null);
  const noticeTimeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (addedTimeoutRef.current !== null) window.clearTimeout(addedTimeoutRef.current);
    if (noticeTimeoutRef.current !== null) window.clearTimeout(noticeTimeoutRef.current);
  }, []);


  function getPriceForProduct(p: PartnerProduct, table: PriceTable): number { return productTablePrice(p, table); }

  function handleClientTypeChange(type: ClientType) {
    if (!canChangeCart()) return;
    setRmaCreditId(''); setRmaCreditAmount('');
    setClientType(type);
    setPriceTable(type);
    setCustomerId('');
    setCustomerName('');
    updateCart((prev) => prev.map((item) => {
      const product = products.find((p) => p.id === item.product_id);
      if (!product) return item;
      return { ...item, unit_price: getPriceForProduct(product, type) };
    }));
  }

  function handleCustomerChange(id: string) {
    if (!canChangeCart()) return;
    const customer = customers.find(candidate => candidate.id === id);
    if (customer?.is_active === false) return;
    const type = customer ? customer.customer_type === 'atacado' ? 'atacado' : 'varejo' : clientType;
    const table = customerPriceTable(customer, type);
    try {
      const next = cart.map(item => {
        const product = products.find(product => product.id === item.product_id);
        return product ? { ...item, unit_price: getPriceForProduct(product, table) } : item;
      });
      setCustomerId(id); setCustomerName(customer?.name ?? ''); setClientType(type); setPriceTable(table);
      setRmaCreditId(''); setRmaCreditAmount('');
      updateCart(next);
    } catch (error) { setCheckoutError(pdvErrorMessage(error)); }
  }

  const filtered = useMemo(() => {
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const term = normalize(search.trim());
    return products.filter((p) => {
      // `products` já chega filtrado pela filial ativa (ou pela filial fixa do funcionário).
      // Aplica o filtro local apenas quando uma filial específica está selecionada,
      // mantendo a Visão Consolidada do proprietário funcional.
      if (selectedBranchId && p.branch_id !== selectedBranchId) return false;
      return normalize(p.name).includes(term) || normalize(p.sku ?? '').includes(term) || normalize(p.barcode ?? '').includes(term) || normalize(p.id) === term;
    });
  }, [products, search, selectedBranchId]);

  const total = pdvTotal(cart);
  const chargeTotal = saleChargeTotal({ total, freight_fee: freightAmount });
  const availableReturnCredits = rmaRequests.filter(rma => rma.customer_id === customerId && rma.branch_id === selectedBranchId && rma.status === 'credito_gerado' && rma.credit_used_amount != null && Number(rma.credit_amount) > Number(rma.credit_used_amount));
  const selectedReturnCredit = availableReturnCredits.find(rma => rma.id === rmaCreditId);
  const returnCreditBalance = selectedReturnCredit ? (Math.round(Number(selectedReturnCredit.credit_amount) * 100) - Math.round(Number(selectedReturnCredit.credit_used_amount) * 100)) / 100 : 0;
  const appliedReturnCredit = rmaCreditId ? Number(rmaCreditAmount.replace(',', '.')) : 0;
  const remainingCharge = (Math.round(chargeTotal * 100) - Math.round(appliedReturnCredit * 100)) / 100;
  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null;
  const credit = credits.find(item => item.customer_id === customerId);
  const customerOpenCredit = Number(credit?.used ?? 0);
  const customerCreditAvailable = Number(credit?.available ?? 0);
  const billedSaleBlocked = paymentMethod === 'faturado' && Boolean(billedSaleError(credit, customerId || null, chargeTotal));

  function showSelectionNotice(message: string) {
    setSelectionNotice(message);
    if (noticeTimeoutRef.current !== null) window.clearTimeout(noticeTimeoutRef.current);
    noticeTimeoutRef.current = window.setTimeout(() => setSelectionNotice(null), 3500);
  }

  function handleCameraCode(code: string) {
    setCameraOpen(false);
    if (!canChangeCart()) return;
    const normalizedCode = code.trim().toLocaleLowerCase();
    const matches = products.filter((product) =>
      (!selectedBranchId || product.branch_id === selectedBranchId)
      && [product.barcode, product.sku, product.id].some(value => !!value?.trim() && value.trim().toLocaleLowerCase() === normalizedCode),
    );
    setSearch('');
    if (matches.length === 1) {
      addToCart(matches[0], true);
    } else if (matches.length > 1) {
      showSelectionNotice('Este código está vinculado a mais de um produto nesta filial. Corrija o código de barras ou SKU cadastrado.');
    } else {
      showSelectionNotice('Código não encontrado. Preencha o campo Código de barras no cadastro do produto.');
    }
  }

  function addToCart(product: PartnerProduct, fromScanner = false) {
    if (!canChangeCart()) return;
    // Ignora disparo duplicado do mesmo toque/clique (ex.: double-tap acidental no mobile).
    const now = Date.now();
    if (!fromScanner) {
      if (lastClickRef.current.id === product.id && now - lastClickRef.current.time < 350) return;
      lastClickRef.current = { id: product.id, time: now };
    }

    if (!product.is_service) {
      const inCart = cartRef.current.find((i) => i.product_id === product.id)?.quantity ?? 0;
      if (product.stock <= 0) {
        showSelectionNotice(`"${product.name}" está sem estoque nesta filial.`);
        return;
      }
      if (inCart + 1 > product.stock) {
        showSelectionNotice(`Estoque insuficiente: apenas ${product.stock} un. de "${product.name}" disponíveis.`);
        return;
      }
    }

    let price: number;
    try { price = getPriceForProduct(product, priceTable); } catch (error) { setCheckoutError(pdvErrorMessage(error)); return; }
    updateCart((prev) => {
      const existing = prev.find((i) => i.product_id === product.id);
      if (existing) return prev.map((i) => i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { product_id: product.id, name: product.name, quantity: 1, unit_price: price }];
    });
    setCompleted(false);
    setCheckoutError(null);
    setSelectionNotice(null);
    setLastAddedId(product.id);
    setSearch('');
    searchInputRef.current?.focus();
    if (addedTimeoutRef.current !== null) window.clearTimeout(addedTimeoutRef.current);
    addedTimeoutRef.current = window.setTimeout(() => setLastAddedId(null), 1200);
  }

  function changeQty(id: string, delta: number) {
    if (!canChangeCart()) return;
    if (delta > 0) {
      const product = products.find((p) => p.id === id);
      const inCart = cartRef.current.find((i) => i.product_id === id)?.quantity ?? 0;
      if (product && !product.is_service && inCart + 1 > product.stock) {
        showSelectionNotice(`Estoque insuficiente: apenas ${product.stock} un. de "${product.name}" disponíveis.`);
        return;
      }
    }
    updateCart((prev) => prev.flatMap((i) => {
      if (i.product_id !== id) return [i];
      const q = i.quantity + delta;
      return q > 0 ? [{ ...i, quantity: q }] : [];
    }));
  }

  function removeFromCart(id: string) {
    if (!canChangeCart()) return;
    updateCart((prev) => prev.filter((i) => i.product_id !== id));
  }

  async function handleSavePreSale() {
    if (!rescuedSale || !onSavePreSale || !canCheckout || !canChangeCart() || !cartRef.current.length || cartHasWrongBranch) return;
    if (!selectedBranchId || selectedBranchId !== rescuedSale.branch_id) { setCheckoutError('Selecione a filial original da pré-venda para salvar.'); return; }
    if (!validSalePrice(freightAmount) || cartRef.current.some(item => !validSalePrice(item.unit_price))) { setCheckoutError('Informe preços e frete válidos com até duas casas decimais.'); return; }
    const customer = customers.find(candidate => candidate.id === customerId);
    if (customer?.is_active === false) { setCheckoutError('Cliente inativo. Selecione outro cliente.'); return; }
    checkoutInFlight.current = true; setIsCheckingOut(true); setIsSavingPreSale(true); setCheckoutError(null); setCameraOpen(false);
    try {
      await onSavePreSale({ customer_id: customerId || null, customer_name: customerName || customer?.name || (clientType === 'atacado' ? 'Cliente Atacado' : 'Cliente Varejo'),
        items: cartRef.current, total: pdvTotal(cartRef.current), freight_fee: freightAmount,
        customer_type: clientType, delivery_type: deliveryType, payment_method: paymentMethod,
        salesperson_id: salespersonId || null, branch_id: selectedBranchId });
      clearConfirmedPdvDraft(draftScope, 'checkout');
      if (checkoutMounted.current) onPreSaleSaved?.();
    } catch (error) { if (checkoutMounted.current) setCheckoutError(pdvErrorMessage(error)); }
    finally { checkoutInFlight.current = false; if (checkoutMounted.current) { setIsCheckingOut(false); setIsSavingPreSale(false); } }
  }

  async function handleSaveOrder() {
    if (rescuedSale || !onCreatePreSale || !canCheckout || !canChangeCart() || !cartRef.current.length || cartHasWrongBranch) return;
    if (!selectedBranchId) { alert('Selecione uma filial antes de salvar o pedido.'); return; }
    if (!validSalePrice(freightAmount) || cartRef.current.some(item => !validSalePrice(item.unit_price))) { setCheckoutError('Informe preços e frete válidos com até duas casas decimais.'); return; }
    const customer = customers.find(candidate => candidate.id === customerId);
    if (customer?.is_active === false) { setCheckoutError('Cliente inativo. Selecione outro cliente.'); return; }
    checkoutInFlight.current = true; setIsCheckingOut(true); setIsSavingPreSale(true); setCheckoutError(null); setCameraOpen(false);
    try {
      await onCreatePreSale({
        draft_scope: draftScope,
        payment_method: paymentMethod === 'misto' ? null : paymentMethod,
        customer_id: customerId || null,
        customer_name: customerName || customer?.name || (clientType === 'atacado' ? 'Cliente Atacado' : 'Cliente Varejo'),
        items: cartRef.current, total: pdvTotal(cartRef.current), freight_fee: freightAmount,
        customer_type: clientType, delivery_type: deliveryType,
        salesperson_id: salespersonId || null, branch_id: selectedBranchId,
      });
      updateCart([], true); setFreightFee(0); setCustomerId(''); setCustomerName(''); setSalespersonId('');
      setClientType('varejo'); setPriceTable('varejo'); setPaymentMethod('pix');
      setPaymentDraft({ ...emptySplitPaymentDraft }); setRmaCreditId(''); setRmaCreditAmount('');
      setDeliveryType('balcao'); setSearch(''); setVisibleProductCount(PRODUCT_PAGE_SIZE);
      setSelectionNotice(null); setLastAddedId(null);
      if (checkoutMounted.current) { setOrderSaved(true); onOpenOrders?.(); }
    } catch (error) { if (checkoutMounted.current) setCheckoutError(pdvErrorMessage(error)); }
    finally { checkoutInFlight.current = false; if (checkoutMounted.current) { setIsCheckingOut(false); setIsSavingPreSale(false); } }
  }

  async function handleCheckout(shouldPrint = false) {
    if (cartRef.current.length === 0 || !canChangeCart()) return;
    const checkoutCart = cartRef.current;
    const checkoutTotal = pdvTotal(checkoutCart);
    const checkoutChargeTotal = saleChargeTotal({ total: checkoutTotal, freight_fee: freightAmount });
    if (!validSalePrice(freightAmount) || checkoutCart.some(item => !validSalePrice(item.unit_price))) {
      setCheckoutError('Informe preços e frete válidos com até duas casas decimais.');
      return;
    }
    if (!selectedBranchId) {
      alert('Selecione uma filial antes de finalizar a venda.');
      return;
    }
    const customer = customers.find((c) => c.id === customerId);
    if (customer?.is_active === false) { setCheckoutError('Cliente inativo. Selecione outro cliente.'); return; }
    if (paymentMethod === 'faturado') {
      const message = billedSaleError(credit, customerId || null, checkoutChargeTotal);
      if (message) { setCheckoutError(message); return; }
    }
    if (rmaCreditId && (rescuedSale || !selectedReturnCredit || !validSalePrice(appliedReturnCredit) || appliedReturnCredit <= 0 || appliedReturnCredit > Math.min(returnCreditBalance, checkoutChargeTotal) || paymentMethod === 'faturado')) {
      setCheckoutError('Confira o crédito de devolução e o valor a usar. A diferença deve ser paga em dinheiro, PIX ou cartão.'); return;
    }
    const parts: SalePayment[] = rmaCreditId
      ? [{ method: 'credito_rma', amount: appliedReturnCredit }, ...(remainingCharge === 0 ? [] : paymentMethod === 'misto' ? draftPayments(paymentDraft) : [{ method: paymentMethod as SalePayment['method'], amount: remainingCharge }])]
      : paymentMethod === 'misto' ? draftPayments(paymentDraft) : [];
    const validation = paymentMethod === 'misto' || rmaCreditId ? splitPaymentError(checkoutChargeTotal, parts) : null;
    if (validation) { setCheckoutError(validation); return; }
    const fallbackName = clientType === 'atacado' ? 'Cliente Atacado' : 'Cliente Varejo';
    const printWindow = shouldPrint && !directReceiptEnabled?.() ? window.open('', '_blank', 'width=440,height=700') : null;
    if (printWindow) printWindow.document.body.textContent = 'Aguardando confirmação da venda...';
    checkoutInFlight.current = true;
    setIsCheckingOut(true);
    setCameraOpen(false);
    setCheckoutError(null);
    try {
      const confirmedSale = await onCreateSale({
        draft_scope: draftScope,
        customer_id: customerId || null,
        customer_name: customerName || customer?.name || fallbackName,
        items: checkoutCart,
        total: checkoutTotal,
        freight_fee: freightAmount,
        customer_type: clientType,
        delivery_type: deliveryType,
        payment_method: rmaCreditId ? 'misto' : paymentMethod,
        rma_credit_id: rmaCreditId || null,
        payment_splits: parts,
        salesperson_id: salespersonId || null,
        branch_id: selectedBranchId,
      });
      updateCart([], true); setFreightFee(0); setCustomerId(''); setCustomerName(''); setSalespersonId('');
      setCompleted(true);
      setClientType('varejo');
      setPriceTable('varejo');
      setPaymentMethod('pix');
      setPaymentDraft({ ...emptySplitPaymentDraft });
      setRmaCreditId(''); setRmaCreditAmount('');
      setDeliveryType('balcao');
      setSearch('');
      setVisibleProductCount(PRODUCT_PAGE_SIZE);
      setSelectionNotice(null);
      setLastAddedId(null);
      let printFailed = false;
      if (shouldPrint) {
        try {
          if (!directReceiptEnabled?.() && (!printWindow || printWindow.closed)) throw new Error('Permita pop-ups no navegador e reimprima pelo Histórico.');
          await printSale(confirmedSale, 'receipt', {
            ...receiptDetails,
            customer: customers.find(c => c.id === confirmedSale.customer_id),
            salespersonName: salespeople.find(person => person.id === confirmedSale.salesperson_id)?.name,
          }, printWindow ?? undefined);
        } catch (error) {
          printFailed = true;
          printWindow?.close();
          setCheckoutError('Venda finalizada. ' + (error instanceof Error ? error.message : 'Não foi possível imprimir. Reimprima pelo Histórico.'));
        }
      }
      if (rescuedSale && !printFailed) onExitRescue?.();
    } catch (error) {
      printWindow?.close();
      setCheckoutError(pdvErrorMessage(error));
    } finally {
      checkoutInFlight.current = false;
      setIsCheckingOut(false);
    }
  }

  return (
    <>
      {rescuedSale && <div className="pdv-cash-context" role="status">
        <span>Editando pré-venda {rescuedSale.sale_number || ''}. Salve as alterações para manter o pedido em aberto ou finalize a venda.</span>
        <button type="button" className="rma-advance-btn" disabled={isCheckingOut || hasPendingSale} onClick={onExitRescue}>Voltar ao PDV</button>
      </div>}
      {cameraOpen && cameraScannerEnabled && !cartLocked && (
        <BarcodeCameraDialog onDetected={handleCameraCode} onClose={() => setCameraOpen(false)} />
      )}
      <fieldset disabled={cartLocked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="pdv-layout pdv-checkout-layout">
        <div className="pdv-left">
          <div className="pdv-search-bar">
            <Search size={18} />
            <input
  type="search"
  ref={searchInputRef}
  disabled={cartLocked}
  name="new-product-search"
  autoComplete="new-password"
  autoCorrect="off"
  autoCapitalize="none"
  spellCheck={false}
  data-lpignore="true"
  data-1p-ignore="true"
  value={search}
  onChange={(e) => setSearch(e.target.value)}
  onKeyDown={(event) => {
    if (event.key !== 'Enter' || !search.trim()) return;
    event.preventDefault();
    if (!barcodeScannerEnabled || !canChangeCart()) return;
    const code = search.trim().toLocaleLowerCase();
    const matches = filtered.filter((product) => [product.barcode, product.sku, product.id].some(value => !!value?.trim() && value.trim().toLocaleLowerCase() === code));
    if (matches.length === 1) {
      addToCart(matches[0], true);
    } else if (matches.length > 1) {
      showSelectionNotice('Este código está vinculado a mais de um produto nesta filial. Corrija o código de barras ou SKU cadastrado.');
    } else {
      showSelectionNotice('Código não encontrado. Preencha o campo Código de barras no cadastro do produto.');
    }
  }}
  placeholder="Buscar por nome, SKU ou código de barras..."
  aria-label="Buscar produto por nome, SKU ou código de barras"
/>
            {cameraScannerEnabled && (
              <button type="button" className="pdv-camera-button" aria-label="Ler código pela câmera" disabled={cartLocked} onClick={() => { if (canChangeCart()) setCameraOpen(true); }}>
                <Camera size={18} />
              </button>
            )}
          </div>

          {selectionNotice && (
            <p className="pdv-selection-notice" role="alert">{selectionNotice}</p>
          )}

          {!search.trim() && <p className="pdv-search-hint">Pesquise pelo nome, SKU ou código de barras para ver os produtos.</p>}
          <div className="pdv-product-search-results" aria-label="Resultados da pesquisa" hidden={!search.trim()}>
          <div className="pdv-product-grid">
            {filtered.length === 0 ? (
              <p className="empty-row">
                {search.trim() ? `Nenhum produto encontrado para "${search.trim()}".` : 'Nenhum produto disponível nesta filial.'}
              </p>
            ) : (
              filtered.slice(0, visibleProductCount).map((p) => {
                const outOfStock = !p.is_service && p.stock <= 0;
                const inCartQty = cart.find((i) => i.product_id === p.id)?.quantity ?? 0;
                const justAdded = lastAddedId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`pdv-product-card${justAdded ? ' added' : ''}`}
                    onClick={() => addToCart(p)}
                    disabled={outOfStock || cartLocked}
                  >
                    <strong>{p.name}</strong>
                    {p.sku && <small>SKU: {p.sku}</small>}
                    <span>{priceTable === 'premium' && p.premium_price == null ? 'Premium não configurado' : money.format(getPriceForProduct(p, priceTable))}</span>
                    {!p.is_service && (
                      <small className={`pdv-stock${outOfStock ? ' out' : ''}`}>
                        {outOfStock ? 'Sem estoque' : `${p.stock} un. em estoque`}
                      </small>
                    )}
                    {justAdded && (
                      <em className="pdv-added-tag"><Check size={12} /> Adicionado ao carrinho</em>
                    )}
                    {!justAdded && inCartQty > 0 && (
                      <em className="pdv-in-cart-tag">{inCartQty} no carrinho</em>
                    )}
                  </button>
                );
              })
            )}
          </div>
          {filtered.length > visibleProductCount && (
            <button
              type="button"
              className="module-action-btn"
              onClick={() => setVisibleProductCount((count) => count + PRODUCT_PAGE_SIZE)}
            >
              Carregar mais ({Math.min(visibleProductCount, filtered.length)} de {filtered.length})
            </button>
          )}
          </div>
        </div>
        <div className="pdv-right" role="region" aria-label="Opções da venda">
          <section ref={cartSectionRef} tabIndex={-1} className="pdv-cart-main" aria-label="Carrinho">
          <div className="pdv-cart-header">
            <h4>Carrinho · {cart.reduce((count, item) => count + item.quantity, 0)} itens</h4>
            {cart.length > 0 && (
              <button className="rma-advance-btn danger" onClick={() => updateCart([])}>
                <X size={14} /> Limpar
              </button>
            )}
          </div>

          <div className={`pdv-cart-table-wrap${cart.length >= 6 ? ' pdv-cart-table-scrollable' : ''}`}>
          <table className="rma-table pdv-cart-table">
            <thead><tr><th>Produto</th><th>Quantidade</th><th>Preço</th><th>Subtotal</th><th>Remover</th></tr></thead>
            <tbody>
            {cart.length === 0 ? (
              <tr><td colSpan={5} className="empty-row">Carrinho vazio. Toque em um produto para começar.</td></tr>
            ) : (
              cart.map((item) => (
                <tr key={item.product_id}>
                  <td data-label="Produto">
                    <strong title={item.name}>{item.name}</strong>
                  </td>
                  <td data-label="Quantidade"><div className="pdv-item-controls">
                    <button aria-label={`Diminuir quantidade de ${item.name}`} disabled={cartLocked} onClick={() => changeQty(item.product_id, -1)}>−</button>
                    <b>{item.quantity}</b>
                    <button aria-label={`Aumentar quantidade de ${item.name}`} disabled={cartLocked} onClick={() => changeQty(item.product_id, 1)}>+</button>
                  </div></td>
                  <td data-label="Preço unitário">{canEditPrice ? <SalePriceInput value={item.unit_price} name={item.name} disabled={isCheckingOut || hasPendingSale} onChange={value => updateCart(previous => previous.map(row => row.product_id === item.product_id ? { ...row, unit_price: value } : row))} /> : money.format(item.unit_price)}</td>
                  <td data-label="Subtotal">{money.format(item.unit_price * item.quantity)}</td>
                  <td><button className="pdv-remove" disabled={cartLocked} aria-label={`Remover ${item.name}`} onClick={() => removeFromCart(item.product_id)}><Trash2 size={16} /></button></td>
                </tr>
              ))
            )}
            </tbody>
          </table>
          </div>
          </section>
          <div ref={paymentSectionRef} tabIndex={-1} className="pdv-sale-scroll" role="region" aria-label="Pagamento e entrega">
          {branchChangedWithCart && cart.length > 0 && (
            <div className="pdv-restricted-checkout" role="alert">
              <LockIcon size={16} />
              <span>A filial foi alterada e o carrinho foi mantido. Confira os produtos antes de finalizar.</span>
              <button type="button" className="rma-advance-btn" onClick={() => updateCart([])}>Esvaziar carrinho</button>
            </div>
          )}
          {cartHasWrongBranch && (
            <p className="otp-error-msg" role="alert">O carrinho contém produtos de outra filial. Remova os itens incompatíveis ou esvazie o carrinho.</p>
          )}

            <>
              <div className="pdv-form">
                <div className="pdv-form-section pdv-customer-section">
                  <div className="pdv-customer-fields">
                    <label>
                      Tipo de cliente
                      <select aria-label="Tabela de preços da venda" value={clientType} onChange={event => handleClientTypeChange(event.target.value as ClientType)}>
                        <option value="varejo">Varejo</option>
                        <option value="atacado">Atacado</option>
                      </select>
                    </label>
                    <CustomerSearchPicker
                      key={`sale-${clientType}`}
                      id="pdv-customer-search"
                      customers={customers}
                      customerId={customerId}
                      clientType={clientType}
                      onSelect={handleCustomerChange}
                    />
                  </div>
                  {customerId && <small>Tabela aplicada: {priceTable === 'premium' ? 'Premium' : priceTable === 'atacado' ? 'Atacado' : 'Varejo'}</small>}
                </div>
                <div className="pdv-form-section pdv-payment-section">
                  <div className="form-row">
                    <label className="pdv-payment-method-field">
                      Forma de Pagamento
                      <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} disabled={!canCheckout}>
                        <option value="pix">PIX</option>
                        <option value="cartao">Cartão</option>
                        <option value="dinheiro">Dinheiro</option>
                        <option value="faturado">Faturado B2B</option>
                        <option value="misto">Dividido (dinheiro / PIX / cartão)</option>
                      </select>
                    </label>
                    {!activeSalespersonId && (
                      <SalespersonSearchPicker
                        id="pdv-salesperson-search"
                        salespeople={salespeople}
                        salespersonId={salespersonId}
                        onSelect={setSalespersonId}
                      />
                    )}
                  </div>
                </div>
                <div className="pdv-form-section pdv-delivery-section">
                  <label className="pdv-delivery-type-field">
                    Tipo de atendimento
                    <select aria-label="Tipo de atendimento da venda" value={deliveryType} onChange={event => setDeliveryType(event.target.value as DeliveryType)}>
                      <option value="balcao">Balcão</option>
                      <option value="entrega">Entrega</option>
                      <option value="retirada">Retirada</option>
                    </select>
                  </label>
                  {deliveryType === 'entrega' && (
                    <label title="Frete terceirizado recebido para repasse ao entregador; não compõe o faturamento.">Frete (R$)
                      <input type="number" min="0" max="99999999.99" step="0.01" inputMode="decimal" aria-label="Frete terceirizado" aria-invalid={!validSalePrice(freightAmount)} value={freightFee} onChange={event => setFreightFee(event.target.value)} />
                    </label>
                  )}
                </div>
              </div>
              {!rescuedSale && customerId && <section className="b2b-credit-summary" aria-label="Crédito de devolução na compra">
                <strong>Crédito de devolução</strong>
                <label>Saldo do cliente<select aria-label="Crédito RMA para a compra" value={rmaCreditId} disabled={cartLocked || !canCheckout} onChange={event => {
                  if (!canChangeCart()) return;
                  const selected = availableReturnCredits.find(rma => rma.id === event.target.value);
                  setRmaCreditId(event.target.value);
                  if (selected && paymentMethod === 'faturado') setPaymentMethod('pix');
                  setRmaCreditAmount(selected ? String(Math.min(chargeTotal, Number(selected.credit_amount) - Number(selected.credit_used_amount))) : '');
                }}><option value="">Não usar crédito</option>{availableReturnCredits.map(rma => <option key={rma.id} value={rma.id}>{rma.product_name} — {money.format(Number(rma.credit_amount) - Number(rma.credit_used_amount))}</option>)}</select></label>
                {!availableReturnCredits.length && <small>Nenhum crédito de devolução disponível para este cliente nesta filial.</small>}
                {rmaCreditId && <><label>Valor a usar (R$)<input aria-label="Valor do crédito RMA na compra" inputMode="decimal" value={rmaCreditAmount} disabled={cartLocked || !canCheckout} onChange={event => { if (canChangeCart()) setRmaCreditAmount(event.target.value); }} /></label>
                  <span>Saldo disponível: {money.format(returnCreditBalance)}</span><strong>Restante a pagar: {Number.isFinite(remainingCharge) ? money.format(Math.max(0, remainingCharge)) : 'Confira o valor'}</strong>
                  <small>A forma de pagamento escolhida será usada para a diferença. O crédito utilizado não entra como dinheiro no caixa.</small></>}
              </section>}
              {paymentMethod === 'misto' && <SplitPaymentFields total={rmaCreditId ? Math.max(0, remainingCharge) : chargeTotal} value={paymentDraft} onChange={setPaymentDraft} disabled={isCheckingOut || !canCheckout} />}
              {paymentMethod === 'faturado' && selectedCustomer && !credit && (
                <p role="status">Não foi possível consultar o crédito deste cliente.</p>
              )}
              {paymentMethod === 'faturado' && selectedCustomer && credit && (
                <div className="b2b-credit-summary">
                  <strong>Crédito B2B</strong>
                  <span>Limite: {money.format(Number(credit?.credit_limit ?? 0))}</span>
                  <span>Utilizado: {money.format(customerOpenCredit)}</span>
                  <span>Disponível: {money.format(Math.max(0, customerCreditAvailable))}</span>
                  <span>Esta venda: {money.format(chargeTotal)}</span>
                </div>
              )}

            </>
          </div>

          <div className="pdv-sale-footer">
              <div className="pdv-total-bar">
                <span>Total {priceTable === 'premium' ? '(Premium)' : priceTable === 'atacado' ? '(Atacado)' : '(Varejo)'}</span>
                <strong>{money.format(chargeTotal)}</strong>
              </div>

              {canCheckout ? (
                <>
                {rescuedSale && onSavePreSale && <button type="button" className="module-submit-btn pdv-save-presale-btn" onClick={() => void handleSavePreSale()} disabled={cart.length === 0 || isCheckingOut || hasPendingSale || cartHasWrongBranch}>
                  <ClipboardList size={18} /> {isSavingPreSale ? 'Salvando alterações...' : 'Salvar alterações da pré-venda'}
                </button>}
                <div className="pdv-checkout-actions">
                  {!rescuedSale && onCreatePreSale && <button type="button" className="module-cancel-btn pdv-checkout-btn pdv-save-order-btn" onClick={() => void handleSaveOrder()} disabled={cart.length === 0 || isCheckingOut || hasPendingSale || cartHasWrongBranch}>
                    <ClipboardList size={18} /> {isSavingPreSale ? 'Salvando...' : 'Salvar pedido'}
                  </button>}
                  <button className="module-submit-btn pdv-checkout-btn" onClick={() => handleCheckout(true)} disabled={cart.length === 0 || isCheckingOut || billedSaleBlocked || hasPendingSale || cartHasWrongBranch}>
                    <Printer size={18} /> {isCheckingOut ? 'Finalizando...' : 'Finalizar e imprimir'}
                  </button>
                  <button className="module-cancel-btn pdv-checkout-btn" onClick={() => handleCheckout(false)} disabled={cart.length === 0 || isCheckingOut || billedSaleBlocked || hasPendingSale || cartHasWrongBranch}>
                    <Check size={18} /> Finalizar sem imprimir
                  </button>
                </div>
                </>
              ) : (
                <div className="pdv-restricted-checkout">
                  <LockIcon size={16} />
                  <span>Finalização de venda restrita a Caixa, Gerente ou Administrador.</span>
                </div>
              )}

          {completed && (
            <div className="sent-message" role="status">
              <Check size={15} /> Venda finalizada! Pronto para uma nova venda. Cupom, etiqueta e envio no Histórico.
            </div>
          )}
          {orderSaved && !completed && (
            <div className="sent-message" role="status">
              <Check size={15} /> Pedido salvo em Pedidos em aberto, sem baixa de estoque.
            </div>
          )}
          {checkoutError && <p className="otp-error-msg" role="alert">{checkoutError}</p>}
          </div>
        </div>
      </div>

      {isActive && !cameraOpen && <nav className="pdv-mobile-actions" aria-label="Atalhos da venda">
        <button type="button" disabled={cartLocked} onClick={() => goToSaleSection(searchInputRef.current)}><Search size={19}/><span>Buscar</span></button>
        {cameraScannerEnabled && <button type="button" disabled={cartLocked} onClick={() => { if (canChangeCart()) setCameraOpen(true); }}><Camera size={19}/><span>Câmera</span></button>}
        <button type="button" onClick={() => goToSaleSection(cartSectionRef.current)}><ShoppingCart size={19}/><span>Carrinho · {cart.reduce((count, item) => count + item.quantity, 0)}</span></button>
        <button type="button" className="pdv-mobile-review" disabled={!cart.length || cartLocked} onClick={() => goToSaleSection(paymentSectionRef.current)}><strong>{money.format(chargeTotal)}</strong><span>Revisar venda</span></button>
      </nav>}
      </fieldset>
    </>
  );
}
