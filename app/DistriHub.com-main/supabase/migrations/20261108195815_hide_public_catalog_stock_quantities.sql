-- Public catalogs disclose availability only, never inventory quantities.
-- Keep tenant/branch checks, SKU visibility, pagination and execution grants.
-- Zero/negative/null stock stays visible but cannot be ordered.
CREATE OR REPLACE FUNCTION public.read_public_catalog_page(p_slug text, p_branch_slug text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid, p_search text DEFAULT ''::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 48)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  store public.store_settings_v2%ROWTYPE;
  v_branch_id uuid;
  branch_data jsonb;
  branches_data jsonb;
  profile_data jsonb;
  products_data jsonb;
  v_total bigint;
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 48), 1), 100);
  v_search text := lower(btrim(coalesce(p_search, '')));
BEGIN
  -- Match the existing catalog's access rules and public field allowlist.
  IF auth.uid() IS NULL AND coalesce(nullif(current_setting('role',true),'none'),session_user)
      NOT IN ('anon','postgres','service_role') THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;
  IF p_slug IS NULL OR length(btrim(p_slug)) = 0 OR length(p_slug) > 200 THEN RETURN NULL; END IF;
  SELECT s.* INTO store FROM public.store_settings_v2 s
  WHERE s.catalog_enabled = true AND s.catalog_slug IS NOT NULL
    AND (lower(s.catalog_slug) = lower(btrim(p_slug)) OR EXISTS (
      SELECT 1 FROM public.partner_profiles p WHERE p.id = s.user_id AND p.business_name = p_slug))
  ORDER BY (lower(s.catalog_slug) = lower(btrim(p_slug))) DESC, s.id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT jsonb_build_object('business_name',p.business_name,'account_name',p.account_name)
    INTO profile_data FROM public.partner_profiles p WHERE p.id = store.user_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'address',b.address)
    ORDER BY b.name,b.id),'[]'::jsonb) INTO branches_data
    FROM public.partner_branches b WHERE b.user_id = store.user_id AND b.is_active = true;

  IF nullif(btrim(p_branch_slug),'') IS NOT NULL THEN
    SELECT b.id, jsonb_build_object('id',b.id,'name',b.name,'address',b.address)
      INTO v_branch_id, branch_data FROM public.partner_branches b
      WHERE b.user_id = store.user_id AND b.is_active = true AND lower(b.name) = lower(btrim(p_branch_slug))
      ORDER BY b.id LIMIT 1;
    -- An invalid fixed branch must never fall back to another branch.
  ELSIF p_branch_id IS NOT NULL THEN
    SELECT b.id INTO v_branch_id FROM public.partner_branches b
      WHERE b.id = p_branch_id AND b.user_id = store.user_id AND b.is_active = true;
  ELSE
    SELECT b.id INTO v_branch_id FROM public.partner_branches b
      WHERE b.user_id = store.user_id AND b.is_active = true ORDER BY b.name,b.id LIMIT 1;
  END IF;

  WITH matching AS MATERIALIZED (
    SELECT p.* FROM public.partner_products p
    WHERE p.user_id = store.user_id AND p.branch_id = v_branch_id
      AND NOT coalesce(p.is_service,false)
      AND (v_search = '' OR strpos(lower(concat(p.name,' ',CASE WHEN store.personalization#>'{catalog,show_sku}' IS DISTINCT FROM 'false'::jsonb THEN p.sku END)),v_search) > 0)
  ), page AS (
    SELECT * FROM matching ORDER BY created_at DESC,id OFFSET v_offset LIMIT v_limit
  )
  SELECT (SELECT count(*) FROM matching),
    coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',p.id,'branch_id',p.branch_id,'name',p.name,'sale_price',p.sale_price,'image_url',p.image_url,
      'category',p.category,'is_service',p.is_service,'available',coalesce(p.stock > 0,false))
      || CASE WHEN store.personalization#>'{catalog,show_sku}' = 'false'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('sku',p.sku) END
      ORDER BY p.created_at DESC,p.id) FROM page p),'[]'::jsonb)
    INTO v_total, products_data;

  RETURN jsonb_build_object(
    'profile',profile_data,'branch',branch_data,'branches',branches_data,'selected_branch_id',v_branch_id,
    'products',products_data,'total',v_total,
    'next_offset',CASE WHEN v_offset::bigint + v_limit < v_total THEN v_offset::bigint + v_limit ELSE NULL END,
    'settings',jsonb_build_object(
      'catalog_slug',store.catalog_slug,'catalog_enabled',true,'logo_url',store.logo_url,'banner_url',store.banner_url,
      'primary_color',store.primary_color,'nav_color',store.nav_color,'business_hours',store.business_hours,
      'catalog_preferences',jsonb_build_object(
        'welcome_message',store.personalization#>'{catalog,welcome_message}',
        'card_size',store.personalization#>'{catalog,card_size}',
        'banner_height',store.personalization#>'{catalog,banner_height}',
        'show_stock',store.personalization#>'{catalog,show_stock}',
        'show_sku',store.personalization#>'{catalog,show_sku}',
        'whatsapp_phone',store.personalization#>'{catalog,whatsapp_phone}',
        'show_whatsapp',store.personalization#>'{catalog,show_whatsapp}')));
END $function$;

CREATE OR REPLACE FUNCTION public.read_public_store_catalog(p_slug text, p_branch_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE store public.store_settings_v2%ROWTYPE; v_branch_id uuid; branch_data jsonb; profile_data jsonb; products_data jsonb;
BEGIN
 -- Anonymous access is intentional for enabled catalogs; a missing JWT is not an authenticated session.
 IF auth.uid() IS NULL AND COALESCE(NULLIF(current_setting('role',true),'none'),session_user) NOT IN ('anon','postgres','service_role') THEN
  RAISE EXCEPTION 'Não autenticado.';
 END IF;
 IF p_slug IS NULL OR length(btrim(p_slug))=0 OR length(p_slug)>200 THEN RETURN NULL; END IF;
 SELECT s.* INTO store FROM public.store_settings_v2 s
 WHERE s.catalog_enabled=true AND s.catalog_slug IS NOT NULL
 AND (lower(s.catalog_slug)=lower(btrim(p_slug)) OR EXISTS(SELECT 1 FROM public.partner_profiles p WHERE p.id=s.user_id AND p.business_name=p_slug))
 ORDER BY (lower(s.catalog_slug)=lower(btrim(p_slug))) DESC,s.id LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('business_name',p.business_name,'account_name',p.account_name) INTO profile_data
 FROM public.partner_profiles p WHERE p.id=store.user_id;
 IF NULLIF(btrim(p_branch_slug),'') IS NOT NULL THEN
  SELECT b.id,jsonb_build_object('id',b.id,'name',b.name,'address',b.address) INTO v_branch_id,branch_data
  FROM public.partner_branches b WHERE b.user_id=store.user_id AND b.is_active=true AND lower(b.name)=lower(btrim(p_branch_slug))
  ORDER BY b.id LIMIT 1;
 END IF;
 SELECT COALESCE(jsonb_agg(q.product ORDER BY q.created_at DESC,q.id),'[]'::jsonb) INTO products_data FROM (
  SELECT p.id,p.created_at,jsonb_build_object('id',p.id,'branch_id',p.branch_id,'name',p.name,'sale_price',p.sale_price,'image_url',p.image_url,
    'category',p.category,'is_service',p.is_service,'available',coalesce(p.stock > 0,false))
      || CASE WHEN store.personalization#>'{catalog,show_sku}' = 'false'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('sku',p.sku) END AS product
  FROM public.partner_products p JOIN public.partner_branches b ON b.id=p.branch_id AND b.user_id=p.user_id AND b.is_active=true
  WHERE p.user_id=store.user_id AND NOT COALESCE(p.is_service,false)
    AND (NULLIF(btrim(p_branch_slug),'') IS NULL OR p.branch_id=v_branch_id)
  ORDER BY p.created_at DESC,p.id LIMIT 1000
 ) q;
 RETURN jsonb_build_object('profile',profile_data,'branch',branch_data,'products',products_data,
  'settings',jsonb_build_object('catalog_slug',store.catalog_slug,'catalog_enabled',true,'logo_url',store.logo_url,'banner_url',store.banner_url,
    'primary_color',store.primary_color,'nav_color',store.nav_color,'business_hours',store.business_hours,
    'catalog_preferences',jsonb_build_object('welcome_message',store.personalization#>'{catalog,welcome_message}','card_size',store.personalization#>'{catalog,card_size}','banner_height',store.personalization#>'{catalog,banner_height}','show_stock',store.personalization#>'{catalog,show_stock}','show_sku',store.personalization#>'{catalog,show_sku}','whatsapp_phone',store.personalization#>'{catalog,whatsapp_phone}','show_whatsapp',store.personalization#>'{catalog,show_whatsapp}')));
END $function$;

REVOKE ALL ON FUNCTION public.read_public_catalog_page(text,text,uuid,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_public_store_catalog(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_public_catalog_page(text,text,uuid,text,integer,integer) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_public_store_catalog(text,text) TO anon,authenticated;
NOTIFY pgrst, 'reload schema';
