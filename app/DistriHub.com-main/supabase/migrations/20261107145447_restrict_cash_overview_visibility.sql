-- Separate dashboard visibility from operational management. No PIN or authorization guard removed.
begin;
CREATE OR REPLACE FUNCTION public.read_partner_cash_register(p_branch_id uuid, p_salesperson_id uuid DEFAULT NULL, p_pin text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE op record; v_sessions jsonb; v_movements jsonb; v_actor uuid;
BEGIN
 PERFORM partner_subscription_private.require_operator_module('caixa',p_salesperson_id);
 PERFORM partner_subscription_private.require_actor('caixa');
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
 SELECT * INTO op FROM public.resolve_partner_pdv_operator(p_salesperson_id,p_pin,p_branch_id);
 IF op.role NOT IN ('administrador','gerente','caixa','vendedor') THEN RAISE EXCEPTION 'Sem permissão para acessar o caixa'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.partner_branches WHERE id=p_branch_id AND user_id=op.company_id) THEN RAISE EXCEPTION 'Filial inválida'; END IF;
 v_actor:=COALESCE(op.salesperson_id,op.company_id);
 SELECT COALESCE(jsonb_agg((to_jsonb(s) || jsonb_build_object('history_complete',op.role IN ('administrador','gerente') OR s.actor_key=v_actor)) ORDER BY s.opened_at DESC,s.id DESC),'[]'::jsonb) INTO v_sessions
 FROM public.partner_cash_sessions s WHERE s.user_id=op.company_id AND s.branch_id=p_branch_id
 AND (op.role IN ('administrador','gerente') OR s.actor_key=v_actor OR s.closed_at IS NULL
   OR EXISTS(SELECT 1 FROM public.partner_cash_movements m WHERE m.session_id=s.id AND m.performed_by=v_actor));
 SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.created_at DESC),'[]'::jsonb) INTO v_movements
 FROM public.partner_cash_movements m JOIN public.partner_cash_sessions s ON s.id=m.session_id
 WHERE s.user_id=op.company_id AND s.branch_id=p_branch_id
 AND (op.role IN ('administrador','gerente') OR s.actor_key=v_actor OR m.performed_by=v_actor);
 RETURN jsonb_build_object('sessions',v_sessions,'movements',v_movements,'actor_key',v_actor,
   'can_manage',op.role IN ('administrador','gerente'),
   'can_view_overview',op.role = 'administrador',
   'sales',(SELECT COALESCE(jsonb_agg(to_jsonb(ps) ORDER BY ps.created_at DESC),'[]'::jsonb)
     FROM public.partner_sales ps WHERE ps.user_id=op.company_id AND ps.branch_id=p_branch_id
     AND EXISTS(SELECT 1 FROM public.partner_cash_movements m JOIN public.partner_cash_sessions s ON s.id=m.session_id
       WHERE m.sale_id=ps.id AND s.user_id=op.company_id AND s.branch_id=p_branch_id
       AND (op.role IN ('administrador','gerente') OR s.actor_key=v_actor OR m.performed_by=v_actor))));
END $function$;
REVOKE ALL ON FUNCTION public.read_partner_cash_register(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_partner_cash_register(uuid,uuid,text) TO authenticated;
commit;
