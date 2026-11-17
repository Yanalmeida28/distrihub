import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const migration=await readFile(new URL('../migrations/20261117014956_harden_storage_and_business_time.sql',import.meta.url),'utf8');
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', employee='33333333-3333-4333-8333-333333333333';
const branch='44444444-4444-4444-8444-444444444444', second='55555555-5555-4555-8555-555555555555', order='66666666-6666-4666-8666-666666666666', customer='77777777-7777-4777-8777-777777777777';
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA partner_operations_private; CREATE SCHEMA partner_cadastros_private; CREATE SCHEMA partner_subscription_private;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$SELECT string_to_array($1,'/')$$;
 CREATE TABLE service_orders(id uuid,user_id uuid,branch_id uuid);
 CREATE TABLE service_order_photos(storage_path text);
 CREATE TABLE partner_customers(id uuid,user_id uuid,branch_id uuid,photo_url text);
 CREATE TABLE partner_salespeople(user_id uuid,auth_user_id uuid,branch_id uuid,active boolean,blocked_modules text[],role text);
 CREATE TABLE partner_branches(id uuid,user_id uuid);
 CREATE TABLE store_settings_v2(user_id uuid,personalization jsonb);
 CREATE TABLE storage.objects(name text,bucket_id text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 CREATE TABLE storage.buckets(id text,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE partner_subscription_private.device_sessions(branch_id uuid);
 CREATE TABLE partner_payable_changes(payable_id uuid);
 CREATE FUNCTION public.partner_has_saas_access(uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT coalesce(current_setting('test.blocked',true),'')<>'true'$$;
 CREATE FUNCTION public.partner_employee_can_access_branch(uuid,uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$SELECT EXISTS(SELECT 1 FROM partner_salespeople WHERE user_id=$1 AND auth_user_id=auth.uid() AND active AND branch_id=$2)$$;
 CREATE FUNCTION partner_cadastros_private.can_manage(uuid,uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$SELECT auth.uid()=$1 OR EXISTS(SELECT 1 FROM partner_salespeople WHERE user_id=$1 AND auth_user_id=auth.uid() AND active AND branch_id=$2 AND NOT ('cadastros'=ANY(blocked_modules)))$$;
 CREATE FUNCTION partner_operations_private.can_access_os_file(text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE POLICY os_attachment_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='service-order-photos' AND partner_operations_private.can_access_os_file(name));
 CREATE POLICY os_attachment_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='service-order-photos' AND partner_operations_private.can_access_os_file(name));
 CREATE POLICY os_attachment_update ON storage.objects FOR UPDATE TO authenticated USING(bucket_id='service-order-photos' AND partner_operations_private.can_access_os_file(name)) WITH CHECK(bucket_id='service-order-photos' AND partner_operations_private.can_access_os_file(name));
 CREATE POLICY os_attachment_delete_unlinked ON storage.objects FOR DELETE TO authenticated USING(bucket_id='service-order-photos' AND partner_operations_private.can_access_os_file(name) AND NOT EXISTS(SELECT 1 FROM service_order_photos WHERE storage_path=name));
 CREATE POLICY service_order_photo_storage_select ON storage.objects FOR SELECT TO authenticated USING(bucket_id='service-order-photos' AND (storage.foldername(name))[1]=auth.uid()::text);
 CREATE POLICY service_order_photo_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='service-order-photos' AND (storage.foldername(name))[1]=auth.uid()::text);
 CREATE POLICY service_order_photo_storage_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='service-order-photos' AND (storage.foldername(name))[1]=auth.uid()::text);
 CREATE TABLE partner_sales(id uuid,user_id uuid,branch_id uuid,items jsonb,total numeric,status text,created_at timestamptz,customer_name text,imei text,serial_number text,sale_number integer,salesperson_id uuid);
 CREATE TABLE stock_movements(user_id uuid,branch_id uuid,type text,quantity numeric,reason text,created_at timestamptz);
 CREATE VIEW partner_stock_movements AS SELECT * FROM stock_movements;
 CREATE FUNCTION public.partner_employee_can_operate_sale(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT partner_employee_can_access_branch($1,$2)$$;
 CREATE TABLE rma_requests_v2(id uuid,user_id uuid,sale_id uuid,sale_item_index integer,quantity integer);
 CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE FUNCTION partner_subscription_private.require_actor(text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF; END$$;
 CREATE FUNCTION partner_subscription_private.require_access(uuid,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT public.partner_has_saas_access($1,$2) THEN RAISE EXCEPTION 'Blocked'; END IF; END$$;
 CREATE FUNCTION partner_operations_private.authorize_branch(uuid,text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$DECLARE company uuid; BEGIN SELECT user_id INTO company FROM partner_branches WHERE id=$1; IF company IS NULL OR NOT(company=auth.uid() OR partner_employee_can_access_branch(company,$1)) THEN RAISE EXCEPTION 'Unauthorized branch'; END IF; RETURN company; END$$;
 INSERT INTO service_orders VALUES('${order}','${owner}','${branch}');
 INSERT INTO service_order_photos VALUES('${owner}/${order}/linked.webp');
 INSERT INTO storage.objects VALUES('${owner}/${order}/linked.webp','service-order-photos');
 INSERT INTO partner_customers VALUES('${customer}','${owner}','${branch}',NULL);
 INSERT INTO partner_branches VALUES('${branch}','${owner}'),('${second}','${other}');
 INSERT INTO partner_salespeople VALUES('${owner}','${employee}','${branch}',true,'{}','gerente');
 INSERT INTO storage.buckets(id) VALUES('customer-photos'),('service-order-photos');
 INSERT INTO store_settings_v2 VALUES('${owner}','{"business_time_zone":"America/Manaus"}');
 INSERT INTO partner_sales VALUES('${order}','${owner}','${branch}','[]',100,'concluida','2026-11-17T03:30:00Z','Synthetic',NULL,NULL,1,NULL);
 GRANT USAGE ON SCHEMA auth,storage,partner_operations_private,partner_cadastros_private TO authenticated;
 GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
 GRANT SELECT ON service_order_photos,partner_customers TO authenticated;`);
 await db.exec(await readFile(new URL('../migrations/20261013160000_history_sale_completion_date.sql',import.meta.url),'utf8'));
 await db.exec(migration);
 const login=async actor=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('test.actor',$1,false)",[actor]);await db.exec('SET ROLE authenticated');};
 return {db,login};
}
test('OS storage protects linked files, company, branch, module, subscription and anonymous access',async()=>{
 const {db,login}=await fixture();try{
  await login(owner);assert.equal((await db.query("SELECT * FROM storage.objects WHERE bucket_id='service-order-photos'")).rows.length,1);
  assert.equal((await db.query('DELETE FROM storage.objects RETURNING name')).rows.length,0);
  await db.query("INSERT INTO storage.objects VALUES($1,'service-order-photos')",[owner+'/'+order+'/pending.webp']);
  assert.equal((await db.query("DELETE FROM storage.objects WHERE name LIKE '%pending.webp' RETURNING name")).rows.length,1);
  await login(employee);assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,1);
  await db.exec(`RESET ROLE; UPDATE partner_salespeople SET branch_id='${second}'; SET ROLE authenticated;`);assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,0);
  await db.exec(`RESET ROLE; UPDATE partner_salespeople SET branch_id='${branch}',blocked_modules=ARRAY['os']; SET ROLE authenticated;`);assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,0);
  await login(other);assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,0);
  await assert.rejects(db.query("INSERT INTO storage.objects VALUES($1,'service-order-photos')",[other+'/'+order+'/forged.webp']),/row-level security/);
  await login(owner);await db.query("SELECT set_config('test.blocked','true',false)");assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,0);
  await assert.rejects(db.query("INSERT INTO storage.objects VALUES($1,'service-order-photos')",[owner+'/'+order+'/blocked.webp']),/row-level security/);
  const acl=await db.query("SELECT has_function_privilege('anon','partner_operations_private.can_access_os_file(text)','EXECUTE') AS allowed");assert.equal(acl.rows[0].allowed,false);
 }finally{await db.close();}
});
test('customer uploads require an accessible customer and preserve linked photos while allowing cleanup',async()=>{
 const {db,login}=await fixture();try{
  await login(employee);const path=employee+'/'+customer+'/photo.webp';
  await db.query("INSERT INTO storage.objects VALUES($1,'customer-photos')",[path]);
  await db.query('RESET ROLE');await db.query('UPDATE partner_customers SET photo_url=$1',[path]);await db.exec('SET ROLE authenticated');
  assert.equal((await db.query("DELETE FROM storage.objects WHERE bucket_id='customer-photos' RETURNING name")).rows.length,0);
  await login(owner);assert.equal((await db.query("SELECT * FROM storage.objects WHERE bucket_id='customer-photos'")).rows.length,1);
  await login(other);await assert.rejects(db.query("INSERT INTO storage.objects VALUES($1,'customer-photos')",[other+'/'+customer+'/forged.webp']),/row-level security/);
  await login(employee);await db.exec(`RESET ROLE; UPDATE partner_salespeople SET branch_id='${second}'; SET ROLE authenticated;`);
  assert.equal((await db.query("SELECT * FROM storage.objects WHERE bucket_id='customer-photos'")).rows.length,0);
  await db.exec(`RESET ROLE; UPDATE partner_salespeople SET branch_id='${branch}'; UPDATE partner_customers SET photo_url=NULL; SET ROLE authenticated;`);
  assert.equal((await db.query("DELETE FROM storage.objects WHERE bucket_id='customer-photos' RETURNING name")).rows.length,1);
 }finally{await db.close();}
});
test('server upload limits and lookup indexes are installed without changing stored photo metadata',async()=>{
 const {db}=await fixture();try{
  const buckets=(await db.query('SELECT * FROM storage.buckets')).rows;assert.equal(buckets.length,2);
  for(const bucket of buckets){assert.equal(Number(bucket.file_size_limit),2097152);assert.deepEqual(bucket.allowed_mime_types,['image/jpeg','image/png','image/webp']);}
  assert.equal((await db.query('SELECT * FROM service_order_photos')).rows.length,1);
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_indexes WHERE indexname IN ('device_sessions_branch_id_audit_idx','payable_changes_payable_id_audit_idx')")).rows[0].n,2);
 }finally{await db.close();}
});
test('history uses the company timezone at midnight and falls back safely without weakening authorization',async()=>{
 const {db,login}=await fixture();try{
  const history=async(day,company=owner,scope=branch)=>(await db.query('SELECT read_partner_sales_history($1,$2,$3::date,$3::date) AS data',[company,scope,day])).rows[0].data;
  await login(owner);assert.equal((await history('2026-11-16')).completed_total,100);assert.equal((await history('2026-11-17')).total,0);
  await db.exec("RESET ROLE; UPDATE store_settings_v2 SET personalization='{}'; SET ROLE authenticated");assert.equal((await history('2026-11-16')).total,0);assert.equal((await history('2026-11-17')).completed_total,100);
  await db.exec("RESET ROLE; UPDATE store_settings_v2 SET personalization='{\"business_time_zone\":\"invalid\"}'; SET ROLE authenticated");assert.equal((await history('2026-11-17')).completed_total,100);
  await assert.rejects(history('2026-11-17',owner,second),/Unauthorized branch/);
  await login(other);await assert.rejects(history('2026-11-17'),/Empresa/);
 }finally{await db.close();}
});
test('deployment and browser protections keep encrypted transport and camera support',async()=>{
 const workflow=await readFile(new URL('../../../../.github/workflows/deploy.yml',import.meta.url),'utf8');
 assert.match(workflow,/protocol: ftps\s+security: strict/);assert.match(workflow,/cancel-in-progress: false/);assert.match(workflow,/contents: read/);
 const headers=await readFile(new URL('../../public/.htaccess',import.meta.url),'utf8');
 for(const name of ['X-Content-Type-Options','X-Frame-Options','Referrer-Policy','Strict-Transport-Security'])assert.ok(headers.includes(name));
 assert.match(headers,/camera=\(self\)/);assert.match(headers,/frame-ancestors 'self'/);assert.match(headers,/Content-Security-Policy-Report-Only/);
});
