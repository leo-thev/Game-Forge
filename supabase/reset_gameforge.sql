-- Destructive: removes GAMEFORGE cloud workspace and collaboration data.
-- Supabase Auth users and unrelated database objects are not deleted.

drop table if exists public.gameforge_project_invitations;
drop table if exists public.gameforge_board_items;
drop table if exists public.gameforge_project_members;
drop table if exists public.gameforge_projects;
drop table if exists public.gameforge_workspaces;

drop function if exists public.gameforge_is_project_member(uuid);
drop function if exists public.gameforge_can_edit_project(uuid);
drop function if exists public.gameforge_create_project_invite(uuid, integer);
drop function if exists public.gameforge_revoke_project_invite(uuid);
drop function if exists public.gameforge_project_invite_expiry(uuid);
drop function if exists public.gameforge_accept_project_invite(text);
drop function if exists public.gameforge_leave_project(uuid);
