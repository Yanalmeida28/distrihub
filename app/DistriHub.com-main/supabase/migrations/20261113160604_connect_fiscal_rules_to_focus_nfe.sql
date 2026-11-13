-- Regras habilitadas explicitamente para NF-e modelo 55 em homologação: venda interna AM.
ALTER TABLE public.fiscal_tax_rules
  ADD COLUMN apply_to_nfe boolean NOT NULL DEFAULT false,
  ADD COLUMN origin text, ADD COLUMN unit text, ADD COLUMN pis_cst text, ADD COLUMN cofins_cst text;
ALTER TABLE public.fiscal_tax_rules ADD CONSTRAINT fiscal_rule_nfe_complete CHECK (
  NOT apply_to_nfe OR coalesce((branch_id IS NOT NULL AND ncm ~ '^[0-9]{8}$' AND cfop ~ '^5[0-9]{3}$'
    AND cst_csosn IN ('102','103','300','400') AND icms_rate=0 AND pis_rate=0 AND cofins_rate=0
    AND origin ~ '^[0-8]$' AND unit ~ '^[A-Z0-9]{1,6}$'
    AND pis_cst IN ('04','06','07','08','09') AND cofins_cst IN ('04','06','07','08','09')), false)
);
CREATE UNIQUE INDEX fiscal_rule_nfe_one_per_ncm ON public.fiscal_tax_rules(user_id,branch_id,ncm)
  WHERE active AND apply_to_nfe;

