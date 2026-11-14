-- Novos dados ficam vazios nos registros antigos; não inferimos datas nem formas de pagamento.
ALTER TABLE public.partner_payables
  ADD COLUMN purchased_on date,
  ADD COLUMN payment_method text,
  ADD COLUMN payment_method_detail text,
  ADD COLUMN purchase_id uuid,
  ADD COLUMN installment_number integer,
  ADD COLUMN installment_count integer,
  ADD COLUMN purchase_total numeric(14,2),
  ADD CONSTRAINT payable_method_valid CHECK (payment_method IS NULL OR payment_method IN
    ('nao_informado','pix','dinheiro','cartao_debito','cartao_credito','boleto','transferencia','cheque','outro')),
  ADD CONSTRAINT payable_method_detail_valid CHECK (
    (payment_method='outro' AND length(trim(payment_method_detail)) BETWEEN 1 AND 80 AND payment_method_detail IS NOT NULL)
    OR (payment_method IS DISTINCT FROM 'outro' AND payment_method_detail IS NULL)),
  ADD CONSTRAINT payable_installment_valid CHECK (
    (purchase_id IS NULL AND installment_number IS NULL AND installment_count IS NULL AND purchase_total IS NULL)
    OR (purchase_id IS NOT NULL AND installment_number IS NOT NULL AND installment_count IS NOT NULL AND purchase_total IS NOT NULL
      AND installment_count BETWEEN 1 AND 120 AND installment_number BETWEEN 1 AND installment_count AND purchase_total>=amount)),
  ADD CONSTRAINT payable_purchase_installment_unique UNIQUE(purchase_id,installment_number);
ALTER TABLE public.partner_payable_payments
  ADD COLUMN payment_method text,
  ADD COLUMN payment_method_detail text,
  ADD CONSTRAINT payable_paid_method_valid CHECK (payment_method IS NULL OR payment_method IN
    ('nao_informado','pix','dinheiro','cartao_debito','cartao_credito','boleto','transferencia','cheque','outro')),
  ADD CONSTRAINT payable_paid_method_detail_valid CHECK (
    (payment_method='outro' AND length(trim(payment_method_detail)) BETWEEN 1 AND 80 AND payment_method_detail IS NOT NULL)
    OR (payment_method IS DISTINCT FROM 'outro' AND payment_method_detail IS NULL));

