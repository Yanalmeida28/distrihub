import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { fiscalAccounts, focusNfceHandler } from '../_shared/focus-nfce.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const user = (token: string) => createClient(url, anon, {
  global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(focusNfceHandler({
  enabled: Deno.env.get('FOCUS_NFCE_HOMOLOGATION_ENABLED') === 'true',
  origin: Deno.env.get('FOCUS_NFCE_ORIGIN') ?? 'https://distrihub.com.br',
  accounts: () => fiscalAccounts(Deno.env.get('FOCUS_NFCE_HOMOLOGATION_ACCOUNTS') ?? '[]', Deno.env.get('FOCUS_NFCE_HOMOLOGATION_TOKEN') ?? ''),
  authenticate: async token => { const result = await user(token).auth.getUser(token); return !result.error && !!result.data.user; },
  prepare: async (token, saleId, branchId) => await user(token).rpc('prepare_focus_nfce', { p_sale_id: saleId, p_branch_id: branchId }),
  claim: async (snapshot, payload, retry) => await admin.rpc('claim_focus_nfce', {
    p_company_id: snapshot.company_id, p_branch_id: snapshot.branch_id, p_sale_id: snapshot.sale.id, p_payload: payload, p_retry: retry,
  }),
  finish: async (id, lease, state, response) => await admin.rpc('finish_focus_nfce', { p_id: id, p_lease: lease, p_state: state, p_response: response }),
  fetch,
}));
