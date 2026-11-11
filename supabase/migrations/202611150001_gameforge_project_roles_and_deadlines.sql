alter table public.gameforge_project_members
  add column if not exists job_roles text[] not null default '{}';

alter table public.gameforge_board_items
  add column if not exists roles text[] not null default array['Owner']::text[];

alter table public.gameforge_project_members
  drop constraint if exists gameforge_project_members_job_roles_check,
  add constraint gameforge_project_members_job_roles_check
    check (job_roles <@ array[
      'Co-owner',
      'UI/UX designer',
      'Builder',
      'Scripter',
      'Modeler',
      'Animator',
      'SFX designer',
      'Sound artist',
      'Commercial manager'
    ]::text[]);

alter table public.gameforge_board_items
  drop constraint if exists gameforge_board_items_roles_check,
  add constraint gameforge_board_items_roles_check
    check (
      cardinality(roles) > 0
      and roles <@ array[
        'Owner',
        'Co-owner',
        'UI/UX designer',
        'Builder',
        'Scripter',
        'Modeler',
        'Animator',
        'SFX designer',
        'Sound artist',
        'Commercial manager'
      ]::text[]
    );

create or replace function public.gameforge_has_owner_permissions(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.gameforge_projects p
    where p.id = target_project_id
      and p.owner_id = (select auth.uid())
  ) or exists (
    select 1
    from public.gameforge_project_members m
    where m.project_id = target_project_id
      and m.user_id = (select auth.uid())
      and m.job_roles @> array['Co-owner']::text[]
  );
$$;

revoke all on function public.gameforge_has_owner_permissions(uuid) from public;
grant execute on function public.gameforge_has_owner_permissions(uuid) to authenticated;

create or replace function public.gameforge_is_project_owner(target_project_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.gameforge_projects p
    where p.id::text = target_project_path
      and public.gameforge_has_owner_permissions(p.id)
  );
$$;

revoke all on function public.gameforge_is_project_owner(text) from public;
grant execute on function public.gameforge_is_project_owner(text) to authenticated;

