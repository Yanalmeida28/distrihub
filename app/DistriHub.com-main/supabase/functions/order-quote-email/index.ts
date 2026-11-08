import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { buildEmailQuotePdf } from '../_shared/order-quote-pdf.ts';
import { orderEmailHandler } from '../_shared/order-email.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const userClient = (token: string) => createClient(url, anonKey, {
  global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false },
});


Deno.serve(orderEmailHandler({
  enabled: Deno.env.get('ORDER_EMAIL_ENABLED') === 'true',
  allowedOrigin: Deno.env.get('ORDER_EMAIL_ORIGIN') ?? 'https://distrihub.com.br',
  from: Deno.env.get('ORDER_EMAIL_FROM') ?? '', apiKey: Deno.env.get('RESEND_API_KEY') ?? '',
  authenticate: async token => { const result = await userClient(token).auth.getUser(token); return !result.error && !!result.data.user; },
  prepare: async (token, id) => await userClient(token).rpc('prepare_order_quote_email', { p_sale_id: id }),
  finish: async (id, state, providerId) => await admin.rpc('finish_order_quote_email', { p_id: id, p_state: state, p_provider_id: providerId }),
  pdf: buildEmailQuotePdf, fetch,
}));
