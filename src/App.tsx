import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Box, Code2, Command, FilePlus2, FolderPlus, Search, Shapes, X } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { Sidebar, Topbar, sectionLabels } from "./components/Sidebar";
import { Button, IconButton, Modal } from "./components/UI";
import { Overview } from "./pages/Overview";
import { ScriptLab } from "./pages/ScriptLab";
import { Assets } from "./pages/Assets";
import { Generator } from "./pages/Generator";
import { DesignLab } from "./pages/DesignLab";
import { GameWorkspace } from "./pages/GameWorkspace";
import { Documentation } from "./pages/Documentation";
import { Settings } from "./pages/Settings";
import forgeLogo from "./assets/forge-logo.png";
import { Auth } from "./pages/Auth";
import { emptyData, loadData, loadLanguagePreference, saveLanguagePreference } from "./lib/storage";
import { acceptProjectInvite, createProjectInvite, getProjectInviteExpiry, loadCloudWorkspace, revokeProjectInvite, saveCloudWorkspace } from "./lib/cloudStorage";
import { createSupabaseClient } from "./lib/supabase";
import { translator } from "./i18n";
import type { AppData, Language, Section } from "./types";

type Toast = { id: number; message: string; error: boolean };
type QuickCommand = { label: string; description: string; section: Section; icon: typeof Code2; action?: "project" | "script" | "asset" };
const commands: QuickCommand[] = [
  { label: "Overview", description: "Go to your workspace overview", section: "overview", icon: Search },
  { label: "Script Lab", description: "Write and organize Luau", section: "scripts", icon: Code2 },
  { label: "Asset Manager", description: "Browse your asset library", section: "assets", icon: Box },
  { label: "System Generator", description: "Configure and generate game systems", section: "generator", icon: Shapes },
  { label: "UI & Design Lab", description: "Create a visual system", section: "design", icon: Shapes },
  { label: "Game Workspace", description: "Plan projects and track tasks", section: "workspace", icon: FolderPlus },
  { label: "Documentation", description: "Search official references", section: "docs", icon: Search },
  { label: "Settings", description: "Preferences and workspace backup", section: "settings", icon: Command },
  { label: "Create a project", description: "Start a new game workspace", section: "workspace", icon: FolderPlus, action: "project" },
  { label: "Create a script", description: "Open Script Lab and create a Luau file", section: "scripts", icon: FilePlus2, action: "script" },
  { label: "Add an asset", description: "Catalog a Roblox asset", section: "assets", icon: Box, action: "asset" },
];

function readWorkspace(): { data: AppData; error: string | null } {
  try { return { data: loadData(), error: null }; }
  catch (error) { return { data: emptyData, error: error instanceof Error ? error.message : "Workspace data could not be loaded." }; }
}