create or replace function public.gameforge_is_project_member(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.gameforge_projects p
    where p.id = target_project_id
      and p.owner_id = (select auth.uid())
  ) or exists (
    select 1
    from public.gameforge_project_members m
    where m.project_id = target_project_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.gameforge_can_edit_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.gameforge_has_owner_permissions(target_project_id)
    or exists (
      select 1
      from public.gameforge_project_members m
      where m.project_id = target_project_id
        and m.user_id = (select auth.uid())
        and m.role = 'editor'
    );
$$;

create or replace function public.gameforge_get_project_team(target_project_id uuid)
returns table(member_id uuid, display_name text, roles text[], is_project_owner boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.gameforge_is_project_member(target_project_id) then
    raise exception 'Only project members can view the project team.';
  end if;

  return query
  select team.member_id, team.display_name, team.roles, team.is_project_owner
  from (
    select
      u.id as member_id,
      coalesce(nullif(u.raw_user_meta_data ->> 'display_name', ''), nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'Owner') as display_name,
      array['Owner']::text[] as roles,
      true as is_project_owner
    from public.gameforge_projects p
    join auth.users u on u.id = p.owner_id
    where p.id = target_project_id
    union all
    select
      u.id,
      coalesce(nullif(u.raw_user_meta_data ->> 'display_name', ''), nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'Collaborator'),
      m.job_roles,
      false
    from public.gameforge_project_members m
    join auth.users u on u.id = m.user_id
    where m.project_id = target_project_id
  ) team
  order by team.is_project_owner desc, team.display_name;
end;
$$;

revoke all on function public.gameforge_get_project_team(uuid) from public;
grant execute on function public.gameforge_get_project_team(uuid) to authenticated;

create or replace function public.gameforge_set_project_member_roles(
  target_project_id uuid,
  target_user_id uuid,
  target_roles text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actual_owner_id uuid;
begin
  if auth.uid() is null or not public.gameforge_has_owner_permissions(target_project_id) then
    raise exception 'Only project owners and co-owners can assign roles.';
  end if;
  if target_roles is null
    or not (target_roles <@ array[
      'Co-owner',
      'UI/UX designer',
      'Builder',
      'Scripter',
      'Modeler',
      'Animator',
      'SFX designer',
      'Sound artist',
      'Commercial manager'
    ]::text[]) then
    raise exception 'One or more project roles are invalid.';
  end if;
  select p.owner_id into actual_owner_id
  from public.gameforge_projects p
  where p.id = target_project_id;
  if not found then
    raise exception 'Project not found.';
  end if;
  if target_user_id = (select auth.uid()) and actual_owner_id <> (select auth.uid()) then
    raise exception 'Co-owners cannot change their own roles.';
  end if;

  update public.gameforge_project_members m
  set job_roles = target_roles
  where m.project_id = target_project_id
    and m.user_id = target_user_id;
  if not found then
    raise exception 'Project collaborator not found.';
  end if;
end;
$$;

revoke all on function public.gameforge_set_project_member_roles(uuid, uuid, text[]) from public;
grant execute on function public.gameforge_set_project_member_roles(uuid, uuid, text[]) to authenticated;

create or replace function public.gameforge_remove_project_member(
  target_project_id uuid,
  target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.gameforge_has_owner_permissions(target_project_id) then
    raise exception 'Only project owners and co-owners can remove collaborators.';
  end if;
  if target_user_id = (select auth.uid()) then
    raise exception 'Use Leave project to remove your own membership.';
  end if;

  delete from public.gameforge_project_members m
  where m.project_id = target_project_id
    and m.user_id = target_user_id
    and not exists (
      select 1 from public.gameforge_projects p
      where p.id = m.project_id and p.owner_id = m.user_id
    );
  if not found then
    raise exception 'Project collaborator not found.';
  end if;
end;
$$;

revoke all on function public.gameforge_remove_project_member(uuid, uuid) from public;
grant execute on function public.gameforge_remove_project_member(uuid, uuid) to authenticated;

drop policy if exists "Owners delete projects" on public.gameforge_projects;
create policy "Owners delete projects"
on public.gameforge_projects for delete to authenticated
using (public.gameforge_has_owner_permissions(id));

drop policy if exists "Authors and owners delete project messages" on public.gameforge_project_messages;
create policy "Authors and owners delete project messages"
on public.gameforge_project_messages for delete to authenticated
using (
  author_id = (select auth.uid())
  or public.gameforge_has_owner_permissions(project_id)
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
  if not public.gameforge_has_owner_permissions(target_project_id) then
    raise exception 'Only project owners and co-owners can create an invitation.';
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
  if auth.uid() is null or not public.gameforge_has_owner_permissions(target_project_id) then
    raise exception 'Only project owners and co-owners can revoke an invitation.';
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
  if auth.uid() is null or not public.gameforge_has_owner_permissions(target_project_id) then
    raise exception 'Only project owners and co-owners can inspect invitations.';
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

drop policy if exists "Project owners read invitations" on public.gameforge_project_invitations;
create policy "Project owners read invitations"
on public.gameforge_project_invitations for select to authenticated
using (public.gameforge_has_owner_permissions(project_id));

drop policy if exists "Project editors update projects" on public.gameforge_projects;
create policy "Project editors update projects"
on public.gameforge_projects for update to authenticated
using (public.gameforge_can_edit_project(id))
with check (public.gameforge_can_edit_project(id));

create or replace function public.gameforge_owner_controls_project_logo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.logo_url is distinct from old.logo_url
    and not public.gameforge_has_owner_permissions(old.id) then
    raise exception 'Only project owners and co-owners can change its logo.';
  end if;
  return new;
end;
$$;

drop policy if exists "Project owners upload logos" on storage.objects;
create policy "Project owners upload logos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'gameforge-project-logos'
  and public.gameforge_is_project_owner((storage.foldername(name))[1])
);

drop policy if exists "Project owners delete logos" on storage.objects;
create policy "Project owners delete logos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'gameforge-project-logos'
  and public.gameforge_is_project_owner((storage.foldername(name))[1])
);

grant select on public.gameforge_project_members to authenticated;
grant select, insert, update, delete on public.gameforge_board_items to authenticated;
grant update (name, description, color, logo_url) on public.gameforge_projects to authenticated;

notify pgrst, 'reload schema';
