ALTER TABLE atendimento_private.messages ADD COLUMN sender_auth uuid, ADD COLUMN sender_operator uuid;
UPDATE atendimento_private.messages m SET sender_auth=a.auth_user,sender_operator=a.operator_id
FROM atendimento_private.audit a
WHERE a.action='test_send' AND a.conversation_id=m.conversation_id
  AND m.external_id='test:send:'||a.target_id AND m.direction='outgoing';

ALTER TABLE atendimento_private.quote_preparations
  ADD COLUMN quote_version text NOT NULL DEFAULT 'legacy',
  DROP CONSTRAINT quote_preparations_conversation_id_sale_id_customer_id_key,
  ADD CONSTRAINT atendimento_quote_version_key UNIQUE (conversation_id,sale_id,customer_id,quote_version);
ALTER TABLE atendimento_private.quote_preparations ALTER COLUMN quote_version DROP DEFAULT;

CREATE OR REPLACE FUNCTION atendimento_private.workspace(
  p_company uuid, p_branch uuid, p_operator uuid, p_credential text, p_action text, p_input jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  actor record;
  channel atendimento_private.channels;
  conversation atendimento_private.conversations;
  quote public.partner_sales;
  target uuid;
  operation uuid;
  version_key text;
  quote_customer public.partner_customers;
  entitlement jsonb;
  cursor_at timestamptz;
  cursor_id uuid;
  page jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_company IS NULL OR p_branch IS NULL THEN RAISE EXCEPTION 'ATENDIMENTO_DENIED'; END IF;
  SELECT * INTO STRICT actor FROM public.resolve_partner_pdv_operator(p_operator, p_credential, p_branch);
  IF actor.company_id IS DISTINCT FROM p_company
    OR (actor.salesperson_id IS NULL AND auth.uid() IS DISTINCT FROM p_company)
    OR (actor.salesperson_id IS NOT NULL AND (actor.branch_id IS DISTINCT FROM p_branch
      OR p_operator IS DISTINCT FROM actor.salesperson_id OR COALESCE(p_credential,'') = ''))
    OR NOT EXISTS (SELECT 1 FROM public.partner_branches WHERE id=p_branch AND user_id=p_company AND is_active)
  THEN RAISE EXCEPTION 'ATENDIMENTO_DENIED'; END IF;
  entitlement := partner_subscription_private.state(p_company);
  IF NOT COALESCE((entitlement->>'can_access')::boolean, false)
  THEN RAISE EXCEPTION 'ATENDIMENTO_DENIED'; END IF;
  PERFORM partner_subscription_private.require_collaborator_module('atendimento');
  PERFORM partner_subscription_private.require_operator_module('atendimento', actor.salesperson_id);

  SELECT * INTO channel FROM atendimento_private.channels WHERE company_id=p_company AND branch_id=p_branch;
  IF p_action = 'list' THEN
    cursor_at := (p_input->>'beforeAt')::timestamptz;
    cursor_id := (p_input->>'beforeId')::uuid;
    SELECT COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY rows.updated_at DESC, rows.id DESC), '[]'::jsonb)
      INTO page FROM (
        SELECT c.id, c.phone, c.customer_id, customer.name AS customer_name, c.state,
          CASE WHEN c.assigned_owner THEN 'Proprietário' ELSE staff.name END AS assignee_name,
          c.updated_at, (c.state <> 'waiting' AND
            (c.assignee IS NOT DISTINCT FROM actor.salesperson_id AND c.assigned_owner = (actor.salesperson_id IS NULL))) AS mine
        FROM atendimento_private.conversations c
        LEFT JOIN public.partner_customers customer ON customer.id=c.customer_id AND customer.user_id=p_company
        LEFT JOIN public.partner_salespeople staff ON staff.id=c.assignee AND staff.user_id=p_company
        WHERE c.company_id=p_company AND c.branch_id=p_branch
          AND (cursor_at IS NULL OR (c.updated_at, c.id) < (cursor_at, cursor_id))
          AND (COALESCE(p_input->>'search','') = '' OR
            strpos(lower(c.phone || ' ' || COALESCE(customer.name,'')), lower(left(p_input->>'search',100))) > 0)
          AND CASE p_input->>'filter'
            WHEN 'waiting' THEN c.state='waiting'
            WHEN 'resolved' THEN c.state='resolved'
            WHEN 'mine' THEN c.state='active' AND c.assignee IS NOT DISTINCT FROM actor.salesperson_id
              AND c.assigned_owner = (actor.salesperson_id IS NULL)
            ELSE true END
        ORDER BY c.updated_at DESC, c.id DESC LIMIT 26
      ) rows;
    RETURN jsonb_build_object('schemaVersion', 2, 'channel', CASE WHEN channel.provider='test' THEN 'test' ELSE 'unconfigured' END, 'rows', page);
  END IF;

  SELECT * INTO conversation FROM atendimento_private.conversations
    WHERE id=(p_input->>'conversationId')::uuid AND company_id=p_company AND branch_id=p_branch;
  IF NOT FOUND THEN RAISE EXCEPTION 'ATENDIMENTO_CONVERSATION_NOT_FOUND'; END IF;

  IF p_action = 'send_status' THEN
    target := (p_input->>'requestId')::uuid;
    RETURN COALESCE((SELECT jsonb_build_object('delivery',m.delivery)
      FROM atendimento_private.messages m
      WHERE m.company_id=p_company AND m.branch_id=p_branch AND m.conversation_id=conversation.id
        AND m.external_id='test:send:'||target AND m.direction='outgoing'
        AND m.sender_auth=auth.uid() AND m.sender_operator IS NOT DISTINCT FROM actor.salesperson_id
        AND m.body=trim(p_input->>'body')), '{}'::jsonb);
  END IF;

  IF p_action = 'history' AND p_input ? 'after' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY rows.position), '[]'::jsonb)
      INTO page FROM (
        SELECT position, direction, body, delivery, created_at FROM atendimento_private.messages
        WHERE conversation_id=conversation.id AND company_id=p_company AND branch_id=p_branch
          AND position > (p_input->>'after')::bigint
        ORDER BY position LIMIT 31
      ) rows;
    RETURN page;
  END IF;

  IF p_action = 'details' THEN
    RETURN jsonb_build_object(
      'conversation', jsonb_build_object('id',conversation.id,'phone',conversation.phone,
        'state',conversation.state,'updated_at',conversation.updated_at,'customer_id',conversation.customer_id,
        'customer_name',(SELECT name FROM public.partner_customers WHERE id=conversation.customer_id AND user_id=p_company),
        'assignee_name', CASE WHEN conversation.assigned_owner THEN 'Proprietário' ELSE
          (SELECT name FROM public.partner_salespeople WHERE id=conversation.assignee AND user_id=p_company) END,
        'mine', conversation.state <> 'waiting' AND conversation.assignee IS NOT DISTINCT FROM actor.salesperson_id
          AND conversation.assigned_owner = (actor.salesperson_id IS NULL)),
      'operators', (SELECT COALESCE(jsonb_agg(to_jsonb(rows)), '[]') FROM (
        SELECT id, name FROM public.partner_salespeople op WHERE op.user_id=p_company AND op.active
          AND op.id IS DISTINCT FROM actor.salesperson_id AND NOT ('atendimento'=ANY(op.blocked_modules))
          AND partner_access_private.has_branch(op.id,p_company,p_branch) ORDER BY name,id
      ) rows),
      'quotes', (SELECT COALESCE(jsonb_agg(to_jsonb(rows)), '[]') FROM (
        SELECT id, total FROM public.partner_sales WHERE user_id=p_company AND branch_id=p_branch
          AND customer_id=conversation.customer_id AND status IN ('aberta','pre_venda')
          AND entitlement->'features' ? 'pedidos'
          AND NOT EXISTS (SELECT 1 FROM public.partner_salespeople op
            WHERE op.id=actor.salesperson_id AND 'pedidos'=ANY(op.blocked_modules))
        ORDER BY id LIMIT 100
      ) rows)
    );
  END IF;

  IF p_action = 'history' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY rows.position DESC), '[]'::jsonb)
      INTO page FROM (
        SELECT position, direction, body, delivery, created_at
        FROM atendimento_private.messages m
        WHERE m.conversation_id=conversation.id AND m.company_id=p_company AND m.branch_id=p_branch
          AND ((p_input->>'before') IS NULL OR m.position < (p_input->>'before')::bigint)
        ORDER BY m.position DESC LIMIT 31
      ) rows;
    RETURN page;
  END IF;

  SELECT * INTO STRICT conversation FROM atendimento_private.conversations
    WHERE id=conversation.id AND company_id=p_company AND branch_id=p_branch
    FOR UPDATE;
  IF p_action = 'assume' THEN
    IF conversation.state <> 'waiting' THEN RAISE EXCEPTION 'ATENDIMENTO_ALREADY_ASSIGNED'; END IF;
    UPDATE atendimento_private.conversations SET state='active', assignee=actor.salesperson_id,
      assigned_owner=(actor.salesperson_id IS NULL), updated_at=now() WHERE id=conversation.id;
  ELSE
    IF conversation.state <> 'active' OR conversation.assignee IS DISTINCT FROM actor.salesperson_id
       OR conversation.assigned_owner <> (actor.salesperson_id IS NULL)
    THEN RAISE EXCEPTION 'ATENDIMENTO_ASSIGNMENT_DENIED'; END IF;

    IF p_action = 'transfer' THEN
      target := (p_input->>'targetId')::uuid;
      IF target IS NULL OR target IS NOT DISTINCT FROM actor.salesperson_id OR NOT EXISTS (
        SELECT 1 FROM public.partner_salespeople op WHERE op.id=target AND op.user_id=p_company AND op.active
          AND NOT ('atendimento'=ANY(op.blocked_modules))
          AND partner_access_private.has_branch(op.id,p_company,p_branch)
      ) THEN RAISE EXCEPTION 'ATENDIMENTO_TARGET_DENIED'; END IF;
      UPDATE atendimento_private.conversations SET assignee=target, assigned_owner=false, updated_at=now()
        WHERE id=conversation.id;
    ELSIF p_action = 'resolve' THEN
      UPDATE atendimento_private.conversations SET state='resolved', updated_at=now() WHERE id=conversation.id;
    ELSIF p_action = 'link' THEN
      target := (p_input->>'targetId')::uuid;
      IF (p_input->'confirmed') IS DISTINCT FROM 'true'::jsonb OR NOT EXISTS (
        SELECT 1 FROM public.partner_customers WHERE id=target AND user_id=p_company
          AND (branch_id IS NULL OR branch_id=p_branch)
      ) THEN RAISE EXCEPTION 'ATENDIMENTO_CUSTOMER_DENIED'; END IF;
      UPDATE atendimento_private.conversations SET customer_id=target, updated_at=now() WHERE id=conversation.id;
    ELSIF p_action = 'prepare_quote' THEN
      IF NOT COALESCE(entitlement->'features' ? 'pedidos',false) THEN RAISE EXCEPTION 'ATENDIMENTO_QUOTE_DENIED'; END IF;
      PERFORM partner_subscription_private.require_collaborator_module('pedidos');
      PERFORM partner_subscription_private.require_operator_module('pedidos', actor.salesperson_id);
      target := (p_input->>'targetId')::uuid;
      SELECT * INTO quote FROM public.partner_sales
        WHERE id=target AND user_id=p_company AND branch_id=p_branch AND customer_id=conversation.customer_id
          AND status IN ('aberta','pre_venda');
      IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM public.partner_customers WHERE id=conversation.customer_id AND user_id=p_company
          AND (branch_id IS NULL OR branch_id=p_branch)
      ) THEN RAISE EXCEPTION 'ATENDIMENTO_QUOTE_DENIED'; END IF;
      SELECT * INTO STRICT quote_customer FROM public.partner_customers WHERE id=conversation.customer_id
        AND user_id=p_company AND (branch_id IS NULL OR branch_id=p_branch);
      version_key := md5(to_jsonb(quote)::text || to_jsonb(quote_customer)::text);
      INSERT INTO atendimento_private.quote_preparations (conversation_id,sale_id,customer_id,auth_user,operator_id,quote_version)
        VALUES (conversation.id,target,conversation.customer_id,auth.uid(),actor.salesperson_id,version_key)
        ON CONFLICT ON CONSTRAINT atendimento_quote_version_key DO NOTHING RETURNING id INTO operation;
      IF operation IS NULL THEN
        SELECT id INTO operation FROM atendimento_private.quote_preparations q
          WHERE conversation_id=conversation.id AND sale_id=target AND customer_id=conversation.customer_id
            AND q.quote_version=version_key;
      ELSE
        INSERT INTO atendimento_private.audit(conversation_id,auth_user,operator_id,action,target_id)
          VALUES (conversation.id,auth.uid(),actor.salesperson_id,p_action,target);
      END IF;
      RETURN jsonb_build_object('operationId',operation,'saleId',target,'sale',to_jsonb(quote),'customer',to_jsonb(quote_customer));
    ELSIF p_action = 'test_send' THEN
      target := (p_input->>'requestId')::uuid;
      IF channel.provider IS DISTINCT FROM 'test' OR target IS NULL OR
         COALESCE(length(trim(p_input->>'body')),0) NOT BETWEEN 1 AND 4096
      THEN RAISE EXCEPTION 'ATENDIMENTO_TEST_ONLY'; END IF;
      INSERT INTO atendimento_private.messages(conversation_id,company_id,branch_id,external_id,direction,body,delivery,sender_auth,sender_operator)
        VALUES (conversation.id,p_company,p_branch,'test:send:'||target,'outgoing',trim(p_input->>'body'),'submitted',auth.uid(),actor.salesperson_id)
        ON CONFLICT (company_id,branch_id,external_id) DO NOTHING;
      IF NOT FOUND THEN
        IF NOT EXISTS (SELECT 1 FROM atendimento_private.messages WHERE company_id=p_company AND branch_id=p_branch
          AND external_id='test:send:'||target AND conversation_id=conversation.id AND body=trim(p_input->>'body')
          AND sender_auth=auth.uid() AND sender_operator IS NOT DISTINCT FROM actor.salesperson_id)
        THEN RAISE EXCEPTION 'ATENDIMENTO_REQUEST_CONFLICT'; END IF;
        RETURN jsonb_build_object('ok',true);
      END IF;
      UPDATE atendimento_private.conversations SET updated_at=now() WHERE id=conversation.id;
    ELSE
      RAISE EXCEPTION 'ATENDIMENTO_ACTION_INVALID';
    END IF;
  END IF;
  INSERT INTO atendimento_private.audit(conversation_id,auth_user,operator_id,action,target_id)
    VALUES (conversation.id,auth.uid(),actor.salesperson_id,p_action,target);
  RETURN jsonb_build_object('ok',true);
END $$;
