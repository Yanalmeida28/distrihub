import { supabase } from './supabase';

export const directOrderEmailEnabled = import.meta.env.VITE_ORDER_EMAIL_ENABLED === 'true';

export async function sendOrderQuoteEmail(saleId: string): Promise<string> {
  if (!supabase || !directOrderEmailEnabled) throw new Error('Envio direto ainda não configurado.');
  const { data, error } = await supabase.functions.invoke('order-quote-email', { body: { saleId } });
  if (error || data?.error) throw new Error('Não foi possível confirmar o envio. Confira a configuração, o acesso à filial e o e-mail do cliente. Use o compartilhamento do PDF se necessário.');
  if (data?.state === 'accepted') return data.duplicate
    ? 'Este orçamento já foi aceito pelo serviço de e-mail. A entrega ao cliente ainda não foi confirmada.'
    : 'Orçamento com PDF aceito pelo serviço de e-mail. A entrega ao cliente ainda não foi confirmada.';
  if (data?.state === 'failed') throw new Error('O serviço recusou o envio. A tentativa foi registrada; confira a configuração antes de solicitar novo envio.');
  throw new Error('O envio está pendente ou sem confirmação. Não repita: confira o histórico no serviço de e-mail para evitar duplicidade.');
}
