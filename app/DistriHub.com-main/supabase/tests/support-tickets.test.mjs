import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('support tickets isolate companies, preserve retry identity and support claim, reply and resolution', async () => {
  const db = new PGlite();
  try {
    const [owner, other, admin, anotherAdmin, branch, foreignBranch, id, requestId] = Array.from({ length: 8 }, () => randomUUID());
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth; CREATE SCHEMA partner_support_private;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULLIF(current_setting('test.uid',true),'')::uuid $$;
      CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid() IN ('${admin}'::uuid,'${anotherAdmin}'::uuid) $$;
      CREATE TABLE public.partner_profiles(id uuid PRIMARY KEY,business_name text);
      CREATE TABLE public.partner_branches(id uuid PRIMARY KEY,user_id uuid,name text,is_active boolean);
      INSERT INTO public.partner_profiles VALUES ('${owner}','Empresa A'),('${other}','Empresa B');
      INSERT INTO public.partner_branches VALUES ('${branch}','${owner}','Balcão',true),('${foreignBranch}','${other}','Exterior',true);
    `);
    await db.exec(await readFile(new URL('../migrations/20261124050615_support_tickets.sql', import.meta.url), 'utf8'));
    await db.exec('SET ROLE authenticated');
    const login = user => db.query("SELECT set_config('test.uid',$1,false)", [user]);
    const call = async (asAdmin, action, input = {}) => (await db.query('SELECT public.support_ticket_workspace($1,$2,$3::jsonb) result', [asAdmin, action, JSON.stringify(input)])).rows[0].result;
    await login(owner);
    const attachment = { mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=' };
    const create = { id, branchId: branch, subject: 'Botão quebrado', area: 'Produtos e serviços', body: 'Acontece no celular.', attachment };
    await assert.rejects(call(false, 'open', { ...create, branchId: foreignBranch }), /SUPPORT_TICKET_DENIED/);
    await assert.rejects(call(false, 'open', { ...create, attachment: { mime: 'image/png', data: 'YWJj' } }), /SUPPORT_TICKET_ATTACHMENT_INVALID/);
    const ticket = await call(false, 'open', create);
    assert.equal(ticket.protocol > 0, true);
    assert.equal((await call(false, 'open', create)).protocol, ticket.protocol);
    assert.equal((await call(false, 'list')).length, 1);
    assert.equal((await call(false, 'read', { id })).attachment, null);
    assert.deepEqual((await call(false, 'read', { id, includeAttachment: true })).attachment, attachment);
    await login(other);
    assert.deepEqual(await call(false, 'list'), []);
    await assert.rejects(call(false, 'read', { id, includeAttachment: true }), /SUPPORT_TICKET_DENIED/);
    await assert.rejects(call(true, 'list'), /SUPPORT_TICKET_DENIED/);
    await login(admin);
    assert.equal((await call(true, 'list', { search: 'balcão', filter: 'open' }))[0].id, id);
    await call(true, 'claim', { id });
    await login(anotherAdmin);
    await assert.rejects(call(true, 'claim', { id }), /SUPPORT_TICKET_ASSIGNED/);
    await login(admin);
    await call(true, 'reply', { id, requestId, body: 'Pode mandar mais detalhes?' });
    await call(true, 'reply', { id, requestId, body: 'Pode mandar mais detalhes?' });
    await call(true, 'waiting', { id });
    await login(owner);
    assert.equal((await call(false, 'read', { id })).ticket.status, 'waiting');
    await call(false, 'reply', { id, requestId: randomUUID(), body: 'Tela do caixa.' });
    await login(admin);
    const thread = await call(true, 'read', { id });
    assert.equal(thread.ticket.status, 'active');
    assert.equal(thread.messages.length, 3);
    await call(true, 'resolve', { id });
    await login(owner);
    assert.equal((await call(false, 'list', { filter: 'resolved' }))[0].id, id);
    await assert.rejects(call(false, 'reply', { id, requestId: randomUUID(), body: 'Nova mensagem.' }), /SUPPORT_TICKET_DENIED/);
  } finally {
    await db.close();
  }
});
