create table if not exists public.gameforge_usage_config (
  singleton boolean primary key default true check (singleton),
  owner_id uuid references auth.users(id) on delete set null,
  accounts_created bigint not null default 0,
  total_visits bigint not null default 0,
  created_at timestamptz not null default now()
);

insert into public.gameforge_usage_config (singleton, accounts_created)
select true, count(*) from auth.users
on conflict (singleton) do nothing;

create table if not exists public.gameforge_usage_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  last_visit_at timestamptz not null default now()
);

alter table public.gameforge_usage_config enable row level security;
alter table public.gameforge_usage_activity enable row level security;

revoke all on public.gameforge_usage_config from public, anon, authenticated;
revoke all on public.gameforge_usage_activity from public, anon, authenticated;

create or replace function public.gameforge_is_analytics_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.gameforge_usage_config c
    where c.singleton = true
      and c.owner_id = (select auth.uid())
  );
$$;

revoke all on function public.gameforge_is_analytics_admin() from public, anon;
grant execute on function public.gameforge_is_analytics_admin() to authenticated;

create or replace function public.gameforge_record_usage_activity()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  request_time timestamptz := now();
  recorded_visit_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'Sign in to record application activity.';
  end if;

  insert into public.gameforge_usage_activity (user_id, last_seen_at, last_visit_at)
  values (current_user_id, request_time, request_time)
  on conflict (user_id) do update
  set last_seen_at = excluded.last_seen_at,
      last_visit_at = case
        when public.gameforge_usage_activity.last_visit_at < request_time - interval '30 minutes'
          then excluded.last_visit_at
        else public.gameforge_usage_activity.last_visit_at
      end
  returning last_visit_at into recorded_visit_at;

  if recorded_visit_at = request_time then
    update public.gameforge_usage_config
    set total_visits = total_visits + 1
    where singleton = true;
  end if;
end;
$$;

revoke all on function public.gameforge_record_usage_activity() from public, anon;
grant execute on function public.gameforge_record_usage_activity() to authenticated;

create or replace function public.gameforge_get_usage_stats()
returns table (
  total_visits bigint,
  accounts_created bigint,
  active_users_7d bigint,
  active_users_30d bigint,
  last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.gameforge_is_analytics_admin() then
    raise exception 'Only the configured GAMEFORGE administrator can view usage statistics.';
  end if;

  return query
  select
    c.total_visits,
    c.accounts_created,
    (select count(*) from public.gameforge_usage_activity a where a.last_seen_at >= now() - interval '7 days'),
    (select count(*) from public.gameforge_usage_activity a where a.last_seen_at >= now() - interval '30 days'),
    (select max(a.last_seen_at) from public.gameforge_usage_activity a)
  from public.gameforge_usage_config c
  where c.singleton = true;
end;
$$;

revoke all on function public.gameforge_get_usage_stats() from public, anon;
grant execute on function public.gameforge_get_usage_stats() to authenticated;

create or replace function public.gameforge_count_created_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.gameforge_usage_config (singleton, accounts_created)
  values (true, 1)
  on conflict (singleton) do update
  set accounts_created = public.gameforge_usage_config.accounts_created + 1;
  return new;
end;
$$;

revoke all on function public.gameforge_count_created_account() from public, anon, authenticated;

drop trigger if exists gameforge_count_created_account on auth.users;
create trigger gameforge_count_created_account
after insert on auth.users
for each row execute function public.gameforge_count_created_account();

notify pgrst, 'reload schema';
