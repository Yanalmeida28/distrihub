-- Serialize every attempt before validation. Replays return the committed result even
-- after the catalog or branch is disabled. PDC01 means a locked, definitive rejection;
-- network errors and ambiguous failures must retain the original request ID.
CREATE OR REPLACE FUNCTION public.place_catalog_order(p_request_id uuid,p_slug text,p_branch_id uuid,p_items jsonb,
 p_business_name text,p_contact text,p_delivery_address text,p_payment_method text,p_delivery_method text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid:=auth.uid(); company uuid; payload jsonb; request partner_operations_private.operation_requests%ROWTYPE;
 item jsonb; product public.partner_products%ROWTYPE; quantity integer; canonical_items jsonb:='[]'::jsonb; amount numeric:=0; result jsonb;
BEGIN
 IF actor IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Entre na conta para enviar o pedido.'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':catalog-order:'||p_request_id::text,0));
 SELECT * INTO request FROM partner_operations_private.operation_requests WHERE actor_id=actor AND kind='catalog-order' AND request_id=p_request_id;
 IF FOUND THEN
  company := (request.payload->>'company')::uuid;
 payload:=jsonb_build_object('company',company,'branch',p_branch_id,'items',p_items,'name',trim(p_business_name),'contact',trim(p_contact),'address',trim(p_delivery_address),'payment',p_payment_method,'delivery',p_delivery_method);
  IF request.payload<>payload THEN RAISE EXCEPTION 'Esta tentativa já identifica outro pedido.'; END IF;
  RETURN request.result;
 END IF;
 IF coalesce(length(trim(p_business_name)),0)<2 OR length(p_business_name)>200 OR coalesce(length(trim(p_contact)),0)<5 OR length(p_contact)>100 OR p_payment_method IS NULL OR p_payment_method NOT IN ('pix','cartao') OR p_delivery_method IS NULL OR p_delivery_method NOT IN ('balcao','entrega') THEN RAISE EXCEPTION USING ERRCODE = 'PDC01', MESSAGE = 'Dados do pedido inválidos.'; END IF;
 IF p_delivery_method='entrega' AND coalesce(length(trim(p_delivery_address)),0)<5 THEN RAISE EXCEPTION USING ERRCODE = 'PDC01', MESSAGE = 'Informe o endereço de entrega.'; END IF;
 IF coalesce(length(p_delivery_address),0)>1500 THEN RAISE EXCEPTION USING ERRCODE = 'PDC01', MESSAGE = 'Endereço muito longo.'; END IF;
 SELECT s.user_id INTO company FROM public.store_settings_v2 s JOIN public.partner_branches b ON b.user_id=s.user_id AND b.id=p_branch_id AND b.is_active
  WHERE s.catalog_enabled AND lower(s.catalog_slug)=lower(trim(p_slug));
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PDC01', MESSAGE = 'Catálogo ou filial indisponível.'; END IF;
 PERFORM partner_subscription_private.require_access(company,'pedidos');
 payload:=jsonb_build_object('company',company,'branch',p_branch_id,'items',p_items,'name',trim(p_business_name),'contact',trim(p_contact),'address',trim(p_delivery_address),'payment',p_payment_method,'delivery',p_delivery_method);

 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE = 'PDC01', MESSAGE = 'Selecione os produtos.'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_items))<>(SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_items)) THEN RAISE EXCEPTION USING ERRCODE = 'PDC01', MESSAGE = 'Produto repetido no pedido.'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'id' LOOP
  IF (item->>'quantity')::numeric<>trunc((item->>'quantity')::numeric) THEN RAISE EXCEPTION USING ERRCODE = 'PDC01', MESSAGE = 'Quantidade deve ser inteira.'; END IF;
  quantity:=(item->>'quantity')::integer;
  SELECT * INTO product FROM public.partner_products WHERE id=(item->>'id')::uuid AND user_id=company AND branch_id=p_branch_id AND NOT coalesce(is_service,false);
  IF NOT FOUND OR quantity IS NULL OR quantity<=0 OR quantity>product.stock OR product.sale_price IS NULL OR product.sale_price<=0 OR product.sale_price::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION USING ERRCODE = 'PDC01', MESSAGE = 'Produto, quantidade ou preço indisponível.'; END IF;
  amount:=amount+round(product.sale_price,2)*quantity;
  canonical_items:=canonical_items||jsonb_build_array(jsonb_build_object('id',product.id,'name',product.name,'sku',product.sku,'price',round(product.sale_price,2),'quantity',quantity));
 END LOOP;
 INSERT INTO public.catalog_orders(id,company_id,branch_id,buyer_id,business_name,contact,delivery_address,items,total,payment_method,delivery_method)
 VALUES(p_request_id,company,p_branch_id,actor,trim(p_business_name),trim(p_contact),left(p_delivery_address,1500),canonical_items,amount,p_payment_method,p_delivery_method);
 result:=jsonb_build_object('id',p_request_id,'total',amount,'items',canonical_items,'status','pendente');
 INSERT INTO partner_operations_private.operation_requests VALUES(actor,'catalog-order',p_request_id,payload,result,now());
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.place_catalog_order(uuid,text,uuid,jsonb,text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.place_catalog_order(uuid,text,uuid,jsonb,text,text,text,text,text) TO authenticated;