export default function App() {
  const [workspace, setWorkspace] = useState(readWorkspace);
  const { data } = workspace;
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [authLanguage, setAuthLanguage] = useState<Language>(() => loadLanguagePreference(data.preferences.language));
  const [readyUserId, setReadyUserId] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState("");
  const [reloadCloud, setReloadCloud] = useState(0);
  const t = useMemo(() => translator(session && readyUserId === session.user.id ? data.preferences.language : authLanguage), [data.preferences.language, authLanguage, session, readyUserId]);
  const [active, setActive] = useState<Section>("overview");
  const [toast, setToast] = useState<Toast[]>([]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [newProjectRequest, setNewProjectRequest] = useState(0);
  const [newScriptRequest, setNewScriptRequest] = useState(0);
  const [newAssetRequest, setNewAssetRequest] = useState(0);
  const persistedData = useRef<AppData>(emptyData);
  const persistenceQueue = useRef(Promise.resolve());
  const notifyRef = useRef<(message: string, type?: "error") => void>(() => {});

  const notify = (message: string, type?: "error") => {
    const id = Date.now() + Math.random();
    setToast(current => [...current, { id, message: t(message), error: type === "error" }]);
    window.setTimeout(() => setToast(current => current.filter(item => item.id !== id)), 3600);
  };
  notifyRef.current = notify;
  const updateData = (next: AppData) => {
    if (!supabase || !session || readyUserId !== session.user.id) return;
    setWorkspace({ data: next, error: null });
    persistenceQueue.current = persistenceQueue.current.then(async () => {
      await saveCloudWorkspace(supabase, session.user.id, next, persistedData.current);
      persistedData.current = next;
    }).catch(error => {
      notifyRef.current(error instanceof Error ? error.message : "Workspace could not be saved to your account.", "error");
    });
  };
  useEffect(() => {
    document.documentElement.lang = data.preferences.language;
  }, [data.preferences.language]);
  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });
    void supabase.auth.getSession().then(({ data: sessionData, error }) => {
      if (error) throw error;
      setSession(sessionData.session);
      setAuthReady(true);
    }).catch(error => {
      notifyRef.current(error instanceof Error ? error.message : "Authentication session could not be loaded.", "error");
      setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("invite");
    if (!token) return;
    sessionStorage.setItem("gameforge.pending-invite", token);
    url.searchParams.delete("invite");
    window.history.replaceState(null, "", url.toString());
  }, []);
  useEffect(() => {
    if (!supabase || !session) {
      setReadyUserId(null);
      setCloudError("");
      return;
    }
    let active = true;
    if (readyUserId !== session.user.id) setReadyUserId(null);
    setCloudError("");
    void (async () => {
      const loaded = await loadCloudWorkspace(supabase, session.user.id);
      if (!active) return;
      let next = loaded.data;
      const token = sessionStorage.getItem("gameforge.pending-invite");
      if (token) {
        try {
          await acceptProjectInvite(supabase, token);
          sessionStorage.removeItem("gameforge.pending-invite");
          next = (await loadCloudWorkspace(supabase, session.user.id)).data;
          notifyRef.current("Project invitation accepted.");
        } catch (error) {
          sessionStorage.removeItem("gameforge.pending-invite");
          notifyRef.current(error instanceof Error ? error.message : "This project invitation could not be accepted.", "error");
        }
      }
      if (!active) return;
      persistedData.current = next;
      setWorkspace({ data: next, error: null });
      setAuthLanguage(next.preferences.language);
      saveLanguagePreference(next.preferences.language);
      setReadyUserId(session.user.id);
      if (loaded.migrated) notifyRef.current("Your local workspace was imported to your account.");
    })().catch(error => {
      if (active) setCloudError(error instanceof Error ? error.message : "Your account workspace could not be loaded.");
    });
    return () => { active = false; };
  }, [supabase, session?.user.id, reloadCloud]);
  useEffect(() => {
    if (!supabase || !session || readyUserId !== session.user.id) return;
    let active = true;
    let timer = 0;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void persistenceQueue.current.finally(() => {
          if (active) setReloadCloud(value => value + 1);
        });
      }, 350);
    };
    const channel = supabase.channel(`gameforge-${session.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "gameforge_projects" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "gameforge_project_members" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "gameforge_board_items" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "gameforge_project_resources" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "gameforge_workspaces", filter: `user_id=eq.${session.user.id}` }, refresh)
      .subscribe();
    return () => {
      active = false;
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [supabase, session?.user.id, readyUserId]);

  const matchingCommands = useMemo(() => commands.filter(command => `${t(command.label)} ${t(command.description)}`.toLowerCase().includes(commandQuery.toLowerCase())), [commandQuery, t]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setCommandOpen(value => !value); setCommandQuery(""); setSelectedCommand(0);
      }
      if (event.key === "Escape") setCommandOpen(false);
      if (!commandOpen) return;
      if (event.key === "ArrowDown" && matchingCommands.length) {
        event.preventDefault(); setSelectedCommand(value => (value + 1) % matchingCommands.length);
      }
      if (event.key === "ArrowUp" && matchingCommands.length) {
        event.preventDefault(); setSelectedCommand(value => (value - 1 + matchingCommands.length) % matchingCommands.length);
      }
      if (event.key === "Enter" && matchingCommands[selectedCommand]) {
        event.preventDefault(); runCommand(matchingCommands[selectedCommand]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandOpen, matchingCommands, selectedCommand]);

  const goTo = (section: Section) => { setActive(section); setCommandOpen(false); };
  const accountName = typeof session?.user.user_metadata.display_name === "string" ? session.user.user_metadata.display_name : "";
  const startNewProject = () => { goTo("workspace"); setNewProjectRequest(value => value + 1); };
  const runCommand = (command: QuickCommand) => {
    goTo(command.section);
    if (command.action === "project") setNewProjectRequest(value => value + 1);
    if (command.action === "script") setNewScriptRequest(value => value + 1);
    if (command.action === "asset") setNewAssetRequest(value => value + 1);
  };
  const changeAuthLanguage = (language: Language) => {
    setAuthLanguage(language);
    try { saveLanguagePreference(language); }
    catch (error) { notify(error instanceof Error ? error.message : "The language preference could not be saved.", "error"); }
  };

  if (!supabase) return <main className="auth-screen"><section className="auth-card"><header className="auth-brand"><span className="brand-mark"><img src={forgeLogo} alt="" /></span><strong>GAMEFORGE</strong><small>STUDIO</small></header><div className="eyebrow">{t("CLOUD STORAGE SETUP")}</div><h1>{t("Connect your Supabase project.")}</h1><p className="auth-description">{t("Create a .env.local file from .env.example, add your Supabase project URL and publishable anon key, then restart the development server.")}</p><ol className="setup-steps"><li>{t("Run the SQL migration in your Supabase SQL editor.")}</li><li>{t("Enable email sign-ups, turn off email confirmation, and set your redirect URLs.")}</li><li>{t("Restart GAMEFORGE to create your account.")}</li></ol><div className="auth-language" role="group" aria-label={t("Language")}>{(["fr", "en"] as Language[]).map(option => <button key={option} className={authLanguage === option ? "auth-language-active" : ""} aria-pressed={authLanguage === option} onClick={() => changeAuthLanguage(option)}>{option.toUpperCase()}</button>)}</div></section></main>;
  if (!authReady) return <main className="auth-screen"><section className="auth-card"><div className="auth-loading"><span className="status-pulse" /> {t("Checking your session...")}</div></section></main>;
  if (!session) return <Auth client={supabase} language={authLanguage} onLanguageChange={changeAuthLanguage} t={t} />;
  if (cloudError) return <main className="auth-screen"><section className="auth-card"><div className="eyebrow">{t("ACCOUNT WORKSPACE")}</div><h1>{t("Could not load your workspace.")}</h1><p className="auth-message auth-error" role="alert">{cloudError}</p><div className="modal-actions"><Button variant="secondary" onClick={() => void supabase.auth.signOut()}>{t("Sign out")}</Button><Button onClick={() => setReloadCloud(value => value + 1)}>{t("Try again")}</Button></div></section></main>;
  if (readyUserId !== session.user.id) return <main className="auth-screen"><section className="auth-card"><div className="auth-loading"><span className="status-pulse" /> {t("Loading your cloud workspace...")}</div></section></main>;
  if (workspace.error) return <div className="recovery-screen"><div className="recovery-card"><div className="brand-mark"><img src={forgeLogo} alt="" /></div><div className="eyebrow">{t("WORKSPACE RECOVERY")}</div><h1>{t("We couldn't read your saved data.")}</h1><p>{t(workspace.error)}</p></div></div>;

  return <div className={`app-shell accent-${data.preferences.accent} theme-${data.preferences.theme}`}>
    <Sidebar active={active} onNavigate={goTo} collapsed={data.preferences.compactSidebar} onNewProject={startNewProject} projectCount={data.projects.length} t={t} />
    <main className="app-main"><Topbar onNavigate={goTo} activeLabel={sectionLabels[active]} onCommand={() => { setCommandQuery(""); setCommandOpen(true); }} accountEmail={session.user.email ?? ""} accountName={accountName} onSignOut={() => { void supabase.auth.signOut().then(({ error }) => { if (error) notify(error.message, "error"); }); }} t={t} />
      {active === "overview" && <Overview data={data} onNavigate={goTo} onNewProject={startNewProject} t={t} language={data.preferences.language} />}
      {active === "scripts" && <ScriptLab scripts={data.scripts} setScripts={scripts => updateData({ ...data, scripts })} fontSize={data.preferences.editorFontSize} theme={data.preferences.theme} onToast={notify} newScriptRequest={newScriptRequest} onScriptRequestHandled={() => setNewScriptRequest(0)} t={t} />}
      {active === "assets" && <Assets assets={data.assets} setAssets={assets => updateData({ ...data, assets })} collections={data.collections} setCollections={collections => updateData({ ...data, collections })} onToast={notify} newAssetRequest={newAssetRequest} onAssetRequestHandled={() => setNewAssetRequest(0)} t={t} />}
      {active === "generator" && <Generator onToast={notify} t={t} theme={data.preferences.theme} />}
      {active === "design" && <DesignLab onToast={notify} t={t} />}
      {active === "workspace" && <GameWorkspace projects={data.projects} setProjects={projects => updateData({ ...data, projects })} board={data.board} setBoard={board => updateData({ ...data, board })} scripts={data.scripts} assets={data.assets} projectResources={data.projectResources} setProjectResources={projectResources => updateData({ ...data, projectResources })} setProjectWorkspaceData={(projects, board, projectResources) => updateData({ ...data, projects, board, projectResources })} client={supabase} onToast={notify} newProjectRequest={newProjectRequest} onProjectRequestHandled={() => setNewProjectRequest(0)} currentUserId={session.user.id} createInvite={projectId => createProjectInvite(supabase, projectId)} revokeInvite={projectId => revokeProjectInvite(supabase, projectId)} getInviteExpiry={projectId => getProjectInviteExpiry(supabase, projectId)} t={t} />}
      {active === "docs" && <Documentation t={t} />}
      {active === "settings" && <Settings client={supabase} accountEmail={session.user.email ?? ""} accountName={accountName} onAccountNameChange={name => setSession(current => current ? { ...current, user: { ...current.user, user_metadata: { ...current.user.user_metadata, display_name: name } } } : current)} data={data} setData={updateData} onToast={notify} t={t} />}
      <div className="toast-region" aria-live="polite">{toast.map(item => <div key={item.id} className={`toast ${item.error ? "toast-error" : ""}`}><span className="toast-icon">{item.error ? <X size={14} /> : <span>✓</span>}</span>{item.message}<button aria-label="Dismiss notification" onClick={() => setToast(current => current.filter(entry => entry.id !== item.id))}><X size={13} /></button></div>)}</div>
    </main>
    {commandOpen && <Modal title="" onClose={() => setCommandOpen(false)} wide><div className="command-palette"><div className="command-search"><Search size={17} /><input value={commandQuery} onChange={event => { setCommandQuery(event.target.value); setSelectedCommand(0); }} placeholder={t("Search pages, tools, actions...")} autoFocus /><kbd>ESC</kbd><IconButton label={t("Close")} onClick={() => setCommandOpen(false)}><X size={15} /></IconButton></div><div className="command-list">{matchingCommands.length ? matchingCommands.map((command, index) => <button key={`${command.label}-${command.action ?? "nav"}`} className={index === selectedCommand ? "command-selected" : ""} onMouseEnter={() => setSelectedCommand(index)} onClick={() => runCommand(command)}><span className="command-item-icon"><command.icon size={16} /></span><span className="command-item-copy"><strong>{t(command.label)}</strong><small>{t(command.description)}</small></span><ArrowRight size={14} /></button>) : <div className="command-no-results">{t("No matching commands.")}</div>}</div><div className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> {t("Navigate")}</span><span><kbd>↵</kbd> {t("Select")}</span><span><kbd>ESC</kbd> {t("Close")}</span></div></div></Modal>}
  </div>;
}
