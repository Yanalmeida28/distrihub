ALTER TABLE public.partner_products ADD COLUMN control_stock boolean NOT NULL DEFAULT true;

CREATE TABLE partner_cash_private.sale_without_stock (
  sale_id uuid NOT NULL REFERENCES public.partner_sales(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  product_id uuid NOT NULL,
  PRIMARY KEY (sale_id, product_id)
);
ALTER TABLE partner_cash_private.sale_without_stock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON partner_cash_private.sale_without_stock FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.save_partner_product_stock_profile(
 p_salesperson_id uuid, p_pin text, p_product_id uuid, p_branch_id uuid,
 p_name text, p_cost_price numeric, p_sale_price numeric, p_wholesale_price numeric,
 p_stock integer, p_min_stock integer, p_category text, p_sku text,
 p_is_service boolean, p_image_url text, p_supplier_id uuid, p_premium_price numeric,
 p_barcode text, p_fiscal jsonb, p_control_stock boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 actor record;
 current_stock integer;
 saved jsonb;
 product public.partner_products;
BEGIN
 IF auth.uid() IS NULL OR p_control_stock IS NULL THEN RAISE EXCEPTION 'Acesso inválido'; END IF;
 SELECT * INTO STRICT actor FROM public.resolve_partner_pdv_operator(p_salesperson_id,p_pin,p_branch_id);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.company_id::text||':'||p_branch_id::text,0));
 IF p_product_id IS NOT NULL THEN
  SELECT stock INTO STRICT current_stock FROM public.partner_products
   WHERE id=p_product_id AND user_id=actor.company_id AND branch_id=p_branch_id FOR UPDATE;
 END IF;
 IF NOT p_control_stock AND (COALESCE(current_stock,0) <> 0 OR COALESCE(p_stock,0) <> 0)
 THEN RAISE EXCEPTION 'Ajuste o saldo para zero antes de desativar o controle de estoque.'; END IF;

 -- Reuse the existing authorization, stock adjustment, price and fiscal validation.
 saved := public.save_partner_product_profile(p_salesperson_id,p_pin,p_product_id,p_branch_id,
   p_name,p_cost_price,p_sale_price,p_wholesale_price,p_stock,p_min_stock,p_category,p_sku,
   p_is_service,p_image_url,p_supplier_id,p_premium_price,p_barcode,p_fiscal);
 UPDATE public.partner_products SET control_stock=p_control_stock
  WHERE id=(saved->>'id')::uuid AND user_id=actor.company_id AND branch_id=p_branch_id
  RETURNING * INTO STRICT product;
 RETURN to_jsonb(product);
END $$;
REVOKE ALL ON FUNCTION public.save_partner_product_stock_profile(uuid,text,uuid,uuid,text,numeric,numeric,numeric,integer,integer,text,text,boolean,text,uuid,numeric,text,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_partner_product_stock_profile(uuid,text,uuid,uuid,text,numeric,numeric,numeric,integer,integer,text,text,boolean,text,uuid,numeric,text,jsonb,boolean) TO authenticated;

DO $$
DECLARE
 definition text;
 marker text := 'UPDATE public.partner_products SET stock=stock-v_quantity,updated_at=pg_catalog.now()';
 guard text := 'IF NOT COALESCE(v_is_service,false) THEN';
BEGIN
 SELECT pg_get_functiondef('partner_cash_private.execute_partner_sale_mutation(uuid,text,uuid,uuid,text,jsonb,numeric,text,text,text,uuid,text,text,text,text,uuid,numeric,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition, marker)=0 OR strpos(definition, guard)=0
   OR strpos(definition, 'SELECT branch_id,stock,is_service INTO v_product_branch,v_stock,v_is_service')=0
 THEN RAISE EXCEPTION 'Verifique a versão da função de checkout antes de migrar o controle de estoque'; END IF;

 definition := replace(definition, 'SELECT branch_id,stock,is_service INTO v_product_branch,v_stock,v_is_service',
   'SELECT branch_id,stock,(COALESCE(is_service,false) OR NOT control_stock) INTO v_product_branch,v_stock,v_is_service');
 definition := replace(definition, marker, '
      IF EXISTS (SELECT 1 FROM public.partner_products WHERE id=(v_item->>''product_id'')::uuid
        AND user_id=v_company_id AND branch_id=p_branch_id AND NOT control_stock AND NOT COALESCE(is_service,false)) THEN
        INSERT INTO partner_cash_private.sale_without_stock(sale_id,product_id) VALUES(v_target_id,(v_item->>''product_id'')::uuid);
        CONTINUE;
      END IF;
      ' || marker);
 definition := replace(definition, guard,
   'IF NOT COALESCE(v_is_service,false) AND NOT EXISTS (
      SELECT 1 FROM partner_cash_private.sale_without_stock WHERE sale_id=v_target_id AND product_id=(v_item->>''product_id'')::uuid
    ) THEN');
 EXECUTE definition;

 SELECT pg_get_functiondef(p.oid) INTO STRICT definition
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='partner_history_private' AND p.proname='execute_cancel';
 IF strpos(definition, guard)=0 THEN RAISE EXCEPTION 'Verifique a versão do cancelamento pelo histórico'; END IF;
 definition := replace(definition, guard,
   'IF NOT COALESCE(v_is_service,false) AND NOT EXISTS (
      SELECT 1 FROM partner_cash_private.sale_without_stock WHERE sale_id=v_target_id AND product_id=(v_item->>''product_id'')::uuid
    ) THEN');
 EXECUTE definition;

 SELECT pg_get_functiondef('partner_rma_private.guard_return()'::regprocedure) INTO definition;
 marker := 'IF NEW.product_id IS NULL THEN RAISE EXCEPTION';
 IF strpos(definition, marker)=0 THEN RAISE EXCEPTION 'Verifique a versão da reintegração de estoque'; END IF;
 definition := replace(definition, marker, '
    IF EXISTS (SELECT 1 FROM partner_cash_private.sale_without_stock WHERE sale_id=NEW.sale_id AND product_id=NEW.product_id)
      OR (NEW.sale_id IS NULL AND EXISTS (SELECT 1 FROM public.partner_products WHERE id=NEW.product_id AND NOT control_stock))
    THEN RAISE EXCEPTION ''Este item não teve baixa de estoque para reintegrar''; END IF;
    ' || marker);
 EXECUTE definition;
END $$;
NOTIFY pgrst, 'reload schema';
