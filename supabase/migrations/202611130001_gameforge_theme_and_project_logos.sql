alter table public.gameforge_projects
  add column if not exists logo_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'gameforge-project-logos',
  'gameforge-project-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Project logos are publicly readable" on storage.objects;
create policy "Project logos are publicly readable"
on storage.objects for select to public
using (bucket_id = 'gameforge-project-logos');

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

drop trigger if exists gameforge_project_logo_owner_only on public.gameforge_projects;
create trigger gameforge_project_logo_owner_only
before update of logo_url on public.gameforge_projects
for each row execute function public.gameforge_owner_controls_project_logo();

notify pgrst, 'reload schema';
