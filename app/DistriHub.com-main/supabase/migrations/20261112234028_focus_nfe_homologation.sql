-- Tentativas privadas. Somente o servidor processa respostas do Focus; nenhuma credencial fica no banco.
CREATE SCHEMA IF NOT EXISTS focus_nfe_private;
REVOKE ALL ON SCHEMA focus_nfe_private FROM PUBLIC, anon, authenticated;

ALTER TABLE public.fiscal_documents ADD COLUMN IF NOT EXISTS environment text,
  ADD COLUMN IF NOT EXISTS model text, ADD COLUMN IF NOT EXISTS payload jsonb;

CREATE TABLE focus_nfe_private.attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  environment text NOT NULL DEFAULT 'homologacao' CHECK (environment = 'homologacao'),
  reference text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'unknown', 'processing', 'authorized', 'rejected', 'cancelled')),
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, branch_id, sale_id, environment)
);
ALTER TABLE focus_nfe_private.attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE focus_nfe_private.attempts FROM PUBLIC, anon, authenticated;

-- Lê somente a venda autorizada. O navegador não escolhe empresa, preços, produtos ou CNPJ emitente.
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
  RETURN jsonb_build_object('customer',customer_snapshot,'company_id',actor.company_id,'branch_id',p_branch_id,'company_document',document,'attempt',previous_attempt,
    'sale',jsonb_build_object('id',sale.id,'total',sale.total,'items',sale.items,'payment_method',sale.payment_method,
      'payment_splits',to_jsonb(sale)->'payment_splits','freight_fee',to_jsonb(sale)->'freight_fee',
      'delivery_type',sale.delivery_type,'customer_type',sale.customer_type),'products',products);
END $$;
REVOKE ALL ON FUNCTION public.prepare_focus_nfe(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_focus_nfe(uuid, uuid) TO authenticated;

-- Só a Edge Function pode reservar uma tentativa. A referência é estável para a venda neste ambiente.
CREATE OR REPLACE FUNCTION public.claim_focus_nfe(p_company_id uuid, p_branch_id uuid, p_sale_id uuid, p_payload jsonb, p_retry boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE job focus_nfe_private.attempts%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.partner_sales s WHERE s.id=p_sale_id AND s.user_id=p_company_id
      AND s.branch_id=p_branch_id AND s.status='concluida') THEN RAISE EXCEPTION 'Venda não disponível.'; END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'cnpj_emitente' IS NULL THEN
    RAISE EXCEPTION 'Dados fiscais inválidos.';
  END IF;
  INSERT INTO focus_nfe_private.attempts(company_id,branch_id,sale_id,reference,payload)
  VALUES(p_company_id,p_branch_id,p_sale_id,'dhn'||replace(p_sale_id::text,'-',''),p_payload)
  ON CONFLICT(company_id,branch_id,sale_id,environment) DO NOTHING;
  SELECT * INTO job FROM focus_nfe_private.attempts a
  WHERE a.company_id=p_company_id AND a.branch_id=p_branch_id AND a.sale_id=p_sale_id AND a.environment='homologacao'
  FOR UPDATE;
  IF job.payload->>'cnpj_emitente' IS DISTINCT FROM p_payload->>'cnpj_emitente' THEN
    RAISE EXCEPTION 'O emitente da tentativa não pode mudar.';
  END IF;
  IF job.state IN ('authorized','cancelled') OR (job.state='rejected' AND NOT coalesce(p_retry,false)) OR job.lease_until>now() THEN
    RETURN jsonb_build_object('id',job.id,'reference',job.reference,'claimed',false,
      'state',CASE WHEN job.lease_until>now() THEN 'processing' ELSE job.state END,'response',job.response);
  END IF;
  -- A correção explícita após rejeição conserva a referência. Respostas incertas conservam os dados originais.
  UPDATE focus_nfe_private.attempts SET lease_id=gen_random_uuid(),lease_until=now()+interval '60 seconds',
    payload=CASE WHEN state='rejected' AND p_retry THEN p_payload ELSE payload END,updated_at=now()
  WHERE id=job.id RETURNING * INTO job;
  INSERT INTO public.fiscal_documents(id,user_id,branch_id,provider,document_type,status,provider_document_id,environment,model,payload,provider_response)
  VALUES(job.id,p_company_id,p_branch_id,'focus_homologacao','nfe','processing',job.reference,'homologation','55',job.payload,
    jsonb_build_object('environment','homologacao','sale_id',p_sale_id,'reference',job.reference))
  ON CONFLICT(id) DO NOTHING;
  RETURN jsonb_build_object('id',job.id,'reference',job.reference,'claimed',true,'lease_id',job.lease_id,
    'payload',job.payload,'state',job.state,'response',job.response);
END $$;
REVOKE ALL ON FUNCTION public.claim_focus_nfe(uuid, uuid, uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_focus_nfe(uuid, uuid, uuid, jsonb, boolean) TO service_role;

-- Resposta atrasada não sobrescreve outra execução nem um resultado final confirmado.
CREATE OR REPLACE FUNCTION public.finish_focus_nfe(p_id uuid, p_lease uuid, p_state text, p_response jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE job focus_nfe_private.attempts%ROWTYPE;
BEGIN
  IF p_state NOT IN ('unknown','processing','authorized','rejected','cancelled') OR p_state IS NULL
      OR jsonb_typeof(p_response) IS DISTINCT FROM 'object' OR p_response->>'environment' IS DISTINCT FROM 'homologacao' THEN
    RAISE EXCEPTION 'Resposta fiscal inválida.';
  END IF;
  SELECT * INTO job FROM focus_nfe_private.attempts a WHERE a.id=p_id AND a.lease_id=p_lease FOR UPDATE;
  IF NOT FOUND OR job.state IN ('authorized','cancelled') THEN RETURN false; END IF;
  UPDATE focus_nfe_private.attempts SET state=p_state,response=p_response,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=p_id;
  UPDATE public.fiscal_documents SET status=CASE WHEN p_state='unknown' THEN 'processing' ELSE p_state END,
    number=p_response->>'numero',series=p_response->>'serie',access_key=CASE WHEN p_state='authorized' THEN p_response->>'chave_nfe' ELSE access_key END,
    xml_url=p_response->>'caminho_xml_nota_fiscal',pdf_url=p_response->>'caminho_danfe',
    rejection_reason=CASE WHEN p_state='rejected' THEN p_response->>'mensagem_sefaz' ELSE NULL END,
    provider_response=jsonb_build_object('environment','homologacao','sale_id',job.sale_id,'reference',job.reference)||p_response,
    updated_at=now() WHERE id=p_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_focus_nfe(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_focus_nfe(uuid, uuid, text, jsonb) TO service_role;
