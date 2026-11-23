import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const [company, other, branch, sibling, foreign, operator, second, denied, buyer, otherBuyer, quote, wrongBuyer, wrongBranch] = Array.from({ length: 13 }, (_, i) => id(i + 1));

test('Atendimento scopes access, assignments, history, quotes and test delivery', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE SCHEMA auth;
      CREATE SCHEMA partner_subscription_private;
      CREATE SCHEMA partner_access_private;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        'SELECT nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      CREATE TABLE partner_profiles(id uuid PRIMARY KEY);
      CREATE TABLE partner_branches(id uuid PRIMARY KEY,user_id uuid,is_active boolean DEFAULT true);
      CREATE TABLE partner_customers(id uuid PRIMARY KEY,user_id uuid,branch_id uuid,name text);
      CREATE TABLE partner_salespeople(id uuid PRIMARY KEY,user_id uuid,branch_id uuid,active boolean,blocked_modules text[],name text);
      CREATE TABLE partner_sales(id uuid PRIMARY KEY,user_id uuid,branch_id uuid,customer_id uuid,status text,total numeric);
      CREATE FUNCTION partner_subscription_private.state(uuid) RETURNS jsonb LANGUAGE sql AS
        'SELECT ''{"can_access":true,"features":["pedidos"]}''::jsonb';
      CREATE FUNCTION partner_subscription_private.require_collaborator_module(text) RETURNS void LANGUAGE plpgsql AS 'BEGIN END';
      CREATE FUNCTION partner_subscription_private.require_operator_module(feature text, staff uuid) RETURNS void LANGUAGE plpgsql AS $$
      BEGIN IF EXISTS (SELECT 1 FROM public.partner_salespeople WHERE id=staff AND feature=ANY(blocked_modules))
      THEN RAISE EXCEPTION 'MODULE_DENIED'; END IF; END $$;
      CREATE FUNCTION partner_access_private.has_branch(staff uuid,company uuid,branch uuid) RETURNS boolean LANGUAGE sql AS
        'SELECT EXISTS(SELECT 1 FROM public.partner_salespeople WHERE id=staff AND user_id=company AND branch_id=branch)';
      CREATE FUNCTION public.resolve_partner_pdv_operator(staff uuid, credential text, branch uuid)
        RETURNS TABLE(company_id uuid,salesperson_id uuid,branch_id uuid) LANGUAGE sql AS $$
          SELECT auth.uid(),null::uuid,branch WHERE staff IS NULL
          UNION ALL SELECT op.user_id,op.id,op.branch_id FROM public.partner_salespeople op
           WHERE staff=op.id AND credential='1234' AND op.active AND op.user_id=auth.uid()
        $$;
      CREATE FUNCTION public.update_partner_salesperson_access(uuid,text,text,numeric,text,text,boolean,uuid,uuid,text,text,text[])
        RETURNS text[] LANGUAGE sql AS $$ SELECT ARRAY['suporte','fiscal'] $$;
      INSERT INTO partner_profiles VALUES ('${company}'),('${other}');
      INSERT INTO partner_branches(id,user_id) VALUES ('${branch}','${company}'),('${sibling}','${company}'),('${foreign}','${other}');
      INSERT INTO partner_salespeople VALUES
        ('${operator}','${company}','${branch}',true,'{}','Primeiro'),
        ('${second}','${company}','${branch}',true,'{}','Segundo'),
        ('${denied}','${company}','${branch}',true,'{atendimento}','Bloqueado');
      INSERT INTO partner_customers VALUES
        ('${buyer}','${company}','${branch}','Cliente A'),('${otherBuyer}','${company}','${branch}','Cliente B');
      INSERT INTO partner_sales VALUES
        ('${quote}','${company}','${branch}','${buyer}','aberta',10),
        ('${wrongBuyer}','${company}','${branch}','${otherBuyer}','aberta',20),
        ('${wrongBranch}','${company}','${sibling}','${buyer}','aberta',30);
    `);
    await db.exec(await readFile(new URL('../migrations/20261123051946_atendimento_chat.sql', import.meta.url), 'utf8'));
    await db.query('INSERT INTO atendimento_private.channels(company_id,branch_id,provider,address) VALUES ($1,$2,$3,$4),($5,$6,$3,$7)',
      [company, branch, 'test', 'pilot', other, foreign, 'foreign']);
    const event = (external, kind = 'incoming', address = 'pilot') =>
      db.query('SELECT public.atendimento_test_event($1,$2,$3,$4,$5)', [address, external, '+5511999990000', 'Mensagem', kind]);
    for (let index = 0; index < 34; index++) await event(String(index));
    await event('33');
    await event('foreign-1', 'incoming', 'foreign');
    await db.exec(await readFile(new URL('../migrations/20261123152117_atendimento_recovery.sql', import.meta.url), 'utf8'));

    const authenticate = async user => {
      await db.exec('SET ROLE authenticated');
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);
    };
    await authenticate(company);
    const call = async (action, input = {}, staff = operator, targetCompany = company, targetBranch = branch) => {
      const result = await db.query('SELECT public.atendimento_workspace($1,$2,$3,$4,$5,$6::jsonb) AS result',
        [targetCompany, targetBranch, staff, staff ? '1234' : null, action, JSON.stringify(input)]);
      return result.rows[0].result;
    };
    await assert.rejects(call('list', {}, denied), /MODULE_DENIED/);
    await assert.rejects(call('list', {}, operator, company, sibling), /ATENDIMENTO_DENIED/);
    await assert.rejects(call('list', {}, null, other, foreign), /ATENDIMENTO_DENIED/);
    await assert.rejects(event('not-authorized'), /permission denied/);
    const list = await call('list');
    assert.equal(list.channel, 'test');
    assert.equal(list.rows.length, 1);
    assert.equal(list.rows[0].customer_id, null);
    assert.deepEqual(await call('list', {}, null, company, sibling), { schemaVersion: 2, channel: 'unconfigured', rows: [] });
    const conversationId = list.rows[0].id;
    const context = { conversationId };
    const [assigned, competing] = await Promise.allSettled([call('assume', context), call('assume', context, second)]);
    assert.equal(assigned.status, 'fulfilled');
    assert.equal(competing.status, 'rejected');
    assert.match(competing.reason.message, /ATENDIMENTO_ALREADY_ASSIGNED/);
    assert.equal((await call('list', { filter: 'waiting' })).rows.length, 0);
    const first = await call('history', context);
    assert.equal(first.length, 31);
    const older = await call('history', { ...context, before: first[29].position });
    assert.equal(older.length, 4);
    assert.ok(first[29].position > older[0].position);
    await assert.rejects(call('link', { ...context, targetId: buyer }), /ATENDIMENTO_CUSTOMER_DENIED/);
    await call('link', { ...context, targetId: buyer, confirmed: true });
    const details = await call('details', context);
    assert.deepEqual(details.quotes.map(item => item.id), [quote]);
    assert.deepEqual(details.operators.map(item => item.id), [second]);
    for (const targetId of [wrongBuyer, wrongBranch]) {
      await assert.rejects(call('prepare_quote', { ...context, targetId }), /ATENDIMENTO_QUOTE_DENIED/);
    }
    const prepared = await call('prepare_quote', { ...context, targetId: quote });
    assert.equal((await call('prepare_quote', { ...context, targetId: quote })).operationId, prepared.operationId);
    await db.exec('RESET ROLE');
    await db.query('UPDATE partner_sales SET total=15 WHERE id=$1', [quote]);
    for (let index = 0; index < 130; index++) await event(`offline-${index}`);
    await event('offline-129');
    await authenticate(company);
    const changed = await call('prepare_quote', { ...context, targetId: quote });
    assert.notEqual(changed.operationId, prepared.operationId);
    assert.equal((await call('prepare_quote', { ...context, targetId: quote })).operationId, changed.operationId);
    let after = first[0].position;
    const recovered = [];
    for (;;) {
      const page = await call('history', { ...context, after });
      if (!page.length) break;
      recovered.push(...page.map(message => message.position));
      after = page[page.length - 1].position;
    }
    assert.equal(recovered.length, 130);
    assert.deepEqual(recovered, [...new Set(recovered)].sort((a, b) => a - b));
    await call('transfer', { ...context, targetId: second });
    assert.equal((await call('list', { filter: 'mine' })).rows.length, 0);
    assert.equal((await call('details', context)).conversation.assignee_name, 'Segundo');
    await assert.rejects(call('resolve', context), /ATENDIMENTO_ASSIGNMENT_DENIED/);
    const outgoing = { ...context, requestId: id(99), body: 'Resposta' };
    await call('test_send', outgoing, second);
    assert.deepEqual(await call('send_status', outgoing, second), { delivery: 'submitted' });
    assert.deepEqual(await call('send_status', outgoing), {});
    await call('test_send', outgoing, second);
    assert.equal((await call('history', context, second))[0].delivery, 'submitted');
    await db.exec('RESET ROLE; SET ROLE service_role');
    await event(outgoing.requestId, 'delivered');
    await event(outgoing.requestId, 'delivered');
    await db.exec('RESET ROLE');
    await authenticate(company);
    const history = await call('history', context, second);
    assert.equal(history[0].delivery, 'delivered');
    assert.equal(history.filter(message => message.direction === 'outgoing').length, 1);
    await call('resolve', context, second);
    assert.equal((await call('list', { filter: 'resolved' }, second)).rows.length, 1);
    await db.exec('RESET ROLE');
    await authenticate(other);
    assert.equal((await call('list', {}, null, other, foreign)).rows.length, 1);
    await assert.rejects(call('history', context, null, other, foreign), /ATENDIMENTO_CONVERSATION_NOT_FOUND/);
  } finally {
    await db.close();
  }
});
