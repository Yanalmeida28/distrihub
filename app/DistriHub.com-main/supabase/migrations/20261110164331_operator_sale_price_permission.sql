BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.partner_salespeople ADD COLUMN can_edit_sale_price boolean NOT NULL DEFAULT false;
GRANT SELECT(can_edit_sale_price) ON public.partner_salespeople TO authenticated;

-- Raw updates cannot grant this permission, even when legacy table grants exist.
CREATE FUNCTION partner_cash_private.guard_sale_price_permission() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.role IS NULL OR NEW.role NOT IN ('vendedor','caixa','atendente') THEN NEW.can_edit_sale_price:=false;END IF;
 IF ((TG_OP='INSERT' AND NEW.can_edit_sale_price) OR (TG_OP='UPDATE' AND NEW.can_edit_sale_price IS DISTINCT FROM OLD.can_edit_sale_price))
 AND current_user IS DISTINCT FROM pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.partner_salespeople'::regclass))
 THEN RAISE EXCEPTION 'Use a autorização administrativa para alterar a permissão de preços.' USING ERRCODE='42501';END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION partner_cash_private.guard_sale_price_permission() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER operator_sale_price_permission BEFORE INSERT OR UPDATE ON public.partner_salespeople
FOR EACH ROW EXECUTE FUNCTION partner_cash_private.guard_sale_price_permission();

CREATE FUNCTION public.set_partner_salesperson_price_permission(p_salesperson_id uuid,p_allowed boolean,p_operator_id uuid DEFAULT NULL,p_operator_pin text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target public.partner_salespeople; actor record;
BEGIN
 IF p_allowed IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Autorização inválida';END IF;
 PERFORM partner_subscription_private.require_actor('administrativo');
 PERFORM partner_subscription_private.require_operator_module('administrativo',p_operator_id);
 SELECT * INTO target FROM public.partner_salespeople WHERE id=p_salesperson_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador indisponível';END IF;
 SELECT * INTO actor FROM public.resolve_partner_operator(p_operator_id,p_operator_pin,target.branch_id);
 IF actor.company_id IS DISTINCT FROM target.user_id OR actor.role IS DISTINCT FROM 'administrador'
 THEN RAISE EXCEPTION 'Somente proprietário ou administrador autorizado pode liberar preços.' USING ERRCODE='42501';END IF;
 IF p_allowed AND (target.role IS NULL OR target.role NOT IN ('vendedor','caixa','atendente'))
 THEN RAISE EXCEPTION 'Permissão individual disponível para balcão, caixa e atendente.';END IF;
 UPDATE public.partner_salespeople SET can_edit_sale_price=p_allowed WHERE id=target.id;
 INSERT INTO public.partner_audit_logs(id,user_id,actor_name,actor_role,action,entity_type,entity_id,details)
 VALUES('audit-'||gen_random_uuid()::text,target.user_id,COALESCE((SELECT name FROM public.partner_salespeople WHERE id=actor.salesperson_id),'Proprietário'),'administrador',
 'Permissão de preço no PDV alterada','colaborador',target.id::text,CASE WHEN p_allowed THEN 'Edição de preço da venda autorizada' ELSE 'Edição de preço da venda revogada' END);
 RETURN p_allowed;
END$$;
REVOKE ALL ON FUNCTION public.set_partner_salesperson_price_permission(uuid,boolean,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_partner_salesperson_price_permission(uuid,boolean,uuid,text) TO authenticated;

CREATE FUNCTION partner_cash_private.operator_price_override(p_company uuid,p_operator uuid,p_branch uuid,p_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.partner_salespeople s WHERE s.id=p_operator AND s.user_id=p_company
 AND s.branch_id=p_branch AND s.role=p_role AND s.role IN ('vendedor','caixa','atendente') AND s.active=true AND s.can_edit_sale_price
 AND (s.auth_user_id=auth.uid() OR s.user_id=auth.uid()));
$$;
REVOKE ALL ON FUNCTION partner_cash_private.operator_price_override(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;

-- Extend only the existing override predicate; all PIN, stock, credit, branch,
-- quote-finalization, price bounds and total validation remain intact.
DO $patch$
DECLARE f record; definition text; old_check text:=$old$(v_role='gerente' OR (v_role='administrador' AND (SELECT auth.uid())=v_company_id))$old$; patched integer:=0; occurrences integer;
BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='partner_cash_private' AND p.proname='execute_partner_sale_mutation' LOOP
  definition:=pg_get_functiondef(f.oid);
  IF position('validate_partner_pdv_negotiated_prices' IN definition)>0 THEN
   occurrences:=(length(definition)-length(replace(definition,old_check,'')))/length(old_check);
   IF occurrences<>2 OR position('AND NOT COALESCE(v_old_status=''pre_venda'' AND p_status=''concluida'',false)' IN definition)=0
   THEN RAISE EXCEPTION 'Contrato de preços desconhecido; nenhuma alteração aplicada';END IF;
   EXECUTE replace(definition,old_check,'('||old_check||' OR partner_cash_private.operator_price_override(v_company_id,v_operator_id,p_branch_id,v_role))');
   patched:=patched+1;
  END IF;
 END LOOP;
 IF patched=0 THEN RAISE EXCEPTION 'Validador de preços da venda não localizado';END IF;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