CREATE OR REPLACE FUNCTION public.save_fiscal_branch_settings(p_settings jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_branch uuid := NULLIF(p_settings->>'branch_id', '')::uuid;
  v_op record;
  v_rule_id uuid := NULLIF(p_settings->>'id', '')::uuid;
BEGIN
  PERFORM partner_subscription_private.require_actor('fiscal');
  IF coalesce((p_settings->>'apply_to_nfe')::boolean,false) AND (
    nullif(p_settings->>'icms_rate','') IS NULL OR nullif(p_settings->>'pis_rate','') IS NULL OR nullif(p_settings->>'cofins_rate','') IS NULL
  ) THEN RAISE EXCEPTION 'Informe as três alíquotas da regra de NF-e explicitamente.'; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Selecione uma filial'; END IF;
  SELECT * INTO v_op FROM public.resolve_partner_pdv_operator(NULL, NULL, v_branch);
  IF v_op.company_id IS NULL OR v_op.role IS NULL OR v_op.role NOT IN ('administrador', 'gerente') THEN RAISE EXCEPTION 'Sem permissão para alterar regras fiscais'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.partner_branches b
    WHERE b.id = v_branch AND b.user_id = v_op.company_id
  ) THEN RAISE EXCEPTION 'Filial inválida'; END IF;

  IF v_rule_id IS NULL THEN
    INSERT INTO public.fiscal_tax_rules(
      user_id, branch_id, name, ncm, cfop, cst_csosn,
      icms_rate, pis_rate, cofins_rate, active, apply_to_nfe, origin, unit, pis_cst, cofins_cst
    )
    VALUES (
      v_op.company_id, v_branch, trim(p_settings->>'name'), p_settings->>'ncm',
      trim(p_settings->>'cfop'), trim(p_settings->>'cst_csosn'),
      COALESCE(NULLIF(p_settings->>'icms_rate', '')::numeric, 0),
      COALESCE(NULLIF(p_settings->>'pis_rate', '')::numeric, 0),
      COALESCE(NULLIF(p_settings->>'cofins_rate', '')::numeric, 0),
      COALESCE((p_settings->>'active')::boolean, true),
      COALESCE((p_settings->>'apply_to_nfe')::boolean, false),
      NULLIF(trim(p_settings->>'origin'),''), NULLIF(upper(trim(p_settings->>'unit')),''),
      NULLIF(trim(p_settings->>'pis_cst'),''), NULLIF(trim(p_settings->>'cofins_cst'),'')
    )
    RETURNING id INTO v_rule_id;
  ELSE
    UPDATE public.fiscal_tax_rules
    SET name = trim(p_settings->>'name'),
        ncm = p_settings->>'ncm',
        cfop = trim(p_settings->>'cfop'),
        cst_csosn = trim(p_settings->>'cst_csosn'),
        icms_rate = COALESCE(NULLIF(p_settings->>'icms_rate', '')::numeric, 0),
        pis_rate = COALESCE(NULLIF(p_settings->>'pis_rate', '')::numeric, 0),
        cofins_rate = COALESCE(NULLIF(p_settings->>'cofins_rate', '')::numeric, 0),
        active = COALESCE((p_settings->>'active')::boolean, true),
        apply_to_nfe = COALESCE((p_settings->>'apply_to_nfe')::boolean, false),
        origin = NULLIF(trim(p_settings->>'origin'),''), unit = NULLIF(upper(trim(p_settings->>'unit')),''),
        pis_cst = NULLIF(trim(p_settings->>'pis_cst'),''), cofins_cst = NULLIF(trim(p_settings->>'cofins_cst'),'')
    WHERE id = v_rule_id AND user_id = v_op.company_id AND branch_id = v_branch;
    IF NOT FOUND THEN RAISE EXCEPTION 'Regra fiscal não encontrada nesta filial'; END IF;
  END IF;
  RETURN v_rule_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_fiscal_branch_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_fiscal_branch_settings(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.prepare_focus_nfe(p_sale_id uuid, p_branch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor record;
  sale public.partner_sales%ROWTYPE;
  document text;
  products jsonb;
  previous_attempt jsonb;
  customer_snapshot jsonb;
BEGIN
  PERFORM partner_subscription_private.require_actor('fiscal');
  IF auth.uid() IS NULL OR p_branch_id IS NULL THEN RAISE EXCEPTION 'Sessão e filial obrigatórias.' USING ERRCODE='42501'; END IF;
  SELECT * INTO actor FROM public.resolve_partner_pdv_operator(NULL, NULL, p_branch_id);
  IF actor.company_id IS NULL OR actor.role NOT IN ('administrador','gerente','caixa') THEN
    RAISE EXCEPTION 'Sem permissão fiscal.' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.partner_branches b WHERE b.id=p_branch_id AND b.user_id=actor.company_id) THEN
    RAISE EXCEPTION 'Filial não autorizada.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO sale FROM public.partner_sales s
  WHERE s.id=p_sale_id AND s.user_id=actor.company_id AND s.branch_id=p_branch_id AND s.status='concluida';
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda concluída não encontrada nesta filial.' USING ERRCODE='42501'; END IF;
  SELECT p.document INTO document FROM public.partner_profiles p WHERE p.id=actor.company_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'user_id',p.user_id,'branch_id',p.branch_id,'ncm',p.ncm,'cfop',p.cfop,'cst_csosn',p.cst_csosn,
    'is_service',p.is_service,'icms_rate',p.icms_rate,'pis_rate',p.pis_rate,'cofins_rate',p.cofins_rate
  )), '[]'::jsonb) INTO products FROM public.partner_products p
  WHERE p.user_id=actor.company_id AND p.branch_id=p_branch_id
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(sale.items) item WHERE item->>'product_id'=p.id::text);
  SELECT jsonb_build_object('payload',a.payload,'state',a.state,'response',a.response,'reference',a.reference)
  INTO previous_attempt FROM focus_nfe_private.attempts a
  WHERE a.company_id=actor.company_id AND a.branch_id=p_branch_id AND a.sale_id=p_sale_id AND a.environment='homologacao';
  SELECT jsonb_build_object('id',c.id,'user_id',c.user_id,'branch_id',c.branch_id,
    'document',c.document,'address',c.address,'address_number',to_jsonb(c)->>'address_number',
    'neighborhood',to_jsonb(c)->>'neighborhood','city',c.city,'state',c.state,'zip_code',c.zip_code,
    'state_registration',to_jsonb(c)->>'state_registration','ie_isento',to_jsonb(c)->'ie_isento')
  INTO customer_snapshot FROM public.partner_customers c
  WHERE c.id=sale.customer_id AND c.user_id=actor.company_id AND c.branch_id=p_branch_id;
  RETURN jsonb_build_object('tax_rules',(SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
    FROM public.fiscal_tax_rules r WHERE r.user_id=actor.company_id AND r.branch_id=p_branch_id
      AND r.active AND r.apply_to_nfe AND EXISTS(SELECT 1 FROM jsonb_array_elements(products) p WHERE p->>'ncm'=r.ncm)),
    'customer',customer_snapshot,'company_id',actor.company_id,'branch_id',p_branch_id,'company_document',document,'attempt',previous_attempt,
    'sale',jsonb_build_object('id',sale.id,'total',sale.total,'items',sale.items,'payment_method',sale.payment_method,
      'payment_splits',to_jsonb(sale)->'payment_splits','freight_fee',to_jsonb(sale)->'freight_fee',
      'delivery_type',sale.delivery_type,'customer_type',sale.customer_type),'products',products);
END $$;
REVOKE ALL ON FUNCTION public.prepare_focus_nfe(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_focus_nfe(uuid, uuid) TO authenticated;
