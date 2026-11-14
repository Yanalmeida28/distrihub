ALTER TABLE public.partner_payables
 ADD COLUMN revision bigint NOT NULL DEFAULT 0,
 ADD COLUMN deleted_at timestamptz,
 ADD COLUMN deletion_reason text;
ALTER TABLE public.partner_payable_payments
 ADD COLUMN voided_at timestamptz,
 ADD COLUMN void_reason text;

CREATE FUNCTION partner_subscription_private.bump_payable_revision() RETURNS trigger
 LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.revision:=OLD.revision+1; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION partner_subscription_private.bump_payable_revision() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER payable_revision BEFORE UPDATE ON public.partner_payables
 FOR EACH ROW EXECUTE FUNCTION partner_subscription_private.bump_payable_revision();

CREATE TABLE public.partner_payable_changes(
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id),
 payable_id uuid NOT NULL REFERENCES public.partner_payables(id),
 action text NOT NULL CHECK(action IN ('edit','delete')),
 request_payload jsonb NOT NULL,
 before_record jsonb NOT NULL,
 after_record jsonb NOT NULL,
 payment_history jsonb NOT NULL,
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.partner_payable_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY payable_changes_owner_read ON public.partner_payable_changes FOR SELECT TO authenticated
 USING(user_id=(SELECT auth.uid()) AND public.partner_has_saas_access(user_id,'financeiro'));
REVOKE ALL ON public.partner_payable_changes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.partner_payable_changes TO authenticated;
CREATE INDEX payable_changes_owner_account ON public.partner_payable_changes(user_id,payable_id,created_at);

