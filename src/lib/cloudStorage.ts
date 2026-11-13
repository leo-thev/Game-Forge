import type { AppData, BoardItem, Project, ProjectResource, ProjectRole, ProjectTeamMember, UsageStats } from "../types";
import type { GameforgeSupabase } from "./supabase";
import { clearLegacyData, emptyData, loadData, loadLanguagePreference } from "./storage";

type CloudProject = {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  color: string;
  logo_url: string | null;
  created_at: string;
};

type CloudBoardItem = {
  id: string;
  project_id: string;
  title: string;
  detail: string;
  kind: BoardItem["kind"];
  priority: BoardItem["priority"];
  status: BoardItem["status"];
  due_date: string | null;
  roles: ProjectRole[] | null;
};

type CloudProjectMember = { project_id: string; user_id: string; job_roles: ProjectRole[] };
type CloudTeamMember = { member_id: string; display_name: string; roles: ProjectRole[]; is_project_owner: boolean };

type CloudProjectResource = {
  id: string;
  project_id: string;
  source_id: string;
  resource_kind: ProjectResource["kind"];
  title: string;
  description: string;
  category: string;
  payload: { code?: string; assetId?: string; imageUrl?: string };
  created_at: string;
};

function throwOnError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function personalData(data: AppData) {
  return {
    scripts: data.scripts,
    assets: data.assets,
    collections: data.collections,
    preferences: data.preferences,
  };
}

function mapProject(project: CloudProject, memberCount: number, userId: string, memberRoles: ProjectRole[]): Project {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    color: project.color,
    logoUrl: project.logo_url ?? undefined,
    createdAt: project.created_at,
    ownerId: project.owner_id,
    role: project.owner_id === userId ? "owner" : memberRoles.includes("Co-owner") ? "co-owner" : "editor",
    memberCount,
  };
}

export async function loadCloudWorkspace(client: GameforgeSupabase, userId: string): Promise<{ data: AppData; migrated: boolean }> {
  const [workspaceResult, projectsResult, itemsResult, membersResult, resourcesResult] = await Promise.all([
    client.from("gameforge_workspaces").select("data").eq("user_id", userId).maybeSingle(),
    client.from("gameforge_projects").select("id, owner_id, name, description, color, logo_url, created_at").order("created_at", { ascending: false }),
    client.from("gameforge_board_items").select("id, project_id, title, detail, kind, priority, status, due_date, roles"),
    client.from("gameforge_project_members").select("project_id, user_id, job_roles"),
    client.from("gameforge_project_resources").select("id, project_id, source_id, resource_kind, title, description, category, payload, created_at"),
  ]);
  throwOnError(workspaceResult.error);
  throwOnError(projectsResult.error);
  throwOnError(itemsResult.error);
  throwOnError(membersResult.error);
  throwOnError(resourcesResult.error);

  const cloudProjects = (projectsResult.data ?? []) as CloudProject[];
  const cloudItems = (itemsResult.data ?? []) as CloudBoardItem[];
  const cloudResources = (resourcesResult.data ?? []) as CloudProjectResource[];
  const cloudDataExists = workspaceResult.data !== null || cloudProjects.length > 0;
  if (!cloudDataExists) {
    const legacy = loadData();
    legacy.preferences.language = loadLanguagePreference(legacy.preferences.language);
    await saveCloudWorkspace(client, userId, legacy, emptyData);
    clearLegacyData();
    return { data: legacy, migrated: true };
  }

  const counts = new Map<string, number>();
  const memberRoles = new Map<string, ProjectRole[]>();
  for (const member of (membersResult.data ?? []) as CloudProjectMember[]) {
    counts.set(member.project_id, (counts.get(member.project_id) ?? 0) + 1);
    if (member.user_id === userId) memberRoles.set(member.project_id, member.job_roles ?? []);
  }
  const stored = workspaceResult.data?.data as Partial<AppData> | null;
  const data: AppData = {
    ...emptyData,
    ...stored,
    scripts: Array.isArray(stored?.scripts) ? stored.scripts : [],
    assets: Array.isArray(stored?.assets) ? stored.assets : [],
    collections: Array.isArray(stored?.collections) && stored.collections.length ? stored.collections : ["Favorites"],
    preferences: {
      ...emptyData.preferences,
      ...stored?.preferences,
      accent: "blue",
      language: stored?.preferences?.language === "en" ? "en" : "fr",
      theme: stored?.preferences?.theme === "light" ? "light" : "dark",
    },
    projects: cloudProjects.map(project => mapProject(project, counts.get(project.id) ?? 0, userId, memberRoles.get(project.id) ?? [])),
    board: cloudItems.map(item => ({
      id: item.id,
      projectId: item.project_id,
      title: item.title,
      detail: item.detail,
      kind: item.kind,
      priority: item.priority,
      status: item.status,
      dueDate: item.due_date ?? undefined,
      roles: item.roles?.length ? item.roles : ["Owner"],
    })),
    projectResources: cloudResources.map(resource => ({
      id: resource.id,
      projectId: resource.project_id,
      sourceId: resource.source_id,
      kind: resource.resource_kind,
      title: resource.title,
      description: resource.description,
      category: resource.category,
      code: resource.payload?.code,
      assetId: resource.payload?.assetId,
      imageUrl: resource.payload?.imageUrl,
      linkedAt: resource.created_at,
    })),
  };
  return { data, migrated: false };
}

