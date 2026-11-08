-- New outbound-email objects only. No changes to sales/customer business functions.
BEGIN;
CREATE TABLE public.order_quote_emails (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.partner_profiles(id) ON DELETE CASCADE,
 sale_id uuid NOT NULL REFERENCES public.partner_sales(id) ON DELETE CASCADE,
 fingerprint text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','failed','unknown')),
 provider_id text,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 UNIQUE(user_id,sale_id,fingerprint)
);
CREATE INDEX order_quote_emails_company_time ON public.order_quote_emails(user_id,created_at);
ALTER TABLE public.order_quote_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_quote_emails FROM PUBLIC,anon,authenticated;
-- No direct frontend access, even within a company. Access through guarded RPCs only.

CREATE FUNCTION public.prepare_order_quote_email(p_sale_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE s public.partner_sales%ROWTYPE; op record; c record; payload jsonb; job public.order_quote_emails%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
 PERFORM partner_subscription_private.require_actor('pedidos');
 PERFORM partner_subscription_private.require_operator_module('pedidos',NULL);
 SELECT * INTO s FROM public.partner_sales WHERE id=p_sale_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido indisponível'; END IF;
 SELECT * INTO op FROM public.resolve_partner_pdv_operator(NULL,NULL,s.branch_id);
 IF s.user_id IS DISTINCT FROM op.company_id OR op.role NOT IN ('administrador','gerente','caixa','vendedor')
 OR NOT EXISTS(SELECT 1 FROM public.partner_branches WHERE id=s.branch_id AND user_id=op.company_id AND is_active=true)
 THEN RAISE EXCEPTION 'Pedido indisponível'; END IF;
 IF s.status NOT IN ('aberta','pre_venda') THEN RAISE EXCEPTION 'Pedido não está aberto'; END IF;
 SELECT id,name,email INTO c FROM public.partner_customers WHERE id=s.customer_id AND user_id=op.company_id
 AND (branch_id IS NULL OR branch_id=s.branch_id) AND is_active IS DISTINCT FROM false;
 IF NOT FOUND OR c.email IS NULL OR c.email !~ '^[^[:space:]<>,;:?&#%]+@[^[:space:]<>,;:?&#%]+[.][^[:space:]<>,;:?&#%]+$'
 OR length(c.email)>254 THEN RAISE EXCEPTION 'Cadastre um e-mail válido para o cliente'; END IF;
 payload:=jsonb_build_object('sale',jsonb_build_object('id',s.id,'sale_number',s.sale_number,'status',s.status,
 'created_at',s.created_at,'items',s.items,'total',s.total,'freight_fee',s.freight_fee,'customer_name',s.customer_name),
 'customer',jsonb_build_object('name',c.name,'email',c.email),
 'company_name',(SELECT coalesce(account_name,business_name) FROM public.partner_profiles WHERE id=op.company_id),
 'branch_name',(SELECT name FROM public.partner_branches WHERE id=s.branch_id AND user_id=op.company_id));
 -- Serialize reservations and enforce a hard company limit, independent of the browser.
 PERFORM pg_advisory_xact_lock(hashtextextended(op.company_id::text, 1701));
 SELECT * INTO job FROM public.order_quote_emails WHERE user_id=op.company_id AND sale_id=s.id AND fingerprint=md5(payload::text);
 IF FOUND THEN RETURN jsonb_build_object('id',job.id,'state',job.state,'claimed',false); END IF;
 IF (SELECT count(*) FROM public.order_quote_emails WHERE user_id=op.company_id AND created_at>now()-interval '1 hour')>=60
 THEN RAISE EXCEPTION 'Limite de e-mails por hora atingido'; END IF;
 INSERT INTO public.order_quote_emails(user_id,sale_id,fingerprint) VALUES(op.company_id,s.id,md5(payload::text)) RETURNING * INTO job;
 RETURN jsonb_build_object('id',job.id,'state',job.state,'claimed',true,'payload',payload);
END $function$;

CREATE FUNCTION public.finish_order_quote_email(p_id uuid,p_state text,p_provider_id text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
 IF p_state IS NULL OR p_state NOT IN ('accepted','failed','unknown') OR length(p_provider_id)>200
 THEN RAISE EXCEPTION 'Resultado inválido'; END IF;
 UPDATE public.order_quote_emails SET state=p_state,provider_id=p_provider_id,finished_at=now()
 WHERE id=p_id AND state='pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'Tentativa não está pendente'; END IF;
END $function$;
REVOKE ALL ON FUNCTION public.prepare_order_quote_email(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_order_quote_email(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.finish_order_quote_email(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_order_quote_email(uuid,text,text) TO service_role;
COMMIT;
