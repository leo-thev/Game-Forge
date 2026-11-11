import { useState } from "react";
import {
  Activity, Box, BookOpen, ChevronDown, Code2, Command, Compass, LayoutDashboard, LogOut,
  Palette, Plus, Settings2, Shapes, Sparkles, Workflow,
} from "lucide-react";
import type { Section } from "../types";
import type { Translator } from "../types";
import { IconButton } from "./UI";

const groups = [
  { title: "WORKSPACE", items: [{ id: "overview", label: "Overview", icon: LayoutDashboard }, { id: "workspace", label: "Game design", icon: Workflow }] },
  { title: "DEVELOP", items: [{ id: "scripts", label: "Script lab", icon: Code2 }, { id: "assets", label: "Asset manager", icon: Box }, { id: "generator", label: "System generator", icon: Shapes }, { id: "design", label: "UI & design lab", icon: Palette }] },
  { title: "RESOURCES", items: [{ id: "docs", label: "Documentation", icon: BookOpen }] },
] as const;

export function Sidebar({ active, onNavigate, collapsed, onNewProject, projectCount, t }: {
  active: Section; onNavigate: (section: Section) => void; collapsed: boolean; onNewProject: () => void; projectCount: number; t: Translator;
}) {
  const [projectOpen, setProjectOpen] = useState(true);
  return <aside className={`sidebar ${collapsed ? "sidebar-collapsed" : ""}`}>
    <div className="brand"><div className="brand-mark"><Sparkles size={16} fill="currentColor" /></div>{!collapsed && <><span className="brand-name">GAMEFORGE</span><span className="brand-edition">STUDIO</span></>}</div>
    {!collapsed && <div className="workspace-switch"><span className="workspace-avatar">G</span><span className="workspace-label"><b>{t("My workspace")}</b><small>{t("PERSONAL PLAN")}</small></span><ChevronDown size={14} /></div>}
    {collapsed && <div className="sidebar-divider" />}
    <nav className="main-nav" aria-label="Main navigation">
      {groups.map(group => <div className="nav-group" key={group.title}>
        {!collapsed && <div className="nav-group-title">{t(group.title)}</div>}
        {group.items.map(item => {
          const Icon = item.icon;
          return <button key={item.id} className={`nav-item ${active === item.id ? "nav-item-active" : ""}`} onClick={() => onNavigate(item.id)} title={t(item.label)} aria-label={t(item.label)}><Icon size={17} /><span>{t(item.label)}</span>{active === item.id && <i />}</button>;
        })}
      </div>)}
    </nav>
    {!collapsed && <section className="project-shortcut">
      <button className="project-shortcut-title" onClick={() => setProjectOpen(!projectOpen)}><span>{t("YOUR PROJECTS")}</span><ChevronDown className={projectOpen ? "" : "rotate-closed"} size={13} /></button>
      {projectOpen && <><div className="project-counter"><span className="project-dot" />{projectCount ? `${projectCount} ${t("active")} ${t(projectCount === 1 ? "project" : "projects")}` : t("No projects yet")}</div><button className="new-project-shortcut" onClick={onNewProject}><Plus size={14} />{t("New project")}</button></>}
    </section>}
    <div className="sidebar-bottom">
      <button className={`nav-item ${active === "settings" ? "nav-item-active" : ""}`} onClick={() => onNavigate("settings")} title={t(collapsed ? "Settings" : "Settings")}><Settings2 size={17} /><span>{t("Settings")}</span></button>
      {!collapsed && <div className="storage-status"><span className="status-pulse" /><span>{t("Everything saved locally")}</span></div>}
    </div>
  </aside>;
}

export function Topbar({ onNavigate, activeLabel, onCommand, accountEmail, accountName, onSignOut, t }: { onNavigate: (section: Section) => void; activeLabel: string; onCommand: () => void; accountEmail: string; accountName: string; onSignOut: () => void; t: Translator }) {
  const shortcut = navigator.userAgent.includes("Mac") ? "⌘ K" : "Ctrl K";
  const displayName = accountName.trim() || accountEmail;
  return <header className="topbar"><div className="breadcrumbs"><span className="breadcrumb-muted">GAMEFORGE</span><span className="breadcrumb-slash">/</span><span>{t(activeLabel)}</span></div><div className="topbar-actions"><button className="global-search" onClick={onCommand}><Command size={14} /><span>{t("Jump to...")}</span><kbd>{shortcut}</kbd></button><span className="online-indicator"><i /> {t("CLOUD STORAGE")}</span><span className="account-email" title={accountEmail}>{displayName}</span><IconButton className="account-signout" label={t("Sign out")} onClick={onSignOut}><LogOut size={15} /></IconButton><button className="topbar-avatar" aria-label={t("Open overview")} onClick={() => onNavigate("overview")}>{displayName.charAt(0).toUpperCase() || "G"}</button></div></header>;
}

export const sectionLabels: Record<Section, string> = {
  overview: "Overview", scripts: "Script lab", assets: "Asset manager", generator: "System generator",
  design: "UI & design lab", workspace: "Game design", docs: "Documentation", settings: "Settings",
};