export async function saveCloudWorkspace(client: GameforgeSupabase, userId: string, next: AppData, previous: AppData): Promise<void> {
  const personalResult = await client.from("gameforge_workspaces").upsert(
    { user_id: userId, data: personalData(next), updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  throwOnError(personalResult.error);

  const previousProjectIds = new Set(previous.projects.map(project => project.id));
  const nextProjectIds = new Set(next.projects.map(project => project.id));
  const inserted = next.projects.filter(project => !previousProjectIds.has(project.id));
  if (inserted.length) {
    const result = await client.from("gameforge_projects").insert(inserted.map(project => ({
      id: project.id,
      owner_id: userId,
      name: project.name,
      description: project.description,
      color: project.color,
      logo_url: project.logoUrl ?? null,
      created_at: project.createdAt,
    })));
    throwOnError(result.error);
  }

  const updated = next.projects.filter(project => previousProjectIds.has(project.id));
  for (const project of updated) {
    const result = await client.from("gameforge_projects").update({
      name: project.name,
      description: project.description,
      color: project.color,
      logo_url: project.logoUrl ?? null,
    }).eq("id", project.id);
    throwOnError(result.error);
  }

  const previousItems = new Map(previous.board.map(item => [item.id, item]));
  const nextItemIds = new Set(next.board.map(item => item.id));
  const changedItems = next.board.filter(item => JSON.stringify(previousItems.get(item.id)) !== JSON.stringify(item));
  if (changedItems.length) {
    const result = await client.from("gameforge_board_items").upsert(changedItems.map(item => ({
      id: item.id,
      project_id: item.projectId,
      title: item.title,
      detail: item.detail,
      kind: item.kind,
      priority: item.priority,
      status: item.status,
      due_date: item.dueDate || null,
      roles: item.roles,
    })), { onConflict: "id" });
    throwOnError(result.error);
  }

  const removedItemIds = previous.board.filter(item => !nextItemIds.has(item.id)).map(item => item.id);
  if (removedItemIds.length) {
    const result = await client.from("gameforge_board_items").delete().in("id", removedItemIds);
    throwOnError(result.error);
  }

  const previousResourceIds = new Set(previous.projectResources.map(resource => resource.id));
  const nextResourceIds = new Set(next.projectResources.map(resource => resource.id));
  const changedResources = next.projectResources.filter(resource =>
    JSON.stringify(previous.projectResources.find(item => item.id === resource.id)) !== JSON.stringify(resource));
  if (changedResources.length) {
    const result = await client.from("gameforge_project_resources").upsert(changedResources.map(resource => ({
      id: resource.id,
      project_id: resource.projectId,
      source_id: resource.sourceId,
      resource_kind: resource.kind,
      created_by: userId,
      title: resource.title,
      description: resource.description,
      category: resource.category,
      payload: {
        ...(resource.code !== undefined ? { code: resource.code } : {}),
        ...(resource.assetId !== undefined ? { assetId: resource.assetId } : {}),
        ...(resource.imageUrl !== undefined ? { imageUrl: resource.imageUrl } : {}),
      },
      created_at: resource.linkedAt,
    })), { onConflict: "id" });
    throwOnError(result.error);
  }
  const removedResourceIds = [...previousResourceIds].filter(id => !nextResourceIds.has(id));
  if (removedResourceIds.length) {
    const result = await client.from("gameforge_project_resources").delete().in("id", removedResourceIds);
    throwOnError(result.error);
  }

  const removedProjectIds = [...previousProjectIds].filter(id => !nextProjectIds.has(id));
  const removedProjects = previous.projects.filter(project => removedProjectIds.includes(project.id));
  const ownedProjectIds = removedProjects.filter(project => project.role === "owner" || project.role === "co-owner").map(project => project.id);
  const leftProjectIds = removedProjects.filter(project => project.role === "editor").map(project => project.id);
  if (ownedProjectIds.length) {
    const result = await client.from("gameforge_projects").delete().in("id", ownedProjectIds);
    throwOnError(result.error);
  }
  for (const projectId of leftProjectIds) {
    const { error } = await client.rpc("gameforge_leave_project", { target_project_id: projectId });
    throwOnError(error);
  }
}

export async function getProjectTeam(client: GameforgeSupabase, projectId: string): Promise<ProjectTeamMember[]> {
  const { data, error } = await client.rpc("gameforge_get_project_team", { target_project_id: projectId });
  throwOnError(error);
  if (!Array.isArray(data)) throw new Error("The project team service returned invalid data.");
  return (data as CloudTeamMember[]).map(member => ({
    id: member.member_id,
    displayName: member.display_name,
    roles: member.roles ?? [],
    isProjectOwner: member.is_project_owner,
  }));
}

export async function setProjectMemberRoles(
  client: GameforgeSupabase,
  projectId: string,
  userId: string,
  roles: ProjectRole[],
): Promise<void> {
  const { error } = await client.rpc("gameforge_set_project_member_roles", {
    target_project_id: projectId,
    target_user_id: userId,
    target_roles: roles,
  });
  throwOnError(error);
}

export async function removeProjectMember(client: GameforgeSupabase, projectId: string, userId: string): Promise<void> {
  const { error } = await client.rpc("gameforge_remove_project_member", {
    target_project_id: projectId,
    target_user_id: userId,
  });
  throwOnError(error);
}

export async function isUsageAnalyticsAdmin(client: GameforgeSupabase): Promise<boolean> {
  const { data, error } = await client.rpc("gameforge_is_analytics_admin");
  throwOnError(error);
  if (typeof data !== "boolean") throw new Error("The usage analytics access check returned invalid data.");
  return data;
}

export async function recordUsageActivity(client: GameforgeSupabase): Promise<void> {
  const { error } = await client.rpc("gameforge_record_usage_activity");
  throwOnError(error);
}

export async function getUsageStats(client: GameforgeSupabase): Promise<UsageStats> {
  const { data, error } = await client.rpc("gameforge_get_usage_stats");
  throwOnError(error);
  if (!Array.isArray(data) || data.length !== 1) throw new Error("Usage statistics are unavailable for this account.");
  const row = data[0] as {
    total_visits?: unknown;
    accounts_created?: unknown;
    active_users_7d?: unknown;
    active_users_30d?: unknown;
    last_activity_at?: unknown;
  };
  const count = (value: unknown) => {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("The usage statistics service returned an invalid counter.");
    return parsed;
  };
  if (row.last_activity_at !== null && typeof row.last_activity_at !== "string") {
    throw new Error("The usage statistics service returned an invalid activity date.");
  }
  return {
    totalVisits: count(row.total_visits),
    accountsCreated: count(row.accounts_created),
    activeUsers7d: count(row.active_users_7d),
    activeUsers30d: count(row.active_users_30d),
    lastActivityAt: row.last_activity_at,
  };
}

export async function createStudioLink(client: GameforgeSupabase, projectId: string): Promise<string> {
  const { data, error } = await client.rpc("gameforge_create_studio_link", { target_project_id: projectId });
  throwOnError(error);
  if (typeof data !== "string" || !/^[a-f0-9]{64}$/.test(data)) {
    throw new Error("The Studio connection could not be created.");
  }
  return data;
}

export async function revokeStudioLink(client: GameforgeSupabase, projectId: string): Promise<void> {
  const { error } = await client.rpc("gameforge_revoke_studio_link", { target_project_id: projectId });
  throwOnError(error);
}

export async function hasStudioLink(client: GameforgeSupabase, projectId: string): Promise<boolean> {
  const { data, error } = await client.rpc("gameforge_studio_link_status", { target_project_id: projectId });
  throwOnError(error);
  if (typeof data !== "boolean") throw new Error("The Studio connection status is invalid.");
  return data;
}

export async function createProjectInvite(client: GameforgeSupabase, projectId: string): Promise<string> {
  const { data, error } = await client.rpc("gameforge_create_project_invite", {
    target_project_id: projectId,
    valid_days: 7,
  });
  throwOnError(error);
  if (typeof data !== "string" || !/^[a-f0-9]{64}$/.test(data)) throw new Error("The invitation service returned an invalid link.");
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("invite", data);
  return url.toString();
}

export async function revokeProjectInvite(client: GameforgeSupabase, projectId: string): Promise<void> {
  const { error } = await client.rpc("gameforge_revoke_project_invite", { target_project_id: projectId });
  throwOnError(error);
}

export async function getProjectInviteExpiry(client: GameforgeSupabase, projectId: string): Promise<string | null> {
  const { data, error } = await client.rpc("gameforge_project_invite_expiry", { target_project_id: projectId });
  throwOnError(error);
  if (data === null) return null;
  if (typeof data !== "string" || Number.isNaN(Date.parse(data))) throw new Error("The invitation service returned an invalid expiry date.");
  return data;
}

export async function acceptProjectInvite(client: GameforgeSupabase, token: string): Promise<void> {
  const { error } = await client.rpc("gameforge_accept_project_invite", { invite_token: token });
  throwOnError(error);
}