CREATE FUNCTION public.create_partner_payable_purchase(
 p_purchase_id uuid,p_branch_id uuid,p_supplier_id uuid,p_description text,p_creditor_name text,p_category text,
 p_total numeric,p_purchased_on date,p_payment_method text,p_payment_method_detail text,p_installments jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_auth uuid := (SELECT auth.uid()); v_count integer; v_number integer:=0; v_item jsonb;
 v_id uuid; v_amount numeric; v_due date; v_existing public.partner_payables%ROWTYPE;
 v_detail text:=nullif(trim(p_payment_method_detail),'');
BEGIN
 PERFORM partner_subscription_private.require_actor('financeiro');
 IF v_auth IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
 IF p_purchase_id IS NULL OR p_total IS NULL OR p_total::text IN ('NaN','Infinity','-Infinity')
   OR p_total<=0 OR p_total<>round(p_total,2) OR p_total>999999999999.99
   THEN RAISE EXCEPTION 'Valor total inválido'; END IF;
 IF p_purchased_on IS NULL OR NOT isfinite(p_purchased_on) OR p_purchased_on<DATE '0001-01-01'
   OR p_purchased_on>(now() AT TIME ZONE 'America/Sao_Paulo')::date
   THEN RAISE EXCEPTION 'Informe a data real da compra, até hoje'; END IF;
 IF p_payment_method IS NULL OR p_payment_method NOT IN
   ('nao_informado','pix','dinheiro','cartao_debito','cartao_credito','boleto','transferencia','cheque','outro')
   OR (p_payment_method='outro' AND (v_detail IS NULL OR length(v_detail)>80))
   OR (p_payment_method<>'outro' AND v_detail IS NOT NULL)
   THEN RAISE EXCEPTION 'Forma de pagamento inválida'; END IF;
 IF p_installments IS NULL OR jsonb_typeof(p_installments)<>'array' THEN RAISE EXCEPTION 'Parcelas inválidas'; END IF;
 v_count:=jsonb_array_length(p_installments);
 IF v_count<1 OR v_count>120 THEN RAISE EXCEPTION 'Informe entre 1 e 120 parcelas'; END IF;
 IF (SELECT sum((item->>'amount')::numeric) FROM jsonb_array_elements(p_installments) item) IS DISTINCT FROM p_total
   OR (SELECT count(DISTINCT item->>'id') FROM jsonb_array_elements(p_installments) item)<>v_count
   THEN RAISE EXCEPTION 'As parcelas devem somar o valor total e ter identificadores únicos'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.partner_branches WHERE id=p_branch_id AND user_id=v_auth)
   THEN RAISE EXCEPTION 'Filial não pertence ao proprietário autenticado'; END IF;
 IF p_supplier_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.partner_suppliers WHERE id=p_supplier_id AND user_id=v_auth)
   THEN RAISE EXCEPTION 'Fornecedor não pertence à loja'; END IF;
 -- A compra inteira é confirmada em uma transação; repetições usam o mesmo identificador.
 PERFORM pg_advisory_xact_lock(hashtextextended(v_auth::text||':'||p_purchase_id::text,0));
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_installments) LOOP
   v_number:=v_number+1;
   v_id:=(v_item->>'id')::uuid; v_amount:=(v_item->>'amount')::numeric; v_due:=(v_item->>'due_date')::date;
   IF v_id IS NULL OR v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity')
     OR v_amount<=0 OR v_amount<>round(v_amount,2) OR v_due IS NULL OR NOT isfinite(v_due)
     OR v_due<DATE '0001-01-01' OR v_due>DATE '9998-12-31'
     THEN RAISE EXCEPTION 'Valor ou vencimento de parcela inválido'; END IF;
   INSERT INTO public.partner_payables(id,user_id,branch_id,supplier_id,description,creditor_name,category,amount,due_date,
     purchased_on,payment_method,payment_method_detail,purchase_id,installment_number,installment_count,purchase_total)
   VALUES(v_id,v_auth,p_branch_id,p_supplier_id,trim(p_description),trim(p_creditor_name),p_category,v_amount,v_due,
     p_purchased_on,p_payment_method,v_detail,p_purchase_id,v_number,v_count,p_total) ON CONFLICT DO NOTHING;
   SELECT * INTO v_existing FROM public.partner_payables WHERE id=v_id AND user_id=v_auth;
   IF NOT FOUND OR v_existing.branch_id IS DISTINCT FROM p_branch_id OR v_existing.supplier_id IS DISTINCT FROM p_supplier_id
     OR v_existing.description IS DISTINCT FROM trim(p_description) OR v_existing.creditor_name IS DISTINCT FROM trim(p_creditor_name)
     OR v_existing.category IS DISTINCT FROM p_category OR v_existing.amount IS DISTINCT FROM v_amount
     OR v_existing.due_date IS DISTINCT FROM v_due OR v_existing.purchased_on IS DISTINCT FROM p_purchased_on
     OR v_existing.payment_method IS DISTINCT FROM p_payment_method OR v_existing.payment_method_detail IS DISTINCT FROM v_detail
     OR v_existing.purchase_id IS DISTINCT FROM p_purchase_id OR v_existing.installment_number IS DISTINCT FROM v_number
     OR v_existing.installment_count IS DISTINCT FROM v_count OR v_existing.purchase_total IS DISTINCT FROM p_total
     THEN RAISE EXCEPTION 'Compra diverge da tentativa original'; END IF;
 END LOOP;
 RETURN p_purchase_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_partner_payable_purchase(uuid,uuid,uuid,text,text,text,numeric,date,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_partner_payable_purchase(uuid,uuid,uuid,text,text,text,numeric,date,text,text,jsonb) TO authenticated;

CREATE FUNCTION public.record_partner_payable_payment_details(
 p_payable_id uuid,p_amount numeric,p_payment_id uuid,p_payment_date date,p_payment_method text,p_payment_method_detail text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_auth uuid:=(SELECT auth.uid()); v_existing public.partner_payable_payments%ROWTYPE;
 v_detail text:=nullif(trim(p_payment_method_detail),'');
BEGIN
 PERFORM partner_subscription_private.require_actor('financeiro');
 IF v_auth IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
 IF p_payment_method IS NULL OR p_payment_method NOT IN
   ('nao_informado','pix','dinheiro','cartao_debito','cartao_credito','boleto','transferencia','cheque','outro')
   OR (p_payment_method='outro' AND (v_detail IS NULL OR length(v_detail)>80))
   OR (p_payment_method<>'outro' AND v_detail IS NOT NULL)
   THEN RAISE EXCEPTION 'Forma de pagamento inválida'; END IF;
 PERFORM 1 FROM public.partner_payables WHERE id=p_payable_id AND user_id=v_auth FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada ou acesso negado'; END IF;
 SELECT * INTO v_existing FROM public.partner_payable_payments WHERE id=p_payment_id;
 IF FOUND AND (v_existing.user_id IS DISTINCT FROM v_auth OR v_existing.payable_id IS DISTINCT FROM p_payable_id
   OR v_existing.payment_method IS DISTINCT FROM p_payment_method OR v_existing.payment_method_detail IS DISTINCT FROM v_detail)
   THEN RAISE EXCEPTION 'Pagamento diverge da tentativa original'; END IF;
 -- Reutiliza a validação de data, valor, saldo e repetição já testada.
 PERFORM public.record_partner_payable_payment_dated(p_payable_id,p_amount,p_payment_id,p_payment_date);
 UPDATE public.partner_payable_payments SET payment_method=p_payment_method,payment_method_detail=v_detail
   WHERE id=p_payment_id AND user_id=v_auth;
 RETURN p_payable_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_partner_payable_payment_details(uuid,numeric,uuid,date,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_partner_payable_payment_details(uuid,numeric,uuid,date,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
