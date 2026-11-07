-- Cache the unchanged STABLE entitlement check once per statement for the owner.
-- Other companies/operators retain the original row-dependent check.
-- No grants, permissive policies, helper functions or business data are changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path=public,pg_catalog;
do $migration$
declare cfg record; p record; expected text; optimized text;
begin
 if not exists(select 1 from pg_proc where oid='public.partner_has_saas_access(uuid,text)'::regprocedure and provolatile='s' and prorettype='boolean'::regtype) then
   raise exception 'Expected STABLE entitlement function';
 end if;
 for cfg in select * from (values
  ('b2b_orders','pedidos'),('fiscal_branch_settings','fiscal'),('fiscal_documents','fiscal'),('fiscal_tax_rules','fiscal'),
  ('partner_branches','cadastros'),('partner_cash_sessions','caixa'),('partner_categories','cadastros'),('partner_combos','cadastros'),
  ('partner_customers','cadastros'),('partner_invoice_receipts','pdv'),('partner_invoices','pdv'),('partner_modifiers','cadastros'),
  ('partner_payable_payments','financeiro'),('partner_payables','financeiro'),('partner_pdv_price_snapshots','pdv'),
  ('partner_products','cadastros'),('partner_sales','pdv'),('partner_salespeople','cadastros'),('partner_suppliers','cadastros'),
  ('rma_requests_v2','rma'),('service_order_items','os'),('service_order_photos','os'),('service_orders','os'),('stock_movements','pdv')
 ) as targets(table_name,feature)
 loop
   -- Prevent a concurrent policy edit between comparison and ALTER POLICY.
   execute format('lock table public.%I in share row exclusive mode',cfg.table_name);
   select * into p from pg_policies where schemaname='public' and tablename=cfg.table_name and policyname='saas_entitlement';
   expected:=format('partner_has_saas_access(user_id, %L::text)',cfg.feature);
   if not found or p.permissive<>'RESTRICTIVE' or p.cmd<>'ALL' or p.roles<>array['authenticated']::name[]
     or p.qual is distinct from expected or p.with_check is distinct from expected then
     raise exception 'Unknown entitlement policy: %',cfg.table_name;
   end if;
   optimized:=format('case when user_id=(select auth.uid()) then (select public.partner_has_saas_access((select auth.uid()),%L::text)) else public.partner_has_saas_access(user_id,%L::text) end',cfg.feature,cfg.feature);
   execute format('alter policy saas_entitlement on public.%I using (%s) with check (%s)',cfg.table_name,optimized,optimized);
 end loop;
end $migration$;
commit;
