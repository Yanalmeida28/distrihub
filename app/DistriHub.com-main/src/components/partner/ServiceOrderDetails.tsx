import { printServiceOrder } from '../../lib/serviceOrderPrint';
import { checklistItems, checklistResults, checklistComplete, checklistText, readChecklist, withoutExitChecklist, type Checklist } from '../../lib/serviceChecklist';
import type { ReceiptDetails } from '../../lib/salePrint';
import { useEffect, useRef, useState } from 'react';
import type { PartnerCustomer, ServiceOrder, ServiceOrderItem, ServiceOrderPhoto, ServiceOrderStatus, ServiceOrderApprovalStatus } from '../../types';
import { supabase } from '../../lib/supabase';
import { changeServicePhoto, compressServicePhoto, uploadServicePhotos } from '../../lib/serviceOrders';
import { pendingPhotos, type PendingPhoto } from '../../lib/operationAttempts';
import { money } from '../../utils';

const statuses: { value: ServiceOrderStatus; label: string }[] = [
  { value: 'aberta', label: 'Aberta' }, { value: 'em_andamento', label: 'Em andamento' },
  { value: 'aguardando_peca', label: 'Aguardando peça' }, { value: 'aguardando_cliente', label: 'Aguardando cliente' },
  { value: 'pronta', label: 'Pronta' }, { value: 'finalizada', label: 'Finalizada / entregue' }, { value: 'cancelada', label: 'Cancelada' },
];
type Props = { startCancellation?: boolean; printDetails?: ReceiptDetails; warrantyTerms?: string; order: ServiceOrder; customers: PartnerCustomer[]; onClose: () => void; onChanged: (order: ServiceOrder) => void };
export function ServiceOrderDetails(props: Props) {
  return <ServiceOrderDetailsContent key={`${props.order.user_id}:${props.order.branch_id}:${props.order.id}`} {...props} />;
}
function ServiceOrderDetailsContent({ order, customers, onClose, onChanged, printDetails, warrantyTerms, startCancellation = false }: Props) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [status, setStatus] = useState(order.status);
  const [approval, setApproval] = useState<ServiceOrderApprovalStatus>(order.approval_status ?? 'aguardando_aprovacao');
  const [technician, setTechnician] = useState(order.technician_name ?? '');
  const [reason, setReason] = useState(withoutExitChecklist(order.approval_notes));
  const [exitChecklist, setExitChecklist] = useState<Checklist>(() => readChecklist(order.approval_notes, order.equipment_type, 'saída'));
  const [customerId, setCustomerId] = useState(order.customer_id ?? '');
  const [parts, setParts] = useState<ServiceOrderItem[]>([]);
  const [photos, setPhotos] = useState<(ServiceOrderPhoto & { url?: string })[]>([]);
  const [removingPhoto, setRemovingPhoto] = useState<string | null>(null);
  const [queuedPhotos, setQueuedPhotos] = useState<PendingPhoto[]>([]);
  const [photoType, setPhotoType] = useState<'entry' | 'exit'>('exit');
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [cancellationOpen, setCancellationOpen] = useState(startCancellation);
  const [cancellationReason, setCancellationReason] = useState('');
  useEffect(() => { if (startCancellation) setCancellationOpen(true); }, [startCancellation]);
  const [loading, setLoading] = useState(true);
  const [printReady, setPrintReady] = useState(false);
  const [invoiceKnown, setInvoiceKnown] = useState(false);
  const [readVersion, setReadVersion] = useState(0);
  const lock = useRef(false);
  const terminal = ['cancelada', 'finalizada', 'entregue'].includes(order.status);
  const finalizing = status === 'finalizada';
  const mustMarkReady = finalizing && order.status !== 'pronta';
  const needsApproval = ['em_andamento', 'pronta', 'finalizada'].includes(status) && approval !== 'aprovado';
  const fileKey = 'service-order-details:' + order.user_id + ':' + order.id;
  const selectedCustomer = customers.find(customer => customer.id === customerId && (!customer.branch_id || customer.branch_id === order.branch_id));
  const showManualContact = !customerId && !order.customer_id;
  const customerAddress = selectedCustomer
    ? [selectedCustomer.address, selectedCustomer.address_number, selectedCustomer.complement, selectedCustomer.neighborhood, selectedCustomer.city, selectedCustomer.state, selectedCustomer.zip_code]
      .map(value => value?.trim()).filter(Boolean).join(', ')
    : '';
  useEffect(() => {
    let active = true;
    if (!supabase) { setLoading(false); setError('Conexão indisponível.'); return; }
    setLoading(true); setPrintReady(false); setInvoiceKnown(false); setError('');
    const client = supabase;
    void (async () => {
      try {
        const [items, media, invoice] = await Promise.all([
          client.from('service_order_items').select('*').eq('service_order_id', order.id).order('created_at'),
          client.from('service_order_photos').select('*').eq('service_order_id', order.id).order('created_at'),
          client.from('partner_invoices').select('id').eq('service_order_id', order.id).maybeSingle(),
        ]);
        if (items.error || media.error || invoice.error) throw items.error ?? media.error ?? invoice.error;
        if (active) { setInvoiceId(invoice.data?.id ?? null); setInvoiceKnown(true); }
        const images = await Promise.all(((media.data ?? []) as ServiceOrderPhoto[]).map(async photo => {
          const { data, error } = await client.storage.from('service-order-photos').createSignedUrl(photo.storage_path, 3600);
          if (error) throw error;
          return { ...photo, url: data?.signedUrl };
        }));
        if (active) { setParts((items.data ?? []) as ServiceOrderItem[]); setPhotos(images); setInvoiceId(invoice.data?.id ?? null); setPrintReady(true); }
        const pending = await pendingPhotos(fileKey);
        if (active) setQueuedPhotos(pending);
      } catch (cause) { if (active) setError(cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : 'Não foi possível carregar os detalhes e fotos.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [order.id, fileKey, readVersion]);
  async function action(work: () => Promise<void>) {
    if (lock.current || !mounted.current || loading) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (cause) { if (mounted.current) setError(cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : 'Não foi possível confirmar a operação. Tente novamente.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    await action(async () => {
      if (!supabase) throw new Error('Conexão indisponível.');
      if (!invoiceKnown) throw new Error('Confira a cobrança da OS antes de salvar. Recarregue os detalhes.');
      if (mustMarkReady) throw new Error('Salve a OS como Pronta antes de finalizar.');
      if (needsApproval) throw new Error('Selecione Aprovado em Aprovação do orçamento antes de salvar esta situação.');
      const hasExit = Object.values(exitChecklist).some(Boolean);
      if (status !== 'cancelada' && (hasExit || ['finalizada', 'entregue'].includes(status)) && !checklistComplete(order.equipment_type, exitChecklist)) throw new Error('Complete o checklist de saída. Para itens sem teste, selecione Não testado.');
      const savedReason = hasExit && status !== 'cancelada' ? [reason.trim(), checklistText(order.equipment_type, exitChecklist, 'saída')].filter(Boolean).join('\n\n') : reason;
      if (savedReason.length > 4000) throw new Error('Reduza a observação para salvar o checklist completo (limite total de 4.000 caracteres).');
      const { data, error } = await supabase.rpc('update_service_order_workflow_checked', { p_order_id: order.id, p_status: status, p_technician: technician, p_approval: approval, p_reason: savedReason, p_customer_id: customerId || null, p_clear_customer: !customerId && Boolean(order.customer_id) });
      if (error || !data) throw error ?? new Error('Situação não confirmada.');
      if (!mounted.current) return;
      if (data.id !== order.id || data.user_id !== order.user_id || data.branch_id !== order.branch_id) throw new Error('Confirmação inválida da OS. Recarregue os detalhes.');
      if (data.status !== status) throw new Error('A situação solicitada não foi confirmada. Recarregue os detalhes da OS e tente novamente.');
      onChanged(data as ServiceOrder);
      setMessage(status === 'finalizada' ? 'OS finalizada.' : 'Situação da OS salva.');
    });
  }
  async function cancelOrder(event: React.FormEvent) {
    event.preventDefault();
    if (terminal) return;
    await action(async () => {
      if (!supabase) throw new Error('Conexão indisponível.');
      const reason = cancellationReason.trim();
      if (reason.length < 5) throw new Error('Informe o motivo do cancelamento com pelo menos 5 caracteres.');
      const { data, error } = await supabase.rpc('update_service_order_workflow_checked', {
        p_order_id: order.id, p_status: 'cancelada', p_technician: order.technician_name ?? '',
        p_approval: order.approval_status ?? 'aguardando_aprovacao', p_reason: reason,
        p_customer_id: order.customer_id, p_clear_customer: false,
      });
      if (error || !data) throw error ?? new Error('Cancelamento não confirmado.');
      if (!mounted.current) return;
      if (data.id !== order.id || data.user_id !== order.user_id || data.branch_id !== order.branch_id || data.status !== 'cancelada') throw new Error('Cancelamento não confirmado. Recarregue os detalhes.');
      setStatus('cancelada'); setCancellationOpen(false); onChanged(data as ServiceOrder);
      setMessage('OS cancelada. As peças baixadas foram devolvidas ao estoque.');
    });
  }
  return <section className="module-card service-order-details" aria-label="Detalhes da ordem de serviço">
    <div className="module-header"><div><h3>OS #{order.os_number || order.id.slice(0, 8)}</h3><p>{order.equipment_type} · {order.equipment_identification || order.serial_number}</p></div><button type="button" className="rma-advance-btn" disabled={busy} onClick={onClose}>Fechar detalhes</button></div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {loading && <p role="status">Carregando detalhes da OS...</p>}
    {!terminal && !cancellationOpen && <button type="button" className="rma-advance-btn" disabled={busy || loading} onClick={() => setCancellationOpen(true)}>Cancelar OS</button>}
    {!terminal && cancellationOpen && <section aria-label="Cancelamento da OS">
      <h4>Cancelar ordem de serviço</h4>
      <p>As peças baixadas voltam ao estoque e a fatura sem recebimentos é cancelada. Se houver valores recebidos, regularize-os no Financeiro antes de cancelar.</p>
      <form className="rma-form" onSubmit={cancelOrder}>
        <label>Motivo do cancelamento<textarea aria-label="Motivo do cancelamento da OS" required minLength={5} maxLength={4000} value={cancellationReason} disabled={busy || loading} onChange={event => { if (!lock.current) setCancellationReason(event.target.value); }} /></label>
        <button type="submit" className="module-submit-btn" disabled={busy || loading}>{busy ? 'Cancelando...' : 'Confirmar cancelamento da OS'}</button>
        <button type="button" className="rma-advance-btn" disabled={busy} onClick={() => setCancellationOpen(false)}>Voltar sem cancelar</button>
      </form>
    </section>}
    {error && <button type="button" disabled={busy || loading} onClick={() => setReadVersion(value => value + 1)}>Recarregar detalhes da OS</button>}
    <button
      type="button"
      className="rma-advance-btn"
      disabled={busy || loading || !printReady}
      onClick={async () => {
        setError('');
        try {
          await printServiceOrder(order, parts, printDetails, warrantyTerms, customers.find(customer => customer.id === order.customer_id));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a impressão da OS.');
        }
      }}
    >
      Imprimir OS / PDF
    </button>
    <p>A impressão usa os dados salvos da OS. Salve as alterações antes de imprimir.</p>
    <p>Cliente: {order.customer_name || 'Não informado'} · Total: {money.format(Number(order.total))}</p>
    <section aria-label="Dados do cliente" style={{ padding: 14, borderRadius: 10, border: '1px solid rgba(127,127,127,.25)' }}>
      <h4 style={{ margin: '0 0 10px' }}>Dados do cliente</h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
        <p style={{ margin: 0 }}><strong>Nome:</strong> {selectedCustomer?.name || ((showManualContact || customerId === order.customer_id) ? order.customer_name : '') || 'Não informado'}</p>
        <p style={{ margin: 0 }}><strong>E-mail:</strong> {(showManualContact ? order.customer_email : selectedCustomer?.email) || 'Não informado'}</p>
        <p style={{ margin: 0 }}><strong>Endereço:</strong> {(showManualContact ? order.customer_address : customerAddress) || 'Não informado'}</p>
        <p style={{ margin: 0 }}><strong>Telefone:</strong> {(showManualContact ? order.customer_phone : selectedCustomer?.phone) || 'Não informado'}</p>
      </div>
    </section>
    <p style={{ whiteSpace: 'pre-wrap' }}>{order.entry_notes}</p>
    <form className="rma-form" onSubmit={save}><fieldset disabled={busy || terminal || loading || !invoiceKnown}>
      <label>Cliente<select value={customerId} disabled={Boolean(invoiceId)} onChange={e => { if (!lock.current && !invoiceId) setCustomerId(e.target.value); }}><option value="">Não informado</option>{customers.filter(c => !c.branch_id || c.branch_id === order.branch_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {invoiceId && <p>OS faturada: o cliente está vinculado à cobrança e não pode ser alterado aqui.</p>}
      <label>Responsável técnico<input maxLength={200} value={technician} onChange={e => setTechnician(e.target.value)} /></label>
      <label>Aprovação do orçamento<select value={approval} onChange={e => setApproval(e.target.value as ServiceOrderApprovalStatus)}><option value="aguardando_aprovacao">Aguardando aprovação</option><option value="aprovado">Aprovado</option><option value="reprovado">Reprovado</option></select></label>
      <label>Situação<select aria-describedby={mustMarkReady || needsApproval ? 'service-order-status-steps' : undefined} value={status} onChange={e => setStatus(e.target.value as ServiceOrderStatus)}>{statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
      {(mustMarkReady || needsApproval) && <p id="service-order-status-steps" role="status">
        {mustMarkReady
          ? 'Para finalizar, selecione Aprovado no orçamento, escolha Pronta e salve a situação. Depois selecione Finalizada / entregue, confira o checklist de saída e salve novamente.'
          : 'Selecione Aprovado em Aprovação do orçamento para salvar esta situação.'}
      </p>}
      <label>Observação / motivo<textarea required={status === 'cancelada'} minLength={status === 'cancelada' ? 5 : undefined} maxLength={4000} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <h4>Checklist de saída</h4>
      <p>Confira após o reparo e antes de entregar. Os resultados são salvos junto com a situação da OS. Avarias e sinais de umidade devem ser marcados como Com defeito.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        {checklistItems(order.equipment_type).map(([key, label]) => <label key={key}>{label}
          <select aria-label={`Saída: ${label}`} value={exitChecklist[key] || ''} onChange={event => { if (!lock.current) setExitChecklist(current => ({ ...current, [key]: event.target.value as Checklist[string] })); }}>
            <option value="">Selecione</option>{checklistResults.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>)}
      </div>
      <button type="button" onClick={() => { if (!lock.current) setExitChecklist(current => Object.fromEntries(checklistItems(order.equipment_type).map(([key]) => [key, current[key] || 'Não testado']))); }}>Marcar pendentes como não testados</button>
      {status === 'cancelada' && <p>O cancelamento devolve as peças baixadas ao estoque e cancela a fatura sem recebimentos. OS com valores recebidos exige conciliação financeira.</p>}
      <button type="submit" className="module-submit-btn">{busy ? 'Salvando...' : 'Salvar situação'}</button>
    </fieldset></form>
    {order.approval_notes?.includes('[Checklist de saída]') && <section aria-label="Vistoria de saída salva"><h4>Vistoria de saída salva</h4><p style={{ whiteSpace: 'pre-wrap' }}>{order.approval_notes}</p></section>}
    <h4>Peças e serviços</h4>{parts.map(p => <p key={p.id}>{p.product_name}{!p.product_id && ' (peça manual / terceiros)'} · {p.quantity} × {money.format(Number(p.unit_price))}</p>)}
    <h4>Fotos de entrada e saída</h4>
    <div className="service-order-photos">{photos.map(photo => <div key={photo.id}>
      <a href={photo.url} target="_blank" rel="noopener noreferrer"><img src={photo.url} alt={photo.label} loading="lazy" /><span>{['entry', 'entrada'].includes(photo.photo_type || '') ? 'Entrada' : ['exit', 'saida'].includes(photo.photo_type || '') ? 'Saída' : 'Foto'} · {photo.label}</span></a>
      <label>Trocar foto<input type="file" aria-label={`Trocar foto: ${photo.label}`} accept="image/*" disabled={busy || loading || order.status === 'cancelada'} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        void action(async () => {
          if (!supabase) throw new Error('Conexão indisponível.');
          const replacement = await compressServicePhoto(file);
          await changeServicePhoto(supabase, photo, replacement);
          if (mounted.current) { setRemovingPhoto(null); setMessage('Foto substituída.'); setReadVersion(value => value + 1); }
        });
      }} /></label>
      <button type="button" aria-label={`Remover foto: ${photo.label}`} disabled={busy || loading || order.status === 'cancelada'} onClick={() => setRemovingPhoto(photo.id)}>Remover foto</button>
      {removingPhoto === photo.id && <div role="group" aria-label={`Confirmar remoção: ${photo.label}`}>
        <p>Remover esta foto da OS?</p>
        <button type="button" disabled={busy || loading} onClick={() => void action(async () => {
          if (!supabase) throw new Error('Conexão indisponível.');
          await changeServicePhoto(supabase, photo);
          if (mounted.current) { setPhotos(current => current.filter(value => value.id !== photo.id)); setRemovingPhoto(null); setMessage('Foto removida da OS.'); setReadVersion(value => value + 1); }
        })}>Confirmar remoção</button>
        <button type="button" disabled={busy} onClick={() => setRemovingPhoto(null)}>Manter foto</button>
      </div>}
    </div>)}</div>
    <div className="rma-form inline"><label>Tipo de foto<select disabled={busy || loading} value={photoType} onChange={e => setPhotoType(e.target.value as 'entry' | 'exit')}><option value="entry">Entrada</option><option value="exit">Saída</option></select></label><label>Adicionar fotos<input type="file" accept="image/*" multiple disabled={busy || loading || order.status === 'cancelada'} onChange={e => {
      const files = Array.from(e.target.files ?? []); e.target.value = '';
      void action(async () => { const prepared = await Promise.all(files.slice(0, 8).map(async file => ({ id: crypto.randomUUID(), file: await compressServicePhoto(file), type: photoType, label: file.name }))); if (!mounted.current) return; const queued = [...queuedPhotos, ...prepared]; await pendingPhotos(fileKey, queued); if (mounted.current) setQueuedPhotos(queued); });
    }} /></label></div>
    {!!queuedPhotos.length && <section aria-label="Fotos aguardando envio"><h4>Fotos aguardando envio</h4>{queuedPhotos.map(photo => <div key={photo.id}><span>{photo.label}</span><button type="button" disabled={busy || loading} aria-label={`Retirar foto pendente: ${photo.label}`} onClick={() => void action(async () => {
      const remaining = queuedPhotos.filter(value => value.id !== photo.id);
      await pendingPhotos(fileKey, remaining.length ? remaining : null);
      if (mounted.current) setQueuedPhotos(remaining);
    })}>Retirar foto pendente</button></div>)}</section>}
    {!!queuedPhotos.length && <button type="button" className="module-submit-btn" disabled={busy || loading || order.status === 'cancelada'} onClick={() => void action(async () => {
      if (!supabase) throw new Error('Conexão indisponível.');
      await uploadServicePhotos(supabase, order.user_id, order.id, queuedPhotos);
      await pendingPhotos(fileKey, null); if (mounted.current) { setQueuedPhotos([]); setMessage('Fotos enviadas e vinculadas.'); setReadVersion(value => value + 1); }
    })}>{busy ? 'Enviando...' : `Enviar / recuperar ${queuedPhotos.length} foto(s)`}</button>}
    <h4>Cobrança da OS</h4>{invoiceId ? <p>Fatura #{invoiceId.slice(0, 8)} registrada. Os recebimentos são feitos no Financeiro.</p> : <div className="rma-form inline"><label>Vencimento<input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} disabled={busy || loading} /></label><button type="button" className="module-submit-btn" disabled={busy || loading || !invoiceKnown || !['pronta', 'finalizada'].includes(order.status)} onClick={() => void action(async () => { if (!supabase) throw new Error('Conexão indisponível.'); const { data, error } = await supabase.rpc('bill_service_order_once', { p_order_id: order.id, p_due_date: dueDate }); if (error || !data) throw error ?? new Error('Fatura não confirmada.'); if (!mounted.current) return; setInvoiceId(data as string); setMessage('Fatura registrada uma única vez. Abra o Financeiro para receber.'); onChanged(order); })}>Gerar fatura da OS</button></div>}
    <h4>Histórico</h4>{order.status_history?.map((entry, index) => <p key={index}>{new Date(entry.at).toLocaleString('pt-BR')} · {entry.status} · {entry.reason || 'Sem observação'}</p>)}
  </section>;
}
