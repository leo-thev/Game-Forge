alter table public.gameforge_project_messages
  add column if not exists reply_to_id uuid
    references public.gameforge_project_messages(id) on delete set null,
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid
    references auth.users(id) on delete set null;

create index if not exists gameforge_project_messages_reply_to_id_idx
  on public.gameforge_project_messages(reply_to_id);

create table if not exists public.gameforge_project_message_reactions (
  project_id uuid not null references public.gameforge_projects(id) on delete cascade,
  message_id uuid not null references public.gameforge_project_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '😮', '🎉')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists gameforge_project_message_reactions_project_id_idx
  on public.gameforge_project_message_reactions(project_id);

alter table public.gameforge_project_messages enable row level security;
alter table public.gameforge_project_message_reactions enable row level security;
alter table public.gameforge_project_messages replica identity full;
alter table public.gameforge_project_message_reactions replica identity full;

create or replace function public.gameforge_is_project_message(target_message_id uuid, target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.gameforge_project_messages m
    where m.id = target_message_id
      and m.project_id = target_project_id
      and public.gameforge_is_project_member(target_project_id)
  );
$$;

revoke all on function public.gameforge_is_project_message(uuid, uuid) from public;
grant execute on function public.gameforge_is_project_message(uuid, uuid) to authenticated;

drop policy if exists "Project members send messages" on public.gameforge_project_messages;
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
  and (
    reply_to_id is null
    or public.gameforge_is_project_message(reply_to_id, project_id)
  )
);

drop policy if exists "Authors and owners delete project messages" on public.gameforge_project_messages;
create policy "Authors and owners delete project messages"
on public.gameforge_project_messages for delete to authenticated
using (
  author_id = (select auth.uid())
  or exists (
    select 1 from public.gameforge_projects p
    where p.id = gameforge_project_messages.project_id
      and p.owner_id = (select auth.uid())
  )
);

drop policy if exists "Project members pin messages" on public.gameforge_project_messages;
create policy "Project members pin messages"
on public.gameforge_project_messages for update to authenticated
using (public.gameforge_is_project_member(project_id))
with check (
  public.gameforge_is_project_member(project_id)
  and (
    (pinned_at is null and pinned_by is null)
    or (pinned_at is not null and pinned_by = (select auth.uid()))
  )
);

drop policy if exists "Project members read message reactions" on public.gameforge_project_message_reactions;
create policy "Project members read message reactions"
on public.gameforge_project_message_reactions for select to authenticated
using (public.gameforge_is_project_member(project_id));

drop policy if exists "Project members add their own reactions" on public.gameforge_project_message_reactions;
create policy "Project members add their own reactions"
on public.gameforge_project_message_reactions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.gameforge_is_project_member(project_id)
  and public.gameforge_is_project_message(message_id, project_id)
);

drop policy if exists "Users remove their own reactions" on public.gameforge_project_message_reactions;
create policy "Users remove their own reactions"
on public.gameforge_project_message_reactions for delete to authenticated
using (
  user_id = (select auth.uid())
  and public.gameforge_is_project_member(project_id)
);

grant select, insert, delete on public.gameforge_project_messages to authenticated;
grant update (pinned_at, pinned_by) on public.gameforge_project_messages to authenticated;
grant select, insert, delete on public.gameforge_project_message_reactions to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'gameforge_project_message_reactions'
    ) then
      alter publication supabase_realtime add table public.gameforge_project_message_reactions;
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';
