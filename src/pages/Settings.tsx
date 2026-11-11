import { useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Check, ChevronRight, Download, Eye, EyeOff, FileUp, KeyRound, Monitor, RotateCcw, SlidersHorizontal, Trash2, UserRound } from "lucide-react";
import type { AppData, Language, Translator } from "../types";
import { Button, Field, Heading } from "../components/UI";
import { downloadText } from "../lib/storage";
import type { GameforgeSupabase } from "../lib/supabase";
import { projectRoles } from "../data/projectRoles";

type Props = { client: GameforgeSupabase; accountEmail: string; accountName: string; onAccountNameChange: (name: string) => void; data: AppData; setData: (data: AppData) => void; onToast: (message: string, type?: "error") => void; t: Translator };

function isWorkspaceData(value: unknown): value is AppData {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const isRecord = (entry: unknown): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry));
  const hasStrings = (entry: unknown, fields: string[]) => isRecord(entry) && fields.every(field => typeof entry[field] === "string");
  const validScripts = Array.isArray(item.scripts) && item.scripts.every(entry => {
    if (!hasStrings(entry, ["id", "name", "category", "code", "updatedAt"]) || typeof entry.favorite !== "boolean") return false;
    const script = entry as Record<string, unknown>;
    return script.history === undefined || (Array.isArray(script.history) && script.history.every(version =>
      hasStrings(version, ["name", "code", "savedAt"])));
  });
  const validAssets = Array.isArray(item.assets) && item.assets.every(entry =>
    hasStrings(entry, ["id", "assetId", "name", "description", "category", "collection", "notes"])
    && ["Models", "Animations", "Sounds", "Decals", "Images", "Meshes", "Plugins"].includes(String(entry.category))
    && typeof entry.favorite === "boolean" && (entry.imageUrl === undefined || typeof entry.imageUrl === "string"));
  const validProjects = Array.isArray(item.projects) && item.projects.every(entry =>
    hasStrings(entry, ["id", "name", "description", "color", "createdAt"])
    && ((entry as Record<string, unknown>).logoUrl === undefined || typeof (entry as Record<string, unknown>).logoUrl === "string"));
  const validBoard = Array.isArray(item.board) && item.board.every(entry =>
    hasStrings(entry, ["id", "title", "detail", "kind", "priority", "status", "projectId"])
    && ["Feature", "Mechanic", "Bug", "Milestone", "Note"].includes(String(entry.kind))
    && (entry.roles === undefined || (Array.isArray(entry.roles) && entry.roles.length > 0
      && entry.roles.every((role: unknown) => typeof role === "string" && projectRoles.some(validRole => validRole === role))))
    && (entry.dueDate === undefined || typeof entry.dueDate === "string")
    && ["Low", "Medium", "High"].includes(String(entry.priority))
    && ["Backlog", "In progress", "Done"].includes(String(entry.status)));
  const validProjectResources = item.projectResources === undefined || (Array.isArray(item.projectResources) && item.projectResources.every(entry =>
    hasStrings(entry, ["id", "projectId", "sourceId", "kind", "title", "description", "category", "linkedAt"])
    && ["Script", "Asset"].includes(String(entry.kind))
    && (entry.code === undefined || typeof entry.code === "string")
    && (entry.assetId === undefined || typeof entry.assetId === "string")
    && (entry.imageUrl === undefined || typeof entry.imageUrl === "string")));
  const validPreferences = isRecord(item.preferences)
    && typeof item.preferences.compactSidebar === "boolean"
    && ["blue", "orange"].includes(String(item.preferences.accent))
    && typeof item.preferences.editorFontSize === "number"
    && item.preferences.editorFontSize >= 10 && item.preferences.editorFontSize <= 22
    && (item.preferences.language === undefined || ["en", "fr"].includes(String(item.preferences.language)))
    && (item.preferences.theme === undefined || ["dark", "light"].includes(String(item.preferences.theme)));
  return validScripts && validAssets && validProjects && validBoard && validProjectResources
    && Array.isArray(item.collections) && item.collections.every(entry => typeof entry === "string")
    && validPreferences;
}

