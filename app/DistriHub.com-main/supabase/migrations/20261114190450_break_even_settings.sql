-- Owner-only planning settings. No financial entries are mutated.
create table public.partner_break_even_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope = 'all' or scope ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  aluguel text not null default '' check (aluguel in ('','fixed','variable')),
  energia text not null default '' check (energia in ('','fixed','variable')),
  salarios text not null default '' check (salarios in ('','fixed','variable')),
  impostos text not null default '' check (impostos in ('','fixed','variable')),
  outros text not null default '' check (outros in ('','fixed','variable')),
  desired numeric(15,2) not null default 0 check (desired >= 0 and desired <= 1000000000000),
  primary key (user_id, scope)
);
alter table public.partner_break_even_settings enable row level security;
revoke all on public.partner_break_even_settings from anon, authenticated;
grant select, insert, update on public.partner_break_even_settings to authenticated;
create policy break_even_owner on public.partner_break_even_settings for all to authenticated
using (user_id = (select auth.uid()) and public.partner_has_saas_access(user_id, 'financeiro')
  and public.partner_has_saas_access(user_id, 'administrativo') and public.partner_has_saas_access(user_id, 'relatorios'))
with check (user_id = (select auth.uid()) and public.partner_has_saas_access(user_id, 'financeiro')
  and public.partner_has_saas_access(user_id, 'administrativo') and public.partner_has_saas_access(user_id, 'relatorios')
  and (scope = 'all' or exists (select 1 from public.partner_branches b where b.id::text = scope and b.user_id = (select auth.uid()))));
