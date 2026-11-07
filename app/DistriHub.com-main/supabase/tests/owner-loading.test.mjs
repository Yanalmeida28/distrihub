import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const migration=await readFile(new URL('../migrations/20261107162944_optimize_owner_entitlement_reads.sql',import.meta.url),'utf8');
const history=await readFile(new URL('../migrations/20261008025316_enforce_saas_access_and_billing_jobs.sql',import.meta.url),'utf8');
const targets=[...history.match(/FOR entry IN SELECT \* FROM \(VALUES([\s\S]*?)\) AS entries/)[1].matchAll(/\('([^']+)','([^']+)'\)/g)].map(m=>[m[1],m[2]]);
const deviceHistory=await readFile(new URL('../migrations/20261023185537_plan_branch_addons_and_device_limits.sql',import.meta.url),'utf8');
const realGuard=deviceHistory.match(/CREATE OR REPLACE FUNCTION public\.partner_has_saas_access\([\s\S]*?\$\$;/)[0];
const ids=Object.fromEntries(['a','b','employee','inactive','unrelated','superadmin','branch1','branch2','branchB'].map(k=>[k,randomUUID()]));
async function fixture(){
 const db=new PGlite();await db.waitReady;
 await db.exec(`create role authenticated;create role anon;create schema auth;create schema partner_subscription_private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create sequence partner_subscription_private.probe_calls;
 create function public.is_super_admin() returns boolean language sql stable security definer set search_path='' as $$select auth.uid()='${ids.superadmin}'::uuid$$;
 create function partner_subscription_private.state(uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform nextval('partner_subscription_private.probe_calls');
 return jsonb_build_object('can_access',coalesce(current_setting('test.blocked',true),'')<>'true','features',case when current_setting('test.module_blocked',true)='true' then '[]'::jsonb else '["cadastros","pdv","caixa","financeiro","os","fiscal","pedidos","rma"]'::jsonb end);end$$;
 create function partner_subscription_private.device_allowed(uuid) returns boolean language sql stable security definer set search_path='' as $$select coalesce(current_setting('test.device_blocked',true),'')<>'true'$$;`);
 for(const [table,feature] of targets){
  await db.exec(`create table public.${table}(id uuid primary key default gen_random_uuid(),user_id uuid not null,branch_id uuid,auth_user_id uuid,active boolean default true);
  alter table public.${table} enable row level security;
  grant select,insert,update,delete on public.${table} to authenticated;
  create policy base_access on public.${table} for all to authenticated using(user_id=(select auth.uid()) or public.is_super_admin() or (auth.uid()='${ids.employee}'::uuid and user_id='${ids.a}'::uuid and branch_id='${ids.branch1}'::uuid)) with check(user_id=(select auth.uid()) or public.is_super_admin() or (auth.uid()='${ids.employee}'::uuid and user_id='${ids.a}'::uuid and branch_id='${ids.branch1}'::uuid));`);
  await db.query(`insert into public.${table}(user_id,branch_id) values($1,$2),($1,$3),($4,$5)`,[ids.a,ids.branch1,ids.branch2,ids.b,ids.branchB]);
 }
 await db.query('insert into public.partner_salespeople(user_id,branch_id,auth_user_id,active) values($1,$2,$3,true),($1,$2,$4,false)',[ids.a,ids.branch1,ids.employee,ids.inactive]);
 // Use the versioned production guard; only its subscription/device dependencies are synthetic fixtures.
 await db.exec(realGuard);
 await db.exec('revoke all on function public.partner_has_saas_access(uuid,text) from public,anon;grant execute on function public.partner_has_saas_access(uuid,text) to authenticated;');
 for(const [table,feature] of targets)await db.exec(`create policy saas_entitlement on public.${table} as restrictive for all to authenticated using(partner_has_saas_access(user_id,'${feature}'::text)) with check(partner_has_saas_access(user_id,'${feature}'::text));`);
 return db;
}
async function login(db,user,blocked=false,module=false,device=false){
 await db.exec('reset role');await db.query("select set_config('test.uid',$1,false),set_config('test.blocked',$2,false),set_config('test.module_blocked',$3,false),set_config('test.device_blocked',$4,false)",[user??'',String(blocked),String(module),String(device)]);await db.exec('set role authenticated');
}
async function matrix(db){const result=[];
 for(const [user,blocked,module,device] of [[ids.a,false,false,false],[ids.b,false,false,false],[ids.employee,false,false,false],[ids.inactive,false,false,false],[ids.unrelated,false,false,false],[ids.superadmin,true,true,true],[null,false,false,false],[ids.a,true,false,false],[ids.a,false,true,false],[ids.a,false,false,true]]){
  await login(db,user,blocked,module,device);const rows=[];for(const [table] of targets)rows.push((await db.query(`select id from ${table} order by id`)).rows);result.push(rows);
 }return result;
}
test('24 owner policy optimizations preserve owner, employee, company, branch, subscription, feature and device visibility',async()=>{
 const db=await fixture();try{assert.equal(targets.length,24);const before=await matrix(db);await db.exec('reset role');await db.exec(migration);assert.deepEqual(await matrix(db),before);
 await db.exec('reset role');const policies=(await db.query("select * from pg_policies where policyname='saas_entitlement'")).rows;assert.equal(policies.length,24);assert(policies.every(p=>p.permissive==='RESTRICTIVE'&&p.cmd==='ALL'&&p.qual===p.with_check));
 assert.equal((await db.query("select has_function_privilege('anon','public.partner_has_saas_access(uuid,text)','execute') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});
test('500 owner rows evaluate unchanged subscription state 500 times before, once after, and check again on the next statement',async()=>{
 const db=await fixture();try{
  await db.exec('truncate public.partner_products');await db.query('insert into public.partner_products(user_id,branch_id) select $1::uuid,$2::uuid from generate_series(1,500)',[ids.a,ids.branch1]);
  const reset=async()=>{await db.exec('reset role;alter sequence partner_subscription_private.probe_calls restart with 1');await login(db,ids.a);};
  const calls=async()=>{await db.exec('reset role');return Number((await db.query('select case when is_called then last_value else 0 end n from partner_subscription_private.probe_calls')).rows[0].n);};
  await reset();assert.equal((await db.query('select count(*)::int n from partner_products')).rows[0].n,500);assert.equal(await calls(),500);
  await db.exec(migration);await reset();const plan=(await db.query('explain (analyze,format json) select count(*) from partner_products')).rows;assert(JSON.stringify(plan).includes('InitPlan'));assert.equal(await calls(),1);
  await login(db,ids.a);await db.query('select count(*) from partner_products');assert.equal(await calls(),2);
  await login(db,ids.a,true);assert.equal((await db.query('select count(*)::int n from partner_products')).rows[0].n,0);
 }finally{await db.close();}
});
test('writes still reject blocked subscriptions, missing modules, unauthorized devices and foreign companies',async()=>{
 const db=await fixture();try{await db.exec(migration);
  for(const flags of [[true,false,false],[false,true,false],[false,false,true]]){
   await login(db,ids.a,...flags);await assert.rejects(db.query('insert into partner_products(user_id,branch_id) values($1,$2)',[ids.a,ids.branch1]));
  }
  await login(db,ids.a);await db.query('insert into partner_products(user_id,branch_id) values($1,$2)',[ids.a,ids.branch1]);await assert.rejects(db.query('insert into partner_products(user_id,branch_id) values($1,$2)',[ids.b,ids.branchB]));
  await login(db,ids.employee);await db.query('insert into partner_products(user_id,branch_id) values($1,$2)',[ids.a,ids.branch1]);await assert.rejects(db.query('insert into partner_products(user_id,branch_id) values($1,$2)',[ids.a,ids.branch2]));
 }finally{await db.close();}
});
test('unknown policy aborts and rolls back every earlier policy change',async()=>{
 const db=await fixture();try{
  await db.exec('alter policy saas_entitlement on public.stock_movements using(false)');const before=(await db.query("select tablename,qual,with_check from pg_policies where policyname='saas_entitlement' order by tablename")).rows;
  await assert.rejects(db.exec(migration),/Unknown entitlement policy/);await db.exec('rollback');
  assert.deepEqual((await db.query("select tablename,qual,with_check from pg_policies where policyname='saas_entitlement' order by tablename")).rows,before);
 }finally{await db.close();}
});
