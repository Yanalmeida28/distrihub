import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../functions/_shared/focus-nfce.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, Request, Response, URL, AbortSignal, btoa, Error, Date });
const { fiscalAccounts, buildFocusNfce, summarizeFocus, focusNfceHandler } = exports;
const company = '00000000-0000-0000-0000-000000000001', branch = '00000000-0000-0000-0000-000000000002';
const saleId = '00000000-0000-0000-0000-000000000003', productId = '00000000-0000-0000-0000-000000000004';
const account = { company_id: company, branch_id: branch, cnpj: '11222333000181', uf: 'AM', token: 'synthetic1234567890', csc_confirmed: true,
  products: { [productId]: { origin: '0', unit: 'UN', pis_cst: '07', cofins_cst: '07' } } };
const snapshot = () => ({ company_id: company, branch_id: branch, company_document: account.cnpj,
  sale: { id: saleId, total: 20.02, items: [{ product_id: productId, name: 'Produto fictício', quantity: 2, unit_price: 10.01 }],
    payment_method: 'dinheiro', delivery_type: 'balcao', customer_type: 'varejo', freight_fee: 0 },
  products: [{ id: productId, branch_id: branch, user_id: company, ncm: '84713012', cfop: '5102', cst_csosn: '102',
    is_service: false, icms_rate: 0, pis_rate: 0, cofins_rate: 0 }] });
const reference = 'dhh' + saleId.replaceAll('-', '');
const key = '13' + '2611' + account.cnpj + '65' + '001' + '000000001' + '1' + '12345678' + '0';
const authorized = { status: 'autorizado', cnpj_emitente: account.cnpj, ref: reference, chave_nfe: 'NFe' + key, numero: '1', serie: '1', caminho_danfe: '/notas/nota.html', caminho_xml_nota_fiscal: '/arquivos/nota.xml' };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const request = (action = 'submit', extra = {}, auth = true) => new Request('https://local.test', { method: 'POST',
  headers: { origin: 'https://distrihub.com.br', ...(auth ? { authorization: 'Bearer session' } : {}) },
  body: JSON.stringify({ saleId, branchId: branch, action, ...extra }) });

function setup(overrides = {}) {
  const calls = [], finishes = [], claims = [];
  const deps = { enabled: true, origin: 'https://distrihub.com.br', accounts: () => fiscalAccounts(JSON.stringify([account])),
    authenticate: async () => true, prepare: async () => ({ data: snapshot(), error: null }),
    claim: async (s, payload, retry) => { claims.push({ s, payload, retry }); return { data: { id: 'job', reference, claimed: true, lease_id: 'lease', payload, state: 'pending', response: {} }, error: null }; },
    finish: async (...args) => { finishes.push(args); return { data: true, error: null }; },
    fetch: async (url, options) => { calls.push({ url, options }); return calls.length === 1 ? response({ codigo: 'nao_encontrado' }, 404) : response(authorized, 201); }, ...overrides };
  return { handler: focusNfceHandler(deps), calls, finishes, claims };
}

test('Focus: monta valores em centavos sem presumir tributação e sem vazar token', () => {
  const payload = buildFocusNfce(snapshot(), account, new Date('2026-11-12T12:00:00Z'));
  assert.equal(payload.valor_total, '20.02');
  assert.equal(payload.items[0].valor_bruto, '20.02');
  assert.equal(payload.formas_pagamento[0].forma_pagamento, '01');
  assert.match(payload.items[0].descricao, /SEM VALOR FISCAL/);
  assert.ok(!JSON.stringify(payload).includes(account.token));
  assert.equal(payload.cpf_destinatario, undefined);
});

test('Focus: recusa token/configuração inválidos, outra empresa/filial, UF e CSC não confirmado', () => {
  for (const change of [{ token: '' }, { uf: 'SP' }, { csc_confirmed: false }, { cnpj: '123' }, { company_id: 'invalid' }]) {
    assert.throws(() => fiscalAccounts(JSON.stringify([{ ...account, ...change }])));
  }
  assert.throws(() => fiscalAccounts(JSON.stringify([account, account])));
  const single = { ...account }; delete single.token;
  assert.equal(fiscalAccounts(JSON.stringify([single]), account.token)[0].token, account.token);
  assert.throws(() => fiscalAccounts(JSON.stringify([single, { ...single, branch_id: company }]), account.token));
  assert.throws(() => buildFocusNfce({ ...snapshot(), branch_id: company }, account));
  assert.throws(() => buildFocusNfce({ ...snapshot(), company_document: '00000000000000' }, account));
});

test('Focus: bloqueia cadastro fiscal incompleto, alíquotas incompatíveis, cartão, frete e total divergente', () => {
  const changes = [s => { s.products[0].ncm = ''; }, s => { s.products[0].cfop = '6102'; }, s => { s.products[0].cst_csosn = '500'; },
    s => { s.products[0].icms_rate = 18; }, s => { s.products[0].pis_rate = null; }, s => { s.products[0].is_service = true; },
    s => { s.products[0].branch_id = company; }, s => { s.sale.total = 20; }, s => { s.sale.items[0].unit_price = 10.001; },
    s => { s.sale.items[0].quantity = 1.5; }, s => { s.sale.payment_method = 'cartao'; }, s => { s.sale.freight_fee = 5; },
    s => { s.sale.delivery_type = 'entrega'; }, s => { s.sale.payment_splits = [{ method: 'pix', amount: 20 }]; }];
  for (const mutate of changes) { const s = snapshot(); mutate(s); assert.throws(() => buildFocusNfce(s, account)); }
  assert.throws(() => buildFocusNfce(snapshot(), { ...account, products: {} }));
  const s = snapshot(); s.sale.payment_splits = [{ method: 'dinheiro', amount: 10 }, { method: 'pix', amount: 10.02 }];
  assert.equal(buildFocusNfce(s, account).formas_pagamento[1].forma_pagamento, '17');
});