export function Settings({ client, accountEmail, accountName, onAccountNameChange, data, setData, onToast, t }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [profileName, setProfileName] = useState(accountName);
  const [profileBusy, setProfileBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const saveProfileName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const displayName = profileName.trim();
    if (!displayName || displayName.length > 40) return;
    setProfileBusy(true);
    try {
      const { data: result, error } = await client.auth.updateUser({ data: { display_name: displayName } });
      if (error) throw error;
      onAccountNameChange(typeof result.user.user_metadata.display_name === "string" ? result.user.user_metadata.display_name : displayName);
      setProfileName(displayName);
      onToast(t("Display name updated."));
    } catch (error) {
      onToast(error instanceof Error ? error.message : t("Display name could not be updated."), "error");
    } finally {
      setProfileBusy(false);
    }
  };
  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError("");
    if (newPassword !== confirmPassword) {
      setPasswordError(t("Passwords do not match."));
      return;
    }
    setPasswordBusy(true);
    try {
      const { error: signInError } = await client.auth.signInWithPassword({ email: accountEmail, password: currentPassword });
      if (signInError) throw signInError;
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onToast(t("Password changed successfully."));
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : t("Password could not be changed."));
    } finally {
      setPasswordBusy(false);
    }
  };
  const exportData = () => {
    downloadText(`gameforge-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ ...data, exportedAt: new Date().toISOString(), format: "gameforge.workspace.v1" }, null, 2), "application/json");
    onToast(t("Workspace backup exported"));
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isWorkspaceData(parsed)) throw new Error(t("This file is not a valid GAMEFORGE workspace backup."));
      setData({
        ...parsed,
        board: parsed.board.map(item => ({ ...item, roles: item.roles?.length ? item.roles : ["Owner"] })),
        projectResources: parsed.projectResources ?? [],
        preferences: { ...parsed.preferences, accent: "blue", language: parsed.preferences.language ?? "fr", theme: parsed.preferences.theme ?? "dark" },
      });
      onToast(t("Workspace backup imported"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "The backup could not be read.";
      onToast(t(message), "error");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const reset = () => {
    setData({ scripts: [], assets: [], projects: [], board: [], projectResources: [], collections: ["Favorites"], preferences: { compactSidebar: false, accent: "blue", editorFontSize: 13, language: data.preferences.language, theme: data.preferences.theme } });
    setResetConfirm(false);
    onToast(t("Workspace data reset"));
  };
  return <div className="page-content settings-page">
    <Heading eyebrow={t("MAKE IT YOURS")} title={t("Settings")} description={t("Tune your account and workspace, and keep a backup of your data.")} />
    <div className="settings-layout"><nav className="settings-nav"><div className="settings-nav-title">{t("ACCOUNT")}</div><a href="#account"><UserRound size={15} /> {t("Account & password")} <ChevronRight size={14} /></a><div className="settings-nav-title">{t("PREFERENCES")}</div><a className="settings-nav-active" href="#appearance"><Monitor size={15} /> {t("Appearance")} <ChevronRight size={14} /></a><a href="#editor"><SlidersHorizontal size={15} /> {t("Editor")} <ChevronRight size={14} /></a><div className="settings-nav-title settings-nav-data">{t("WORKSPACE DATA")}</div><a href="#backup"><Download size={15} /> {t("Backup & restore")} <ChevronRight size={14} /></a><a href="#danger"><AlertTriangle size={15} /> {t("Danger zone")} <ChevronRight size={14} /></a></nav>
      <div className="settings-sections">
        <section className="settings-card" id="account"><div className="settings-card-heading"><span className="settings-section-icon"><UserRound size={16} /></span><div><h2>{t("Account & password")}</h2><p>{t("Manage your signed-in account without sending password reset emails.")}</p></div></div><form className="profile-name-form" onSubmit={event => void saveProfileName(event)}><Field label={t("Display name")} autoComplete="nickname" maxLength={40} minLength={1} required value={profileName} onChange={event => setProfileName(event.target.value)} /><div className="backup-actions"><Button type="submit" disabled={profileBusy || !profileName.trim() || profileName.trim() === accountName}><UserRound size={14} /> {profileBusy ? t("Please wait...") : t("Save display name")}</Button></div></form><div className="settings-option"><div><strong>{t("Email address")}</strong><small>{accountEmail}</small></div></div><form className="account-password-form" onSubmit={event => void changePassword(event)}><div className="account-password-fields"><Field label={t("Current password")} type={showPassword ? "text" : "password"} autoComplete="current-password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /><label className="field"><span>{t("New password")}</span><span className="auth-password-control"><input type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required value={newPassword} onChange={event => setNewPassword(event.target.value)} /><button type="button" className="auth-password-toggle" aria-label={t(showPassword ? "Hide password" : "Show password")} title={t(showPassword ? "Hide password" : "Show password")} onClick={() => setShowPassword(visible => !visible)}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label><Field label={t("Confirm new password")} type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></div>{passwordError && <p className="auth-message auth-error" role="alert">{passwordError}</p>}<div className="backup-actions"><Button type="submit" disabled={passwordBusy}><KeyRound size={14} /> {passwordBusy ? t("Please wait...") : t("Change password")}</Button></div></form><p className="settings-note"><Check size={13} /> {t("Changing your password here does not send an email. If you forget it, recovery requires email access.")}</p></section>
        <section className="settings-card" id="appearance"><div className="settings-card-heading"><span className="settings-section-icon"><Monitor size={16} /></span><div><h2>{t("Appearance")}</h2><p>{t("Customize the look and feel of your workspace.")}</p></div></div><div className="settings-option"><div><strong>{t("Theme")}</strong><small>{t("Choose a clear light or dark workspace.")}</small></div><div className="language-options" role="group" aria-label={t("Theme")}>{(["dark", "light"] as const).map(theme => <button key={theme} className={`accent-choice ${data.preferences.theme === theme ? "accent-choice-active" : ""}`} aria-pressed={data.preferences.theme === theme} onClick={() => setData({ ...data, preferences: { ...data.preferences, theme } })}><span className="language-code">{theme === "dark" ? "◐" : "☼"}</span>{t(theme === "dark" ? "Dark" : "Light")}{data.preferences.theme === theme && <Check size={13} />}</button>)}</div></div><div className="settings-option"><div><strong>{t("Language")}</strong><small>{t("Choose the language used across GAMEFORGE.")}</small></div><div className="language-options" role="group" aria-label={t("Language")}>{(["fr", "en"] as Language[]).map(language => <button key={language} className={`accent-choice ${data.preferences.language === language ? "accent-choice-active" : ""}`} aria-pressed={data.preferences.language === language} onClick={() => setData({ ...data, preferences: { ...data.preferences, language } })}><span className="language-code">{language.toUpperCase()}</span>{t(language === "fr" ? "French" : "English")}{data.preferences.language === language && <Check size={13} />}</button>)}</div></div><div className="settings-option"><div><strong>{t("Accent color")}</strong><small>{t("Choose the highlight color used across the interface.")}</small></div><div className="accent-options"><button className="accent-choice accent-blue accent-choice-active" aria-pressed="true"><i /> {t("Electric blue")}<Check size={13} /></button></div></div><div className="settings-option"><div><strong>{t("Compact sidebar")}</strong><small>{t("Collapse navigation labels to give your workspace more room.")}</small></div><button className={`toggle ${data.preferences.compactSidebar ? "toggle-on" : ""}`} role="switch" aria-checked={data.preferences.compactSidebar} onClick={() => setData({ ...data, preferences: { ...data.preferences, compactSidebar: !data.preferences.compactSidebar } })}><i /></button></div></section>
        <section className="settings-card" id="editor"><div className="settings-card-heading"><span className="settings-section-icon editor-settings-icon"><SlidersHorizontal size={16} /></span><div><h2>{t("Editor preferences")}</h2><p>{t("Set the Luau editor up to match your workflow.")}</p></div></div><div className="settings-option"><div><strong>{t("Editor font size")}</strong><small>{t("Current size:")} {data.preferences.editorFontSize}px</small></div><div className="font-size-control"><button aria-label={t("Decrease editor font size")} disabled={data.preferences.editorFontSize <= 10} onClick={() => setData({ ...data, preferences: { ...data.preferences, editorFontSize: data.preferences.editorFontSize - 1 } })}>−</button><span>{data.preferences.editorFontSize}</span><button aria-label={t("Increase editor font size")} disabled={data.preferences.editorFontSize >= 22} onClick={() => setData({ ...data, preferences: { ...data.preferences, editorFontSize: data.preferences.editorFontSize + 1 } })}>+</button></div></div></section>
        <section className="settings-card" id="backup"><div className="settings-card-heading"><span className="settings-section-icon backup-icon"><Download size={16} /></span><div><h2>{t("Backup & restore")}</h2><p>{t("Export an offline copy or restore a previous workspace.")}</p></div></div><div className="backup-summary"><div><span>{t("PROJECTS")}</span><strong>{data.projects.length}</strong></div><div><span>{t("SCRIPTS")}</span><strong>{data.scripts.length}</strong></div><div><span>{t("ASSETS")}</span><strong>{data.assets.length}</strong></div><div><span>{t("BOARD ITEMS")}</span><strong>{data.board.length}</strong></div></div><div className="backup-actions"><Button onClick={exportData}><Download size={14} /> {t("Export workspace JSON")}</Button><Button variant="secondary" onClick={() => fileInput.current?.click()}><FileUp size={14} /> {t("Import workspace JSON")}</Button><input ref={fileInput} className="sr-only" type="file" accept=".json,application/json" onChange={event => void importFile(event.target.files?.[0])} /></div><p className="settings-note"><Check size={13} /> {t("Your data is saved in this browser on this device. Export regularly to keep an offline backup.")}</p></section>
        <section className="settings-card danger-card" id="danger"><div className="settings-card-heading"><span className="settings-section-icon danger-icon"><AlertTriangle size={16} /></span><div><h2>{t("Danger zone")}</h2><p>{t("Permanently clear all GAMEFORGE data saved in this browser.")}</p></div></div>{!resetConfirm ? <div className="danger-action"><span>{t("This removes every project, script, asset, collection, and preference.")}</span><Button variant="danger" onClick={() => setResetConfirm(true)}><Trash2 size={14} /> {t("Reset workspace")}</Button></div> : <div className="reset-confirm"><div><strong>{t("Are you absolutely sure?")}</strong><span>{t("This action cannot be undone. Export a backup first if you need one.")}</span></div><Button variant="secondary" onClick={() => setResetConfirm(false)}>{t("Cancel")}</Button><Button variant="danger" onClick={reset}><RotateCcw size={14} /> {t("Yes, reset everything")}</Button></div>}</section>
        <div className="storage-disclaimer"><span className="status-pulse" /> {t("No account required · Local browser storage · No external services")}</div>
      </div>
    </div>
  </div>;
}
