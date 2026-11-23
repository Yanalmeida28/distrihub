CREATE SCHEMA atendimento_private;
REVOKE ALL ON SCHEMA atendimento_private FROM PUBLIC, anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_branch_company_key ON public.partner_branches(id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_customer_company_key ON public.partner_customers(id, user_id);

CREATE TABLE atendimento_private.channels (
  company_id uuid NOT NULL REFERENCES public.partner_profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('test', 'meta', 'waha')),
  address text NOT NULL CHECK (address <> ''),
  phone_e164 text UNIQUE CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CHECK (provider='test' OR phone_e164 IS NOT NULL),
  PRIMARY KEY (company_id, branch_id),
  UNIQUE (provider, address),
  FOREIGN KEY (branch_id, company_id) REFERENCES public.partner_branches(id, user_id) ON DELETE CASCADE
);

CREATE TABLE atendimento_private.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  phone text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  customer_id uuid,
  state text NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting', 'active', 'resolved')),
  assignee uuid,
  assigned_owner boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, company_id, branch_id),
  UNIQUE (company_id, branch_id, phone),
  CHECK (NOT assigned_owner OR assignee IS NULL),
  CHECK ((state = 'waiting') = (assignee IS NULL AND NOT assigned_owner)),
  FOREIGN KEY (company_id, branch_id) REFERENCES atendimento_private.channels ON DELETE CASCADE,
  FOREIGN KEY (customer_id, company_id) REFERENCES public.partner_customers(id, user_id) ON DELETE SET NULL (customer_id)
);

CREATE TABLE atendimento_private.messages (
  position bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  external_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  body text NOT NULL,
  delivery text NOT NULL CHECK (delivery IN ('received', 'submitted', 'delivered')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, branch_id, external_id),
  FOREIGN KEY (conversation_id, company_id, branch_id)
    REFERENCES atendimento_private.conversations(id, company_id, branch_id) ON DELETE CASCADE
);
CREATE INDEX atendimento_history ON atendimento_private.messages(conversation_id, position DESC);
CREATE INDEX atendimento_inbox ON atendimento_private.conversations(company_id, branch_id, updated_at DESC, id DESC);

CREATE TABLE atendimento_private.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES atendimento_private.conversations ON DELETE CASCADE,
  auth_user uuid NOT NULL,
  operator_id uuid,
  action text NOT NULL,
  target_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE atendimento_private.quote_preparations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES atendimento_private.conversations ON DELETE CASCADE,
  sale_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  auth_user uuid NOT NULL,
  operator_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, sale_id, customer_id)
);

