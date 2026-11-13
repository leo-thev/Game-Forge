drop function if exists public.gameforge_studio_upsert_snapshot(text, text, text, jsonb);

create function public.gameforge_studio_upsert_snapshot(
  studio_token text,
  target_place_id text,
  target_universe_id text,
  target_scope_key text,
  instance_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_project_id uuid;
  invalid_row_count integer;
begin
  if studio_token is null or length(studio_token) <> 64
     or target_place_id is null or target_place_id !~ '^[0-9]{1,20}$'
     or target_universe_id is null or target_universe_id !~ '^[0-9]{1,20}$'
     or target_scope_key is null or length(target_scope_key) not between 1 and 1500
     or target_scope_key like '/%' or target_scope_key like '%/'
     or instance_rows is null then
    raise exception 'Invalid Studio snapshot.';
  end if;

  if jsonb_typeof(instance_rows) is distinct from 'array' then
    raise exception 'The Studio snapshot must be an array.';
  end if;
  if jsonb_array_length(instance_rows) > 3000 then
    raise exception 'The Studio snapshot exceeds the 3,000-instance limit.';
  end if;

  select l.project_id into linked_project_id
  from public.gameforge_studio_links l
  where l.token_hash = encode(extensions.digest(convert_to(studio_token, 'UTF8'), 'sha256'), 'hex')
    and l.token_hash is not null;

  if linked_project_id is null then
    raise exception 'This Studio connection is invalid or has been revoked.';
  end if;

  select count(*) into invalid_row_count
  from jsonb_to_recordset(instance_rows) as x(
    instance_key text,
    name text,
    class_name text,
    full_path text
  )
  where x.instance_key is null
     or length(x.instance_key) not between 1 and 1500
     or (x.instance_key <> target_scope_key
         and left(x.instance_key, length(target_scope_key) + 1) <> target_scope_key || '/')
     or x.name is null or length(x.name) > 200
     or x.class_name is null or length(x.class_name) not between 1 and 100
     or x.full_path is null or length(x.full_path) not between 1 and 3000;

  if invalid_row_count > 0
     or (select count(*) from jsonb_array_elements(instance_rows)) <>
        (select count(distinct value ->> 'instance_key') from jsonb_array_elements(instance_rows)) then
    raise exception 'The Studio snapshot contains invalid or duplicate instances.';
  end if;

  update public.gameforge_studio_instances
  set is_present = false
  where project_id = linked_project_id
    and place_id = target_place_id
    and (
      instance_key = target_scope_key
      or left(instance_key, length(target_scope_key) + 1) = target_scope_key || '/'
    );

  delete from public.gameforge_studio_instances i
  where i.project_id = linked_project_id
    and i.place_id = target_place_id
    and (
      i.instance_key = target_scope_key
      or left(i.instance_key, length(target_scope_key) + 1) = target_scope_key || '/'
    )
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

revoke all on function public.gameforge_studio_upsert_snapshot(text, text, text, text, jsonb) from public, authenticated;
grant execute on function public.gameforge_studio_upsert_snapshot(text, text, text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
