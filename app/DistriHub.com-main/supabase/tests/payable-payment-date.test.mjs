import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const owner = '00000000-0000-0000-0000-000000000001', other = '00000000-0000-0000-0000-000000000002';
const branch = '00000000-0000-0000-0000-000000000003', account = '00000000-0000-0000-0000-000000000004';
const payment = '00000000-0000-0000-0000-000000000005', legacy = '00000000-0000-0000-0000-000000000006';
test('dated payments preserve registration time, ownership, access, exact retries and account balance', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA partner_subscription_private;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
      CREATE FUNCTION partner_subscription_private.require_actor(text) RETURNS void LANGUAGE plpgsql AS $$
        BEGIN IF current_setting('test.blocked',true)='true' THEN RAISE EXCEPTION 'Acesso bloqueado'; END IF; END $$;
      CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${owner}'),('${other}');
      CREATE TABLE partner_branches(id uuid PRIMARY KEY,user_id uuid); INSERT INTO partner_branches VALUES('${branch}','${owner}');
      CREATE TABLE partner_suppliers(id uuid PRIMARY KEY,user_id uuid);
    `);
    await db.exec(readFileSync(new URL('../migrations/20261007055110_add_partner_payables.sql', import.meta.url), 'utf8'));
    await db.exec(`INSERT INTO partner_payables(id,user_id,branch_id,description,creditor_name,category,amount,due_date)
      VALUES('${account}','${owner}','${branch}','Despesa sintética','Credor','outros',100,current_date);
      INSERT INTO partner_payable_payments(id,payable_id,user_id,amount,created_at)
      VALUES('${legacy}','${account}','${owner}',10,now()-interval '50 days');
      UPDATE partner_payables SET paid_amount=10,status='parcial' WHERE id='${account}';`);
    await db.exec(readFileSync(new URL('../migrations/20261114163617_payable_payment_date.sql', import.meta.url), 'utf8'));
    assert.equal((await db.query('SELECT paid_at FROM partner_payable_payments WHERE id=$1',[legacy])).rows[0].paid_at, null);
    const { today, old, future } = (await db.query(`SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today,
      ((now() AT TIME ZONE 'America/Sao_Paulo')::date-40)::text AS old,
      ((now() AT TIME ZONE 'America/Sao_Paulo')::date+1)::text AS future`)).rows[0];
    const login = id => db.query("SELECT set_config('test.uid',$1,false)",[id ?? '']);
    const pay = (date = old, amount = 30, id = payment, payable = account) => db.query('SELECT record_partner_payable_payment_dated($1,$2,$3,$4::date)',[payable,amount,id,date]);
    await db.exec('SET ROLE anon'); await assert.rejects(pay(),/permission denied/);
    await db.exec('SET ROLE authenticated'); await assert.rejects(pay(),/Não autenticado/);
    await login(other); await assert.rejects(pay(),/acesso negado/);
    await login(owner);
    await db.exec("SELECT set_config('test.blocked','true',false)"); await assert.rejects(pay(),/Acesso bloqueado/);
    await db.exec("SELECT set_config('test.blocked','false',false)");
    for (const date of [null,future,'infinity','-infinity']) await assert.rejects(pay(date),/data real/);
    await assert.rejects(pay('2026-02-30'));
    for (const amount of [0,-1,0.001,'NaN',91]) await assert.rejects(pay(old,amount));
    await pay(); await pay();
    await assert.rejects(pay(today),/diverge/); await assert.rejects(pay(old,31),/diverge/);
    await assert.rejects(pay(old,30,'00000000-0000-0000-0000-000000000007',other),/acesso negado/);
    await db.exec('RESET ROLE');
    const row = (await db.query(`SELECT (paid_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS paid,
      (created_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS registered FROM partner_payable_payments WHERE id=$1`,[payment])).rows[0];
    assert.equal(row.paid,old); assert.equal(row.registered,today);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM partner_payable_payments WHERE id=$1',[payment])).rows[0].n,1);
    assert.equal(Number((await db.query('SELECT paid_amount FROM partner_payables WHERE id=$1',[account])).rows[0].paid_amount),40);
    await db.exec('SET ROLE authenticated');
    await pay(today,60,'00000000-0000-0000-0000-000000000008');
    await assert.rejects(pay(today,1,'00000000-0000-0000-0000-000000000009'),/saldo/);
    await db.exec('RESET ROLE');
    assert.equal((await db.query('SELECT status FROM partner_payables WHERE id=$1',[account])).rows[0].status,'paga');
    // O aplicativo antigo e tentativas pendentes continuam compatíveis com a operação original.
    await db.query('SELECT record_partner_payable_payment($1,$2,$3)',[account,30,payment]);
  } finally { await db.close(); }
});