ALTER TABLE atendimento_private.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE atendimento_private.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE atendimento_private.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE atendimento_private.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE atendimento_private.quote_preparations ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION atendimento_private.workspace(
  p_company uuid, p_branch uuid, p_operator uuid, p_credential text, p_action text, p_input jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  actor record;
  channel atendimento_private.channels;
  conversation atendimento_private.conversations;
  quote public.partner_sales;
  target uuid;
  operation uuid;
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
    RETURN jsonb_build_object('channel', CASE WHEN channel.provider='test' THEN 'test' ELSE 'unconfigured' END, 'rows', page);
  END IF;

  SELECT * INTO conversation FROM atendimento_private.conversations
    WHERE id=(p_input->>'conversationId')::uuid AND company_id=p_company AND branch_id=p_branch;
  IF NOT FOUND THEN RAISE EXCEPTION 'ATENDIMENTO_CONVERSATION_NOT_FOUND'; END IF;

  IF p_action = 'details' THEN
    RETURN jsonb_build_object(
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
      INSERT INTO atendimento_private.quote_preparations AS q (conversation_id,sale_id,customer_id,auth_user,operator_id)
        VALUES (conversation.id,target,conversation.customer_id,auth.uid(),actor.salesperson_id)
        ON CONFLICT (conversation_id,sale_id,customer_id) DO NOTHING RETURNING id INTO operation;
      IF operation IS NULL THEN
        SELECT id INTO operation FROM atendimento_private.quote_preparations
          WHERE conversation_id=conversation.id AND sale_id=target AND customer_id=conversation.customer_id;
      ELSE
        INSERT INTO atendimento_private.audit(conversation_id,auth_user,operator_id,action,target_id)
          VALUES (conversation.id,auth.uid(),actor.salesperson_id,p_action,target);
      END IF;
      RETURN jsonb_build_object('operationId',operation,'saleId',target,'sale',to_jsonb(quote));
    ELSIF p_action = 'test_send' THEN
      target := (p_input->>'requestId')::uuid;
      IF channel.provider IS DISTINCT FROM 'test' OR target IS NULL OR
         COALESCE(length(trim(p_input->>'body')),0) NOT BETWEEN 1 AND 4096
      THEN RAISE EXCEPTION 'ATENDIMENTO_TEST_ONLY'; END IF;
      INSERT INTO atendimento_private.messages(conversation_id,company_id,branch_id,external_id,direction,body,delivery)
        VALUES (conversation.id,p_company,p_branch,'test:send:'||target,'outgoing',trim(p_input->>'body'),'submitted')
        ON CONFLICT (company_id,branch_id,external_id) DO NOTHING;
      IF NOT FOUND THEN
        IF NOT EXISTS (SELECT 1 FROM atendimento_private.messages WHERE company_id=p_company AND branch_id=p_branch
          AND external_id='test:send:'||target AND conversation_id=conversation.id AND body=trim(p_input->>'body'))
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

CREATE FUNCTION public.atendimento_workspace(
  p_company uuid, p_branch uuid, p_operator uuid, p_credential text, p_action text, p_input jsonb
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT atendimento_private.workspace(p_company,p_branch,p_operator,p_credential,p_action,p_input);
$$;
REVOKE ALL ON FUNCTION public.atendimento_workspace(uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.atendimento_workspace(uuid,uuid,uuid,text,text,jsonb) TO authenticated;

-- Test transport adapter. No browser role can provision a channel or inject provider events.
CREATE FUNCTION public.atendimento_test_event(p_address text,p_external text,p_phone text,p_body text,p_kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE channel atendimento_private.channels; conversation uuid;
BEGIN
  SELECT * INTO STRICT channel FROM atendimento_private.channels WHERE provider='test' AND address=p_address;
  IF COALESCE(length(p_external),0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'ATENDIMENTO_EVENT_INVALID'; END IF;
  IF p_kind='delivered' THEN
    UPDATE atendimento_private.messages SET delivery='delivered'
      WHERE company_id=channel.company_id AND branch_id=channel.branch_id
        AND external_id='test:send:'||p_external AND direction='outgoing' AND delivery='submitted';
    RETURN;
  END IF;
  IF p_kind IS DISTINCT FROM 'incoming' OR COALESCE(length(trim(p_body)),0) NOT BETWEEN 1 AND 4096
  THEN RAISE EXCEPTION 'ATENDIMENTO_EVENT_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(channel.branch_id::text||':'||p_external,0));
  IF EXISTS (SELECT 1 FROM atendimento_private.messages WHERE company_id=channel.company_id
    AND branch_id=channel.branch_id AND external_id='test:incoming:'||p_external) THEN RETURN; END IF;
  INSERT INTO atendimento_private.conversations (company_id,branch_id,phone)
    VALUES (channel.company_id,channel.branch_id,p_phone)
    ON CONFLICT (company_id,branch_id,phone) DO UPDATE SET updated_at=now(),
      state=CASE WHEN conversations.state='resolved' THEN 'waiting' ELSE conversations.state END,
      assignee=CASE WHEN conversations.state='resolved' THEN NULL ELSE conversations.assignee END,
      assigned_owner=CASE WHEN conversations.state='resolved' THEN false ELSE conversations.assigned_owner END
    RETURNING id INTO conversation;
  INSERT INTO atendimento_private.messages(conversation_id,company_id,branch_id,external_id,direction,body,delivery)
    VALUES (conversation,channel.company_id,channel.branch_id,'test:incoming:'||p_external,'incoming',p_body,'received');
END $$;
REVOKE ALL ON FUNCTION public.atendimento_test_event(text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.atendimento_test_event(text,text,text,text,text) TO service_role;

DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.update_partner_salesperson_access(uuid,text,text,numeric,text,text,boolean,uuid,uuid,text,text,text[])'::regprocedure)
    INTO definition;
  IF strpos(definition,'''suporte'',''fiscal''')=0 THEN RAISE EXCEPTION 'ATENDIMENTO_MODULE_REGISTRY_CHANGED'; END IF;
  EXECUTE replace(definition,'''suporte'',''fiscal''','''suporte'',''atendimento'',''fiscal''');
END $$;
