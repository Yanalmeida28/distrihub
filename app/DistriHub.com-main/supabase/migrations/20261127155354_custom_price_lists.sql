BEGIN;

CREATE TABLE public.partner_price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
  base_table text NOT NULL CHECK (base_table IN ('varejo', 'atacado', 'premium')),
  adjustment_bps integer NOT NULL CHECK (adjustment_bps BETWEEN -10000 AND 100000),
  UNIQUE (id, user_id)
);
CREATE UNIQUE INDEX partner_price_lists_unique_name ON public.partner_price_lists (user_id, lower(name));
ALTER TABLE public.partner_price_lists ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_price_lists FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.partner_price_lists TO authenticated;
GRANT UPDATE (name, base_table, adjustment_bps) ON public.partner_price_lists TO authenticated;
CREATE POLICY read_price_lists ON public.partner_price_lists FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR EXISTS (
  SELECT 1 FROM public.partner_branches branch
  WHERE branch.user_id = partner_price_lists.user_id
    AND public.partner_employee_can_access_branch(branch.user_id, branch.id)
));
CREATE POLICY insert_price_lists ON public.partner_price_lists FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()) AND public.partner_has_saas_access(user_id, 'cadastros'));
CREATE POLICY update_price_lists ON public.partner_price_lists FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()) AND public.partner_has_saas_access(user_id, 'cadastros'))
WITH CHECK (user_id = (SELECT auth.uid()) AND public.partner_has_saas_access(user_id, 'cadastros'));

CREATE TABLE public.partner_price_list_items (
  price_list_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.partner_products(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  branch_id uuid NOT NULL REFERENCES public.partner_branches(id) ON DELETE CASCADE,
  price numeric NOT NULL CHECK (price BETWEEN 0 AND 99999999.99 AND price = round(price, 2)),
  PRIMARY KEY (price_list_id, product_id),
  FOREIGN KEY (price_list_id, user_id) REFERENCES public.partner_price_lists(id, user_id) ON DELETE CASCADE
);
CREATE INDEX partner_price_list_items_scope ON public.partner_price_list_items (user_id, branch_id);
ALTER TABLE public.partner_price_list_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_price_list_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_price_list_items TO authenticated;
CREATE POLICY read_price_list_items ON public.partner_price_list_items FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR public.partner_employee_can_access_branch(user_id, branch_id));
CREATE POLICY write_price_list_items ON public.partner_price_list_items FOR ALL TO authenticated
USING (user_id = (SELECT auth.uid()) AND public.partner_has_saas_access(user_id, 'cadastros'))
WITH CHECK (user_id = (SELECT auth.uid()) AND public.partner_has_saas_access(user_id, 'cadastros')
  AND EXISTS (SELECT 1 FROM public.partner_products product WHERE product.id = partner_price_list_items.product_id
    AND product.user_id = partner_price_list_items.user_id AND product.branch_id = partner_price_list_items.branch_id));

CREATE FUNCTION partner_cash_private.guard_customer_price_list() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.price_table LIKE 'lista:%' AND NOT EXISTS (
    SELECT 1 FROM public.partner_price_lists price_list
    WHERE price_list.user_id = NEW.user_id AND 'lista:' || price_list.id::text = NEW.price_table
  ) THEN RAISE EXCEPTION 'Tabela de preços personalizada inválida para esta empresa.' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION partner_cash_private.guard_customer_price_list() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_customer_price_list
BEFORE INSERT OR UPDATE OF price_table, user_id ON public.partner_customers
FOR EACH ROW EXECUTE FUNCTION partner_cash_private.guard_customer_price_list();

-- Preserve the existing validation and permissions for negotiated prices. Only
-- extend the calculation of the authoritative unit price for a customer.
DO $migration$
DECLARE
  definition text := pg_get_functiondef('partner_cash_private.validate_partner_pdv_negotiated_prices(uuid,uuid,uuid,text,jsonb,numeric,boolean)'::regprocedure);
  old_guard text := $old$IF v_table NOT IN ('varejo','atacado','premium') THEN RAISE EXCEPTION 'Tabela de preços inválida'; END IF;$old$;
  item_loop text := 'FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP';
  old_price text := $old$THEN v_product.wholesale_price ELSE v_product.sale_price END;$old$;
BEGIN
  IF strpos(definition, old_guard) = 0 OR strpos(definition, old_price) = 0 OR strpos(definition, 'v_item jsonb;') = 0 OR strpos(definition, item_loop) = 0 THEN
    RAISE EXCEPTION 'A função de preços do PDV mudou. Confira a migração.';
  END IF;
  definition := replace(definition, 'v_item jsonb;', 'v_item jsonb; v_list_id uuid; v_adjustment integer := 0; v_list_prices jsonb;');
  definition := replace(definition, old_guard, $new$
    IF v_table LIKE 'lista:%' THEN
      SELECT list.id, list.base_table, list.adjustment_bps
      INTO v_list_id, v_table, v_adjustment
      FROM public.partner_price_lists list
      WHERE list.user_id = p_company AND 'lista:' || list.id::text = v_table
      FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Tabela de preços personalizada indisponível.'; END IF;
    ELSIF v_table NOT IN ('varejo','atacado','premium') THEN
      RAISE EXCEPTION 'Tabela de preços inválida';
    END IF;$new$);
  definition := replace(definition, item_loop, $new$
    IF v_list_id IS NOT NULL THEN
      SELECT jsonb_object_agg(item.product_id, item.price) INTO v_list_prices
      FROM public.partner_price_list_items item
      WHERE item.price_list_id = v_list_id AND item.user_id = p_company AND item.branch_id = p_branch
        AND item.product_id IN (SELECT (x->>'product_id')::uuid FROM jsonb_array_elements(p_items) x);
    END IF;
  $new$ || item_loop);
  definition := replace(definition, old_price, old_price || $new$
    IF v_list_id IS NOT NULL THEN
      v_price := COALESCE(
        (v_list_prices->>v_product.id::text)::numeric,
        round(v_price * (10000 + v_adjustment) / 10000, 2)
      );
    END IF;$new$);
  EXECUTE definition;
END;
$migration$;

COMMIT;
