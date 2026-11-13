import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, ChevronDown, CircleAlert, Copy, Download, Eye, FolderTree, Link2, LoaderCircle, Plus, RefreshCw, Search, Unlink, X } from "lucide-react";
import type { Project, StudioInstance, StudioSystemAssignment, Translator } from "../types";
import { Button, Field, IconButton, Modal } from "./UI";
import { createStudioLink, hasStudioLink, revokeStudioLink } from "../lib/cloudStorage";
import { getSupabaseConnectionConfig, type GameforgeSupabase } from "../lib/supabase";
import { StudioTreeViewer } from "./StudioTreeViewer";

type PlaceSummary = { id: string; universeId: string; lastSeenAt: string };
type StudioPluginConfig = { supabaseUrl: string; anonKey: string; studioToken: string; projectName: string };

function isStudioInstance(value: unknown): value is StudioInstance {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return ["project_id", "place_id", "universe_id", "instance_key", "name", "class_name", "full_path", "last_seen_at"]
    .every(key => typeof row[key] === "string")
    && typeof row.is_present === "boolean";
}

function isStudioAssignment(value: unknown): value is StudioSystemAssignment {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return ["project_id", "place_id", "instance_key", "system_name"].every(key => typeof row[key] === "string");
}

export function StudioExplorer({ client, project, t }: { client: GameforgeSupabase; project: Project; t: Translator }) {
  const [instances, setInstances] = useState<StudioInstance[]>([]);
  const [assignments, setAssignments] = useState<StudioSystemAssignment[]>([]);
  const [selectedPlace, setSelectedPlace] = useState("");
  const [search, setSearch] = useState("");
  const [filterSystem, setFilterSystem] = useState("__all__");
  const [targetSystem, setTargetSystem] = useState("");
  const [newSystem, setNewSystem] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(100);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [linkActive, setLinkActive] = useState(false);
  const [setupConfig, setSetupConfig] = useState<StudioPluginConfig | null>(null);
  const [copied, setCopied] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [instanceResult, assignmentResult, linkStatus] = await Promise.all([
        client.from("gameforge_studio_instances")
          .select("project_id, place_id, universe_id, instance_key, name, class_name, full_path, last_seen_at, is_present")
          .eq("project_id", project.id)
          .order("full_path"),
        client.from("gameforge_studio_instance_systems")
          .select("project_id, place_id, instance_key, system_name")
          .eq("project_id", project.id)
          .order("system_name"),
        hasStudioLink(client, project.id),
      ]);
      if (instanceResult.error) throw instanceResult.error;
      if (assignmentResult.error) throw assignmentResult.error;
      const nextInstances: unknown = instanceResult.data;
      const nextAssignments: unknown = assignmentResult.data;
      if (!Array.isArray(nextInstances) || !nextInstances.every(isStudioInstance)
        || !Array.isArray(nextAssignments) || !nextAssignments.every(isStudioAssignment)) {
        throw new Error("The Studio project data has an invalid format.");
      }
      setInstances(nextInstances);
      setAssignments(nextAssignments);
      setLinkActive(linkStatus);
    } catch (caught) {
      console.error("GAMEFORGE could not load the Studio project tree.", caught);
      setError(caught instanceof Error ? caught.message : t("The Studio project tree could not be loaded."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [client, project.id]);

  const places = useMemo(() => {
    const byId = new Map<string, PlaceSummary>();
    for (const instance of instances) {
      const existing = byId.get(instance.place_id);
      if (!existing || existing.lastSeenAt < instance.last_seen_at) {
        byId.set(instance.place_id, { id: instance.place_id, universeId: instance.universe_id, lastSeenAt: instance.last_seen_at });
      }
    }
    return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  }, [instances]);

  useEffect(() => {
    if (places.length && !places.some(place => place.id === selectedPlace)) setSelectedPlace(places[0].id);
  }, [places, selectedPlace]);

  const placeInstances = useMemo(() => instances.filter(instance => instance.place_id === selectedPlace), [instances, selectedPlace]);
  const placeAssignments = useMemo(() => assignments.filter(assignment => assignment.place_id === selectedPlace), [assignments, selectedPlace]);
  const systems = useMemo(() => [...new Set(placeAssignments.map(assignment => assignment.system_name))].sort((a, b) => a.localeCompare(b)), [placeAssignments]);
  const assignmentsByInstance = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const assignment of placeAssignments) {
      result.set(assignment.instance_key, [...(result.get(assignment.instance_key) ?? []), assignment.system_name]);
    }
    return result;
  }, [placeAssignments]);
  const filteredInstances = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return placeInstances.filter(instance => {
      const tags = assignmentsByInstance.get(instance.instance_key) ?? [];
      if (filterSystem === "__unassigned__" && tags.length) return false;
      if (filterSystem !== "__all__" && filterSystem !== "__unassigned__" && !tags.includes(filterSystem)) return false;
      return !query || `${instance.name} ${instance.class_name} ${instance.full_path}`.toLocaleLowerCase().includes(query);
    });
  }, [placeInstances, search, filterSystem, assignmentsByInstance]);

  const toggleAssignment = async (instance: StudioInstance, systemName: string) => {
    const key = `${instance.instance_key}:${systemName}`;
    setBusy(key);
    setError("");
    const exists = (assignmentsByInstance.get(instance.instance_key) ?? []).includes(systemName);
    try {
      const result = exists
        ? await client.from("gameforge_studio_instance_systems").delete()
          .eq("project_id", project.id).eq("place_id", selectedPlace)
          .eq("instance_key", instance.instance_key).eq("system_name", systemName)
        : await client.from("gameforge_studio_instance_systems").insert({
          project_id: project.id,
          place_id: selectedPlace,
          instance_key: instance.instance_key,
          system_name: systemName,
        });
      if (result.error) throw result.error;
      await load();
    } catch (caught) {
      console.error("GAMEFORGE could not update a Studio system assignment.", caught);
      setError(caught instanceof Error ? caught.message : t("The system assignment could not be saved."));
    } finally {
      setBusy("");
    }
  };

  const addSystem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = newSystem.trim();
    if (!value || value.length > 80) return;
    setTargetSystem(value);
    setFilterSystem("__all__");
    setNewSystem("");
  };

  const connectPlugin = async () => {
    setBusy("connect");
    setError("");
    try {
      const studioToken = await createStudioLink(client, project.id);
      const supabaseConfig = getSupabaseConnectionConfig();
      if (!supabaseConfig) throw new Error("Supabase connection settings are unavailable.");
      setSetupConfig({
        supabaseUrl: supabaseConfig.url,
        anonKey: supabaseConfig.anonKey,
        studioToken,
        projectName: project.name,
      });
      setLinkActive(true);
      setCopied(false);
    } catch (caught) {
      console.error("GAMEFORGE could not create the Studio connection.", caught);
      setError(caught instanceof Error ? caught.message : t("The Studio connection could not be created."));
    } finally {
      setBusy("");
    }
  };

  const copySetup = async () => {
    if (!setupConfig) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(setupConfig, null, 2));
      setCopied(true);
    } catch (caught) {
      console.error("GAMEFORGE could not copy the Studio setup.", caught);
      setError(t("Clipboard access failed. Check browser permissions."));
    }
  };

  const disconnectPlugin = async () => {
    if (!window.confirm(t("Disconnect the Studio plugin? Its saved connection will stop working."))) return;
    setBusy("disconnect");
    setError("");
    try {
      await revokeStudioLink(client, project.id);
      setLinkActive(false);
    } catch (caught) {
      console.error("GAMEFORGE could not revoke the Studio connection.", caught);
      setError(caught instanceof Error ? caught.message : t("The Studio connection could not be revoked."));
    } finally {
      setBusy("");
    }
  };

  const visibleInstances = filteredInstances.slice(0, visibleLimit);
  const dateLabel = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return <>
    <section className="studio-explorer panel">
      <header className="studio-explorer-heading">
        <div>
          <div className="eyebrow">{t("ROBLOX STUDIO")}</div>
          <h2><FolderTree size={17} /> {t("In-game explorer")} <span>{placeInstances.length}</span></h2>
          <p>{t("Import names, types, and paths from Studio, then group instances into your game systems. Script source is never imported.")}</p>
        </div>
        <div className="studio-explorer-actions">
          <Button variant="secondary" disabled={!placeInstances.some(instance => instance.is_present)} onClick={() => setTreeOpen(true)}><Eye size={14} />{t("View hierarchy")}</Button>
          <Button variant="secondary" disabled={busy !== ""} onClick={() => void load()}><RefreshCw size={14} />{t("Refresh")}</Button>
          <Button variant="secondary" disabled={busy !== ""} onClick={() => void connectPlugin()}><Link2 size={14} />{linkActive ? t("Reconnect plugin") : t("Connect Studio plugin")}</Button>
          {linkActive && <IconButton label={t("Disconnect Studio plugin")} disabled={busy !== ""} onClick={() => void disconnectPlugin()}><Unlink size={14} /></IconButton>}
        </div>
      </header>
      {error && <p className="studio-explorer-error" role="alert"><CircleAlert size={14} />{error}</p>}
      {loading ? <div className="studio-explorer-loading" role="status"><LoaderCircle size={15} />{t("Loading Studio project tree...")}</div> : <>
        {!places.length ? <div className="studio-explorer-empty"><FolderTree size={17} /><span>{t("Connect the Studio plugin and import a snapshot to see this game's hierarchy.")}</span></div> : <>
          <div className="studio-explorer-toolbar">
            <label><span>{t("PLACE")}</span><span className="studio-select"><select value={selectedPlace} onChange={event => { setSelectedPlace(event.target.value); setVisibleLimit(100); }} aria-label={t("Place")}><option value="">{t("Select a place")}</option>{places.map(place => <option key={place.id} value={place.id}>{t("Place")} {place.id} · {t("Universe")} {place.universeId}</option>)}</select><ChevronDown size={13} /></span></label>
            <label className="studio-search"><Search size={14} /><input value={search} onChange={event => { setSearch(event.target.value); setVisibleLimit(100); }} placeholder={t("Search names, types, or paths...")} aria-label={t("Search in-game instances")} /></label>
            <label><span>{t("FILTER")}</span><span className="studio-select"><select value={filterSystem} onChange={event => { setFilterSystem(event.target.value); setVisibleLimit(100); }} aria-label={t("Filter by system")}><option value="__all__">{t("All instances")}</option><option value="__unassigned__">{t("Unassigned")}</option>{systems.map(system => <option value={system} key={system}>{system}</option>)}</select><ChevronDown size={13} /></span></label>
          </div>
          <div className="studio-system-tools">
            <form onSubmit={addSystem}><Field label={t("Create a system label")} value={newSystem} onChange={event => setNewSystem(event.target.value)} placeholder={t("e.g. Money system")} maxLength={80} /><Button type="submit" variant="secondary" disabled={!newSystem.trim()}><Plus size={13} />{t("Add system")}</Button></form>
            {systems.length > 0 && <label><span>{t("ASSIGN TO")}</span><span className="studio-select"><select value={targetSystem} onChange={event => setTargetSystem(event.target.value)} aria-label={t("System to assign")}><option value="">{t("Choose a system")}</option>{systems.map(system => <option value={system} key={system}>{system}</option>)}</select><ChevronDown size={13} /></span></label>}
          </div>
          <div className="studio-snapshot-meta">{t("Last imported")}: {places.find(place => place.id === selectedPlace) ? dateLabel(places.find(place => place.id === selectedPlace)!.lastSeenAt) : "—"} · {filteredInstances.length} {t("matching instances")}</div>
          <div className="studio-instance-list">
            {visibleInstances.map(instance => {
              const tags = assignmentsByInstance.get(instance.instance_key) ?? [];
              const isBusy = busy.startsWith(`${instance.instance_key}:`);
              const depth = Math.min(instance.instance_key.split("/").length - 1, 12);
              return <article className={`studio-instance-row ${instance.is_present ? "" : "studio-instance-missing"}`} key={instance.instance_key}>
                <div className="studio-instance-copy" style={{ paddingLeft: `${depth * 10}px` }}><strong>{instance.name || t("(unnamed)")}</strong><code>{instance.class_name}</code><small title={instance.full_path}>{instance.full_path}</small></div>
                <div className="studio-instance-tags">{tags.map(system => <button key={system} title={t("Remove from system")} disabled={isBusy || busy !== ""} onClick={() => void toggleAssignment(instance, system)}>{system}<X size={11} /></button>)}{!instance.is_present && <span className="studio-missing-badge">{t("Missing in latest import")}</span>}</div>
                {instance.is_present && targetSystem && <Button variant={tags.includes(targetSystem) ? "secondary" : "ghost"} disabled={busy !== ""} onClick={() => void toggleAssignment(instance, targetSystem)}>{tags.includes(targetSystem) ? <Check size={12} /> : <Plus size={12} />}{tags.includes(targetSystem) ? t("Linked") : t("Assign")}</Button>}
              </article>;
            })}
            {!filteredInstances.length && <div className="studio-explorer-empty">{t("No instances match this filter.")}</div>}
          </div>
          {filteredInstances.length > visibleInstances.length && <Button className="studio-load-more" variant="secondary" onClick={() => setVisibleLimit(limit => limit + 100)}><Download size={13} />{t("Show more")} ({filteredInstances.length - visibleInstances.length})</Button>}
        </>}
      </>}
    </section>
    {treeOpen && <StudioTreeViewer
      instances={placeInstances}
      projectName={project.name}
      t={t}
      onClose={() => setTreeOpen(false)}
    />}
    {setupConfig && <Modal title={t("Connect Roblox Studio")} onClose={() => setSetupConfig(null)} wide>
      <div className="studio-setup-dialog">
        <p>{t("Download the plugin, install it in Studio, then paste this one-time connection configuration into the plugin and click Connect.")}</p>
        <ol><li>{t("Download the GAMEFORGE Studio plugin source.")} <a href={`${import.meta.env.BASE_URL}GameForge.plugin.lua`} download="GameForge.plugin.lua"><Download size={12} />{t("Download plugin")}</a></li><li>{t("In Studio, create a Script, paste the file contents, and choose Save as Local Plugin from the Plugins menu.")}</li><li>{t("Open the GAMEFORGE toolbar button, paste the configuration below, and click Connect. Enable HTTP requests if Studio asks.")}</li><li>{t("After connecting, click Import entire game. The plugin will send the full place in small batches and show its progress.")}</li></ol>
        <pre className="studio-setup-config"><code>{JSON.stringify(setupConfig, null, 2)}</code></pre>
        <div className="modal-actions"><Button variant="secondary" onClick={() => void copySetup()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? t("Copied") : t("Copy configuration")}</Button><Button onClick={() => setSetupConfig(null)}>{t("Done")}</Button></div>
        <p className="studio-security-note">{t("This token can upload hierarchy metadata only to this project. It does not grant access to your account, and the code of your scripts is not transmitted. Reconnecting replaces the previous token.")}</p>
      </div>
    </Modal>}
  </>;
}
