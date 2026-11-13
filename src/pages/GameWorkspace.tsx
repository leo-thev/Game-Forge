import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, Check, ChevronDown, CircleDot, Clipboard, Code2, Download, ExternalLink, Flag, FolderKanban, ImagePlus, Link2, MessageSquareText, Plus, Rocket, Share2, Settings2, Trash2, Unlink, Users, Workflow, X } from "lucide-react";
import type { AssetItem, BoardItem, Project, ProjectResource, ProjectRole, ProjectTeamMember, ScriptItem, Translator } from "../types";
import { projectTemplates, type ProjectTemplateId } from "../data/projectTemplates";
import { assignableProjectRoles, projectRoles } from "../data/projectRoles";
import { Button, EmptyState, Field, IconButton, Modal } from "../components/UI";
import { ProjectChat } from "../components/ProjectChat";
import { StudioExplorer } from "../components/StudioExplorer";
import type { GameforgeSupabase } from "../lib/supabase";
import { getProjectTeam, removeProjectMember, setProjectMemberRoles } from "../lib/cloudStorage";

const colors = ["#5577FF", "#FF8A4C", "#B493F7", "#4FBF9A", "#DB638A"];
const statuses: BoardItem["status"][] = ["Backlog", "In progress", "Done"];
const kindIcons = { Feature: Workflow, Mechanic: Settings2, Bug: CircleDot, Milestone: Flag, Note: MessageSquareText };

function formatDueDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function isOverdue(value: string): boolean {
  const due = new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

async function prepareProjectLogo(file: File): Promise<Blob> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  }
  if (file.size > 8 * 1024 * 1024) throw new Error("Project logo must be smaller than 8 MB.");
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 512 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The project logo image could not be processed.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", .86));
    if (!blob) throw new Error("The project logo image could not be converted.");
    if (blob.size > 2 * 1024 * 1024) throw new Error("The optimized project logo must be smaller than 2 MB.");
    return blob;
  } finally {
    image.close();
  }
}

function projectLogoStoragePath(url?: string): string | null {
  if (!url) return null;
  const marker = "/storage/v1/object/public/gameforge-project-logos/";
  const index = url.indexOf(marker);
  return index < 0 ? null : decodeURIComponent(url.slice(index + marker.length));
}

