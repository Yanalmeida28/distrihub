ALTER TABLE public.partner_sales ADD COLUMN observations text
  CHECK (char_length(observations) <= 1000);

-- The original sale RPCs still control authorization, stock, credit and cash.
-- Updating the note in the same transaction prevents a confirmed sale without its note.
CREATE FUNCTION public.save_pdv_sale_with_observation(
  p_sale jsonb, p_operator_id uuid, p_pin text, p_cash_session_id uuid, p_rma_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  sale_id uuid := (p_sale->>'id')::uuid;
  v_branch_id uuid := (p_sale->>'branch_id')::uuid;
  requested_status text := p_sale->>'status';
  note text := nullif(btrim(p_sale->>'observations'), '');
  previous_status text;
  previous_note text;
  actor record;
  cash_actor uuid;
  confirmed_id uuid;
BEGIN
  IF auth.uid() IS NULL OR sale_id IS NULL OR v_branch_id IS NULL
    OR requested_status IS NULL OR requested_status NOT IN ('pre_venda', 'concluida')
    OR char_length(note) > 1000 THEN
    RAISE EXCEPTION 'Dados inválidos para salvar a observação da venda' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor FROM public.resolve_partner_pdv_operator(p_operator_id, p_pin, v_branch_id);
  IF actor.company_id IS NULL THEN RAISE EXCEPTION 'Operador inválido'; END IF;
  cash_actor := coalesce(actor.salesperson_id, actor.company_id);
  IF p_cash_session_id IS NOT NULL THEN
    IF coalesce(actor.role, '') NOT IN ('administrador', 'gerente') THEN RAISE EXCEPTION 'Caixa não autorizado'; END IF;
    SELECT cs.actor_key INTO cash_actor FROM public.partner_cash_sessions cs
      WHERE cs.id = p_cash_session_id AND cs.user_id = actor.company_id AND cs.branch_id = v_branch_id;
    IF cash_actor IS NULL THEN RAISE EXCEPTION 'Caixa inválido para esta filial'; END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(actor.company_id::text || v_branch_id::text || cash_actor::text, 1));
  IF p_rma_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(sale_id::text, 7)); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(sale_id::text, 0));

  SELECT s.status, s.observations INTO previous_status, previous_note
    FROM public.partner_sales s WHERE s.id = sale_id AND s.user_id = actor.company_id AND s.branch_id = v_branch_id;

  IF previous_status = 'concluida' AND previous_note IS DISTINCT FROM note THEN
    RAISE EXCEPTION 'A observação diverge da venda já confirmada' USING ERRCODE = '22023';
  END IF;

  IF p_rma_id IS NOT NULL THEN
    confirmed_id := public.execute_partner_sale_with_rma_credit(p_sale, p_rma_id, p_operator_id, p_pin, p_cash_session_id);
  ELSIF p_cash_session_id IS NOT NULL THEN
    confirmed_id := public.supervised_execute_partner_sale_mutation(
      p_cash_session_id, p_operator_id, p_pin, sale_id, (p_sale->>'customer_id')::uuid, p_sale->>'customer_name',
      p_sale->'items', (p_sale->>'total')::numeric, p_sale->>'imei', p_sale->>'serial_number',
      p_sale->>'payment_method', v_branch_id, requested_status, p_sale->>'origin', p_sale->>'customer_type',
      p_sale->>'delivery_type', (p_sale->>'salesperson_id')::uuid, (p_sale->>'freight_fee')::numeric, p_sale->'payment_splits');
  ELSE
    confirmed_id := public.execute_partner_sale_mutation(
      p_operator_id, p_pin, sale_id, (p_sale->>'customer_id')::uuid, p_sale->>'customer_name',
      p_sale->'items', (p_sale->>'total')::numeric, p_sale->>'imei', p_sale->>'serial_number',
      p_sale->>'payment_method', v_branch_id, requested_status, p_sale->>'origin', p_sale->>'customer_type',
      p_sale->>'delivery_type', (p_sale->>'salesperson_id')::uuid, (p_sale->>'freight_fee')::numeric, p_sale->'payment_splits');
  END IF;

  IF confirmed_id IS DISTINCT FROM sale_id THEN RAISE EXCEPTION 'Venda não confirmada'; END IF;
  IF previous_status IS DISTINCT FROM 'concluida' AND previous_note IS DISTINCT FROM note THEN
    UPDATE public.partner_sales AS s SET observations = note
      WHERE s.id = confirmed_id AND s.user_id = actor.company_id AND s.branch_id = v_branch_id AND s.status = requested_status;
    IF NOT FOUND THEN RAISE EXCEPTION 'Observação não confirmada'; END IF;
  END IF;
  RETURN confirmed_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_pdv_sale_with_observation(jsonb, uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_pdv_sale_with_observation(jsonb, uuid, text, uuid, uuid) TO authenticated;
