import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
const require = createRequire(import.meta.url);
async function load(path, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Response, Request, AbortSignal, Intl, Uint8Array, btoa, require: name => imports[name] ?? require(name) });
  return exports;
}
const { orderEmailHandler } = await load('../functions/_shared/order-email.ts');
const { buildEmailQuotePdf } = await load('../functions/_shared/order-quote-pdf.ts', { 'npm:jspdf@4.2.1': require('jspdf') });
const id = '12345678-1234-1234-1234-123456789abc';
const payload = { customer: { name: 'Cliente sintetico', email: 'cliente@example.com' }, company_name: 'Loja A', branch_name: 'Centro',
  sale: { id, sale_number: 12, status: 'pre_venda', created_at: '2026-11-08', total: 100, freight_fee: 10,
    items: [{ name: 'Produto', quantity: 2, unit_price: 50 }] } };
const request = (body = { saleId: id }, token = true, origin = 'https://distrihub.com.br') => new Request('https://example.com', {
  method: 'POST', headers: { ...(token ? { authorization: 'Bearer synthetic' } : {}), origin }, body: JSON.stringify(body),
});
function setup(overrides = {}) {
  const sent = [], finished = [];
  const deps = { enabled: true, allowedOrigin: 'https://distrihub.com.br', from: 'orcamentos@example.com', apiKey: 'synthetic-test-only',
    authenticate: async () => true,
    prepare: async () => ({ data: { id, state: 'pending', claimed: true, payload }, error: null }),
    finish: async (...args) => { finished.push(args); return { error: null }; },
    pdf: buildEmailQuotePdf,
    fetch: async (url, options) => { sent.push({ url, options }); return Response.json({ id: 'provider-synthetic' }); }, ...overrides };
  return { handler: orderEmailHandler(deps), sent, finished };
}
test('server renders a real PDF and sends only the canonical recipient with a stable idempotency key', async () => {
  const { handler, sent, finished } = setup();
  const response = await handler(request());
  assert.equal((await response.json()).state, 'accepted');
  const message = JSON.parse(sent[0].options.body);
  assert.deepEqual(message.to, ['cliente@example.com']);
  assert.equal(sent[0].options.headers['Idempotency-Key'], `order-quote/${id}`);
  assert.ok(Buffer.from(message.attachments[0].content, 'base64').toString().startsWith('%PDF-'));
  assert.deepEqual(finished, [[id, 'accepted', 'provider-synthetic']]);
});
test('disabled configuration, missing/invalid identity and foreign origins cannot send', async () => {
  for (const [overrides, req, status] of [
    [{ enabled: false }, request(), 503], [{ apiKey: '' }, request(), 503], [{}, request({}, false), 401],
    [{ authenticate: async () => false }, request(), 401], [{}, request({}, true, 'https://foreign.example'), 403],
  ]) {
    const { handler, sent } = setup(overrides);
    assert.equal((await handler(req)).status, status); assert.equal(sent.length, 0);
  }
});
test('browser cannot override recipient, PDF or company; failed authorization never reaches the provider', async () => {
  for (const body of [{ saleId: id, to: 'other@example.com' }, { saleId: id, pdf: 'fake' }, { saleId: id, companyId: id }, { saleId: 'invalid' }]) {
    const { handler, sent } = setup(); assert.equal((await handler(request(body))).status, 400); assert.equal(sent.length, 0);
  }
  const { handler, sent } = setup({ prepare: async () => ({ data: null, error: 'denied' }) });
  assert.equal((await handler(request())).status, 403); assert.equal(sent.length, 0);
});
test('duplicate, pending and unknown reservations never trigger another provider call', async () => {
  for (const state of ['accepted', 'pending', 'unknown', 'failed']) {
    const { handler, sent } = setup({ prepare: async () => ({ data: { id, state, claimed: false }, error: null }) });
    const result = await (await handler(request())).json();
    assert.equal(result.state, state); assert.equal(result.duplicate, true); assert.equal(sent.length, 0);
  }
});
test('timeout and server errors remain unknown without retries; explicit rejection is a failure', async () => {
  for (const [fetch, expected] of [
    [async () => { throw new Error('timeout with possible acceptance'); }, 'unknown'],
    [async () => new Response('', { status: 500 }), 'unknown'],
    [async () => new Response('', { status: 429 }), 'failed'],
    [async () => Response.json({ unexpected: true }), 'unknown'],
  ]) {
    let calls = 0;
    const { handler, finished } = setup({ fetch: async (...args) => { calls++; return fetch(...args); } });
    assert.equal((await (await handler(request())).json()).state, expected);
    assert.equal(calls, 1); assert.equal(finished[0][1], expected);
  }
});
test('failure to persist an accepted result never claims delivery or retries', async () => {
  const { handler, sent } = setup({ finish: async () => ({ error: 'database unavailable' }) });
  assert.equal((await (await handler(request())).json()).state, 'unknown'); assert.equal(sent.length, 1);
});
