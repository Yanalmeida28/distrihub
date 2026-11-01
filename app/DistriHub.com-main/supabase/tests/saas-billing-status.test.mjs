import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
const source = ts.transpileModule(await readFile(new URL('../functions/saas-billing-status/index.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const scheduler = 'a'.repeat(64);
function harness({ authorized = true, token = 'fictional-provider-token', webhook = 'fictional-webhook-secret', returnUrl = 'https://distrihub.com.br', providerStatus = 200, accountId = 123, unavailable = false } = {}) {
  let handler; const calls = [], reads = [];
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fictional-service-key', MERCADO_PAGO_ACCESS_TOKEN: token, MERCADO_PAGO_WEBHOOK_SECRET: webhook, SAAS_RETURN_URL: returnUrl };
  vm.runInNewContext(source, { exports: {}, Request, Response, URL, AbortSignal,
    Deno: { env: { get(key) { reads.push(key); return env[key]; } }, serve(fn) { handler = fn; } },
    require: () => ({ createClient: () => ({ rpc: async (name, args) => { assert.equal(name, 'authorize_saas_scheduler'); assert.equal(args.p_token, scheduler); return { data: authorized, error: null }; } }) }),
    fetch: async (url, options) => { calls.push(url); assert.equal(url, 'https://api.mercadopago.com/users/me'); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); if (unavailable) throw Error('sensitive upstream error'); return new Response(JSON.stringify({ id: accountId, email: 'private@example.invalid' }), { status: providerStatus }); },
  });
  return { calls, reads, run: (headers = { 'x-distrihub-scheduler': scheduler }, body = { expectedAccountId: '123' }) => handler(new Request('https://example.com/check', { method: 'POST', headers, body: JSON.stringify(body) })) };
}
test('diagnóstico privado recusa acesso antes de ler credenciais ou consultar o provedor', async () => {
  const h = harness(); assert.equal((await h.run({})).status, 401); assert.equal(h.reads.length, 0); assert.equal(h.calls.length, 0);
  const invalid = harness({ authorized: false }); assert.equal((await invalid.run()).status, 401); assert.equal(invalid.calls.length, 0); assert.ok(!invalid.reads.includes('MERCADO_PAGO_ACCESS_TOKEN'));
});
test('conferência só consulta identificação e não expõe segredos ou dados pessoais', async () => {
  const h = harness(); const response = await h.run(); const body = await response.text(); const data = JSON.parse(body);
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(data.credentialAccepted, true); assert.equal(data.accountMatches, true); assert.equal(data.checks.returnUrlValid, true); assert.equal(h.calls.length, 1); assert.doesNotMatch(body, /fictional|private@|123/);
});
test('token de outra conta não é aprovado como conta esperada', async () => {
  const h = harness({ accountId: 456 }); const data = await (await h.run()).json(); assert.equal(data.credentialAccepted, true); assert.equal(data.accountMatches, false);
});
test('segredos ausentes e retorno inválido são identificados sem criar recursos', async () => {
  const h = harness({ token: '', webhook: '', returnUrl: 'https://evil.example' }); const data = await (await h.run()).json(); assert.equal(data.checks.accessTokenConfigured, false); assert.equal(data.checks.webhookSecretConfigured, false); assert.equal(data.checks.returnUrlValid, false); assert.equal(h.calls.length, 0);
});
test('erro de autenticação ou rede não é tratado como sucesso nem vaza resposta', async () => {
  for (const options of [{ providerStatus: 401 }, { unavailable: true }]) { const h = harness(options); const body = await (await h.run()).text(); assert.equal(JSON.parse(body).credentialAccepted, false); assert.doesNotMatch(body, /private@|sensitive|fictional/); }
});
test('conta esperada inválida não consulta Mercado Pago', async () => {
  const h = harness(); assert.equal((await h.run(undefined, { expectedAccountId: '../invalid' })).status, 400); assert.equal(h.calls.length, 0);
});
