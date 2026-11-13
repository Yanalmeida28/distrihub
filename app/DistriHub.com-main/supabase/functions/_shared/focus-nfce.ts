// Integração restrita à homologação. Não aceita URL ou ambiente enviados pelo navegador.
export const focusHomologationUrl = 'https://homologacao.focusnfe.com.br';
const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
type Result<T> = { data: T | null; error: unknown };
export type FiscalAccount = {
  company_id: string; branch_id: string; cnpj: string; uf: string; token: string;
  csc_confirmed: boolean;
  products: Record<string, {
    origin: string; unit: string; pis_cst: string; cofins_cst: string;
  }>;
};
export type FiscalSnapshot = {
  attempt?: { payload: Record<string, unknown>; state: string; response: Record<string, unknown>; reference: string } | null;
  company_id: string; branch_id: string; company_document: string;
  sale: { id: string; total: number; items: { product_id: string; name: string; quantity: number; unit_price: number }[];
    payment_method: string; payment_splits?: { method: string; amount: number }[]; freight_fee?: number;
    delivery_type: string; customer_type: string };
  products: { id: string; branch_id: string; user_id: string; ncm: string; cfop: string; cst_csosn: string;
    is_service: boolean; icms_rate: number; pis_rate: number; cofins_rate: number }[];
};
export type FiscalJob = { id: string; reference: string; claimed: boolean; lease_id?: string; payload: Record<string, unknown>;
  state: string; response: Record<string, unknown> };

function money(value: unknown, label: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (value == null || value === '' || !Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n * 100)) || Math.abs(n * 100 - Math.round(n * 100)) > 0.00001) {
    throw new Error(`${label}: informe um valor válido em centavos.`);
  }
  return Math.round(n * 100);
}

export function fiscalAccounts(raw: string, singleAccountToken = '', model: 'nfce' | 'nfe' = 'nfce'): FiscalAccount[] {
  let accounts: FiscalAccount[];
  try { accounts = JSON.parse(raw); } catch { throw new Error('Configuração de homologação inválida no servidor.'); }
  // Para a primeira empresa, o token pode ficar em um segredo separado, mais simples de cadastrar.
  const sameIssuer = Array.isArray(accounts) && accounts.length > 0 && accounts.every(a => a && a.company_id === accounts[0]?.company_id && a.cnpj === accounts[0]?.cnpj);
  if (Array.isArray(accounts) && (accounts.length === 1 || model === 'nfe' && sameIssuer) && singleAccountToken) {
    accounts = accounts.map(a => a && !a.token ? { ...a, token: singleAccountToken } : a);
  }
  if (!Array.isArray(accounts) || accounts.length === 0 || accounts.some(a => !a || !uuid.test(a.company_id) || !uuid.test(a.branch_id) ||
      !/^\d{14}$/.test(a.cnpj) || a.uf !== 'AM' || typeof a.token !== 'string' || !/^[a-z0-9]{16,256}$/i.test(a.token) ||
      (model === 'nfce' && a.csc_confirmed !== true) || !a.products || typeof a.products !== 'object' || Array.isArray(a.products)) ||
      new Set(accounts.map(a => `${a.company_id}:${a.branch_id}`)).size !== accounts.length) {
    throw new Error(model === 'nfce' ? 'Confira a empresa, filial, CNPJ, UF AM, token e confirmação do CSC no servidor.' : 'Confira empresa, filial, CNPJ, UF AM e token de homologação no servidor.');
  }
  return accounts;
}