CREATE FUNCTION public.manage_partner_payable(
 p_payable_id uuid,p_action text,p_changes jsonb,p_expected_revision bigint,p_request_id uuid,p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_auth uuid:=(SELECT auth.uid()); v_account public.partner_payables%ROWTYPE;
 v_event public.partner_payable_changes%ROWTYPE; v_next jsonb; v_before jsonb; v_after jsonb; v_history jsonb;
 v_request jsonb; v_reason text:=nullif(trim(p_reason),''); v_group uuid;
 v_description text; v_creditor text; v_category text; v_supplier uuid; v_amount numeric; v_due date;
 v_purchase date; v_method text; v_detail text; v_paid numeric; v_total numeric;
BEGIN
 PERFORM partner_subscription_private.require_actor('financeiro');
 IF v_auth IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
 IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0 OR p_action IS NULL
   OR p_action NOT IN ('edit','delete') OR p_changes IS NULL OR jsonb_typeof(p_changes)<>'object'
   THEN RAISE EXCEPTION 'Solicitação de alteração inválida'; END IF;
 IF v_reason IS NULL OR length(v_reason)>500 THEN RAISE EXCEPTION 'Informe o motivo da alteração, com até 500 caracteres'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_changes) field WHERE field NOT IN
   ('description','creditor_name','category','supplier_id','amount','due_date','purchased_on','payment_method','payment_method_detail'))
   OR (p_action='delete' AND p_changes<>'{}'::jsonb) THEN RAISE EXCEPTION 'Campos de alteração inválidos'; END IF;
 SELECT coalesce(purchase_id,id) INTO v_group FROM public.partner_payables WHERE id=p_payable_id AND user_id=v_auth;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada ou acesso negado'; END IF;
 -- Mesma ordem de trava da criação da compra; pagamentos também travam a conta.
 PERFORM pg_advisory_xact_lock(hashtextextended(v_auth::text||':'||v_group::text,0));
 SELECT * INTO v_account FROM public.partner_payables WHERE id=p_payable_id AND user_id=v_auth FOR UPDATE;
 v_request:=jsonb_build_object('action',p_action,'changes',p_changes,'revision',p_expected_revision,'reason',v_reason);
 SELECT * INTO v_event FROM public.partner_payable_changes WHERE id=p_request_id;
 IF FOUND THEN
   IF v_event.user_id=v_auth AND v_event.payable_id=p_payable_id AND v_event.request_payload=v_request THEN RETURN p_payable_id; END IF;
   RAISE EXCEPTION 'Alteração diverge da tentativa original';
 END IF;
 IF v_account.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Esta conta já foi excluída'; END IF;
 IF v_account.revision<>p_expected_revision THEN RAISE EXCEPTION 'A conta mudou desde que foi aberta. Atualize a lista e abra a edição novamente' USING ERRCODE='40001'; END IF;
 v_before:=to_jsonb(v_account);
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb),
   coalesce(sum(p.amount) FILTER(WHERE p.voided_at IS NULL),0)
   INTO v_history,v_paid FROM public.partner_payable_payments p WHERE p.payable_id=p_payable_id AND p.user_id=v_auth;
 IF v_account.paid_amount<>v_paid THEN RAISE EXCEPTION 'O histórico de pagamentos precisa ser conferido antes da alteração'; END IF;
 IF p_action='edit' THEN
   IF v_account.status='cancelada' THEN RAISE EXCEPTION 'Conta cancelada não pode ser editada'; END IF;
   v_next:=v_before||p_changes;
   v_description:=trim(v_next->>'description'); v_creditor:=trim(v_next->>'creditor_name'); v_category:=v_next->>'category';
   v_supplier:=(v_next->>'supplier_id')::uuid; v_amount:=(v_next->>'amount')::numeric; v_due:=(v_next->>'due_date')::date;
   v_purchase:=(v_next->>'purchased_on')::date; v_method:=v_next->>'payment_method'; v_detail:=nullif(trim(v_next->>'payment_method_detail'),'');
   IF v_description IS NULL OR length(v_description) NOT BETWEEN 1 AND 200
     OR v_creditor IS NULL OR length(v_creditor) NOT BETWEEN 1 AND 200
     OR v_category IS NULL OR v_category NOT IN ('fornecedor','aluguel','energia','salarios','impostos','outros')
     OR v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<=0
     OR v_amount<>round(v_amount,2) OR v_amount>999999999999.99
     THEN RAISE EXCEPTION 'Confira descrição, credor, categoria e valor da conta'; END IF;
   IF v_amount<v_paid THEN RAISE EXCEPTION 'O valor da conta não pode ser menor que o total já pago'; END IF;
   IF v_due IS NULL OR NOT isfinite(v_due) OR v_due<DATE '0001-01-01' OR v_due>DATE '9998-12-31'
     OR (v_purchase IS NOT NULL AND (NOT isfinite(v_purchase) OR v_purchase<DATE '0001-01-01'
       OR v_purchase>(now() AT TIME ZONE 'America/Sao_Paulo')::date))
     THEN RAISE EXCEPTION 'Confira as datas da compra e do vencimento'; END IF;
   IF v_supplier IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.partner_suppliers WHERE id=v_supplier AND user_id=v_auth)
     THEN RAISE EXCEPTION 'Fornecedor não pertence à loja'; END IF;
   IF (v_method IS NOT NULL AND v_method NOT IN ('nao_informado','pix','dinheiro','cartao_debito','cartao_credito','boleto','transferencia','cheque','outro'))
     OR (v_method='outro' AND (v_detail IS NULL OR length(v_detail)>80))
     OR (v_method IS DISTINCT FROM 'outro' AND v_detail IS NOT NULL)
     THEN RAISE EXCEPTION 'Forma de pagamento inválida'; END IF;
   -- Atualiza o total informativo da compra sem alterar valores de outras parcelas.
   IF v_account.purchase_id IS NOT NULL AND v_amount<>v_account.amount THEN
     SELECT sum(amount)-v_account.amount+v_amount INTO v_total FROM public.partner_payables
       WHERE purchase_id=v_account.purchase_id AND user_id=v_auth;
     IF v_total>999999999999.99 THEN RAISE EXCEPTION 'Total da compra excede o limite permitido'; END IF;
     -- Primeiro aumenta o total, quando necessário, para respeitar a restrição de cada parcela.
     IF v_total>v_account.purchase_total THEN
       UPDATE public.partner_payables SET purchase_total=v_total WHERE purchase_id=v_account.purchase_id AND user_id=v_auth;
     END IF;
   END IF;
   UPDATE public.partner_payables SET description=v_description,creditor_name=v_creditor,category=v_category,supplier_id=v_supplier,
     amount=v_amount,due_date=v_due,purchased_on=v_purchase,payment_method=v_method,payment_method_detail=v_detail,
     status=CASE WHEN v_paid=v_amount THEN 'paga' WHEN v_paid>0 THEN 'parcial' ELSE 'aberta' END
     WHERE id=p_payable_id;
   IF v_account.purchase_id IS NOT NULL AND v_amount<>v_account.amount AND v_total<v_account.purchase_total THEN
     UPDATE public.partner_payables SET purchase_total=v_total WHERE purchase_id=v_account.purchase_id AND user_id=v_auth;
   END IF;
 ELSE
   -- Exclusão corrige um registro indevido. Não representa devolução bancária.
   UPDATE public.partner_payable_payments SET voided_at=now(),void_reason=v_reason
     WHERE payable_id=p_payable_id AND user_id=v_auth AND voided_at IS NULL;
   UPDATE public.partner_payables SET status='cancelada',deleted_at=now(),deletion_reason=v_reason WHERE id=p_payable_id;
 END IF;
 SELECT to_jsonb(p) INTO v_after FROM public.partner_payables p WHERE id=p_payable_id;
 INSERT INTO public.partner_payable_changes(id,user_id,payable_id,action,request_payload,before_record,after_record,payment_history,reason)
   VALUES(p_request_id,v_auth,p_payable_id,p_action,v_request,v_before,v_after,v_history,v_reason);
 RETURN p_payable_id;
END;
$$;
REVOKE ALL ON FUNCTION public.manage_partner_payable(uuid,text,jsonb,bigint,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_partner_payable(uuid,text,jsonb,bigint,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
