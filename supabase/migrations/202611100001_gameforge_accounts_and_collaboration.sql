create extension if not exists pgcrypto with schema extensions;

create table if not exists public.gameforge_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.gameforge_projects (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  description text not null default '',
  color text not null default '#5577FF',
  created_at timestamptz not null default now()
);

create table if not exists public.gameforge_project_members (
  project_id uuid not null references public.gameforge_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('editor')),
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.gameforge_board_items (
  id uuid primary key,
  project_id uuid not null references public.gameforge_projects(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  detail text not null default '',
  kind text not null check (kind in ('Feature', 'Mechanic', 'Bug', 'Milestone', 'Note')),
  priority text not null check (priority in ('Low', 'Medium', 'High')),
  status text not null check (status in ('Backlog', 'In progress', 'Done'))
);

create table if not exists public.gameforge_project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.gameforge_projects(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists gameforge_projects_owner_id_idx on public.gameforge_projects(owner_id);
create index if not exists gameforge_project_members_user_id_idx on public.gameforge_project_members(user_id);
create index if not exists gameforge_board_items_project_id_idx on public.gameforge_board_items(project_id);

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array[
      'gameforge_workspaces',
      'gameforge_projects',
      'gameforge_project_members',
      'gameforge_board_items'
    ] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end;
$$;

create or replace function public.gameforge_is_project_member(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gameforge_projects p
    where p.id = target_project_id and p.owner_id = (select auth.uid())
  ) or exists (
    select 1 from public.gameforge_project_members m
    where m.project_id = target_project_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.gameforge_can_edit_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gameforge_projects p
    where p.id = target_project_id and p.owner_id = (select auth.uid())
  ) or exists (
    select 1 from public.gameforge_project_members m
    where m.project_id = target_project_id
      and m.user_id = (select auth.uid())
      and m.role = 'editor'
  );
$$;

alter table public.gameforge_workspaces enable row level security;
alter table public.gameforge_projects enable row level security;
alter table public.gameforge_project_members enable row level security;
alter table public.gameforge_board_items enable row level security;
alter table public.gameforge_project_invitations enable row level security;

create policy "Users manage their private workspace"
on public.gameforge_workspaces for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Project members read projects"
on public.gameforge_projects for select to authenticated
using (public.gameforge_is_project_member(id));

create policy "Users create owned projects"
on public.gameforge_projects for insert to authenticated
with check (owner_id = (select auth.uid()));

create policy "Project editors update projects"
on public.gameforge_projects for update to authenticated
using (public.gameforge_can_edit_project(id))
with check (public.gameforge_can_edit_project(id));

create policy "Owners delete projects"
on public.gameforge_projects for delete to authenticated
using (owner_id = (select auth.uid()));

create policy "Project members read membership"
on public.gameforge_project_members for select to authenticated
using (public.gameforge_is_project_member(project_id));

create policy "Project members read board items"
on public.gameforge_board_items for select to authenticated
using (public.gameforge_is_project_member(project_id));

create policy "Project editors add board items"
on public.gameforge_board_items for insert to authenticated
with check (public.gameforge_can_edit_project(project_id));

create policy "Project editors update board items"
on public.gameforge_board_items for update to authenticated
using (public.gameforge_can_edit_project(project_id))
with check (public.gameforge_can_edit_project(project_id));

create policy "Project editors delete board items"
on public.gameforge_board_items for delete to authenticated
using (public.gameforge_can_edit_project(project_id));

create policy "Project owners read invitations"
on public.gameforge_project_invitations for select to authenticated
using (
  exists (
    select 1 from public.gameforge_projects p
    where p.id = project_id and p.owner_id = (select auth.uid())
  )
);

create or replace function public.gameforge_create_project_invite(
  target_project_id uuid,
  valid_days integer default 7
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_token text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to create an invitation.';
  end if;
  if valid_days < 1 or valid_days > 30 then
    raise exception 'Invitation expiry must be between 1 and 30 days.';
  end if;
  if not exists (
    select 1 from public.gameforge_projects p
    where p.id = target_project_id and p.owner_id = auth.uid()
  ) then
    raise exception 'Only the project owner can create an invitation.';
  end if;

  update public.gameforge_project_invitations
  set revoked_at = now()
  where project_id = target_project_id and revoked_at is null;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.gameforge_project_invitations (
    project_id, created_by, token_hash, expires_at
  ) values (
    target_project_id,
    auth.uid(),
    extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256'),
    now() + make_interval(days => valid_days)
  );
  return raw_token;
end;
$$;

create or replace function public.gameforge_revoke_project_invite(target_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to revoke an invitation.';
  end if;
  if not exists (
    select 1 from public.gameforge_projects p
    where p.id = target_project_id and p.owner_id = auth.uid()
  ) then
    raise exception 'Only the project owner can revoke an invitation.';
  end if;
  update public.gameforge_project_invitations
  set revoked_at = now()
  where project_id = target_project_id and revoked_at is null;
end;
$$;

create or replace function public.gameforge_project_invite_expiry(target_project_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_expiry timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in to inspect a project invitation.';
  end if;
  if not exists (
    select 1 from public.gameforge_projects p
    where p.id = target_project_id and p.owner_id = auth.uid()
  ) then
    raise exception 'Only the project owner can inspect invitations.';
  end if;
  select i.expires_at into invitation_expiry
  from public.gameforge_project_invitations i
  where i.project_id = target_project_id
    and i.revoked_at is null
    and i.expires_at > now()
  order by i.created_at desc
  limit 1;
  return invitation_expiry;
end;
$$;

create or replace function public.gameforge_accept_project_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.gameforge_project_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to accept a project invitation.';
  end if;
  if invite_token !~ '^[a-f0-9]{64}$' then
    raise exception 'This invitation link is invalid.';
  end if;

  select * into invitation
  from public.gameforge_project_invitations i
  where i.token_hash = extensions.digest(convert_to(invite_token, 'UTF8'), 'sha256')
    and i.revoked_at is null
    and i.expires_at > now()
  for update;

  if not found then
    raise exception 'This invitation link is expired or has been revoked.';
  end if;

  insert into public.gameforge_project_members (project_id, user_id, role)
  values (invitation.project_id, auth.uid(), 'editor')
  on conflict (project_id, user_id) do nothing;
  return invitation.project_id;
end;
$$;

create or replace function public.gameforge_leave_project(target_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to leave a project.';
  end if;
  delete from public.gameforge_project_members m
  where m.project_id = target_project_id and m.user_id = auth.uid();
end;
$$;

revoke all on function public.gameforge_is_project_member(uuid) from public;
revoke all on function public.gameforge_can_edit_project(uuid) from public;
revoke all on function public.gameforge_create_project_invite(uuid, integer) from public;
revoke all on function public.gameforge_revoke_project_invite(uuid) from public;
revoke all on function public.gameforge_project_invite_expiry(uuid) from public;
revoke all on function public.gameforge_accept_project_invite(text) from public;
revoke all on function public.gameforge_leave_project(uuid) from public;

grant execute on function public.gameforge_is_project_member(uuid) to authenticated;
grant execute on function public.gameforge_can_edit_project(uuid) to authenticated;
grant execute on function public.gameforge_create_project_invite(uuid, integer) to authenticated;
grant execute on function public.gameforge_revoke_project_invite(uuid) to authenticated;
grant execute on function public.gameforge_project_invite_expiry(uuid) to authenticated;
grant execute on function public.gameforge_accept_project_invite(text) to authenticated;
grant execute on function public.gameforge_leave_project(uuid) to authenticated;

grant usage on schema public to anon, authenticated;

-- These grants make the tables discoverable to PostgREST. RLS has no anon
-- policies, so anonymous clients still cannot read or modify any rows.
grant select on public.gameforge_workspaces to anon;
grant select on public.gameforge_projects to anon;
grant select on public.gameforge_project_members to anon;
grant select on public.gameforge_board_items to anon;
grant select on public.gameforge_project_invitations to anon;

grant select, insert, update, delete on public.gameforge_workspaces to authenticated;
grant select, insert, delete on public.gameforge_projects to authenticated;
grant update (name, description, color) on public.gameforge_projects to authenticated;
grant select on public.gameforge_project_members to authenticated;
grant select, insert, update, delete on public.gameforge_board_items to authenticated;
