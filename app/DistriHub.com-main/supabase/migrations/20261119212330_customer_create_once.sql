BEGIN;
-- Atomic receipt and customer creation; no PIN/token enters the receipt payload.
CREATE FUNCTION public.create_partner_customer_once(p_request_id uuid,p_customer jsonb,p_operator_id uuid DEFAULT NULL,p_operator_pin text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid:=auth.uid(); op record; branch uuid; receipt partner_operations_private.operation_requests%ROWTYPE; payload jsonb; customer uuid;
BEGIN
 IF actor IS NULL OR p_request_id IS NULL OR jsonb_typeof(p_customer) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Cadastro sem identificação válida.'; END IF;
 branch:=(p_customer->>'branch_id')::uuid;
 PERFORM partner_subscription_private.require_actor('cadastros');
 SELECT * INTO op FROM public.resolve_partner_operator(p_operator_id,p_operator_pin,branch);
 IF branch IS NULL OR op.branch_id IS DISTINCT FROM branch OR op.company_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.partner_branches b WHERE b.id=branch AND b.user_id=op.company_id AND b.is_active) THEN RAISE EXCEPTION 'Filial não autorizada.'; END IF;
 payload:=jsonb_build_object('company',op.company_id,'operator',p_operator_id,'customer',p_customer);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':customer-create:'||p_request_id::text,0));
 SELECT * INTO receipt FROM partner_operations_private.operation_requests WHERE actor_id=actor AND kind='customer-create' AND request_id=p_request_id;
 IF FOUND THEN
  IF receipt.payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Esta tentativa já identifica outro cadastro.'; END IF;
  RETURN (receipt.result->>'id')::uuid;
 END IF;
 customer:=public.execute_partner_customer_mutation(p_operator_id,p_operator_pin,NULL,branch,p_customer->>'name',p_customer->>'document',p_customer->>'phone',p_customer->>'email',
  (p_customer->>'birthday')::date,p_customer->>'address',p_customer->>'neighborhood',p_customer->>'city',p_customer->>'device_model',p_customer->>'notes',
  coalesce(p_customer->>'customer_type','varejo'),coalesce((p_customer->>'credit_limit')::numeric,0),coalesce((p_customer->>'allow_credit')::boolean,false));
 IF customer IS NULL THEN RAISE EXCEPTION 'O banco não confirmou o cadastro.'; END IF;
 INSERT INTO partner_operations_private.operation_requests(actor_id,kind,request_id,payload,result) VALUES(actor,'customer-create',p_request_id,payload,jsonb_build_object('id',customer));
 RETURN customer;
END; $fn$;
REVOKE ALL ON FUNCTION public.create_partner_customer_once(uuid,jsonb,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_partner_customer_once(uuid,jsonb,uuid,text) TO authenticated;
COMMIT;
