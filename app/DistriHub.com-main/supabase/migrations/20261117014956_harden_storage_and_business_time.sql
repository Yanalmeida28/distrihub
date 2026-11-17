-- Remove permissive legacy rules: policies are ORed, not layered restrictions.
DROP POLICY IF EXISTS service_order_photo_storage_select ON storage.objects;
DROP POLICY IF EXISTS service_order_photo_storage_insert ON storage.objects;
DROP POLICY IF EXISTS service_order_photo_storage_delete ON storage.objects;

-- Keep the existing company/branch predicate and deny explicitly blocked OS staff.
CREATE OR REPLACE FUNCTION partner_operations_private.can_access_os_file(p_path text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE folder text[]:=string_to_array(p_path,'/'); o public.service_orders%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR coalesce(folder[1],'') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 OR coalesce(folder[2],'') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RETURN false; END IF;
 SELECT * INTO o FROM public.service_orders WHERE id=folder[2]::uuid AND user_id=folder[1]::uuid;
 RETURN FOUND AND public.partner_has_saas_access(o.user_id,'os') AND (o.user_id=auth.uid() OR (
  public.partner_employee_can_access_branch(o.user_id,o.branch_id) AND EXISTS(
   SELECT 1 FROM public.partner_salespeople sp WHERE sp.auth_user_id=auth.uid() AND sp.user_id=o.user_id
    AND sp.active AND NOT ('os'=ANY(coalesce(sp.blocked_modules,'{}'::text[])))
  )));
END $fn$;
REVOKE ALL ON FUNCTION partner_operations_private.can_access_os_file(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION partner_operations_private.can_access_os_file(text) TO authenticated;

CREATE OR REPLACE FUNCTION partner_cadastros_private.can_access_customer_file(p_path text,p_write boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE folder text[]:=string_to_array(p_path,'/'); c public.partner_customers%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR coalesce(folder[2],'') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RETURN false; END IF;
 SELECT * INTO c FROM public.partner_customers WHERE id=folder[2]::uuid;
 RETURN FOUND AND public.partner_has_saas_access(c.user_id,'cadastros')
  AND partner_cadastros_private.can_manage(c.user_id,c.branch_id)
  AND (folder[1]=auth.uid()::text OR (NOT p_write AND c.photo_url=p_path));
END $fn$;
REVOKE ALL ON FUNCTION partner_cadastros_private.can_access_customer_file(text,boolean) FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA partner_cadastros_private TO authenticated;
GRANT EXECUTE ON FUNCTION partner_cadastros_private.can_access_customer_file(text,boolean) TO authenticated;
DROP POLICY IF EXISTS customer_photos_select_own ON storage.objects;
DROP POLICY IF EXISTS customer_photos_insert_own ON storage.objects;
DROP POLICY IF EXISTS customer_photos_update_own ON storage.objects;
DROP POLICY IF EXISTS customer_photos_delete_own ON storage.objects;
DROP POLICY IF EXISTS customer_photo_read_company ON storage.objects;
CREATE POLICY customer_photo_read_authorized ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='customer-photos' AND partner_cadastros_private.can_access_customer_file(name));
CREATE POLICY customer_photo_insert_authorized ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='customer-photos' AND partner_cadastros_private.can_access_customer_file(name,true));
CREATE POLICY customer_photo_update_authorized ON storage.objects FOR UPDATE TO authenticated
 USING(bucket_id='customer-photos' AND partner_cadastros_private.can_access_customer_file(name,true))
 WITH CHECK(bucket_id='customer-photos' AND partner_cadastros_private.can_access_customer_file(name,true));
CREATE POLICY customer_photo_delete_unlinked ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='customer-photos' AND partner_cadastros_private.can_access_customer_file(name,true)
  AND NOT EXISTS(SELECT 1 FROM public.partner_customers WHERE photo_url=name));

-- Existing files remain intact. Limits apply to subsequent uploads.
UPDATE storage.buckets SET file_size_limit=2097152,allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp']
 WHERE id IN ('customer-photos','service-order-photos');
CREATE INDEX IF NOT EXISTS device_sessions_branch_id_audit_idx ON partner_subscription_private.device_sessions(branch_id);
CREATE INDEX IF NOT EXISTS payable_changes_payable_id_audit_idx ON public.partner_payable_changes(payable_id);

-- Preserve the current history authorization, pagination, completion and refund rules.
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.read_partner_sales_history(uuid,uuid,date,date,text,text,integer)'::regprocedure) INTO definition;
 IF position('AT TIME ZONE ''America/Sao_Paulo''' in definition)=0 OR position('DECLARE result jsonb;' in definition)=0
 OR position('PERFORM partner_subscription_private.require_actor(''pdv'');' in definition)=0 THEN
  RAISE EXCEPTION 'Unexpected sales history definition; review before changing its business timezone.';
 END IF;
 definition:=replace(definition,'AT TIME ZONE ''America/Sao_Paulo''','AT TIME ZONE v_business_time_zone');
 definition:=replace(definition,'DECLARE result jsonb;','DECLARE v_business_time_zone text; result jsonb;');
 definition:=replace(definition,'PERFORM partner_subscription_private.require_actor(''pdv'');',$body$
 SELECT coalesce((SELECT personalization->>'business_time_zone' FROM public.store_settings_v2 WHERE user_id=p_company_id LIMIT 1),'America/Sao_Paulo') INTO v_business_time_zone;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=v_business_time_zone) THEN v_business_time_zone:='America/Sao_Paulo'; END IF;
 PERFORM partner_subscription_private.require_actor('pdv');$body$);
 EXECUTE definition;
END $migration$;
