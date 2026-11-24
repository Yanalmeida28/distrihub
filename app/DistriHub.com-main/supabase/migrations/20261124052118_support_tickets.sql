CREATE TABLE partner_support_private.tickets (
 id uuid PRIMARY KEY,
 protocol bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 company_id uuid NOT NULL REFERENCES public.partner_profiles(id) ON DELETE CASCADE,
 branch_id uuid,
 branch_label text,
 subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 120),
 area text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','active','waiting','resolved')),
 assignee uuid,
 attachment_mime text,
 attachment_data bytea,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((attachment_data IS NULL) = (attachment_mime IS NULL)),
 CHECK (attachment_data IS NULL OR octet_length(attachment_data) BETWEEN 1 AND 1048576)
);
CREATE INDEX support_tickets_company_queue ON partner_support_private.tickets(company_id,updated_at DESC,id);
CREATE INDEX support_tickets_admin_queue ON partner_support_private.tickets(updated_at DESC,id);

CREATE TABLE partner_support_private.ticket_messages (
 id uuid PRIMARY KEY,
 ticket_id uuid NOT NULL REFERENCES partner_support_private.tickets(id) ON DELETE CASCADE,
 position bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 sender_id uuid NOT NULL,
 admin boolean NOT NULL,
 body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_ticket_message_history ON partner_support_private.ticket_messages(ticket_id,position DESC);
ALTER TABLE partner_support_private.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_support_private.ticket_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON partner_support_private.tickets,partner_support_private.ticket_messages FROM PUBLIC,anon,authenticated;

CREATE FUNCTION partner_support_private.ticket_summary(p_ticket partner_support_private.tickets,p_actor uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_ticket.id,'protocol',p_ticket.protocol,'subject',p_ticket.subject,'area',p_ticket.area,
  'company',COALESCE((SELECT business_name FROM public.partner_profiles WHERE id=p_ticket.company_id),'Empresa'),
  'branch',p_ticket.branch_label,'status',p_ticket.status,'updated_at',p_ticket.updated_at,
  'assigned',p_ticket.assignee IS NOT NULL,'mine',COALESCE(p_ticket.assignee=p_actor,false));
$$;
REVOKE ALL ON FUNCTION partner_support_private.ticket_summary(partner_support_private.tickets,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.support_ticket_workspace(p_admin boolean,p_action text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 actor uuid := auth.uid();
 ticket partner_support_private.tickets;
 message partner_support_private.ticket_messages;
 ticket_id uuid;
 branch uuid;
 branch_name text;
 request_id uuid;
 subject_value text;
 area_value text;
 body_value text;
 image_mime text;
 image_data bytea;
 filter_value text := COALESCE(p_input->>'filter','all');
 search_value text := lower(left(btrim(COALESCE(p_input->>'search','')),120));
 page_no integer := COALESCE((p_input->>'page')::integer,0);
BEGIN
 IF actor IS NULL OR p_admin IS NULL OR (p_admin AND NOT COALESCE(public.is_super_admin(),false))
  OR (NOT p_admin AND NOT EXISTS(SELECT 1 FROM public.partner_profiles WHERE id=actor))
 THEN RAISE EXCEPTION 'SUPPORT_TICKET_DENIED'; END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'SUPPORT_TICKET_INVALID'; END IF;

 IF p_action='list' THEN
  IF page_no NOT BETWEEN 0 AND 10000 OR filter_value NOT IN ('all','open','active','waiting','resolved')
  THEN RAISE EXCEPTION 'SUPPORT_TICKET_INVALID'; END IF;
  RETURN (SELECT COALESCE(jsonb_agg(partner_support_private.ticket_summary(rows.ticket,actor) ORDER BY rows.updated_at DESC,rows.id),'[]')
   FROM (
    SELECT t AS ticket,t.updated_at,t.id FROM partner_support_private.tickets t
    JOIN public.partner_profiles p ON p.id=t.company_id
    WHERE (p_admin OR t.company_id=actor)
      AND (filter_value='all' OR t.status=filter_value)
      AND (search_value='' OR strpos(lower(concat_ws(' ',t.subject,t.protocol,t.branch_label,CASE WHEN p_admin THEN p.business_name END)),search_value)>0)
    ORDER BY t.updated_at DESC,t.id LIMIT 26 OFFSET (page_no*25)
   ) rows);
 END IF;

 ticket_id := (p_input->>'id')::uuid;
 IF ticket_id IS NULL THEN RAISE EXCEPTION 'SUPPORT_TICKET_INVALID'; END IF;
 IF p_action='open' THEN
  IF p_admin THEN RAISE EXCEPTION 'SUPPORT_TICKET_DENIED'; END IF;
  subject_value := btrim(p_input->>'subject');
  area_value := p_input->>'area';
  body_value := btrim(p_input->>'body');
  IF COALESCE(length(subject_value),0) NOT BETWEEN 1 AND 120 OR COALESCE(length(body_value),0) NOT BETWEEN 1 AND 2000
   OR area_value IS NULL OR area_value NOT IN ('Acesso','PDV e caixa','Produtos e serviços','Pedidos e orçamentos','Financeiro','Fiscal','Outros')
  THEN RAISE EXCEPTION 'SUPPORT_TICKET_INVALID'; END IF;
  branch := (p_input->>'branchId')::uuid;
  IF branch IS NOT NULL THEN
   SELECT name INTO branch_name FROM public.partner_branches WHERE id=branch AND user_id=actor AND is_active;
   IF NOT FOUND THEN RAISE EXCEPTION 'SUPPORT_TICKET_DENIED'; END IF;
  END IF;
  IF p_input ? 'attachment' THEN
   image_mime := p_input->'attachment'->>'mime';
   IF image_mime IS NULL OR image_mime NOT IN ('image/png','image/jpeg','image/webp')
    OR COALESCE(length(p_input->'attachment'->>'data'),0) NOT BETWEEN 1 AND 1398104
   THEN RAISE EXCEPTION 'SUPPORT_TICKET_ATTACHMENT_INVALID'; END IF;
   image_data := decode(p_input->'attachment'->>'data','base64');
   IF octet_length(image_data) NOT BETWEEN 1 AND 1048576 OR NOT (CASE image_mime
     WHEN 'image/png' THEN substring(image_data FROM 1 FOR 8)=decode('89504e470d0a1a0a','hex')
     WHEN 'image/jpeg' THEN substring(image_data FROM 1 FOR 3)=decode('ffd8ff','hex')
     ELSE substring(image_data FROM 1 FOR 4)=decode('52494646','hex')
          AND substring(image_data FROM 9 FOR 4)=decode('57454250','hex')
   END) THEN RAISE EXCEPTION 'SUPPORT_TICKET_ATTACHMENT_INVALID'; END IF;
  END IF;

  INSERT INTO partner_support_private.tickets(id,company_id,branch_id,branch_label,subject,area,attachment_mime,attachment_data)
   VALUES(ticket_id,actor,branch,branch_name,subject_value,area_value,image_mime,image_data)
   ON CONFLICT(id) DO NOTHING RETURNING * INTO ticket;
  IF FOUND THEN
   INSERT INTO partner_support_private.ticket_messages(id,ticket_id,sender_id,admin,body)
    VALUES(ticket_id,ticket_id,actor,false,body_value);
  ELSE
   SELECT * INTO ticket FROM partner_support_private.tickets WHERE id=ticket_id AND company_id=actor;
   IF NOT FOUND OR ticket.subject IS DISTINCT FROM subject_value OR ticket.area IS DISTINCT FROM area_value
    OR ticket.branch_id IS DISTINCT FROM branch OR ticket.attachment_mime IS DISTINCT FROM image_mime
    OR ticket.attachment_data IS DISTINCT FROM image_data OR NOT EXISTS(
     SELECT 1 FROM partner_support_private.ticket_messages m WHERE m.id=ticket.id AND m.ticket_id=ticket.id AND m.body=body_value)
   THEN RAISE EXCEPTION 'SUPPORT_TICKET_CONFLICT'; END IF;
  END IF;
  RETURN partner_support_private.ticket_summary(ticket,actor);
 END IF;

 IF p_action='read' THEN
  SELECT * INTO ticket FROM partner_support_private.tickets WHERE id=ticket_id AND (p_admin OR company_id=actor);
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPORT_TICKET_DENIED'; END IF;
  RETURN jsonb_build_object(
   'ticket',partner_support_private.ticket_summary(ticket,actor),
   'messages',(SELECT COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY rows.position),'[]') FROM (
     SELECT m.id,m.body,m.admin,m.created_at,m.position FROM partner_support_private.ticket_messages m
      WHERE m.ticket_id=ticket.id AND (p_input->>'before' IS NULL OR m.position < (p_input->>'before')::bigint)
      ORDER BY m.position DESC LIMIT 51
    ) rows),
   'attachment',CASE WHEN ticket.attachment_data IS NOT NULL AND (p_input->'includeAttachment')='true'::jsonb THEN
    jsonb_build_object('mime',ticket.attachment_mime,'data',replace(encode(ticket.attachment_data,'base64'),chr(10),'')) END);
 END IF;

 SELECT * INTO ticket FROM partner_support_private.tickets WHERE id=ticket_id AND (p_admin OR company_id=actor) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SUPPORT_TICKET_DENIED'; END IF;
 IF p_action='reply' THEN
  request_id := (p_input->>'requestId')::uuid;
  body_value := btrim(p_input->>'body');
  IF request_id IS NULL OR COALESCE(length(body_value),0) NOT BETWEEN 1 AND 2000
  THEN RAISE EXCEPTION 'SUPPORT_TICKET_INVALID'; END IF;
  SELECT * INTO message FROM partner_support_private.ticket_messages WHERE id=request_id;
  IF FOUND THEN
   IF message.ticket_id IS DISTINCT FROM ticket.id OR message.sender_id IS DISTINCT FROM actor
    OR message.admin IS DISTINCT FROM p_admin OR message.body IS DISTINCT FROM body_value
   THEN RAISE EXCEPTION 'SUPPORT_TICKET_CONFLICT'; END IF;
   RETURN jsonb_build_object('ok',true);
  END IF;
  IF ticket.status='resolved' OR (p_admin AND ticket.assignee IS DISTINCT FROM actor) THEN RAISE EXCEPTION 'SUPPORT_TICKET_DENIED'; END IF;
  INSERT INTO partner_support_private.ticket_messages(id,ticket_id,sender_id,admin,body)
   VALUES(request_id,ticket.id,actor,p_admin,body_value);
  UPDATE partner_support_private.tickets SET updated_at=clock_timestamp(),
   status=CASE WHEN NOT p_admin AND ticket.status='waiting' THEN 'active' ELSE ticket.status END WHERE id=ticket.id;
 ELSE
  IF NOT p_admin OR ticket.status='resolved' THEN RAISE EXCEPTION 'SUPPORT_TICKET_DENIED'; END IF;
  IF p_action='claim' THEN
   IF ticket.assignee IS NOT NULL AND ticket.assignee IS DISTINCT FROM actor THEN RAISE EXCEPTION 'SUPPORT_TICKET_ASSIGNED'; END IF;
   UPDATE partner_support_private.tickets SET assignee=actor,status='active',updated_at=clock_timestamp() WHERE id=ticket.id;
  ELSIF p_action IN ('waiting','resolve') AND ticket.assignee=actor THEN
   UPDATE partner_support_private.tickets SET status=CASE WHEN p_action='resolve' THEN 'resolved' ELSE 'waiting' END,
    updated_at=clock_timestamp() WHERE id=ticket.id;
  ELSE
   RAISE EXCEPTION 'SUPPORT_TICKET_DENIED';
  END IF;
 END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.support_ticket_workspace(boolean,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_ticket_workspace(boolean,text,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