export function buildFocusNfce(snapshot: FiscalSnapshot, account: FiscalAccount, now = new Date(), model: 'nfce' | 'nfe' = 'nfce'): Record<string, unknown> {
  if (snapshot.company_id !== account.company_id || snapshot.branch_id !== account.branch_id ||
      snapshot.company_document?.replace(/\D/g, '') !== account.cnpj) throw new Error('CNPJ ou filial não corresponde à configuração do Focus.');
  const sale = snapshot.sale;
  if ((model === 'nfce' && sale.customer_type !== 'varejo') || sale.delivery_type !== 'balcao' || Number(sale.freight_fee ?? 0) !== 0) {
    throw new Error('Esta homologação inicial aceita apenas venda de varejo no balcão, sem frete.');
  }
  if (!Array.isArray(sale.items) || !sale.items.length || sale.items.length > 500) throw new Error('Venda sem itens válidos.');
  let total = 0;
  const items = sale.items.map((item, index) => {
    const product = snapshot.products.find(p => p.id === item.product_id && p.user_id === account.company_id && p.branch_id === account.branch_id);
    const tax = account.products[item.product_id];
    // Não presume origem, unidade nem enquadramento tributário. Campos adicionais vêm da configuração revisada.
    if (!product || product.is_service || !/^\d{8}$/.test(product.ncm) || !/^5\d{3}$/.test(product.cfop) ||
        !['102', '103', '300', '400'].includes(product.cst_csosn) ||
        [product.icms_rate, product.pis_rate, product.cofins_rate].some(rate => rate == null || Number(rate) !== 0) ||
        !tax || !/^[0-8]$/.test(tax.origin) || !/^[A-Z0-9]{1,6}$/.test(tax.unit) ||
        !['04', '06', '07', '08', '09'].includes(tax.pis_cst) || !['04', '06', '07', '08', '09'].includes(tax.cofins_cst)) {
      throw new Error(`Revise a classificação fiscal do produto ${item.product_id}. Esta etapa aceita apenas os enquadramentos sem cálculo de tributos documentados no guia.`);
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 999999) throw new Error('Quantidade de produto inválida.');
    const unit = money(item.unit_price, 'Preço');
    const gross = unit * item.quantity;
    if (!Number.isSafeInteger(gross)) throw new Error('Valor do item fora do limite.');
    total += gross;
    return { numero_item: String(index + 1), codigo_produto: item.product_id, codigo_ncm: product.ncm,
      descricao: index === 0 ? 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : String(item.name).slice(0, 120),
      cfop: product.cfop, unidade_comercial: tax.unit, unidade_tributavel: tax.unit,
      quantidade_comercial: String(item.quantity), quantidade_tributavel: String(item.quantity),
      valor_unitario_comercial: (unit / 100).toFixed(2), valor_unitario_tributavel: (unit / 100).toFixed(2),
      valor_bruto: (gross / 100).toFixed(2), inclui_no_total: '1',
      icms_origem: tax.origin, icms_situacao_tributaria: product.cst_csosn,
      pis_situacao_tributaria: tax.pis_cst, cofins_situacao_tributaria: tax.cofins_cst };
  });
  if (!total || !Number.isSafeInteger(total) || total !== money(sale.total, 'Total')) throw new Error('Total da venda difere dos itens. Não foi aplicada correção automática.');
  const splits = sale.payment_splits?.length ? sale.payment_splits : [{ method: sale.payment_method, amount: sale.total }];
  let paid = 0;
  const payments = splits.map(payment => {
    // Cartões precisam de dados adicionais da operação; crédito de RMA não é convertido em dinheiro.
    if (payment.method !== 'dinheiro' && payment.method !== 'pix') throw new Error('A homologação inicial aceita apenas pagamentos em dinheiro ou Pix registrados na venda.');
    const amount = money(payment.amount, 'Pagamento');
    if (amount <= 0) throw new Error('Pagamento inválido.');
    paid += amount;
    return { forma_pagamento: payment.method === 'dinheiro' ? '01' : '17', valor_pagamento: (amount / 100).toFixed(2) };
  });
  if (paid !== total) throw new Error('Os pagamentos não correspondem ao total da venda.');
  return { cnpj_emitente: account.cnpj, data_emissao: now.toISOString(), natureza_operacao: 'VENDA AO CONSUMIDOR',
    local_destino: '1', presenca_comprador: '1', modalidade_frete: '9', indicador_inscricao_estadual_destinatario: '9',
    valor_produtos: (total / 100).toFixed(2), valor_total: (total / 100).toFixed(2), items, formas_pagamento: payments };
}

