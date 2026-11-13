create table if not exists public.gameforge_studio_links (
  project_id uuid primary key references public.gameforge_projects(id) on delete cascade,
  token_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.gameforge_studio_instances (
  project_id uuid not null references public.gameforge_projects(id) on delete cascade,
  place_id text not null,
  universe_id text not null,
  instance_key text not null,
  name text not null,
  class_name text not null,
  full_path text not null,
  last_seen_at timestamptz not null default now(),
  is_present boolean not null default true,
  primary key (project_id, place_id, instance_key)
);

create index if not exists gameforge_studio_instances_project_place_idx
  on public.gameforge_studio_instances (project_id, place_id, full_path);

create table if not exists public.gameforge_studio_instance_systems (
  project_id uuid not null,
  place_id text not null,
  instance_key text not null,
  system_name text not null check (length(trim(system_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  primary key (project_id, place_id, instance_key, system_name),
  foreign key (project_id, place_id, instance_key)
    references public.gameforge_studio_instances(project_id, place_id, instance_key)
    on delete cascade
);

alter table public.gameforge_studio_links enable row level security;
alter table public.gameforge_studio_instances enable row level security;
alter table public.gameforge_studio_instance_systems enable row level security;

revoke all on public.gameforge_studio_links from public, anon, authenticated;
revoke all on public.gameforge_studio_instances from anon, authenticated;
revoke all on public.gameforge_studio_instance_systems from anon, authenticated;

create policy "Project members read Studio instances"
on public.gameforge_studio_instances for select to authenticated
using (public.gameforge_is_project_member(project_id));

create policy "Project editors manage Studio instance systems"
on public.gameforge_studio_instance_systems for all to authenticated
using (public.gameforge_can_edit_project(project_id))
with check (public.gameforge_can_edit_project(project_id));

grant select on public.gameforge_studio_instances to authenticated;
grant select, insert, delete on public.gameforge_studio_instance_systems to authenticated;

create or replace function public.gameforge_create_studio_link(target_project_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  studio_token text;
begin
  if auth.uid() is null or not public.gameforge_can_edit_project(target_project_id) then
    raise exception 'You do not have permission to connect Studio to this project.';
  end if;

  studio_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.gameforge_studio_links (project_id, token_hash)
  values (
    target_project_id,
    encode(extensions.digest(convert_to(studio_token, 'UTF8'), 'sha256'), 'hex')
  )
  on conflict (project_id) do update
  set token_hash = excluded.token_hash,
      created_at = now();

  return studio_token;
end;
$$;

create or replace function public.gameforge_revoke_studio_link(target_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.gameforge_can_edit_project(target_project_id) then
    raise exception 'You do not have permission to disconnect Studio from this project.';
  end if;

  update public.gameforge_studio_links
  set token_hash = null,
      created_at = now()
  where project_id = target_project_id;
end;
$$;

create or replace function public.gameforge_studio_link_status(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.gameforge_studio_links l
    where l.project_id = target_project_id
      and l.token_hash is not null
  ) and public.gameforge_can_edit_project(target_project_id);
$$;

create or replace function public.gameforge_studio_upsert_snapshot(
  studio_token text,
  target_place_id text,
  target_universe_id text,
  instance_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_project_id uuid;
  row_count integer;
begin
  if studio_token is null or length(studio_token) <> 64
     or target_place_id is null or target_place_id !~ '^[0-9]{1,20}$'
     or target_universe_id is null or target_universe_id !~ '^[0-9]{1,20}$'
     or instance_rows is null
     or jsonb_typeof(instance_rows) <> 'array'
     or jsonb_array_length(instance_rows) > 3000 then
    raise exception 'Invalid Studio snapshot.';
  end if;

  select l.project_id into linked_project_id
  from public.gameforge_studio_links l
  where l.token_hash = encode(extensions.digest(convert_to(studio_token, 'UTF8'), 'sha256'), 'hex')
    and l.token_hash is not null;

  if linked_project_id is null then
    raise exception 'This Studio connection is invalid or has been revoked.';
  end if;

  select count(*) into row_count from jsonb_to_recordset(instance_rows) as x(
    instance_key text,
    name text,
    class_name text,
    full_path text
  )
  where x.instance_key is null or length(x.instance_key) not between 1 and 1500
     or x.name is null or length(x.name) > 200
     or x.class_name is null or length(x.class_name) not between 1 and 100
     or x.full_path is null or length(x.full_path) not between 1 and 3000;

  if row_count > 0
     or (select count(*) from jsonb_array_elements(instance_rows)) <>
        (select count(distinct value ->> 'instance_key') from jsonb_array_elements(instance_rows)) then
    raise exception 'The Studio snapshot contains invalid or duplicate instances.';
  end if;

  update public.gameforge_studio_instances
  set is_present = false
  where project_id = linked_project_id and place_id = target_place_id;

  delete from public.gameforge_studio_instances i
  where i.project_id = linked_project_id
    and i.place_id = target_place_id
    and not i.is_present
    and not exists (
      select 1
      from public.gameforge_studio_instance_systems s
      where s.project_id = i.project_id
        and s.place_id = i.place_id
        and s.instance_key = i.instance_key
    );

  insert into public.gameforge_studio_instances (
    project_id, place_id, universe_id, instance_key, name, class_name, full_path, last_seen_at, is_present
  )
  select linked_project_id, target_place_id, target_universe_id,
         x.instance_key, x.name, x.class_name, x.full_path, now(), true
  from jsonb_to_recordset(instance_rows) as x(
    instance_key text,
    name text,
    class_name text,
    full_path text
  )
  on conflict (project_id, place_id, instance_key) do update
  set universe_id = excluded.universe_id,
      name = excluded.name,
      class_name = excluded.class_name,
      full_path = excluded.full_path,
      last_seen_at = excluded.last_seen_at,
      is_present = true;

  return jsonb_array_length(instance_rows);
end;
$$;

revoke all on function public.gameforge_create_studio_link(uuid) from public, anon;
revoke all on function public.gameforge_revoke_studio_link(uuid) from public, anon;
revoke all on function public.gameforge_studio_link_status(uuid) from public, anon;
revoke all on function public.gameforge_studio_upsert_snapshot(text, text, text, jsonb) from public, authenticated;

grant execute on function public.gameforge_create_studio_link(uuid) to authenticated;
grant execute on function public.gameforge_revoke_studio_link(uuid) to authenticated;
grant execute on function public.gameforge_studio_link_status(uuid) to authenticated;
grant execute on function public.gameforge_studio_upsert_snapshot(text, text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
