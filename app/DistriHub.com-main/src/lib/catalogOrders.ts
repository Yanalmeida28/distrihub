import type { SupabaseClient } from '@supabase/supabase-js';
export type CatalogOrderInput = { requestId: string; catalogSlug: string; branchId: string; cart: { id: string; quantity: number }[]; businessName: string; contact: string; deliveryAddress: string; paymentMethod: string; deliveryMethod: string };
export class CatalogOrderRejected extends Error {}
export async function saveCatalogOrder(client: SupabaseClient | null, userId: string | null, input: CatalogOrderInput): Promise<{ id: string; total: number }> {
  if (!client || !userId) throw new Error('Entre na sua conta para enviar o pedido.');
  if (!['pix', 'cartao'].includes(input.paymentMethod)) throw new Error('Forma de pagamento inválida.');
  if (!input.catalogSlug || !input.branchId || !input.cart.length || input.cart.some(item => !item.id || !Number.isInteger(item.quantity) || item.quantity <= 0)) throw new Error('Selecione um catálogo, filial e produtos válidos.');
  const { data, error } = await client.rpc('place_catalog_order', { p_request_id: input.requestId, p_slug: input.catalogSlug, p_branch_id: input.branchId, p_items: input.cart.map(item => ({ id: item.id, quantity: item.quantity })), p_business_name: input.businessName.trim(), p_contact: input.contact.trim(), p_delivery_address: input.deliveryAddress.trim(), p_payment_method: input.paymentMethod, p_delivery_method: input.deliveryMethod });
  // Only the locked server protocol can declare that this attempt did not commit.
  // Legacy P0001 errors may precede replay lookup; preserve those attempts.
  if (error) { if (error.code === 'PDC01') throw new CatalogOrderRejected(error.message); throw new Error(error.message); }
  if (!data || data.id !== input.requestId || !Number.isFinite(Number(data.total)) || Number(data.total) <= 0) throw new Error('O servidor não confirmou o pedido. Recupere a mesma tentativa.');
  return { id: data.id, total: Number(data.total) };
}
