import type { ReceiptDetails } from '../../lib/salePrint';
import { checklistItems, checklistResults, checklistComplete as isChecklistComplete, checklistText, readChecklist, validChecklistResult, type Checklist } from '../../lib/serviceChecklist';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  ClipboardList,
  ImagePlus,
  Package,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';

import type {
  BusinessSegment,
  PartnerBranch,
  PartnerCustomer,
  PartnerProduct,
  ServiceOrder,
} from '../../types';

import { supabase } from '../../lib/supabase';
import { useSessionDraftState } from '../../hooks/useSessionDraft';
import { OperationAttempts, pendingPhotos, type OperationAttempt } from '../../lib/operationAttempts';
import { ServiceOrderRejected, createServiceOrder, servicePartPrice, uploadServicePhotos, type ServiceOrderPayload } from '../../lib/serviceOrders';
import { ServiceOrderDetails } from './ServiceOrderDetails';

type Props = {
  userId?: string;
  authUserId?: string;
  onChanged?: () => void;
  segment: BusinessSegment;
  branches: PartnerBranch[];
  customers: PartnerCustomer[];
  products: PartnerProduct[];
  selectedBranchId: string | null;
  printDetails?: ReceiptDetails;
  warrantyTerms?: string;
  onUpdateWarrantyTerms?: (value: string) => void;
  isActive?: boolean;
};

type DraftItem = {
  product_id: string | null;
  manual_id?: string;
  name: string;
  quantity: number;
  unit_price: number;
  stock: number;
  is_service: boolean;
};
const draftItemKey = (item: DraftItem) => item.manual_id ?? item.product_id ?? item.name;
const manualCustomerOption = '__manual__';

type Photo = {
  id: string;
  file: File;
  type: 'entry' | 'exit';
  label: string;
  preview: string;
};

const money = (value: number) =>
  value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

const inputDarkStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: '#102638',
  color: '#edf5fc',
  border: '1px solid #29465f',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
};

const labelDarkStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  color: '#edf5fc',
  fontWeight: 600,
  fontSize: 14,
};

export function ServiceOrdersModule(props: Props) {
  return <ServiceOrdersContent key={`${props.authUserId ?? props.userId}:${props.userId}:${props.selectedBranchId}`} {...props} />;
}