async function uploadProjectLogo(client: GameforgeSupabase, project: Project, file: File): Promise<string> {
  const blob = await prepareProjectLogo(file);
  const path = `${project.id}/${crypto.randomUUID()}.webp`;
  const { error: uploadError } = await client.storage.from("gameforge-project-logos").upload(path, blob, {
    contentType: "image/webp",
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) throw uploadError;
  const publicUrl = client.storage.from("gameforge-project-logos").getPublicUrl(path).data.publicUrl;
  const { error: updateError } = await client.from("gameforge_projects")
    .update({ logo_url: publicUrl })
    .eq("id", project.id)
    .select("id")
    .single();
  if (updateError) {
    const { error: cleanupError } = await client.storage.from("gameforge-project-logos").remove([path]);
    if (cleanupError) console.error("GAMEFORGE could not clean up the failed project-logo upload.", cleanupError);
    throw updateError;
  }
  const oldPath = projectLogoStoragePath(project.logoUrl);
  if (oldPath) {
    const { error: removeError } = await client.storage.from("gameforge-project-logos").remove([oldPath]);
    if (removeError) console.error("GAMEFORGE could not remove the previous project logo.", removeError);
  }
  return publicUrl;
}

async function removeProjectLogo(client: GameforgeSupabase, project: Project): Promise<boolean> {
  const { error } = await client.from("gameforge_projects")
    .update({ logo_url: null })
    .eq("id", project.id)
    .select("id")
    .single();
  if (error) throw error;
  const path = projectLogoStoragePath(project.logoUrl);
  if (path) {
    const { error: removeError } = await client.storage.from("gameforge-project-logos").remove([path]);
    if (removeError) {
      console.error("GAMEFORGE could not remove the previous project logo.", removeError);
      return false;
    }
  }
  return true;
}

export function GameWorkspace({ projects, setProjects, board, setBoard, scripts, assets, projectResources, setProjectResources, setProjectWorkspaceData, client, onToast, newProjectRequest = 0, onProjectRequestHandled, currentUserId, createInvite, revokeInvite, getInviteExpiry, t }: { projects: Project[]; setProjects: (projects: Project[]) => void; board: BoardItem[]; setBoard: (items: BoardItem[]) => void; scripts: ScriptItem[]; assets: AssetItem[]; projectResources: ProjectResource[]; setProjectResources: (resources: ProjectResource[]) => void; setProjectWorkspaceData: (projects: Project[], board: BoardItem[], resources: ProjectResource[]) => void; client: GameforgeSupabase; onToast: (message: string, type?: "error") => void; newProjectRequest?: number; onProjectRequestHandled?: () => void; currentUserId: string; createInvite: (projectId: string) => Promise<string>; revokeInvite: (projectId: string) => Promise<void>; getInviteExpiry: (projectId: string) => Promise<string | null>; t: Translator }) {
  const [selectedProject, setSelectedProject] = useState(projects[0]?.id ?? "all");
  const [showProject, setShowProject] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showItem, setShowItem] = useState(false);
  const [editing, setEditing] = useState<BoardItem | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectColor, setProjectColor] = useState(colors[projects.length % colors.length]);
  const [projectTemplate, setProjectTemplate] = useState<ProjectTemplateId>("blank");
  const [projectLogoFile, setProjectLogoFile] = useState<File | null>(null);
  const [projectLogoPreview, setProjectLogoPreview] = useState("");
  const [removeExistingProjectLogo, setRemoveExistingProjectLogo] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [kind, setKind] = useState<BoardItem["kind"]>("Feature");
  const [priority, setPriority] = useState<BoardItem["priority"]>("Medium");
  const [status, setStatus] = useState<BoardItem["status"]>("Backlog");
  const [dueDate, setDueDate] = useState("");
  const [taskRoles, setTaskRoles] = useState<ProjectRole[]>([]);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [teamMembersByProject, setTeamMembersByProject] = useState<Record<string, ProjectTeamMember[]>>({});
  const [teamProject, setTeamProject] = useState<Project | null>(null);
  const [teamBusy, setTeamBusy] = useState("");
  const [itemProject, setItemProject] = useState("");
  const [showResource, setShowResource] = useState(false);
  const [resourceKind, setResourceKind] = useState<ProjectResource["kind"]>("Asset");
  const [resourceSourceId, setResourceSourceId] = useState("");
  const [resourceProjectId, setResourceProjectId] = useState("");
  const [sharingProject, setSharingProject] = useState<Project | null>(null);
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteExpiry, setInviteExpiry] = useState<string | null>(null);
  const sharingProjectId = useRef<string | null>(null);
  const applyTeamData = (teamData: Record<string, ProjectTeamMember[]>) => {
    setTeamMembersByProject(teamData);
    const updatedProjects = projects.map(project => {
      const currentMember = teamData[project.id]?.find(member => member.id === currentUserId);
      const role: Project["role"] = project.ownerId === currentUserId ? "owner" : currentMember?.roles.includes("Co-owner") ? "co-owner" : "editor";
      const memberCount = Math.max(0, (teamData[project.id]?.length ?? (project.memberCount ?? 0) + 1) - 1);
      return project.role === role && project.memberCount === memberCount
        ? project
        : { ...project, role, memberCount };
    });
    if (updatedProjects.some((project, index) => project !== projects[index])) setProjects(updatedProjects);
  };
  const refreshTeams = async () => {
    const results = await Promise.all(projects.map(async project => [project.id, await getProjectTeam(client, project.id)] as const));
    applyTeamData(Object.fromEntries(results));
  };
  useEffect(() => {
    let active = true;
    const loadTeams = async () => {
      try {
        const results = await Promise.all(projects.map(async project => [project.id, await getProjectTeam(client, project.id)] as const));
        if (active) applyTeamData(Object.fromEntries(results));
      } catch (error) {
        console.error("GAMEFORGE could not load project roles.", error);
        if (active) onToast(error instanceof Error ? error.message : t("The project team could not be loaded."), "error");
      }
    };
    void loadTeams();
    const channel = client.channel("gameforge-project-team")
      .on("postgres_changes", { event: "*", schema: "public", table: "gameforge_project_members" }, () => { void loadTeams(); })
      .subscribe();
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [client, projects, currentUserId]);
  useEffect(() => {
    if (newProjectRequest > 0) {
      openNewProject();
      onProjectRequestHandled?.();
    }
  }, [newProjectRequest, onProjectRequestHandled]);
  const currentProject = projects.find(project => project.id === selectedProject);
  const visible = useMemo(() => board.filter(item => {
    if (selectedProject !== "all" && item.projectId !== selectedProject) return false;
    if (showAllTasks) return true;
    const project = projects.find(candidate => candidate.id === item.projectId);
    const member = teamMembersByProject[item.projectId]?.find(candidate => candidate.id === currentUserId);
    const roles = member?.roles ?? (project?.ownerId === currentUserId ? ["Owner"] : []);
    return item.roles.some(role => roles.includes(role));
  }), [board, selectedProject, showAllTasks, projects, teamMembersByProject, currentUserId]);
  const deadlines = useMemo(() => visible.filter(item => item.dueDate && item.status !== "Done")
    .sort((left, right) => (left.dueDate ?? "").localeCompare(right.dueDate ?? "")), [visible]);
  const visibleResources = useMemo(() => projectResources.filter(resource => selectedProject === "all" || resource.projectId === selectedProject), [projectResources, selectedProject]);
  const linkedSourceIds = new Set(projectResources.filter(resource => resource.projectId === resourceProjectId && resource.kind === resourceKind).map(resource => resource.sourceId));
  const availableSources = resourceKind === "Script"
    ? scripts.filter(script => !linkedSourceIds.has(script.id)).map(script => ({ id: script.id, name: script.name, detail: script.category }))
    : assets.filter(asset => !linkedSourceIds.has(asset.id)).map(asset => ({ id: asset.id, name: asset.name, detail: `${asset.category} · ${asset.assetId}` }));
  const newProject = async () => {
    if (!projectName.trim()) return;
    if (editingProject) {
      setProjectBusy(true);
      try {
        let logoUrl = editingProject.logoUrl;
        let oldLogoRemoved = true;
        if (editingProject.role !== "editor" && projectLogoFile) {
          logoUrl = await uploadProjectLogo(client, editingProject, projectLogoFile);
        } else if (editingProject.role !== "editor" && removeExistingProjectLogo) {
          oldLogoRemoved = await removeProjectLogo(client, editingProject);
          logoUrl = undefined;
        }
        setProjects(projects.map(project => project.id === editingProject.id ? {
          ...project,
          name: projectName.trim(),
          description: projectDescription.trim(),
          color: projectColor,
          logoUrl,
        } : project));
        if (projectLogoPreview.startsWith("blob:")) URL.revokeObjectURL(projectLogoPreview);
        setProjectLogoFile(null); setProjectLogoPreview(""); setRemoveExistingProjectLogo(false);
        setProjectName(""); setProjectDescription(""); setEditingProject(null); setShowProject(false);
        onToast(t(oldLogoRemoved ? "Project details updated" : "Project logo removed, but the old file could not be deleted."));
      } catch (error) {
        console.error("GAMEFORGE could not save project details or logo.", error);
        onToast(error instanceof Error ? error.message : t("Project details could not be saved."), "error");
      } finally {
        setProjectBusy(false);
      }
      return;
    }
    const project: Project = { id: crypto.randomUUID(), name: projectName.trim(), description: projectDescription.trim(), color: projectColor, createdAt: new Date().toISOString(), ownerId: currentUserId, role: "owner", memberCount: 0 };
    const template = projectTemplates.find(item => item.id === projectTemplate) ?? projectTemplates[0];
    const starterItems: BoardItem[] = template.items.map(item => ({
      ...item,
      id: crypto.randomUUID(),
      projectId: project.id,
      status: "Backlog",
      roles: ["Owner"],
    }));
    setProjectWorkspaceData([...projects, project], [...board, ...starterItems], projectResources);
    setSelectedProject(project.id); setProjectName(""); setProjectDescription(""); setProjectColor(colors[(projects.length + 1) % colors.length]); setProjectTemplate("blank"); setShowProject(false); onToast(t("Project created"));
  };
  const openNewItem = () => {
    const projectId = currentProject?.id ?? projects[0]?.id ?? "";
    const project = projects.find(candidate => candidate.id === projectId);
    const member = teamMembersByProject[projectId]?.find(candidate => candidate.id === currentUserId);
    const roles = member?.roles ?? (project?.ownerId === currentUserId ? ["Owner"] : []);
    setEditing(null); setTitle(""); setDetail(""); setKind("Feature"); setPriority("Medium"); setStatus("Backlog"); setDueDate(""); setTaskRoles(roles); setItemProject(projectId); setShowItem(true);
  };
  const openNewProject = () => {
    if (projectLogoPreview.startsWith("blob:")) URL.revokeObjectURL(projectLogoPreview);
    setEditingProject(null); setProjectName(""); setProjectDescription(""); setProjectColor(colors[projects.length % colors.length]); setProjectTemplate("blank"); setProjectLogoFile(null); setProjectLogoPreview(""); setRemoveExistingProjectLogo(false); setShowProject(true);
  };
  const editProject = () => {
    if (!currentProject) return;
    if (projectLogoPreview.startsWith("blob:")) URL.revokeObjectURL(projectLogoPreview);
    setEditingProject(currentProject); setProjectName(currentProject.name); setProjectDescription(currentProject.description); setProjectColor(currentProject.color); setProjectLogoFile(null); setProjectLogoPreview(currentProject.logoUrl ?? ""); setRemoveExistingProjectLogo(false); setShowProject(true);
  };
  const closeProjectModal = () => {
    if (projectLogoPreview.startsWith("blob:")) URL.revokeObjectURL(projectLogoPreview);
    setProjectLogoFile(null); setProjectLogoPreview(""); setRemoveExistingProjectLogo(false); setShowProject(false); setEditingProject(null);
  };
  const chooseProjectLogo = (file?: File) => {
    if (!file) return;
    if (projectLogoPreview.startsWith("blob:")) URL.revokeObjectURL(projectLogoPreview);
    setProjectLogoFile(file);
    setProjectLogoPreview(URL.createObjectURL(file));
    setRemoveExistingProjectLogo(false);
  };
  const clearProjectLogo = () => {
    if (projectLogoPreview.startsWith("blob:")) URL.revokeObjectURL(projectLogoPreview);
    setProjectLogoFile(null);
    setProjectLogoPreview("");
    setRemoveExistingProjectLogo(Boolean(editingProject?.logoUrl));
  };
  const openEditItem = (item: BoardItem) => { setEditing(item); setTitle(item.title); setDetail(item.detail); setKind(item.kind); setPriority(item.priority); setStatus(item.status); setDueDate(item.dueDate ?? ""); setTaskRoles(item.roles); setItemProject(item.projectId); setShowItem(true); };
  const saveItem = () => {
    if (!title.trim() || !itemProject || !taskRoles.length) return;
    const updated: BoardItem = { id: editing?.id ?? crypto.randomUUID(), title: title.trim(), detail: detail.trim(), kind, priority, status, projectId: itemProject, roles: taskRoles, dueDate: dueDate || undefined };
    setBoard(editing ? board.map(item => item.id === editing.id ? updated : item) : [updated, ...board]);
    setShowItem(false); onToast(t(editing ? "Workspace item updated" : `${kind} added to workspace`));
  };
  const shift = (item: BoardItem, direction: -1 | 1) => {
    const index = statuses.indexOf(item.status);
    const next = statuses[Math.max(0, Math.min(statuses.length - 1, index + direction))];
    setBoard(board.map(task => task.id === item.id ? { ...task, status: next } : task));
  };
  const removeItem = (item: BoardItem) => {
    if (!window.confirm(`${t("Delete")} « ${item.title} » ?`)) return;
    setBoard(board.filter(task => task.id !== item.id)); onToast(t("Workspace item deleted"));
  };
  const removeProject = () => {
    if (!currentProject || !window.confirm(`${t("Delete project")} « ${currentProject.name} » ? ${board.filter(item => item.projectId === currentProject.id).length} ${t("workspace items will also be deleted.")}`)) return;
    const remainingProjects = projects.filter(project => project.id !== currentProject.id);
    setProjectWorkspaceData(
      remainingProjects,
      board.filter(item => item.projectId !== currentProject.id),
      projectResources.filter(item => item.projectId !== currentProject.id),
    );
    setSelectedProject(remainingProjects[0]?.id ?? "all");
    onToast(t("Project and its workspace items deleted"));
  };
  const openResourceDialog = () => {
    const projectId = currentProject?.id ?? projects[0]?.id ?? "";
    setResourceKind("Asset");
    setResourceProjectId(projectId);
    setResourceSourceId("");
    setShowResource(true);
  };
  const linkResource = () => {
    if (!resourceProjectId) return;
    const common = { id: crypto.randomUUID(), projectId: resourceProjectId, linkedAt: new Date().toISOString() };
    let resource: ProjectResource;
    if (resourceKind === "Script") {
      const source = scripts.find(script => script.id === resourceSourceId);
      if (!source) return;
      resource = { ...common, sourceId: source.id, kind: "Script", title: source.name, description: "", category: source.category, code: source.code };
    } else {
      const source = assets.find(asset => asset.id === resourceSourceId);
      if (!source) return;
      resource = { ...common, sourceId: source.id, kind: "Asset", title: source.name, description: source.description, category: source.category, assetId: source.assetId, imageUrl: source.imageUrl };
    }
    setProjectResources([resource, ...projectResources]);
    setShowResource(false);
    onToast(t("Resource linked to project"));
  };
  const unlinkResource = (resource: ProjectResource) => {
    if (!window.confirm(`${t("Remove")} « ${resource.title} » ${t("from this project?")}`)) return;
    setProjectResources(projectResources.filter(item => item.id !== resource.id));
    onToast(t("Linked resource removed"));
  };
  const copyResourceCode = async (resource: ProjectResource) => {
    if (resource.code === undefined) return;
    try {
      await navigator.clipboard.writeText(resource.code);
      onToast(t("Script copied to clipboard"));
    } catch (error) {
      console.error("GAMEFORGE could not copy the linked script.", error);
      onToast(t("Clipboard access failed. Check browser permissions."), "error");
    }
  };
  const exportProject = async () => {
    if (!currentProject || selectedProject === "all") return;
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const projectBoard = board.filter(item => item.projectId === currentProject.id);
      const resources = projectResources.filter(item => item.projectId === currentProject.id);
      const scripts = resources.filter(resource => resource.kind === "Script" && resource.code !== undefined);
      const assets = resources.filter(resource => resource.kind === "Asset");
      const safeName = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "project";
      const scriptFiles = scripts.map(resource => {
        const path = `scripts/${safeName(resource.title)}-${resource.id.slice(0, 8)}.luau`;
        zip.file(path, resource.code ?? "");
        return { title: resource.title, category: resource.category, path };
      });
      zip.file("project.json", JSON.stringify({
        format: "gameforge.project.v1",
        exportedAt: new Date().toISOString(),
        project: {
          name: currentProject.name,
          description: currentProject.description,
          color: currentProject.color,
          createdAt: currentProject.createdAt,
        },
        resources: resources.map(({ id, kind, title, description, category, assetId, imageUrl }) => ({
          id, kind, title, description, category,
          ...(assetId ? { assetId } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        })),
        scriptFiles,
      }, null, 2));
      zip.file("board.json", JSON.stringify(projectBoard.map(({ id, title, detail, kind, priority, status, roles, dueDate }) => ({
        id, title, detail, kind, priority, status, roles, ...(dueDate ? { dueDate } : {}),
      })), null, 2));
      zip.file("assets.json", JSON.stringify(assets.map(({ title, description, category, assetId, imageUrl }) => ({
        title, description, category, assetId, ...(imageUrl ? { imageUrl } : {}),
      })), null, 2));
      zip.file("README.txt", [
        currentProject.name,
        "",
        currentProject.description,
        "",
        "Project planning data: project.json and board.json",
        "Linked Luau snapshots: scripts/",
        "Linked Roblox asset IDs: assets.json",
      ].join("\n"));
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `gameforge-${safeName(currentProject.name)}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast(t("Project export downloaded"));
    } catch (error) {
      console.error("GAMEFORGE could not export the project.", error);
      onToast(error instanceof Error ? error.message : t("Project export failed."), "error");
    }
  };
  const displayedResources = visibleResources;
  const counts = statuses.map(item => visible.filter(task => task.status === item).length);
  const openSharing = (project: Project) => {
    sharingProjectId.current = project.id;
    setSharingProject(project);
    setInviteUrl("");
    setInviteExpiry(null);
    setInviteBusy(true);
    void getInviteExpiry(project.id).then(expiry => {
      if (sharingProjectId.current === project.id) setInviteExpiry(expiry);
    }).catch(error => {
      console.error("GAMEFORGE could not load the project invitation status.", error);
      if (sharingProjectId.current === project.id) onToast(error instanceof Error ? error.message : t("The invitation status could not be loaded."), "error");
    }).finally(() => {
      if (sharingProjectId.current === project.id) setInviteBusy(false);
    });
  };
  const generateInvite = async () => {
    if (!sharingProject) return;
    setInviteBusy(true);
    try {
      const url = await createInvite(sharingProject.id);
      setInviteUrl(url);
      setInviteExpiry(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());
      try {
        await navigator.clipboard.writeText(url);
        onToast(t("Invitation link copied to clipboard"));
      } catch (error) {
        console.error("GAMEFORGE could not access the clipboard.", error);
        onToast(t("Invitation created. Copy the link below to share it."));
      }
    } catch (error) {
      console.error("GAMEFORGE could not create a project invitation.", error);
      onToast(error instanceof Error ? error.message : t("The invitation could not be created."), "error");
    } finally {
      setInviteBusy(false);
    }
  };
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      onToast(t("Invitation link copied to clipboard"));
    } catch (error) {
      console.error("GAMEFORGE could not access the clipboard.", error);
      onToast(t("Clipboard access failed. Check browser permissions."), "error");
    }
  };
  const revokeCurrentInvite = async () => {
    if (!sharingProject) return;
    setInviteBusy(true);
    try {
      await revokeInvite(sharingProject.id);
      setInviteUrl("");
      setInviteExpiry(null);
      onToast(t("Invitation link revoked"));
    } catch (error) {
      console.error("GAMEFORGE could not revoke the project invitation.", error);
      onToast(error instanceof Error ? error.message : t("The invitation could not be revoked."), "error");
    } finally {
      setInviteBusy(false);
    }
  };
  const updateMemberRoles = async (member: ProjectTeamMember, roles: ProjectRole[]) => {
    if (!teamProject) return;
    setTeamBusy(member.id);
    try {
      await setProjectMemberRoles(client, teamProject.id, member.id, roles);
      await refreshTeams();
      onToast(t("Project roles updated"));
    } catch (error) {
      console.error("GAMEFORGE could not update collaborator roles.", error);
      onToast(error instanceof Error ? error.message : t("Project roles could not be updated."), "error");
    } finally {
      setTeamBusy("");
    }
  };
  const removeMember = async (member: ProjectTeamMember) => {
    if (!teamProject || !window.confirm(`${t("Remove collaborator")} ${member.displayName}?`)) return;
    setTeamBusy(member.id);
    try {
      await removeProjectMember(client, teamProject.id, member.id);
      await refreshTeams();
      onToast(t("Collaborator removed"));
    } catch (error) {
      console.error("GAMEFORGE could not remove a project collaborator.", error);
      onToast(error instanceof Error ? error.message : t("Collaborator could not be removed."), "error");
    } finally {
      setTeamBusy("");
    }
  };
  return <div className="page-content game-workspace">
    <div className="module-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> {t("FROM FIRST IDEA TO FINAL BUILD")}</div><h1>{t("Game")} <span>{t("Workspace")}</span></h1><p>{t("Plan mechanics, track the details, and move your Roblox game forward.")}</p></div><div className="module-heading-actions"><Button variant="secondary" disabled={!currentProject || selectedProject === "all"} onClick={() => void exportProject()}><Download size={15} /> {t("Export project")}</Button><Button variant="secondary" onClick={openNewProject}><FolderKanban size={15} /> {t("New project")}</Button><Button onClick={openNewItem} disabled={!projects.length}><Plus size={15} /> {t("Add to board")}</Button></div></div>
    {!projects.length ? <section className="workspace-empty panel"><EmptyState icon={<Rocket size={22} />} title={t("Give your game a home")} description={t("Create a project to organize its mechanics, features, bugs, milestones, and notes in one board.")} action={<Button onClick={openNewProject}><Plus size={14} /> {t("Create your first project")}</Button>} /></section> : <>
      <div className="workspace-projectbar"><label className="project-select-label"><span>{t("PROJECT")}</span><span className="project-select-wrap">{currentProject?.logoUrl ? <img className="project-select-logo" src={currentProject.logoUrl} alt="" /> : <span className="project-select-swatch" style={{ background: currentProject?.color ?? colors[0] }} />}<select value={selectedProject} onChange={event => setSelectedProject(event.target.value)}><option value="all">{t("All projects")}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select><ChevronDown size={14} /></span></label>{currentProject && <><div className="projectbar-description">{currentProject.description || t("No description yet.")}</div>{currentProject.role !== "editor" && <><button className="delete-project-link" onClick={() => openSharing(currentProject)}><Share2 size={13} /> {t("Invite collaborators")} <span className="collaborator-count">{currentProject.memberCount ?? 0}</span></button><button className="delete-project-link" onClick={() => setTeamProject(currentProject)}><Users size={13} /> {t("Manage team")}</button></>}<button className="delete-project-link" onClick={editProject}><Settings2 size={13} /> {t("Edit details")}</button>{currentProject.role !== "editor" && <button className="delete-project-link" onClick={removeProject}><Trash2 size={13} /> {t("Delete project")}</button>}</>}<div className="projectbar-spacer" /><div className="workspace-summary"><span className="summary-dot" />{visible.filter(item => item.status !== "Done").length} {t("open items")}</div></div>
      <div className="workspace-stats"><div><span className="workspace-stat-icon blue"><Workflow size={15} /></span><span><b>{visible.filter(item => item.kind === "Feature" || item.kind === "Mechanic").length}</b><small>{t("FEATURES & MECHANICS")}</small></span></div><div><span className="workspace-stat-icon blue"><CircleDot size={15} /></span><span><b>{visible.filter(item => item.kind === "Bug").length}</b><small>{t("BUGS TRACKED")}</small></span></div><div><span className="workspace-stat-icon purple"><Flag size={15} /></span><span><b>{visible.filter(item => item.kind === "Milestone").length}</b><small>{t("MILESTONES")}</small></span></div><div><span className="workspace-stat-icon green"><Check size={15} /></span><span><b>{visible.filter(item => item.status === "Done").length}</b><small>{t("COMPLETED")}</small></span></div></div>
      <section className="project-resources panel" id="project-resources"><header className="project-resources-heading"><div><div className="eyebrow">{t("SHARED WITH PROJECT MEMBERS")}</div><h2>{t("Linked resources")} <span>{displayedResources.length}</span></h2><p>{t("Scripts are shared as code snapshots; assets are shared as saved Roblox IDs. Later library edits do not change a linked copy.")}</p></div><Button variant="secondary" onClick={openResourceDialog}><Link2 size={14} /> {t("Link a resource")}</Button></header>{displayedResources.length ? <div className="project-resource-grid">{displayedResources.map(resource => <article className="project-resource-card" key={resource.id}><header><span className={`project-resource-icon ${resource.kind === "Script" ? "resource-script" : "resource-asset"}`}>{resource.kind === "Script" ? <Code2 size={15} /> : <FolderKanban size={15} />}</span><div><h3>{resource.title}</h3><small>{t(resource.kind)} · {t(resource.category)}{selectedProject === "all" ? ` · ${projects.find(project => project.id === resource.projectId)?.name ?? ""}` : ""}</small></div><IconButton label={t("Unlink resource")} onClick={() => unlinkResource(resource)}><Unlink size={13} /></IconButton></header>{resource.description && <p>{resource.description}</p>}{resource.kind === "Script" && <><details className="project-resource-code"><summary>{t("View shared code")}</summary><pre><code>{resource.code}</code></pre></details><button className="project-resource-action" onClick={() => void copyResourceCode(resource)}><Clipboard size={13} /> {t("Copy script")}</button></>}{resource.kind === "Asset" && <div className="project-resource-asset"><code>{resource.assetId}</code>{resource.assetId && <a href={`https://create.roblox.com/store/asset/${encodeURIComponent(resource.assetId)}`} target="_blank" rel="noreferrer">{t("Open in Roblox")} <ExternalLink size={12} /></a>}</div>}</article>)}</div> : <div className="project-resources-empty"><Link2 size={15} />{t("Link a script or asset so every project collaborator can access it here.")}</div>}</section>
      {currentProject && selectedProject !== "all" && <StudioExplorer key={currentProject.id} client={client} project={currentProject} t={t} />}
      {currentProject && selectedProject !== "all" && <ProjectChat client={client} projectId={currentProject.id} currentUserId={currentUserId} isProjectOwner={currentProject.role !== "editor"} resources={projectResources.filter(resource => resource.projectId === currentProject.id)} teamMembers={teamMembersByProject[currentProject.id] ?? []} t={t} />}
      <label className="show-all-tasks"><input type="checkbox" checked={showAllTasks} onChange={event => setShowAllTasks(event.target.checked)} /><span>{t("Show all tasks")}</span><small>{t("Otherwise, only tasks assigned to your project roles are shown.")}</small></label>
      <div className="kanban-board">{statuses.map((column, index) => {
        const items = visible.filter(item => item.status === column);
        return <section className={`kanban-column kanban-${index}`} key={column}><header className="kanban-heading"><div className="kanban-heading-title"><i className={`kanban-dot kanban-dot-${index}`} /><h2>{t(column)}</h2><span>{counts[index]}</span></div><IconButton label={`${t("Add item")} · ${t(column)}`} onClick={() => { openNewItem(); setStatus(column); }}><Plus size={15} /></IconButton></header><div className="kanban-cards">{items.map(item => { const Icon = kindIcons[item.kind]; return <article className="kanban-card" key={item.id}><div className="kanban-card-top"><span className={`task-kind task-${item.kind.toLowerCase()}`}><Icon size={12} />{t(item.kind)}</span><div className="kanban-item-actions"><IconButton label={t("Edit item")} onClick={() => openEditItem(item)}><span className="more-dots">···</span></IconButton><IconButton label={t("Delete item")} onClick={() => removeItem(item)}><Trash2 size={12} /></IconButton></div></div><button className="kanban-card-content" onClick={() => openEditItem(item)}><h3>{item.title}</h3>{item.detail && <p>{item.detail}</p>}</button><div className="task-role-list">{item.roles.map(role => <span className="project-role-badge" key={role}>{t(role)}</span>)}</div>{item.dueDate && <div className={`milestone-due ${item.status !== "Done" && isOverdue(item.dueDate) ? "milestone-overdue" : ""}`}><CalendarDays size={12} /><time dateTime={item.dueDate}>{formatDueDate(item.dueDate)}</time>{item.status !== "Done" && isOverdue(item.dueDate) && <span>{t("Overdue")}</span>}</div>}<div className="kanban-card-bottom"><span className={`priority priority-${item.priority.toLowerCase()}`}>{item.priority === "High" ? <ArrowUp size={12} /> : item.priority === "Low" ? <ArrowDown size={12} /> : <span className="priority-medium-icon">—</span>}{t(item.priority)}</span><span className="task-project-name"><i style={{ background: projects.find(project => project.id === item.projectId)?.color }} />{projects.find(project => project.id === item.projectId)?.name}</span></div><div className="kanban-card-controls">{index > 0 && <button onClick={() => shift(item, -1)}><ArrowLeft size={12} /> {t("Previous")}</button>}{index < 2 && <button onClick={() => shift(item, 1)}>{t("Move to")} {t(statuses[index + 1])} <ArrowRight size={12} /></button>}</div></article>; })}{!items.length && <div className="column-empty">{t(index === 0 ? "Ideas land here." : index === 1 ? "Work in progress appears here." : "Completed work is celebrated here.")}</div>}</div>{index === 0 && <button className="add-kanban-item" onClick={openNewItem}><Plus size={14} /> {t("Add item")}</button>}</section>;
      })}</div>
      <section className="project-deadlines panel"><header><div><div className="eyebrow">{t("PROJECT TIMELINE")}</div><h2>{t("Upcoming deadlines")} <span>{deadlines.length}</span></h2></div></header>{deadlines.length ? <ol>{deadlines.map(item => <li key={item.id}><time dateTime={item.dueDate}>{formatDueDate(item.dueDate!)}</time><button type="button" onClick={() => openEditItem(item)}>{item.title}</button><span>{t(item.kind)}</span>{selectedProject === "all" && <small>{projects.find(project => project.id === item.projectId)?.name}</small>}{isOverdue(item.dueDate!) && <b>{t("Overdue")}</b>}</li>)}</ol> : <p>{t("No upcoming deadlines.")}</p>}</section>
    </>}
    {showProject && <Modal title={t(editingProject ? "Edit project details" : "Create a project")} onClose={closeProjectModal}><div className="modal-body"><Field label={t("Project name")} placeholder={t("e.g. Starfall: A space adventure")} value={projectName} onChange={event => setProjectName(event.target.value)} autoFocus />{!editingProject && <><label className="field"><span>{t("Project starter template")}</span><select value={projectTemplate} onChange={event => setProjectTemplate(event.target.value as ProjectTemplateId)}>{projectTemplates.map(template => <option key={template.id} value={template.id}>{t(template.label)}</option>)}</select></label><p className="project-template-help">{t(projectTemplates.find(template => template.id === projectTemplate)?.description ?? "")}{projectTemplates.find(template => template.id === projectTemplate)?.items.length ? ` ${projectTemplates.find(template => template.id === projectTemplate)?.items.length} ${t("starter tasks will be added to the project board.")}` : ""}</p></>}<label className="field"><span>{t("Game description")}</span><textarea rows={3} placeholder={t("What are you building? Capture the core idea...")} value={projectDescription} onChange={event => setProjectDescription(event.target.value)} /></label><div className="project-logo-editor"><div className="project-logo-preview" style={{ background: projectColor }}>{projectLogoPreview ? <img src={projectLogoPreview} alt={t("Project logo preview")} /> : <ImagePlus size={20} />}</div><div className="project-logo-controls"><strong>{t("Project logo")}</strong><small>{t("Square PNG, JPEG, or WebP. Optimized to 512px.")}</small>{(editingProject?.role === "owner" || editingProject?.role === "co-owner") ? <div className="project-logo-actions"><label className="button button-secondary"><ImagePlus size={13} />{t(projectLogoPreview ? "Change image" : "Choose image")}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => chooseProjectLogo(event.target.files?.[0])} /></label>{projectLogoPreview && <button className="project-logo-remove" type="button" aria-label={t("Remove project logo")} onClick={clearProjectLogo}><X size={14} />{t("Remove")}</button>}</div> : <small>{t(editingProject ? "Only the project owner can change this logo." : "Create the project first, then edit it to add a logo.")}</small>}</div></div><div className="project-color-picker"><span>{t("PROJECT COLOR")}</span><div>{colors.map(color => <button key={color} className={projectColor === color ? "selected" : ""} aria-label={t(`Select ${color} project color`)} style={{ background: color }} onClick={() => setProjectColor(color)} />)}</div></div><div className="modal-actions"><Button variant="secondary" disabled={projectBusy} onClick={closeProjectModal}>{t("Cancel")}</Button><Button disabled={!projectName.trim() || projectBusy} onClick={() => void newProject()}>{projectBusy ? t("Saving...") : t(editingProject ? "Save details" : "Create project")}</Button></div></div></Modal>}
    {showItem && <Modal title={t(editing ? "Edit workspace item" : "Add to the board")} onClose={() => setShowItem(false)}><div className="modal-body"><Field label={t("Title")} placeholder={t("e.g. Design the first boss encounter")} value={title} onChange={event => setTitle(event.target.value)} autoFocus /><label className="field"><span>{t("Description / notes")}</span><textarea rows={3} placeholder={t("Details, acceptance criteria, or design notes...")} value={detail} onChange={event => setDetail(event.target.value)} /></label><div className="field-row"><label className="field"><span>{t("Type")}</span><select value={kind} onChange={event => setKind(event.target.value as BoardItem["kind"])}>{["Feature", "Mechanic", "Bug", "Milestone", "Note"].map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label><label className="field"><span>{t("Priority")}</span><select value={priority} onChange={event => setPriority(event.target.value as BoardItem["priority"])}>{["Low", "Medium", "High"].map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label></div><Field label={t("Target date (optional)")} type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /><fieldset className="task-role-picker"><legend>{t("Assigned roles")} <span>{t("At least one role is required.")}</span></legend><div>{projectRoles.map(role => <label key={role}><input type="checkbox" checked={taskRoles.includes(role)} onChange={event => setTaskRoles(current => event.target.checked ? [...new Set([...current, role])] : current.filter(value => value !== role))} /><span>{t(role)}</span></label>)}</div></fieldset><div className="field-row"><label className="field"><span>{t("Status")}</span><select value={status} onChange={event => setStatus(event.target.value as BoardItem["status"])}>{statuses.map(value => <option key={value} value={value}>{t(value)}</option>)}</select></label><label className="field"><span>{t("Project")}</span><select value={itemProject} onChange={event => setItemProject(event.target.value)}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div><div className="modal-actions"><Button variant="secondary" onClick={() => setShowItem(false)}>{t("Cancel")}</Button><Button disabled={!title.trim() || !itemProject || !taskRoles.length} onClick={saveItem}>{t(editing ? "Save changes" : "Add to board")}</Button></div></div></Modal>}
    {showResource && <Modal title={t("Link a resource to a project")} onClose={() => setShowResource(false)}><div className="modal-body"><p className="resource-share-note">{t("A copy of the selected script or asset details will be shared with every project collaborator. Private notes and library settings stay private.")}</p><label className="field"><span>{t("Project")}</span><select value={resourceProjectId} onChange={event => { setResourceProjectId(event.target.value); setResourceSourceId(""); }}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><div className="field-row"><label className="field"><span>{t("Resource type")}</span><select value={resourceKind} onChange={event => { setResourceKind(event.target.value as ProjectResource["kind"]); setResourceSourceId(""); }}><option value="Asset">{t("Asset")}</option><option value="Script">{t("Script")}</option></select></label><label className="field"><span>{t("Select resource")}</span><select value={resourceSourceId} onChange={event => setResourceSourceId(event.target.value)}><option value="">{t("Choose a resource")}</option>{availableSources.map(source => <option key={source.id} value={source.id}>{source.name} · {source.detail}</option>)}</select></label></div>{!availableSources.length && <p className="resource-share-note">{t(resourceKind === "Script" ? "No unlinked scripts are available in your library." : "No unlinked assets are available in your library.")}</p>}<div className="modal-actions"><Button variant="secondary" onClick={() => setShowResource(false)}>{t("Cancel")}</Button><Button disabled={!resourceSourceId || !resourceProjectId} onClick={linkResource}><Link2 size={14} /> {t("Link resource")}</Button></div></div></Modal>}
    {sharingProject && <Modal title={t("Invite collaborators")} onClose={() => { sharingProjectId.current = null; setSharingProject(null); }}><div className="modal-body share-dialog"><div className="share-dialog-project">{sharingProject.logoUrl ? <img className="project-select-logo" src={sharingProject.logoUrl} alt="" /> : <span className="project-select-swatch" style={{ background: sharingProject.color }} />}<div><strong>{sharingProject.name}</strong><small><Users size={12} /> {sharingProject.memberCount ?? 0} {t("collaborators")}</small></div></div><p>{t("Anyone with this link can join as an editor. The link expires in 7 days; generating a new link revokes the previous one.")}</p>{inviteExpiry && <p className="invite-expiry">{t("An active invite link expires")} {new Date(inviteExpiry).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.</p>}{inviteUrl && <label className="field"><span>{t("Shareable invitation link")}</span><input readOnly value={inviteUrl} onFocus={event => event.currentTarget.select()} /></label>}<div className="modal-actions">{inviteUrl && <Button variant="secondary" disabled={inviteBusy} onClick={() => void copyInvite()}><Clipboard size={14} /> {t("Copy link")}</Button>}{inviteExpiry && <Button variant="danger" disabled={inviteBusy} onClick={() => void revokeCurrentInvite()}><Link2 size={14} /> {t("Revoke link")}</Button>}<Button disabled={inviteBusy} onClick={() => void generateInvite()}><Share2 size={14} /> {t(inviteExpiry ? "Generate a new link" : "Generate invite link")}</Button></div></div></Modal>}
    {teamProject && <Modal title={t("Manage project team")} onClose={() => setTeamProject(null)}><div className="modal-body team-dialog"><p>{t("Assign one or more roles to each collaborator. Co-owners can manage the project like its owner.")}</p>{(teamMembersByProject[teamProject.id] ?? []).map(member => <article className="team-member-card" key={member.id}><header><div><strong>{member.displayName}</strong>{member.isProjectOwner && <span className="project-role-badge">{t("Owner")}</span>}</div>{!member.isProjectOwner && member.id !== currentUserId && <Button variant="danger" disabled={teamBusy === member.id} onClick={() => void removeMember(member)}><Trash2 size={13} />{t("Remove")}</Button>}</header>{member.isProjectOwner ? <p>{t("Project owner")}</p> : <fieldset disabled={teamBusy === member.id || (member.id === currentUserId && teamProject.role === "co-owner")}><legend>{t("Project roles")}</legend><div>{assignableProjectRoles.map(role => <label key={role}><input type="checkbox" checked={member.roles.includes(role)} onChange={event => void updateMemberRoles(member, event.target.checked ? [...new Set([...member.roles, role])] : member.roles.filter(value => value !== role))} /><span>{t(role)}</span></label>)}</div>{!member.roles.length && <small>{t("No roles assigned yet.")}</small>}</fieldset>}</article>)}</div></Modal>}
  </div>;
}