export function summarizeFocus(raw: Record<string, unknown>, account: FiscalAccount, reference: string, model: 'nfce' | 'nfe' = 'nfce') {
  const allowed = ['status', 'status_sefaz', 'mensagem_sefaz', 'numero', 'serie', 'chave_nfe', 'cnpj_emitente', 'protocolo'];
  const result: Record<string, unknown> = { environment: 'homologacao', reference };
  for (const key of allowed) if (typeof raw[key] === 'string') result[key] = String(raw[key]).slice(0, 600).split(account.token).join('[removido]');
  if (typeof raw.ref === 'string' && raw.ref !== reference) throw new Error('Referência inesperada na resposta fiscal.');
  if (raw.cnpj_emitente != null && String(raw.cnpj_emitente).replace(/\D/g, '') !== account.cnpj) throw new Error('Emitente inesperado na resposta fiscal.');
  if (raw.status === 'autorizado') {
    const key = String(raw.chave_nfe ?? '').replace(/^NFe/, '');
    if (!/^\d{44}$/.test(key) || key.slice(0, 2) !== '13' || key.slice(6, 20) !== account.cnpj || key.slice(20, 22) !== (model === 'nfe' ? '55' : '65')) {
      throw new Error('Chave fiscal não corresponde ao modelo e emitente de AM.');
    }
    result.chave_nfe = key;
  }
  for (const field of ['caminho_danfe', 'caminho_xml_nota_fiscal']) {
    const value = raw[field];
    if (typeof value !== 'string' || value.length > 2000 || /[\\?#\s]/.test(value)) continue;
    const url = new URL(value, focusHomologationUrl);
    if (url.origin === focusHomologationUrl && !url.username && !url.password && !url.href.includes(account.token)) result[field] = url.href;
  }
  return result;
}

export type FocusDependencies = {
  enabled: boolean; origin: string; accounts: () => FiscalAccount[];
  authenticate: (token: string) => Promise<boolean>;
  prepare: (token: string, saleId: string, branchId: string) => Promise<Result<FiscalSnapshot>>;
  claim: (snapshot: FiscalSnapshot, payload: Record<string, unknown>, retry: boolean) => Promise<Result<FiscalJob>>;
  finish: (id: string, lease: string, state: string, result: Record<string, unknown>) => Promise<Result<unknown>>;
  fetch: typeof fetch;
};

export function focusNfceHandler(deps: FocusDependencies, options: {
  model: 'nfe'; build: (snapshot: FiscalSnapshot, account: FiscalAccount) => Record<string, unknown>;
} | null = null) {
  const model = options?.model ?? 'nfce';
  const label = model === 'nfe' ? 'NF-e' : 'NFC-e';
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
      ...(origin === deps.origin ? { 'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS' } : {}) };
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && origin !== deps.origin) return json({ error: 'Origem não permitida.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token || !await deps.authenticate(token).catch(() => false)) return json({ error: 'Entre novamente para continuar.' }, 401);
    let job: FiscalJob | null = null;
    try {
      const raw = await request.text();
      if (raw.length > 2048) return json({ error: 'Requisição muito grande.' }, 413);
      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: 'Requisição inválida.' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['saleId', 'branchId', 'action'].includes(k)) ||
          !uuid.test(body.saleId ?? '') || !uuid.test(body.branchId ?? '') || !['status', 'submit', 'retry'].includes(body.action)) {
        return json({ error: 'Informe uma venda, filial e ação válidas.' }, 400);
      }
      const prepared = await deps.prepare(token, body.saleId, body.branchId);
      if (prepared.error || !prepared.data) return json({ error: 'Confira a permissão fiscal e a venda concluída nesta filial.' }, 403);
      if (!deps.enabled) return json({ error: `${label} de homologação ainda não ativada no servidor.` }, 503);
      const snapshot = prepared.data;
      const account = deps.accounts().find(a => a.company_id === snapshot.company_id && a.branch_id === snapshot.branch_id);
      if (!account) return json({ error: `Esta filial ainda não foi configurada para ${label} de teste.` }, 503);
      const candidate = snapshot.attempt && !(snapshot.attempt.state === 'rejected' && body.action === 'retry')
        ? snapshot.attempt.payload : options ? options.build(snapshot, account) : buildFocusNfce(snapshot, account);
      if (candidate.cnpj_emitente !== account.cnpj) throw new Error('Configuração do emitente diverge da tentativa original.');
      if (body.action === 'status') return json({ environment: 'homologacao', configured: true,
        ...(snapshot.attempt ? { state: snapshot.attempt.state, reference: snapshot.attempt.reference, result: snapshot.attempt.response } : {}),
        message: 'Configuração local pronta para enviar. A autorização ainda depende do Focus e da SEFAZ de homologação.' });
      const reservation = await deps.claim(snapshot, candidate, body.action === 'retry');
      if (reservation.error || !reservation.data) return json({ error: 'Não foi possível reservar a tentativa fiscal.' }, 409);
      job = reservation.data;
      if (!job.claimed) return json({ environment: 'homologacao', state: job.state, result: job.response, reference: job.reference });
      if (!job.lease_id || !/^[a-z0-9]+$/i.test(job.reference) || job.payload.cnpj_emitente !== account.cnpj) throw new Error('Configuração do emitente diverge da tentativa original.');
      const call = (path: string, payload?: Record<string, unknown>) => deps.fetch(`${focusHomologationUrl}/v2/${path}`, {
        method: payload ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Basic ${btoa(`${account.token}:`)}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      // Consulta primeiro, inclusive após timeout ou recarregamento. A referência nunca muda para repetir uma venda.
      let response = await call(`${model}/${job.reference}`);
      let provider = await response.json().catch(() => null) as Record<string, unknown> | null;
      const notFound = response.status === 404 && provider?.codigo === 'nao_encontrado';
      const rejected = response.ok && provider?.status === 'erro_autorizacao';
      if (notFound || (rejected && body.action === 'retry')) {
        // Atualizar a data é seguro após consulta negativa/rejeição; os valores e tributos ficam congelados no banco.
        response = await call(`${model}?ref=${job.reference}`, { ...job.payload, data_emissao: new Date().toISOString() });
        provider = await response.json().catch(() => null) as Record<string, unknown> | null;
      }
      let result: Record<string, unknown> = { environment: 'homologacao', message: 'Resultado não confirmado. Consulte a mesma venda novamente.' };
      let state = 'unknown';
      if (response.ok && provider) {
        result = summarizeFocus(provider, account, job.reference, model);
        state = provider.status === 'autorizado' ? 'authorized' : provider.status === 'erro_autorizacao' ? 'rejected' : provider.status === 'cancelado' ? 'cancelled'
          : model === 'nfe' && provider.status === 'processando_autorizacao' ? 'processing' : 'unknown';
      } else if (response.status === 401 || response.status === 403) {
        result.message = 'O Focus recusou a credencial ou a permissão da empresa. Confira o token de homologação no servidor.';
      } else if (response.status === 422 || response.status === 400) {
        // Um erro HTTP não prova que uma tentativa anterior deixou de autorizar. Conserva a referência para consulta.
        result.message = 'O Focus não confirmou a autorização. Confira empresa, CSC e classificação fiscal; consulte antes de repetir.';
      }
      const saved = await deps.finish(job.id, job.lease_id, state, result);
      if (saved.error || saved.data !== true) return json({ error: 'Resposta recebida, mas a gravação não foi confirmada. Consulte a mesma venda novamente.', environment: 'homologacao', state: 'unknown', reference: job.reference }, 503);
      return json({ environment: 'homologacao', state, result, reference: job.reference });
    } catch (error) {
      if (job?.claimed && job.lease_id) {
        await deps.finish(job.id, job.lease_id, 'unknown', { environment: 'homologacao', message: 'Resposta incerta. Consulte a mesma referência antes de repetir.' }).catch(() => null);
        return json({ error: 'Resultado fiscal incerto. Consulte a mesma venda novamente; a referência foi preservada.', environment: 'homologacao', state: 'unknown', reference: job.reference }, 503);
      }
      // Erros de configuração nunca incluem o JSON de credenciais, payload externo ou cabeçalhos.
      return json({ error: error instanceof Error ? error.message : `Não foi possível preparar a ${label}.` }, 422);
    }
  };
}