function ServiceOrdersContent({
  userId,
  authUserId,
  onChanged,
  segment,
  branches,
  customers,
  products,
  selectedBranchId,
  warrantyTerms,
  printDetails,
  isActive = true,
}: Props) {
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [open, setOpen] = useSessionDraftState('service-order:open', false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readVersion, setReadVersion] = useState(0);
  const [preparingPhotos, setPreparingPhotos] = useState(false);
  const readGeneration = useRef(0);
  const photoLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const saveLock = useRef(false);
  const [pendingAttempt, setPendingAttempt] = useState<OperationAttempt<ServiceOrderPayload> | null>(null);
  const [details, setDetails] = useState<ServiceOrder | null>(null);
  const [cancelRequestedId, setCancelRequestedId] = useState<string | null>(null);
  const attemptScope = (authUserId ?? userId) + ':' + userId + ':' + selectedBranchId;
  const scopeRef = useRef(attemptScope); scopeRef.current = attemptScope;

  const [customerId, setCustomerId] = useSessionDraftState('service-order:customer-id', '');
  const [manualCustomerName, setManualCustomerName] = useSessionDraftState('service-order:manual-customer-name', '');
  const [manualCustomerEmail, setManualCustomerEmail] = useSessionDraftState('service-order:manual-customer-email', '');
  const [manualCustomerAddress, setManualCustomerAddress] = useSessionDraftState('service-order:manual-customer-address', '');
  const [manualCustomerPhone, setManualCustomerPhone] = useSessionDraftState('service-order:manual-customer-phone', '');
  const [equipmentType, setEquipmentType] = useSessionDraftState('service-order:equipment-type', '');
  const [identification, setIdentification] = useSessionDraftState('service-order:identification', '');
  const [serial, setSerial] = useSessionDraftState('service-order:serial', '');
  const [accessories, setAccessories] = useSessionDraftState('service-order:accessories', '');
  const [condition, setCondition] = useSessionDraftState('service-order:condition', '');
  const [damage, setDamage] = useSessionDraftState('service-order:damage', '');
  const [notes, setNotes] = useSessionDraftState('service-order:notes', '');
  const [labor, setLabor] = useSessionDraftState('service-order:labor', '');
  const [preRepairChecklist, setPreRepairChecklist] = useSessionDraftState<Checklist>('service-order:checklist', {});
  const [customerAcknowledged, setCustomerAcknowledged] = useSessionDraftState('service-order:customer-acknowledged', false);
  const previousWarranty = useRef(warrantyTerms ?? '');
  useEffect(() => {
    const current = warrantyTerms ?? '';
    if (previousWarranty.current !== current) {
      previousWarranty.current = current;
      if (!pendingAttempt) setCustomerAcknowledged(false);
    }
  }, [warrantyTerms, pendingAttempt, setCustomerAcknowledged]);
  const presentedWarranty = pendingAttempt?.payload.warranty_terms ?? warrantyTerms ?? '';

  const [productSearch, setProductSearch] = useSessionDraftState('service-order:product-search', '');
  const [items, setItems] = useSessionDraftState<DraftItem[]>('service-order:items', []);
  const [manualName, setManualName] = useSessionDraftState('service-order:manual-name', '');
  const [manualPrice, setManualPrice] = useSessionDraftState('service-order:manual-price', '');
  const [manualQuantity, setManualQuantity] = useSessionDraftState('service-order:manual-quantity', '1');
  const [entryPhotos, setEntryPhotos] = useState<Photo[]>([]);
  const [exitPhotos, setExitPhotos] = useState<Photo[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const photos = [...entryPhotos, ...exitPhotos];
  const photosRef = useRef(photos); photosRef.current = photos;
  useEffect(() => () => { photosRef.current.forEach(photo => URL.revokeObjectURL(photo.preview)); }, []);
  useEffect(() => { if (!isActive) setDetails(null); }, [isActive]);

  const entryFileRef = useRef<HTMLInputElement>(null);
  const exitFileRef = useRef<HTMLInputElement>(null);

  const branch = branches.find(
    (item) => item.id === selectedBranchId
  );
  const branchCustomers = customers.filter(
    (customer) => !customer.branch_id || customer.branch_id === selectedBranchId
  );
  const selectedCustomer = branchCustomers.find((customer) => customer.id === customerId);
  const customerAddress = selectedCustomer
    ? [
        selectedCustomer.address,
        selectedCustomer.address_number,
        selectedCustomer.complement,
        selectedCustomer.neighborhood,
        selectedCustomer.city,
        selectedCustomer.state,
        selectedCustomer.zip_code,
      ].map((value) => value?.trim()).filter(Boolean).join(', ')
    : '';

  const availableProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();

    if (!term) return [];

    return products.filter((product) => {
      if (product.branch_id !== selectedBranchId) {
        return false;
      }

      return (
        product.name.toLowerCase().includes(term) ||
        (product.sku ?? '').toLowerCase().includes(term)
      );
    });
  }, [products, selectedBranchId, productSearch]);

  const partsTotal = items.reduce(
    (total, item) =>
      total + item.unit_price * item.quantity,
    0
  );

  const laborTotal = Number(labor) || 0;

  const total = partsTotal + laborTotal;
  const checklistLabels = checklistItems(equipmentType);
  const checklistComplete = isChecklistComplete(equipmentType, preRepairChecklist);
  function restorePayload(payload: ServiceOrderPayload) {
    setCustomerId(payload.manual_customer ? manualCustomerOption : payload.customer_id ?? '');
    setManualCustomerName(payload.manual_customer?.name ?? '');
    setManualCustomerEmail(payload.manual_customer?.email ?? '');
    setManualCustomerAddress(payload.manual_customer?.address ?? '');
    setManualCustomerPhone(payload.manual_customer?.phone ?? '');
    setEquipmentType(payload.equipment_type); setIdentification(payload.identification);
    setSerial(payload.serial); setAccessories(payload.accessories); setCondition(payload.condition); setDamage(payload.damage);
    setNotes(payload.draft_notes ?? payload.notes); setLabor(String(payload.labor_total));
    setItems(payload.items.map(item => ({ ...item, name: item.product_id ? products.find(p => p.id === item.product_id)?.name ?? 'Peça' : item.name ?? 'Peça manual', stock: products.find(p => p.id === item.product_id)?.stock ?? 0, is_service: Boolean(products.find(p => p.id === item.product_id)?.is_service) })));
    setPreRepairChecklist(readChecklist(payload.notes, payload.equipment_type, 'entrada')); setCustomerAcknowledged(true); setOpen(true);
  }
  useEffect(() => {
    let active = true;
    setPendingAttempt(null);
    if (!userId || !selectedBranchId || typeof window === 'undefined') return;
    try {
      const previous = new OperationAttempts(window.localStorage).pending<ServiceOrderPayload>(attemptScope, 'service-order');
      if (previous) {
        setPendingAttempt(previous);
        restorePayload(previous.payload);
        void pendingPhotos(attemptScope + ':' + previous.id).then(files => {
          if (!active) return;
          const photos = files.map(photo => ({ ...photo, preview: URL.createObjectURL(photo.file) }));
          setEntryPhotos(photos.filter(p => p.type === 'entry')); setExitPhotos(photos.filter(p => p.type === 'exit'));
        }).catch(() => { if (active) setSaveError('A tentativa foi preservada, mas as fotos precisam ser selecionadas novamente.'); });
      }
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : 'Não foi possível recuperar a OS pendente.'); }
    return () => { active = false; };
    // Recovery runs only when the authenticated company/branch changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptScope]);
  const possibleRecurrence = Boolean((serial.trim() || identification.trim()) && orders.some((order) => (
    (serial.trim() && order.serial_number?.trim() === serial.trim()) ||
    (identification.trim() && order.equipment_identification?.trim() === identification.trim())
  )));

  useEffect(() => {
    let active = true;
    async function loadOrders() {
      const request = ++readGeneration.current;
      if (!isActive) return;
      if (!selectedBranchId) {
        setOrders([]);
        setLoadError(null);
        setLoadingOrders(false);
        return;
      }
      if (!supabase || !userId) {
        setLoadError('Conecte-se para carregar as Ordens de Serviço.');
        return;
      }
      setLoadingOrders(true); setLoadError(null);
      try {
      let query = supabase
        .from('service_orders')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', {
          ascending: false,
        });

      query = query.eq('branch_id', selectedBranchId);

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      if (active && request === readGeneration.current) setOrders((data as ServiceOrder[]) ?? []);
      } catch (cause) {
        if (active && request === readGeneration.current) setLoadError(cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : 'Não foi possível carregar as Ordens de Serviço.');
      } finally { if (active && request === readGeneration.current) setLoadingOrders(false); }
    }

    loadOrders();
    return () => { active = false; };
  }, [userId, selectedBranchId, isActive, readVersion]);

  const filteredOrders = orders.filter((order) =>
    `${order.customer_name ?? ''} ${
      order.equipment_identification ?? ''
    } ${order.serial_number ?? ''}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  function addProduct(product: PartnerProduct) {
    if (saveLock.current || photoLock.current) return;
    setItems((current) => {
      const existing = current.find(
        (item) => item.product_id === product.id
      );

      if (existing) {
        return current.map((item) => {
          if (item.product_id !== product.id) {
            return item;
          }

          const nextQuantity = product.is_service
            ? item.quantity + 1
            : Math.min(
                item.quantity + 1,
                product.stock
              );

          return {
            ...item,
            quantity: nextQuantity,
          };
        });
      }

      if (!product.is_service && product.stock < 1) {
        return current;
      }

      return [
        ...current,
        {
          product_id: product.id,
          name: product.name,
          quantity: 1,
          unit_price: product.sale_price,
          stock: product.stock,
          is_service: product.is_service,
        },
      ];
    });
  }

  function addManualPart() {
    if (saveLock.current || photoLock.current) return;
    const price = servicePartPrice(manualPrice);
    const quantity = Number(manualQuantity);
    if (!manualName.trim() || manualName.trim().length > 200 || !Number.isFinite(price) || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      setSaveError('Informe a descrição da peça, quantidade de 1 a 999 e preço unitário válido (ex.: 150,00).');
      return;
    }
    if (items.length >= 100) { setSaveError('A OS permite até 100 itens.'); return; }
    setItems(current => [...current, { product_id: null, manual_id: crypto.randomUUID(), name: manualName.trim(), quantity, unit_price: price, stock: 0, is_service: false }]);
    setManualName(''); setManualPrice(''); setManualQuantity('1'); setSaveError(null);
  }

  function removeProduct(itemKey: string) {
    if (saveLock.current || photoLock.current) return;
    setItems((current) =>
      current.filter(
        (item) => draftItemKey(item) !== itemKey
      )
    );
  }

  function resetForm() {
    [...entryPhotos, ...exitPhotos].forEach((photo) => {
      URL.revokeObjectURL(photo.preview);
    });

    setOpen(false);
    setCustomerId('');
    setManualCustomerName('');
    setManualCustomerEmail('');
    setManualCustomerAddress('');
    setManualCustomerPhone('');
    setEquipmentType('');
    setIdentification('');
    setSerial('');
    setAccessories('');
    setCondition('');
    setDamage('');
    setNotes('');
    setLabor('');
    setPreRepairChecklist({});
    setCustomerAcknowledged(false);
    setProductSearch('');
    setItems([]);
    setManualName(''); setManualPrice(''); setManualQuantity('1');
    setEntryPhotos([]);
    setExitPhotos([]);
    setPhotoError(null);
    setSaveError(null);
  }

  async function compressPhoto(file: File): Promise<File> {
    const maxBytes = 300 * 1024;
    if (!file.type.startsWith('image/')) {
      throw new Error(`O arquivo "${file.name}" não é uma imagem válida.`);
    }

    const sourceUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = sourceUrl;
      await image.decode();
      const maxDimension = Math.max(image.width, image.height);
      const dimensions = [1600, 1400, 1200, 1000, 800, 640, 480, 360];

      for (const dimension of dimensions) {
        const scale = Math.min(1, dimension / maxDimension);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) continue;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        for (let quality = 0.82; quality >= 0.22; quality -= 0.1) {
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
          if (blob && blob.size <= maxBytes) {
            return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' });
          }
        }
      }

      throw new Error(`Não foi possível comprimir "${file.name}" para até 300 KB. Escolha uma imagem menor.`);
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  }

  async function addPhotos(files: FileList | null, type: 'entry' | 'exit') {
    if (!files || saveLock.current || photoLock.current) {
      return;
    }
    setPhotoError(null);

    const current = type === 'entry' ? entryPhotos : exitPhotos;
    const setter = type === 'entry' ? setEntryPhotos : setExitPhotos;

    const remaining = 8 - current.length;

    if (remaining <= 0) {
      return;
    }

    const selectedFiles = Array.from(files).slice(
      0,
      remaining
    );

    let compressedFiles: File[];
    photoLock.current = true; setPreparingPhotos(true);
    try {
      compressedFiles = await Promise.all(selectedFiles.map((file) => compressPhoto(file)));
    } catch (error) {
      if (mounted.current) setPhotoError(error instanceof Error ? error.message : 'Não foi possível preparar a foto para upload.');
      return;
    } finally { photoLock.current = false; if (mounted.current) setPreparingPhotos(false); }
    if (!mounted.current) return;
    const newPhotos: Photo[] = compressedFiles.map(
      (file, index) => ({
        id: pendingAttempt?.payload.photo_ids?.filter(meta => meta.type === type && !photos.some(photo => photo.id === meta.id))[index]?.id ?? crypto.randomUUID(),
        file,
        type,
        label:
          current.length === 0 && index === 0
            ? type === 'entry' ? 'Frente' : 'Saída'
            : type === 'entry' ? 'Entrada' : 'Saída',
        preview: URL.createObjectURL(file),
      })
    );

    setter((existing) => [...existing, ...newPhotos]);
  }

  async function saveOrder() {
    if (saveLock.current || photoLock.current) return;
    if (!supabase || !userId || !selectedBranchId) { setSaveError('Selecione uma filial e entre na conta.'); return; }
    if (!pendingAttempt && (!checklistComplete || !customerAcknowledged)) { setSaveError('Complete a vistoria e confirme as condições de entrada.'); return; }
    if (!equipmentType.trim() && !identification.trim() && !serial.trim()) { setSaveError('Informe o equipamento ou identificação.'); return; }
    if (!Number.isFinite(Number(labor || 0)) || Number(labor || 0) < 0) { setSaveError('Informe um valor de mão de obra válido.'); return; }
    if (customerId === manualCustomerOption && !manualCustomerName.trim()) { setSaveError('Informe o nome do cliente.'); return; }
    if (customerId === manualCustomerOption && (manualCustomerName.trim().length > 200 || manualCustomerEmail.trim().length > 320 || manualCustomerAddress.trim().length > 1000 || manualCustomerPhone.trim().length > 50)) { setSaveError('Confira os dados do cliente: nome, e-mail, endereço ou telefone excedem o limite permitido.'); return; }
    if (customerId === manualCustomerOption && manualCustomerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manualCustomerEmail.trim())) { setSaveError('Informe um e-mail válido para o cliente.'); return; }
    if (manualName.trim() || manualPrice.trim()) { setSaveError('Adicione a peça manual à lista antes de salvar a OS ou limpe seus campos.'); return; }
    if (items.length > 100 || items.some(item => !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(item.unit_price) || item.unit_price < 0 || Math.abs(item.unit_price * 100 - Math.round(item.unit_price * 100)) > 0.00001 || (!item.product_id && (!item.name.trim() || item.name.trim().length > 200 || item.quantity > 999 || item.unit_price > 9999999.99)))) { setSaveError('Confira a descrição, quantidade e preço das peças.'); return; }
    saveLock.current = true; setSaving(true); setSaveError(null);
    const currentScope = attemptScope;
    let attempts: OperationAttempts | null = null;
    let startedCreation = false;
    let wasPending = false;
    let createdAttempt = false;
    try {
      attempts = new OperationAttempts(window.localStorage);
      wasPending = !!attempts.pending(currentScope, 'service-order');
      const payload: ServiceOrderPayload = {
        branch_id: selectedBranchId, customer_id: customerId && customerId !== manualCustomerOption ? customerId : null,
        ...(customerId === manualCustomerOption ? { manual_customer: { name: manualCustomerName.trim(), email: manualCustomerEmail.trim(), address: manualCustomerAddress.trim(), phone: manualCustomerPhone.trim() } } : {}),
        segment, equipment_type: equipmentType,
        identification, serial, accessories, condition, damage,
        draft_notes: notes,
        ...(pendingAttempt ? (pendingAttempt.payload.warranty_terms !== undefined ? { warranty_terms: pendingAttempt.payload.warranty_terms } : {}) : { warranty_terms: warrantyTerms ?? '' }),
        notes: pendingAttempt?.payload.notes ?? notes.trim() + '\n\n' + checklistText(equipmentType, preRepairChecklist, 'entrada') + '\nCliente ciente das condições de entrada: sim.',
        labor_total: Math.round(Number(labor || 0) * 100) / 100,
        items: items.map(item => ({ product_id: item.product_id, quantity: item.quantity, unit_price: item.unit_price, ...(!item.product_id ? { name: item.name, manual_id: item.manual_id } : {}) })),
        photo_ids: pendingAttempt?.payload.photo_ids ?? photos.map(p => ({ id: p.id, type: p.type, label: p.label })),
      };
      const attempt = attempts.get(currentScope, 'service-order', payload);
      createdAttempt = !wasPending;
      setPendingAttempt(attempt);
      if ((attempt.payload.photo_ids?.length ?? 0) !== photos.length || attempt.payload.photo_ids?.some(meta => !photos.some(photo => photo.id === meta.id))) throw new Error('Selecione novamente as fotos pendentes para recuperar esta OS.');
      await pendingPhotos(currentScope + ':' + attempt.id, photos.map(({ id, file, type, label }) => ({ id, file, type, label })));
      startedCreation = true;
      const orderId = await createServiceOrder(supabase, attempt.id, attempt.payload);
      const { data: saved, error: readError } = await supabase.from('service_orders').select('*').eq('id', orderId).single();
      if (readError || !saved || saved.id !== orderId || saved.user_id !== userId || saved.branch_id !== selectedBranchId) throw new Error('OS criada, mas sua confirmação não pôde ser carregada. Recupere a mesma tentativa.');
      await uploadServicePhotos(supabase, userId, orderId, photos);
      attempts.confirm(currentScope, 'service-order');
      try { await pendingPhotos(currentScope + ':' + attempt.id, null); } catch { /* Saved files can be cleared on the next successful attempt. */ }
      if (mounted.current && scopeRef.current === currentScope) {
        readGeneration.current++; setLoadingOrders(false); setLoadError(null);
        setOrders(current => [saved as ServiceOrder, ...current.filter(order => order.id !== orderId)]);
        setPendingAttempt(null); resetForm(); setDetails(saved as ServiceOrder); onChanged?.();
      }
    } catch (cause) {
      const canRevise = cause instanceof ServiceOrderRejected && cause.canRevise;
      if (((!startedCreation || cause instanceof ServiceOrderRejected) && createdAttempt || canRevise) && attempts) {
        try { attempts.confirm(currentScope, 'service-order'); if (mounted.current && scopeRef.current === currentScope) { setPendingAttempt(null); if (canRevise) setCustomerAcknowledged(false); } }
        catch { /* Retain the pending identity when browser storage cannot be cleared. */ }
      }
      if (mounted.current && scopeRef.current === currentScope) setSaveError(cause instanceof Error ? cause.message : 'Não foi possível confirmar a OS. Recupere a mesma tentativa.');
    } finally { saveLock.current = false; if (mounted.current) setSaving(false); }
  }

  return (
    <section
      className="service-orders-module"
      style={{
        padding: 24,
        maxWidth: 1280,
        margin: '0 auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 22,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 26,
            }}
          >
            Ordens de Serviço
          </h1>

          <p
            style={{
              opacity: 0.7,
              margin: '6px 0',
            }}
          >
            OS multi-segmento, vistoria de entrada e
            controle de peças por filial.
          </p>
        </div>

        <button
          className="partner-primary-btn"
          disabled={!selectedBranchId}
          onClick={() => setOpen(true)}
        >
          <Plus size={18} />
          Nova OS
        </button>
      </div>

      {warrantyTerms?.trim() && (
        <details className="module-card">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Termo de Garantia de Serviços</summary>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 12 }}>{warrantyTerms}</p>
        </details>
      )}

      {!selectedBranchId && (
        <div
          className="partner-card"
          style={{
            padding: 16,
            marginBottom: 18,
          }}
        >
          Selecione uma filial para abrir uma OS e
          consumir o estoque correto.
        </div>
      )}

      {pendingAttempt && <div className="module-card"><p>Existe uma OS aguardando confirmação. Recupere esta tentativa antes de cadastrar outra.</p><button type="button" disabled={saving} onClick={() => restorePayload(pendingAttempt.payload)}>Restaurar dados enviados</button></div>}
      {loadError && <div role="alert"><p>{loadError}</p><button type="button" className="rma-advance-btn" disabled={loadingOrders} onClick={() => setReadVersion(value => value + 1)}>Tentar carregar OS novamente</button></div>}
      {loadingOrders && <p role="status">Carregando Ordens de Serviço...</p>}
      {details && <ServiceOrderDetails startCancellation={cancelRequestedId === details.id} printDetails={printDetails} warrantyTerms={warrantyTerms} order={details} customers={customers} onClose={() => { setDetails(null); setCancelRequestedId(null); }} onChanged={order => { if (!mounted.current) return; readGeneration.current++; setLoadingOrders(false); setLoadError(null); setDetails(order); setOrders(current => current.map(existing => existing.id === order.id ? order : existing)); onChanged?.(); }} />}
      {open && (
        <div
          className="partner-card service-order-form"
          style={{
            padding: 22,
            marginBottom: 24,
          }}
        >
          <fieldset disabled={saving || preparingPhotos} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div
            className="service-order-form-header"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <h2 style={{ margin: 0 }}>
                Nova Ordem de Serviço
              </h2>

              <small>
                Filial: {branch?.name ?? 'Não selecionada'}
              </small>
              <p role="note" style={{ margin: '8px 0 0', color: '#adc2d6', fontSize: 12 }}>
                Ao salvar, os dados e anexos da tentativa são preservados neste navegador até a confirmação.
              </p>
            </div>

            <button
              className="partner-icon-btn"
              disabled={saving || !!pendingAttempt}
              onClick={resetForm}
            >
              <X size={20} />
            </button>
          </div>

          <div
            className="service-order-fields"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
              gap: 16,
              marginTop: 22,
            }}
          >
            <label style={labelDarkStyle}>
              <span style={{ color: '#edf5fc' }}>Cliente</span>
              <select
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                style={{ ...inputDarkStyle, WebkitAppearance: 'none', appearance: 'none' }}
              >
                <option value="" style={{ backgroundColor: '#102638', color: '#edf5fc' }}>Sem cliente</option>
                <option value={manualCustomerOption} style={{ backgroundColor: '#102638', color: '#edf5fc' }}>Informar cliente manualmente</option>
                {branchCustomers.map((item) => (
                  <option key={item.id} value={item.id} style={{ backgroundColor: '#102638', color: '#edf5fc' }}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {customerId === manualCustomerOption && (
              <section
                aria-label="Dados do cliente manual"
                style={{ gridColumn: '1 / -1', padding: 14, borderRadius: 10, backgroundColor: '#102638', border: '1px solid #29465f' }}
              >
                <h3 style={{ margin: '0 0 12px', color: '#edf5fc', fontSize: 15 }}>Dados do cliente</h3>
                <div className="service-order-fields" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
                  <label style={labelDarkStyle}>
                    Nome *
                    <input required maxLength={200} value={manualCustomerName} onChange={event => setManualCustomerName(event.target.value)} style={inputDarkStyle} autoComplete="name" />
                  </label>
                  <label style={labelDarkStyle}>
                    E-mail
                    <input type="email" maxLength={320} value={manualCustomerEmail} onChange={event => setManualCustomerEmail(event.target.value)} style={inputDarkStyle} autoComplete="email" />
                  </label>
                  <label style={labelDarkStyle}>
                    Endereço
                    <input maxLength={1000} value={manualCustomerAddress} onChange={event => setManualCustomerAddress(event.target.value)} style={inputDarkStyle} autoComplete="street-address" />
                  </label>
                  <label style={labelDarkStyle}>
                    Telefone
                    <input type="tel" maxLength={50} value={manualCustomerPhone} onChange={event => setManualCustomerPhone(event.target.value)} style={inputDarkStyle} autoComplete="tel" />
                  </label>
                </div>
              </section>
            )}
            {selectedCustomer && (
              <section
                aria-label="Dados do cliente"
                style={{ gridColumn: '1 / -1', padding: 14, borderRadius: 10, backgroundColor: '#102638', border: '1px solid #29465f' }}
              >
                <h3 style={{ margin: '0 0 10px', color: '#edf5fc', fontSize: 15 }}>Dados do cliente</h3>
                <div className="service-order-fields" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, color: '#edf5fc', fontSize: 13 }}>
                  <p style={{ margin: 0 }}><strong>Nome:</strong> {selectedCustomer.name}</p>
                  <p style={{ margin: 0 }}><strong>E-mail:</strong> {selectedCustomer.email || 'Não informado'}</p>
                  <p style={{ margin: 0 }}><strong>Endereço:</strong> {customerAddress || 'Não informado'}</p>
                  <p style={{ margin: 0 }}><strong>Telefone:</strong> {selectedCustomer.phone || 'Não informado'}</p>
                </div>
              </section>
            )}

            <label style={labelDarkStyle}>
              <span style={{ color: '#edf5fc' }}>Tipo de equipamento</span>
              <input
                value={equipmentType}
                onChange={(event) => setEquipmentType(event.target.value)}
                placeholder="Ex.: notebook, TV, celular, eletrodoméstico..."
                style={inputDarkStyle}
                className="dark-os-input"
              />
            </label>

            <label style={labelDarkStyle}>
              <span style={{ color: '#edf5fc' }}>Identificação do Equipamento</span>
              <input
                value={identification}
                onChange={(event) => setIdentification(event.target.value)}
                placeholder="Modelo, patrimônio, placa, etiqueta..."
                style={{ ...inputDarkStyle }}
              />
            </label>

            <label style={labelDarkStyle}>
              <span style={{ color: '#edf5fc' }}>Nº de Série</span>
              <input
                value={serial}
                onChange={(event) => setSerial(event.target.value)}
                placeholder="Opcional"
                style={{ ...inputDarkStyle }}
              />
            </label>
          </div>

          <div className="service-order-section" style={{ marginTop: 24, padding: 18, borderRadius: 14, backgroundColor: '#102638', border: '1px solid #29465f' }}>
            <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8, color: '#edf5fc' }}>
              <ClipboardList size={18} />
              Laudo e Vistoria de Entrada
            </h3>

            <div
              className="service-order-fields"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))',
                gap: 16,
              }}
            >
              <label style={labelDarkStyle}>
                <span style={{ color: '#edf5fc' }}>Acessórios Deixados</span>
                <textarea
                  value={accessories}
                  onChange={(event) => setAccessories(event.target.value)}
                  rows={4}
                  placeholder="Cabos, fontes, controles, capas..."
                  style={{ ...inputDarkStyle, minHeight: 110, resize: 'vertical' }}
                />
              </label>

              <label style={labelDarkStyle}>
                <span style={{ color: '#edf5fc' }}>Estado físico</span>
                <textarea
                  value={condition}
                  onChange={(event) => setCondition(event.target.value)}
                  rows={4}
                  placeholder="Riscos, trincas, amassados, desgaste..."
                  style={{ ...inputDarkStyle, minHeight: 110, resize: 'vertical' }}
                />
              </label>

              <label style={labelDarkStyle}>
                <span style={{ color: '#edf5fc' }}>Avarias identificadas</span>
                <textarea
                  value={damage}
                  onChange={(event) => setDamage(event.target.value)}
                  rows={4}
                  placeholder="Registre o que já existia na entrada."
                  style={{ ...inputDarkStyle, minHeight: 110, resize: 'vertical' }}
                />
              </label>

              <label style={labelDarkStyle}>
                <span style={{ color: '#edf5fc' }}>Observações</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={4}
                  placeholder="Sintomas, testes, observações do cliente..."
                  style={{ ...inputDarkStyle, minHeight: 110, resize: 'vertical' }}
                />
              </label>
            </div>
          </div>

          <div className="service-order-section" style={{ marginTop: 18, padding: 18, borderRadius: 14, backgroundColor: '#102638', border: '1px solid #29465f' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: 0, color: '#edf5fc' }}>Checklist de entrada</h3>
                <small style={{ color: '#adc2d6' }}>Registre cada resultado antes do reparo. Use Com defeito para avarias ou sinais de umidade. Se não foi possível avaliar, escolha Não testado.</small>
              </div>
              <span style={{ padding: '5px 9px', borderRadius: 999, background: checklistComplete ? '#12382d' : '#102638', color: checklistComplete ? '#4ade80' : '#fbbf24', fontSize: 11, fontWeight: 700 }}>
                {checklistComplete ? 'Completo' : 'Obrigatório'}
              </span>
            </div>
            <div className="service-order-fields" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, marginTop: 14 }}>
              {checklistLabels.map(([key, label]) => (
                <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 11, border: '1px solid #29465f', borderRadius: 9, color: '#edf5fc', fontSize: 13, cursor: 'pointer' }}>
                  {label}
                  <select aria-label={`Entrada: ${label}`} style={{ ...inputDarkStyle, minWidth: 0 }} value={validChecklistResult(preRepairChecklist[key]) ? preRepairChecklist[key] : ''} onChange={(event) => { if (!saveLock.current) setPreRepairChecklist((current) => ({ ...current, [key]: event.target.value as Checklist[string] })); }}>
                    <option value="">Selecione</option>{checklistResults.map(value => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <button type="button" className="rma-advance-btn" onClick={() => { if (!saveLock.current) setPreRepairChecklist(current => Object.fromEntries(checklistLabels.map(([key]) => [key, validChecklistResult(current[key]) ? current[key] : 'Não testado']))); }}>Marcar pendentes como não testados</button>
            {possibleRecurrence && (
              <div style={{ marginTop: 12, padding: 11, borderRadius: 9, background: '#102638', border: '1px solid #29465f', color: '#fbbf24', fontSize: 12 }}>
                Possível reincidência: já existe uma OS com a mesma identificação ou número de série nesta filial. Verifique a garantia antes de prosseguir.
              </div>
            )}
            {presentedWarranty.trim() && <details style={{ marginTop: 14 }}><summary>Termo de garantia desta OS</summary><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{presentedWarranty}</p></details>}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 14, color: '#edf5fc', fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={customerAcknowledged} onChange={(event) => setCustomerAcknowledged(event.target.checked)} />
              Cliente informado e de acordo com as condições registradas, acessórios, avarias de entrada e termo de garantia apresentado.
            </label>
          </div>

          <div style={{ marginTop: 22 }}>
            {photoError && (
              <div role="alert" style={{ marginBottom: 12, padding: 11, borderRadius: 9, background: '#102638', border: '1px solid #29465f', color: '#fda4af', fontSize: 12 }}>
                {photoError}
              </div>
            )}
            <div
              className="service-order-fields"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 16,
              }}
            >
              {saveError && <div className="branch-action-error" role="alert" style={{ marginBottom: 14 }}>{saveError}</div>}
              <div
                className="service-order-section"
                style={{
                  padding: 18,
                  borderRadius: 14,
                  backgroundColor: '#102638',
                  border: '1px solid #29465f',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 12,
                  }}
                >
                  <h3 style={{ margin: 0 }}>
                    <Camera size={18} />
                    Fotos de entrada
                  </h3>
                  <small style={{ color: '#adc2d6' }}>Compressão WebP automática, até 300 KB</small>

                  <button
                    className="partner-secondary-btn"
                    onClick={() => entryFileRef.current?.click()}
                    disabled={entryPhotos.length >= 8}
                  >
                    <ImagePlus size={17} />
                    Adicionar foto
                  </button>
                </div>

                <input
                  ref={entryFileRef}
                  hidden
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => addPhotos(event.target.files, 'entry')}
                />

                {entryPhotos.length > 0 ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))',
                      gap: 10,
                    }}
                  >
                    {entryPhotos.map((photo) => (
                      <div key={photo.id}>
                        <img
                          src={photo.preview}
                          alt={photo.label}
                          style={{
                            width: '100%',
                            aspectRatio: 1,
                            objectFit: 'cover',
                            borderRadius: 10,
                          }}
                        />

                        <small>{photo.label} · ENTRADA</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    style={{
                      padding: 20,
                      border: '1px dashed #29465f',
                      borderRadius: 10,
                      opacity: 0.65,
                    }}
                  >
                    Registre frente, verso/lados e detalhes das avarias.
                  </div>
                )}
              </div>

              <div
                className="service-order-section"
                style={{
                  padding: 18,
                  borderRadius: 14,
                  backgroundColor: '#102638',
                  border: '1px solid #29465f',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 12,
                  }}
                >
                  <h3 style={{ margin: 0 }}>
                    <Package size={18} />
                    Fotos de saída
                  </h3>
                  <small style={{ color: '#adc2d6' }}>Use na conclusão da OS</small>

                  <button
                    className="partner-secondary-btn"
                    onClick={() => exitFileRef.current?.click()}
                    disabled={exitPhotos.length >= 8}
                  >
                    <ImagePlus size={17} />
                    Adicionar foto
                  </button>
                </div>

                <input
                  ref={exitFileRef}
                  hidden
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => addPhotos(event.target.files, 'exit')}
                />

                {exitPhotos.length > 0 ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))',
                      gap: 10,
                    }}
                  >
                    {exitPhotos.map((photo) => (
                      <div key={photo.id}>
                        <img
                          src={photo.preview}
                          alt={photo.label}
                          style={{
                            width: '100%',
                            aspectRatio: 1,
                            objectFit: 'cover',
                            borderRadius: 10,
                          }}
                        />

                        <small>{photo.label} · SAÍDA</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    style={{
                      padding: 20,
                      border: '1px dashed #29465f',
                      borderRadius: 10,
                      opacity: 0.65,
                    }}
                  >
                    Registre fotos finais, entrega e item concluído.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            <h3>
              <Package size={18} />
              Peças e produtos utilizados
            </h3>

            <div
              className="service-order-parts-layout"
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'minmax(250px,1fr) 2fr',
                gap: 16,
              }}
            >
              <div>
                <label style={labelDarkStyle}>
                  <span style={{ color: '#edf5fc' }}>Buscar no estoque da filial</span>
                  <input
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="Digite o nome ou SKU da peça"
                    style={{ ...inputDarkStyle }}
                  />
                </label>

                {productSearch.trim() && availableProducts.length === 0 && (
                  <p role="status">Nenhuma peça encontrada nesta filial.</p>
                )}
                {availableProducts.length > 20 && (
                  <p role="status">Mostrando 20 resultados. Refine a pesquisa para encontrar a peça.</p>
                )}
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {availableProducts
                  .slice(0, 20)
                  .map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => {
                        addProduct(product);
                        setProductSearch('');
                      }}
                      disabled={
                        !product.is_service &&
                        product.stock < 1
                      }
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: 10,
                        marginTop: 7,
                        borderRadius: 9,
                        backgroundColor: '#102638',
                        border: '1px solid #29465f',
                        color: '#edf5fc',
                      }}
                    >
                      <b>{product.name}</b>

                      <br />

                      <small>
                        {product.sku ? `SKU: ${product.sku} · ` : ''}
                        {product.is_service
                          ? 'Serviço'
                          : `Estoque: ${product.stock}`}{' '}
                        · {money(product.sale_price)}
                      </small>
                    </button>
                  ))}
                </div>
                <section aria-label="Peça manual ou de terceiros" style={{ marginTop: 18 }}>
                  <h4>Peça manual / comprada de terceiros</h4>
                  <p>Inclua a peça e o valor cobrado no orçamento, sem movimentar o estoque da loja.</p>
                  <label style={labelDarkStyle}>Descrição da peça<input aria-label="Descrição da peça manual" maxLength={200} value={manualName} onChange={event => setManualName(event.target.value)} style={inputDarkStyle} /></label>
                  <label style={labelDarkStyle}>Quantidade<input aria-label="Quantidade da peça manual" type="number" min={1} max={999} step={1} value={manualQuantity} onChange={event => setManualQuantity(event.target.value)} style={inputDarkStyle} /></label>
                  <label style={labelDarkStyle}>Preço unitário cobrado (R$)<input aria-label="Preço da peça manual" inputMode="decimal" placeholder="Ex.: 150,00" value={manualPrice} onChange={event => setManualPrice(event.target.value)} style={inputDarkStyle} /></label>
                  <button type="button" className="partner-primary-btn" onClick={addManualPart}>Adicionar peça manual</button>
                </section>
              </div>

              <div>
                {items.length > 0 ? (
                  items.map((item) => (
                    <div
                      key={draftItemKey(item)}
                      className="service-order-item-row"
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          '1fr 80px 100px 36px',
                        gap: 8,
                        alignItems: 'center',
                        marginBottom: 8,
                      }}
                    >
                      <span>
                        {item.name}

                        <small
                          style={{
                            display: 'block',
                            opacity: 0.6,
                          }}
                        >
                          {!item.product_id ? 'Peça manual / terceiros — sem baixa de estoque' : item.is_service
                            ? 'Serviço'
                            : `Estoque: ${item.stock}`}
                        </small>
                      </span>

                      <label className="service-order-item-field"><span>Quantidade</span><input
                        aria-label={`Quantidade de ${item.name}`}
                        type="number"
                        min={1}
                        max={!item.product_id || item.is_service ? 999 : item.stock}
                        value={item.quantity}
                        onChange={(event) => {
                          const value = Number(event.target.value);

                          setItems((current) =>
                            current.map((currentItem) =>
                              draftItemKey(currentItem) === draftItemKey(item)
                                ? {
                                    ...currentItem,
                                    quantity: Math.max(
                                      1,
                                      Math.min(
                                        value,
                                        !currentItem.product_id || currentItem.is_service ? 999 : currentItem.stock
                                      )
                                    ),
                                  }
                                : currentItem
                            )
                          );
                        }}
                        style={{ ...inputDarkStyle }}
                      /></label>

                      <label className="service-order-item-field"><span>Preço unitário</span><input
                        aria-label={`Preço unitário de ${item.name}`}
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.unit_price}
                        onChange={(event) => {
                          const value = Number(event.target.value);

                          setItems((current) =>
                            current.map((currentItem) =>
                              draftItemKey(currentItem) === draftItemKey(item)
                                ? {
                                    ...currentItem,
                                    unit_price: value,
                                  }
                                : currentItem
                            )
                          );
                        }}
                        style={{ ...inputDarkStyle }}
                      /></label>

                      <button
                        className="partner-icon-btn"
                        aria-label={`Remover ${item.name}`}
                        onClick={() =>
                          removeProduct(
                            draftItemKey(item)
                          )
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div
                    style={{
                      padding: 18,
                      opacity: 0.6,
                    }}
                  >
                    Nenhuma peça adicionada.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 20,
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 14,
              alignItems: 'end',
              flexWrap: 'wrap',
            }}
          >
            <label style={labelDarkStyle}>
              <span style={{ color: '#edf5fc' }}>Mão de obra</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={labor}
                onChange={(event) => setLabor(event.target.value)}
                style={{ ...inputDarkStyle }}
              />
            </label>

            <div>
              <small>
                Peças: {money(partsTotal)}
              </small>

              <br />

              <b>Total: {money(total)}</b>
            </div>

            <button
              className="partner-primary-btn"
              disabled={saving}
              onClick={saveOrder}
            >
              {saving
                ? 'Salvando...'
                : pendingAttempt ? 'Recuperar OS e anexos' : 'Salvar'}
            </button>
          </div>
          </fieldset>
        </div>
      )}

      <div
        className="partner-card service-order-list"
        style={{
          padding: 18,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <Search size={18} />

          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquisar OS"
            style={{
              flex: 1,
              backgroundColor: '#102638',
              color: '#edf5fc',
              border: '1px solid #29465f',
              borderRadius: 10,
              padding: '10px 12px',
            }}
          />
        </div>

        {loadingOrders || loadError ? null : filteredOrders.length > 0 ? (
          filteredOrders.map((order) => (
            <div
              key={order.id}
              className="service-order-list-row"
              style={{
                padding: 14,
                borderTop:
                  '1px solid rgba(127,127,127,.15)',
                display: 'flex',
                justifyContent:
                  'space-between',
              }}
            >
              <span>
                <b>
                  OS #{order.id.slice(0, 8)}
                </b>{' '}
                ·{' '}
                {order.customer_name ||
                  'Sem cliente'}

                <br />

                <small>
                  {order.equipment_type ||
                    'Equipamento'}{' '}
                  ·{' '}
                  {order.equipment_identification ||
                    order.serial_number ||
                    'Sem identificação'}
                </small>
              </span>

              <div><b>{money(order.total)}</b><p>{order.status}</p>
                <button type="button" className="rma-advance-btn" disabled={saving || preparingPhotos} onClick={() => { if (!saveLock.current && !photoLock.current) { setCancelRequestedId(null); setDetails(order); } }}>Abrir OS</button>
                {!['cancelada', 'finalizada', 'entregue'].includes(order.status) && <button type="button" className="rma-advance-btn" disabled={saving || preparingPhotos} aria-label={`Cancelar OS #${order.id.slice(0, 8)}`} onClick={() => { if (!saveLock.current && !photoLock.current) { setCancelRequestedId(order.id); setDetails(order); } }}>Cancelar OS</button>}
              </div>
            </div>
          ))
        ) : (
          <div
            style={{
              padding: 35,
              textAlign: 'center',
              opacity: 0.6,
            }}
          >
            <p>
              Nenhuma OS encontrada.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
