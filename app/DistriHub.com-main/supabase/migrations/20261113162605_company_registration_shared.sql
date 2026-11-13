-- Um cadastro da empresa, compartilhado pelas telas. Não armazena certificados nem credenciais.
ALTER TABLE public.partner_profiles ADD COLUMN company_registration jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK(jsonb_typeof(company_registration)='object' AND octet_length(company_registration::text)<=6000);

CREATE FUNCTION public.get_company_registration(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor record; result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão obrigatória.' USING ERRCODE='42501'; END IF;
  IF public.is_super_admin() IS DISTINCT FROM true THEN
    SELECT * INTO actor FROM public.resolve_partner_pdv_operator(NULL,NULL,NULL);
    IF actor.company_id IS DISTINCT FROM p_company_id THEN RAISE EXCEPTION 'Empresa não autorizada.' USING ERRCODE='42501'; END IF;
  END IF;
  SELECT jsonb_build_object('business_name',p.business_name,'document',p.document,'registration',p.company_registration)
  INTO result FROM public.partner_profiles p WHERE p.id=p_company_id;
  IF result IS NULL THEN RAISE EXCEPTION 'Empresa não encontrada.'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_company_registration(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_company_registration(uuid) TO authenticated;

CREATE FUNCTION public.save_company_registration(p_company_id uuid,p_registration jsonb,p_expected_registration jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor record; field record; normalized jsonb := '{}'::jsonb; val text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão obrigatória.' USING ERRCODE='42501'; END IF;
  IF public.is_super_admin() IS DISTINCT FROM true THEN
    SELECT * INTO actor FROM public.resolve_partner_pdv_operator(NULL,NULL,NULL);
    IF auth.uid() IS DISTINCT FROM p_company_id OR actor.company_id IS DISTINCT FROM p_company_id OR actor.salesperson_id IS NOT NULL THEN
      RAISE EXCEPTION 'Somente o proprietário ou super admin pode alterar este cadastro.' USING ERRCODE='42501';
    END IF;
  END IF;
  IF jsonb_typeof(p_registration) IS DISTINCT FROM 'object' OR octet_length(p_registration::text)>6000 THEN
    RAISE EXCEPTION 'Cadastro inválido.';
  END IF;
  FOR field IN SELECT * FROM jsonb_each(p_registration) LOOP
    IF field.key NOT IN ('legal_name','trade_name','state_registration','municipal_registration','tax_regime',
      'address','address_number','complement','neighborhood','city','state','zip_code') OR jsonb_typeof(field.value)<>'string' THEN
      RAISE EXCEPTION 'Campo cadastral inválido.';
    END IF;
    val := trim(field.value #>> '{}');
    IF char_length(val)>160 THEN RAISE EXCEPTION 'Campo cadastral muito longo.'; END IF;
    IF field.key='zip_code' AND val<>'' THEN
      val := replace(val,'-','');
      IF val !~ '^[0-9]{8}$' THEN RAISE EXCEPTION 'Informe um CEP com 8 dígitos.'; END IF;
    END IF;
    IF field.key='state' AND val<>'' THEN
      val := upper(val);
      IF val NOT IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') THEN
        RAISE EXCEPTION 'Informe uma UF válida.';
      END IF;
    END IF;
    IF field.key='tax_regime' AND val NOT IN ('','1','2','3','4') THEN RAISE EXCEPTION 'Regime tributário inválido.'; END IF;
    normalized := normalized || jsonb_build_object(field.key,val);
  END LOOP;
  IF coalesce(normalized->>'legal_name','')='' THEN RAISE EXCEPTION 'Informe a razão social.'; END IF;
  UPDATE public.partner_profiles SET company_registration=normalized,business_name=normalized->>'legal_name'
  WHERE id=p_company_id AND company_registration=p_expected_registration;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cadastro alterado em outra tela ou empresa não encontrada.' USING ERRCODE='40001'; END IF;
  RETURN public.get_company_registration(p_company_id);
END $$;
REVOKE ALL ON FUNCTION public.save_company_registration(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_company_registration(uuid,jsonb,jsonb) TO authenticated;
