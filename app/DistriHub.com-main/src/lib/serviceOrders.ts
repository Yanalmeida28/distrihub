import type { SupabaseClient } from '@supabase/supabase-js';
import type { PendingPhoto } from './operationAttempts';
import type { ServiceOrderPhoto, ServiceOrderStatus } from '../types';

export const serviceOrderStatusLabels: Record<ServiceOrderStatus, string> = {
  aberta: 'Aberta',
  em_analise: 'Em análise',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovada: 'Aprovada',
  em_andamento: 'Em andamento',
  em_reparo: 'Em reparo',
  aguardando_peca: 'Aguardando peça',
  aguardando_cliente: 'Aguardando cliente',
  pronta: 'Pronta',
  finalizada: 'Finalizada',
  entregue: 'Entregue',
  cancelada: 'Cancelada',
};

export type ServiceOrderPayload = {
  branch_id: string; customer_id: string | null; segment: string; equipment_type: string;
  manual_customer?: { name: string; email: string; address: string; phone: string };
  identification: string; serial: string; accessories: string; condition: string; damage: string;
  notes: string; labor_total: number; items: { product_id: string | null; quantity: number; unit_price: number; name?: string; manual_id?: string }[];
  photo_ids?: { id: string; type: 'entry' | 'exit'; label: string }[];
  draft_notes?: string;
  warranty_terms?: string;
};
export function servicePartPrice(value: string): number {
  const normalized = value.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  const decimal = normalized.includes(',') ? normalized.replace(/\./g, '').replace(',', '.') : normalized;
  if (!/^\d+(?:\.\d{1,2})?$/.test(decimal)) return NaN;
  const result = Number(decimal);
  return Number.isFinite(result) && result <= 9999999.99 ? result : NaN;
}
export class ServiceOrderRejected extends Error {
  constructor(message: string, readonly canRevise = false) { super(message); }
}
export async function createServiceOrder(client: SupabaseClient, requestId: string, payload: ServiceOrderPayload): Promise<string> {
  const { data, error } = await client.rpc('create_service_order_once', { p_request_id: requestId, p_payload: payload });
  if (error) { if (['P0001','22023','23514'].includes(error.code)) throw new ServiceOrderRejected(error.message, error.code === '22023'); throw new Error(error.message); }
  if (typeof data !== 'string' || data !== requestId) throw new Error('O servidor não confirmou a criação da OS. Tente recuperar a mesma operação.');
  return data;
}
export async function uploadServicePhotos(client: SupabaseClient, companyId: string, orderId: string, photos: PendingPhoto[]) {
  for (const photo of photos) {
    const path = `${companyId}/${orderId}/${photo.id}.webp`;
    const { error: uploadError } = await client.storage.from('service-order-photos').upload(path, photo.file, { upsert: true, contentType: photo.file.type });
    if (uploadError) throw new Error(`OS salva; foto "${photo.label}" ainda não foi enviada. Tente novamente. ${uploadError.message}`);
    const { data, error } = await client.rpc('save_service_order_photo', { p_order_id: orderId, p_photo_id: photo.id, p_path: path, p_type: photo.type, p_label: photo.label });
    if (error || data !== true) throw new Error(`OS salva; vínculo da foto "${photo.label}" ainda não foi confirmado. Tente novamente. ${error?.message ?? ''}`);
  }
}

export async function changeServicePhoto(client: SupabaseClient, photo: ServiceOrderPhoto, replacement?: File) {
  const path = replacement ? `${photo.user_id}/${photo.service_order_id}/${crypto.randomUUID()}.webp` : null;
  if (replacement && path) {
    const { error } = await client.storage.from('service-order-photos').upload(path, replacement, { contentType: replacement.type, upsert: false });
    if (error) throw new Error(`Não foi possível enviar a nova foto. A foto atual foi mantida. ${error.message}`);
  }
  const { data, error } = await client.rpc('manage_service_order_photo', {
    p_order_id: photo.service_order_id, p_photo_id: photo.id, p_expected_path: photo.storage_path,
    p_new_path: path, p_new_label: replacement?.name ?? null,
  });
  // Never delete a file after an uncertain response: it may still be linked.
  if (error || data !== true) throw new Error(error?.message || 'Alteração da foto não confirmada. Recarregue os detalhes da OS antes de tentar novamente.');
  try {
    const { error: cleanupError } = await client.storage.from('service-order-photos').remove([photo.storage_path]);
    return { cleanupPending: Boolean(cleanupError) };
  } catch { return { cleanupPending: true }; }
}

export async function compressServicePhoto(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('Selecione uma imagem.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    for (const dimension of [1600, 1200, 800, 480, 320]) {
      const scale = Math.min(1, dimension / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d'); if (!context) continue;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.6, 0.4, 0.22]) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (blob && blob.size <= 300 * 1024) return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
      }
    }
    throw new Error('Não foi possível preparar esta imagem. Selecione uma foto menor.');
  } finally { URL.revokeObjectURL(url); }
}