test('Focus: sessão, origem, escopo, feature flag e payload inválidos não iniciam envio', async () => {
  const { handler, calls, claims } = setup();
  assert.equal((await handler(request('submit', {}, false))).status, 401);
  assert.equal((await handler(new Request('https://local.test', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }))).status, 403);
  assert.equal((await handler(request('submit', { token: 'bad', total: 1 }))).status, 400);
  assert.equal((await setup({ prepare: async () => ({ data: null, error: 'denied' }) }).handler(request())).status, 403);
  assert.equal((await setup({ enabled: false }).handler(request())).status, 503);
  assert.equal((await setup({ accounts: () => [] }).handler(request())).status, 503);
  assert.equal(calls.length, 0); assert.equal(claims.length, 0);
});

test('Focus: verificação é local e não emite nota nem cria tentativa', async () => {
  const { handler, calls, claims } = setup();
  const result = await (await handler(request('status'))).json();
  assert.equal(result.configured, true); assert.equal(result.environment, 'homologacao');
  assert.equal(calls.length, 0); assert.equal(claims.length, 0);
});

test('Focus: consulta antes de enviar, usa somente homologação e autenticação Basic', async () => {
  const { handler, calls, finishes } = setup();
  const result = await (await handler(request())).json();
  assert.equal(result.state, 'authorized'); assert.equal(result.result.chave_nfe, key);
  assert.equal(calls.length, 2); assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].url, `https://homologacao.focusnfe.com.br/v2/nfce?ref=${reference}`);
  assert.equal(calls[1].options.headers.Authorization, 'Basic ' + btoa(account.token + ':'));
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(finishes[0][2], 'authorized'); assert.ok(!JSON.stringify(result).includes(account.token));
});

test('Focus: recuperação de autorização existente não reenvia, mesmo com produto alterado', async () => {
  const s = snapshot(); s.attempt = { payload: buildFocusNfce(s, account), state: 'unknown', response: {}, reference }; s.products = [];
  const calls = [];
  const { handler } = setup({ prepare: async () => ({ data: s, error: null }), fetch: async (url, options) => { calls.push(options.method); return response(authorized); } });
  assert.equal((await (await handler(request())).json()).state, 'authorized');
  assert.deepEqual(calls, ['GET']);
});

test('Focus: reserva ocupada/final não chama o provedor', async () => {
  const { handler, calls } = setup({ claim: async () => ({ data: { claimed: false, state: 'processing', response: {}, reference }, error: null }) });
  assert.equal((await (await handler(request())).json()).state, 'processing'); assert.equal(calls.length, 0);
});

test('Focus: timeout, resposta inválida e erro HTTP conservam a referência e nunca informam autorização', async () => {
  for (const fetch of [async () => { throw new Error('timeout'); }, async () => response({ codigo: 'permissao_negada' }, 403),
    async () => new Response('invalid', { status: 200 }), async () => response({ codigo: 'nfce_em_processamento' }, 422),
    async () => response({ ...authorized, chave_nfe: '123' })]) {
    const { handler, finishes } = setup({ fetch }); const result = await (await handler(request())).json();
    assert.equal(result.state, 'unknown'); assert.equal(result.reference, reference); assert.equal(finishes.at(-1)[2], 'unknown');
  }
});

test('Focus: reenviar exige rejeição consultada e ação explícita, nunca uma referência nova', async () => {
  const rejected = { status: 'erro_autorizacao', mensagem_sefaz: 'Classificação fiscal inválida.' };
  for (const action of ['submit', 'retry']) {
    const calls = [];
    const { handler } = setup({ fetch: async (url, options) => { calls.push({ url, options }); return response(calls.length === 1 ? rejected : authorized); } });
    const result = await (await handler(request(action))).json();
    assert.equal(result.state, action === 'retry' ? 'authorized' : 'rejected'); assert.equal(calls.length, action === 'retry' ? 2 : 1);
  }
});

test('Focus: gravação não confirmada não anuncia sucesso e links recusam origens externas/credenciais', async () => {
  const { handler } = setup({ finish: async () => ({ data: false, error: null }) });
  const result = await (await handler(request())).json(); assert.equal(result.state, 'unknown'); assert.match(result.error, /gravação/);
  const clean = summarizeFocus({ ...authorized, caminho_danfe: '//evil.test/nota', caminho_xml_nota_fiscal: 'https://token@homologacao.focusnfe.com.br/nota.xml', token: account.token }, account, reference);
  assert.equal(clean.caminho_danfe, undefined); assert.equal(clean.caminho_xml_nota_fiscal, undefined); assert.equal(clean.token, undefined);
});
