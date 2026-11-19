BEGIN;
-- The original one-argument RPC remains the complete historical contract.
-- Operational callers receive open work and a short recent list, never a partial credit balance.
CREATE FUNCTION public.get_partner_pdv_snapshot(p_branch_id uuid,p_operational boolean,p_known_sales uuid[],p_known_invoices uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE company uuid; operator_id uuid; operator_role text; result jsonb;
BEGIN
 IF p_operational IS DISTINCT FROM true THEN RETURN public.get_partner_pdv_snapshot(p_branch_id); END IF;
 PERFORM partner_subscription_private.require_actor('pdv');
 SELECT op.company_id,op.salesperson_id,op.role INTO company,operator_id,operator_role FROM public.resolve_partner_pdv_operator(NULL,NULL,p_branch_id) op;
 IF operator_role IS NULL OR operator_role NOT IN ('administrador','gerente','caixa','vendedor','atendente') THEN RAISE EXCEPTION 'Acesso negado ao PDV'; END IF;
 IF p_branch_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.partner_branches b WHERE b.id=p_branch_id AND b.user_id=company) THEN RAISE EXCEPTION 'Filial inválida'; END IF;
 IF coalesce(cardinality(p_known_sales),0)>5000 OR coalesce(cardinality(p_known_invoices),0)>5000 THEN RAISE EXCEPTION 'Quantidade de registros inválida.'; END IF;
 WITH authorized_sales AS NOT MATERIALIZED (
  SELECT s.* FROM public.partner_sales s WHERE s.user_id=company AND s.branch_id=p_branch_id
   AND (company=(SELECT auth.uid()) OR public.partner_employee_can_operate_sale(s.user_id,s.branch_id,s.salesperson_id))
 ), recent AS (SELECT id FROM authorized_sales ORDER BY created_at DESC,id LIMIT 30),
 credit_usage AS (
  SELECT i.customer_id,SUM(i.amount-coalesce(i.paid_amount,0)) AS used FROM public.partner_invoices i
  WHERE i.user_id=company AND i.status IN ('aberta','vencida','parcial','pending') GROUP BY i.customer_id
 )
 SELECT jsonb_build_object(
  'operational',true,
  'products',coalesce((SELECT jsonb_agg(p) FROM public.partner_products p WHERE p.user_id=company AND p.branch_id=p_branch_id),'[]'::jsonb),
  'sales',coalesce((SELECT jsonb_agg(s ORDER BY s.created_at DESC,s.id) FROM authorized_sales s WHERE s.status IN ('aberta','pre_venda') OR s.id=ANY(coalesce(p_known_sales,'{}'::uuid[])) OR s.id IN(SELECT id FROM recent)),'[]'::jsonb),
  'invoices',coalesce((SELECT jsonb_agg(i ORDER BY i.due_date,i.id) FROM public.partner_invoices i WHERE i.user_id=company AND i.branch_id=p_branch_id
   AND (i.status IN ('aberta','vencida','parcial','pending') OR i.id=ANY(coalesce(p_known_invoices,'{}'::uuid[])))
   AND (company=(SELECT auth.uid()) OR EXISTS(SELECT 1 FROM authorized_sales s WHERE s.id=i.sale_id))),'[]'::jsonb),
  'movements','[]'::jsonb,
  'credits',coalesce((SELECT jsonb_agg(jsonb_build_object('customer_id',c.id,'allow_credit',c.allow_credit,'credit_limit',c.credit_limit,
    'used',coalesce(u.used,0),'available',c.credit_limit-coalesce(u.used,0)))
   FROM public.partner_customers c LEFT JOIN credit_usage u ON u.customer_id=c.id
   WHERE c.user_id=company AND (c.branch_id IS NULL OR c.branch_id=p_branch_id)),'[]'::jsonb),
  'return_credits',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'customer_id',r.customer_id,'branch_id',r.branch_id,'product_name',r.product_name,
    'status',r.status,'credit_amount',r.credit_amount,'credit_used_amount',coalesce(used.amount,0)))
   FROM public.rma_requests_v2 r LEFT JOIN LATERAL(SELECT SUM(a.amount) AS amount FROM public.partner_rma_credit_applications a WHERE a.rma_id=r.id) used ON true
   WHERE r.user_id=company AND r.branch_id=p_branch_id AND r.status='credito_gerado' AND r.credit_amount>coalesce(used.amount,0)),'[]'::jsonb)
 ) INTO result;
 RETURN result;
END; $fn$;
REVOKE ALL ON FUNCTION public.get_partner_pdv_snapshot(uuid,boolean,uuid[],uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_partner_pdv_snapshot(uuid,boolean,uuid[],uuid[]) TO authenticated;
COMMIT;
