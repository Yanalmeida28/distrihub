-- A data efetiva do pagamento é separada do instante em que ele foi registrado.
-- Registros anteriores permanecem nulos e usam created_at nas consultas.
ALTER TABLE public.partner_payable_payments ADD COLUMN paid_at timestamptz;
ALTER TABLE public.partner_payable_payments ALTER COLUMN paid_at SET DEFAULT now();
COMMENT ON COLUMN public.partner_payable_payments.paid_at IS 'Data efetiva do pagamento; created_at preserva o instante do registro. Nulo em registros anteriores à migração.';

CREATE FUNCTION public.record_partner_payable_payment_dated(
  p_payable_id uuid, p_amount numeric, p_payment_id uuid, p_payment_date date
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_auth uuid := (SELECT auth.uid());
  v_account public.partner_payables%ROWTYPE;
  v_payment public.partner_payable_payments%ROWTYPE;
  v_paid numeric;
BEGIN
  PERFORM partner_subscription_private.require_actor('financeiro');
  IF v_auth IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF p_payment_id IS NULL OR p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity')
    OR p_amount <= 0 OR p_amount <> round(p_amount,2) THEN RAISE EXCEPTION 'Pagamento inválido'; END IF;
  IF p_payment_date IS NULL OR NOT isfinite(p_payment_date) OR p_payment_date < DATE '0001-01-01'
    OR p_payment_date > (now() AT TIME ZONE 'America/Sao_Paulo')::date
    THEN RAISE EXCEPTION 'Informe a data real do pagamento, até hoje'; END IF;
  -- A trava serializa pagamentos parciais e repetições da mesma tentativa.
  SELECT * INTO v_account FROM public.partner_payables WHERE id=p_payable_id AND user_id=v_auth FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada ou acesso negado'; END IF;
  SELECT * INTO v_payment FROM public.partner_payable_payments WHERE id=p_payment_id;
  IF FOUND THEN
    IF v_payment.user_id=v_auth AND v_payment.payable_id=p_payable_id AND v_payment.amount=p_amount
      AND (coalesce(v_payment.paid_at,v_payment.created_at) AT TIME ZONE 'America/Sao_Paulo')::date=p_payment_date
      THEN RETURN p_payable_id; END IF;
    RAISE EXCEPTION 'Pagamento diverge da tentativa original';
  END IF;
  IF v_account.status NOT IN ('aberta','parcial') OR p_amount > v_account.amount-v_account.paid_amount
    THEN RAISE EXCEPTION 'Pagamento excede saldo ou conta encerrada'; END IF;
  INSERT INTO public.partner_payable_payments(id,payable_id,user_id,amount,paid_at)
    VALUES(p_payment_id,p_payable_id,v_auth,p_amount,
      (p_payment_date + TIME '12:00:00') AT TIME ZONE 'America/Sao_Paulo');
  v_paid := v_account.paid_amount+p_amount;
  UPDATE public.partner_payables SET paid_amount=v_paid,status=CASE WHEN v_paid=amount THEN 'paga' ELSE 'parcial' END
    WHERE id=p_payable_id;
  RETURN p_payable_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_partner_payable_payment_dated(uuid,numeric,uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_partner_payable_payment_dated(uuid,numeric,uuid,date) TO authenticated;
NOTIFY pgrst, 'reload schema';
