export type QuotePayload = {
  customer: { name: string; email: string };
  company_name: string; branch_name: string;
  sale: { id: string; sale_number?: number; created_at: string; status: string; total: number; freight_fee?: number;
    items: { name: string; quantity: number; unit_price: number }[] };
};
type Reservation = { id: string; claimed: boolean; state: string; payload?: QuotePayload };
type Result<T> = { data: T | null; error: unknown };
export type EmailDependencies = {
  enabled: boolean; allowedOrigin: string; from: string; apiKey: string;
  authenticate: (token: string) => Promise<boolean>;
  prepare: (token: string, id: string) => Promise<Result<Reservation>>;
  finish: (id: string, state: string, providerId: string | null) => Promise<Result<unknown>>;
  pdf: (payload: QuotePayload) => Promise<string>;
  fetch: typeof fetch;
};

export function orderEmailHandler(deps: EmailDependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'Vary': 'Origin', ...(origin === deps.allowedOrigin ? { 'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS' } : {}) };
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && origin !== deps.allowedOrigin) return json({ error: 'Origem não permitida.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return json({ error: 'Entre novamente para enviar.' }, 401);
    try {
      if (!await deps.authenticate(token)) return json({ error: 'Sessão inválida.' }, 401);
      if (!deps.enabled || !deps.apiKey || !/^[^\s<>]+@[^\s<>]+\.[^\s<>]+$/.test(deps.from)) {
        return json({ error: 'Envio direto ainda não configurado. Use o compartilhamento do PDF.' }, 503);
      }
      if (Number(request.headers.get('content-length')) > 1024) return json({ error: 'Requisição inválida.' }, 413);
      const raw = await request.text();
      if (raw.length > 1024) return json({ error: 'Requisição inválida.' }, 413);
      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: 'Requisição inválida.' }, 400); }
      if (!body || typeof body !== 'object' || Object.keys(body).some(key => key !== 'saleId') ||
          typeof body.saleId !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.saleId)) {
        return json({ error: 'Pedido inválido.' }, 400);
      }
      const { data: job, error } = await deps.prepare(token, body.saleId);
      if (error || !job) return json({ error: 'Confira o acesso à filial, o pedido aberto e o e-mail do cliente.' }, 403);
      if (!job.claimed) return json({ state: job.state, duplicate: true });
      let state = 'unknown'; let providerId: string | null = null;
      try {
        if (!job.payload) throw new Error('snapshot');
        const content = await deps.pdf(job.payload);
        if (!content || content.length > 4_000_000) throw new Error('attachment');
        const response = await deps.fetch('https://api.resend.com/emails', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${deps.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `order-quote/${job.id}` },
          body: JSON.stringify({ from: deps.from, to: [job.payload.customer.email],
            subject: `Orçamento ${job.payload.sale.sale_number ?? job.payload.sale.id.slice(0, 8)}`,
            text: `${job.payload.company_name} — ${job.payload.branch_name}\nOlá, ${job.payload.customer.name}. Segue seu orçamento em PDF. Aguarde a confirmação da loja. Este orçamento não comprova pagamento.`,
            attachments: [{ filename: `orcamento-${job.payload.sale.id}.pdf`, content }],
          }),
        });
        if (response.ok) {
          const result = await response.json();
          if (typeof result.id === 'string' && result.id.length <= 200) { state = 'accepted'; providerId = result.id; }
        } else if ([400,401,403,404,413,422,429].includes(response.status)) state = 'failed';
      } catch { /* Never retry a possibly accepted delivery or expose provider errors. */ }
      const saved = await deps.finish(job.id, state, providerId);
      if (saved.error) return json({ state: 'unknown' });
      return json({ state });
    } catch {
      return json({ error: 'Não foi possível confirmar o envio. Não repita automaticamente.' }, 503);
    }
  };
}
