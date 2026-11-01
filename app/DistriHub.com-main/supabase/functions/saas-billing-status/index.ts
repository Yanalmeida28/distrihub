import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

// Private diagnostic: uses the existing scheduler credential; never processes billing jobs.
Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  const schedulerToken = request.headers.get('x-distrihub-scheduler');
  if (!schedulerToken || !/^[a-f0-9]{64}$/.test(schedulerToken)) return json({ error: 'Não autorizado.' }, 401);
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authorized, error } = await admin.rpc('authorize_saas_scheduler', { p_token: schedulerToken });
    if (error || authorized !== true) return json({ error: 'Não autorizado.' }, 401);
    const body = await request.json() as { expectedAccountId?: unknown };
    if (typeof body.expectedAccountId !== 'string' || !/^\d{1,20}$/.test(body.expectedAccountId)) {
      return json({ error: 'Informe a conta esperada para a conferência.' }, 400);
    }
    const token = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN');
    const webhookSecret = Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET');
    let returnUrlValid = false;
    try {
      const url = new URL(Deno.env.get('SAAS_RETURN_URL') ?? '');
      returnUrlValid = url.origin === 'https://distrihub.com.br' && !url.username && !url.password;
    } catch { /* Report only the validation result, never the value. */ }
    const checks = { accessTokenConfigured: Boolean(token), webhookSecretConfigured: Boolean(webhookSecret), returnUrlValid };
    if (!token) return json({ checks, credentialAccepted: false, accountMatches: false });
    try {
      // Read-only provider request: no subscription/payment creation, updates or cancellations.
      const response = await fetch('https://api.mercadopago.com/users/me', {
        method: 'GET', headers: { Authorization: `Bearer ${token}` },
        redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return json({ checks, credentialAccepted: false, accountMatches: false, providerStatus: response.status });
      const account = await response.json() as { id?: unknown };
      const validAccount = typeof account.id === 'number' && Number.isSafeInteger(account.id) && account.id > 0;
      return json({ checks, credentialAccepted: validAccount, accountMatches: validAccount && String(account.id) === body.expectedAccountId });
    } catch { return json({ checks, credentialAccepted: false, accountMatches: false, providerUnavailable: true }); }
  } catch { return json({ error: 'Não foi possível conferir a configuração.' }, 503); }
});
