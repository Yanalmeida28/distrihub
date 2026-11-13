import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Request, Response, URL, AbortSignal, btoa, Error, Date, require: name => imports[name] });
  return exports;
}
const common = load('../functions/_shared/focus-nfce.ts');
const { nfeAccounts, buildFocusNfe } = load('../functions/_shared/focus-nfe.ts', { './focus-nfce.ts': common });
const company = '00000000-0000-0000-0000-000000000001', branch = '00000000-0000-0000-0000-000000000002';
const sale = '00000000-0000-0000-0000-000000000003', product = '00000000-0000-0000-0000-000000000004';
const customer = '00000000-0000-0000-0000-000000000005';
const account = { company_id: company, branch_id: branch, cnpj: '11222333000181', uf: 'AM', token: 'synthetic1234567890',
  nfe_enabled: true, issuer_regime: '1', products: { [product]: { origin: '0', unit: 'UN', pis_cst: '07', cofins_cst: '07' } },
  customer_policies: { [customer]: { final_consumer: '1', ie_indicator: '9' } } };
const snapshot = () => ({ company_id: company, branch_id: branch, company_document: account.cnpj,
  sale: { id: sale, total: 10, items: [{ product_id: product, name: 'Produto sintético', quantity: 1, unit_price: 10 }],
    payment_method: 'pix', delivery_type: 'balcao', customer_type: 'atacado', freight_fee: 0 },
  products: [{ id: product, user_id: company, branch_id: branch, ncm: '84713012', cfop: '5102', cst_csosn: '102', is_service: false, icms_rate: 0, pis_rate: 0, cofins_rate: 0 }],
  customer: { id: customer, user_id: company, branch_id: branch, document: '52998224725', address: 'Rua de teste', address_number: '1', neighborhood: 'Bairro de teste', city: 'Manaus', state: 'AM', zip_code: '69000000' } });
const reference = 'dhn' + sale.replaceAll('-', '');
const key = '13' + '2611' + account.cnpj + '55' + '001' + '000000001' + '1' + '12345678' + '0';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('Focus NF-e: sem CSC, duas filiais do mesmo emitente podem usar o segredo existente', () => {
  const first = { ...account }; delete first.token;
  const second = { ...first, branch_id: customer };
  assert.equal(nfeAccounts(JSON.stringify([first, second]), account.token).length, 2);
  assert.throws(() => common.fiscalAccounts(JSON.stringify([first]), account.token), /CSC/);
  assert.throws(() => nfeAccounts(JSON.stringify([first, { ...second, company_id: sale }]), account.token));
  assert.throws(() => nfeAccounts(JSON.stringify([{ ...account, nfe_enabled: false }])));
});

test('Focus NF-e: payload identifica destinatário e endereço sem substituir por dados fictícios', () => {
  const payload = buildFocusNfe(snapshot(), account);
  assert.equal(payload.tipo_documento, '1'); assert.equal(payload.finalidade_emissao, '1');
  assert.equal(payload.cpf_destinatario, '52998224725'); assert.equal(payload.logradouro_destinatario, 'Rua de teste');
  assert.equal(payload.regime_tributario_emitente, '1'); assert.match(payload.nome_destinatario, /SEM VALOR FISCAL/);
  assert.equal(payload.indicador_inscricao_estadual_destinatario, '9');
  assert.equal(payload.serie, undefined); assert.equal(payload.numero, undefined); assert.equal(payload.csc, undefined);
  const business = snapshot(); business.customer.document = '11222333000181';
  assert.equal(buildFocusNfe(business, account).cnpj_destinatario, '11222333000181');
});

test('Focus NF-e: bloqueia destinatário anônimo, documento inválido, endereço incompleto, outra filial e UF', () => {
  const changes = [s => { s.customer = null; }, s => { s.customer.document = '12345678901'; }, s => { s.customer.branch_id = company; },
    s => { s.customer.address_number = ''; }, s => { s.customer.neighborhood = ''; }, s => { s.customer.zip_code = ''; }, s => { s.customer.state = 'SP'; }];
  for (const mutate of changes) { const s = snapshot(); mutate(s); assert.throws(() => buildFocusNfe(s, account)); }
  assert.throws(() => buildFocusNfe(snapshot(), { ...account, customer_policies: {} }));
  assert.throws(() => buildFocusNfe(snapshot(), { ...account, issuer_regime: '3' }));
  assert.throws(() => buildFocusNfe(snapshot(), { ...account, customer_policies: { [customer]: { final_consumer: '0', ie_indicator: '1' } } }));
});

test('Focus NF-e: processamento assíncrono consulta a referência e não reenvia nem anuncia autorização', async () => {
  const calls = [], saved = [];
  const s = snapshot(), payload = buildFocusNfe(s, account);
  const dependencies = { enabled: true, origin: 'https://distrihub.com.br', accounts: () => [account], authenticate: async () => true,
    prepare: async () => ({ data: s, error: null }),
    claim: async () => ({ data: { id: 'job', reference, claimed: true, lease_id: 'lease', payload, state: 'pending', response: {} }, error: null }),
    finish: async (...args) => { saved.push(args); return { data: true, error: null }; },
    fetch: async (url, options) => { calls.push({ url, options }); return json({ status: 'processando_autorizacao', ref: reference }, 202); } };
  const request = () => new Request('https://local.test', { method: 'POST', headers: { authorization: 'Bearer session' }, body: JSON.stringify({ saleId: sale, branchId: branch, action: 'submit' }) });
  let handler = common.focusNfceHandler(dependencies, { model: 'nfe', build: buildFocusNfe });
  const result = await (await handler(request())).json();
  assert.equal(result.state, 'processing'); assert.equal(saved[0][2], 'processing'); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://homologacao.focusnfe.com.br/v2/nfe/${reference}`);
  calls.length = 0;
  handler = common.focusNfceHandler({ ...dependencies, fetch: async (url, options) => { calls.push({ url, options }); return calls.length === 1 ? json({ codigo: 'nao_encontrado' }, 404) : json({ status: 'processando_autorizacao' }, 202); } }, { model: 'nfe', build: buildFocusNfe });
  assert.equal((await (await handler(request())).json()).state, 'processing');
  assert.equal(calls[1].url, `https://homologacao.focusnfe.com.br/v2/nfe?ref=${reference}`);
  assert.equal(calls[1].options.method, 'POST');
});

test('Focus NF-e: chave do modelo 65 é recusada e modelo 55 de AM é aceito', () => {
  const data = { status: 'autorizado', chave_nfe: key, cnpj_emitente: account.cnpj, ref: reference };
  assert.equal(common.summarizeFocus(data, account, reference, 'nfe').chave_nfe, key);
  assert.throws(() => common.summarizeFocus(data, account, reference, 'nfce'));
});
