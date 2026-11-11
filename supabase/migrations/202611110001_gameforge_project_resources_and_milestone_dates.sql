alter table public.gameforge_board_items
  add column if not exists due_date date;

create table if not exists public.gameforge_project_resources (
  id uuid primary key,
  project_id uuid not null references public.gameforge_projects(id) on delete cascade,
  source_id text not null,
  resource_kind text not null check (resource_kind in ('Script', 'Asset')),
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '',
  category text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (project_id, resource_kind, source_id)
);

create index if not exists gameforge_project_resources_project_id_idx
  on public.gameforge_project_resources(project_id);

create table if not exists public.gameforge_project_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.gameforge_projects(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid references public.gameforge_project_resources(id) on delete set null,
  message text not null check (length(trim(message)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists gameforge_project_messages_project_created_idx
  on public.gameforge_project_messages(project_id, created_at);

alter table public.gameforge_project_resources enable row level security;
alter table public.gameforge_project_messages enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'gameforge_project_resources'
      and policyname = 'Project members read linked resources'
  ) then
    create policy "Project members read linked resources"
    on public.gameforge_project_resources for select to authenticated
    using (public.gameforge_is_project_member(project_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'gameforge_project_resources'
      and policyname = 'Project editors add linked resources'
  ) then
    create policy "Project editors add linked resources"
    on public.gameforge_project_resources for insert to authenticated
    with check (
      created_by = (select auth.uid())
      and public.gameforge_can_edit_project(project_id)
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'gameforge_project_resources'
      and policyname = 'Project editors remove linked resources'
  ) then
    create policy "Project editors remove linked resources"
    on public.gameforge_project_resources for delete to authenticated
    using (public.gameforge_can_edit_project(project_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'gameforge_project_messages'
      and policyname = 'Project members read messages'
  ) then
    create policy "Project members read messages"
    on public.gameforge_project_messages for select to authenticated
    using (public.gameforge_is_project_member(project_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'gameforge_project_messages'
      and policyname = 'Project members send messages'
  ) then
    create policy "Project members send messages"
    on public.gameforge_project_messages for insert to authenticated
    with check (
      author_id = (select auth.uid())
      and public.gameforge_can_edit_project(project_id)
      and (
        resource_id is null
        or exists (
          select 1 from public.gameforge_project_resources r
          where r.id = resource_id and r.project_id = gameforge_project_messages.project_id
        )
      )
    );
  end if;
end;
$$;

grant usage on schema public to anon, authenticated;
grant select on public.gameforge_board_items, public.gameforge_project_resources to anon;
grant select, insert, update, delete on public.gameforge_board_items to authenticated;
grant select, insert, delete on public.gameforge_project_resources to authenticated;
grant select, insert on public.gameforge_project_messages to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'gameforge_project_resources'
    ) then
      alter publication supabase_realtime add table public.gameforge_project_resources;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'gameforge_project_messages'
    ) then
      alter publication supabase_realtime add table public.gameforge_project_messages;
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';
