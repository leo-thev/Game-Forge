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
      and p.owner_id = (select auth.uid())
  );
$$;

revoke all on function public.gameforge_is_project_owner(text) from public;
grant execute on function public.gameforge_is_project_owner(text) to authenticated;

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

create or replace function public.gameforge_owner_controls_project_logo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.logo_url is distinct from old.logo_url
    and old.owner_id is distinct from (select auth.uid()) then
    raise exception 'Only the project owner can change its logo.';
  end if;
  return new;
end;
$$;

revoke all on function public.gameforge_owner_controls_project_logo() from public;

notify pgrst, 'reload schema';
