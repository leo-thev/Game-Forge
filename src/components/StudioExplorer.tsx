import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, ChevronDown, CircleAlert, Copy, Download, Eye, FolderTree, Link2, LoaderCircle, Plus, RefreshCw, Search, Sparkles, Unlink, X } from "lucide-react";
import type { Project, StudioInstance, StudioSystemAssignment, Translator } from "../types";
import { Button, Field, IconButton, Modal } from "./UI";
import { createStudioLink, hasStudioLink, revokeStudioLink } from "../lib/cloudStorage";
import { getSupabaseConnectionConfig, type GameforgeSupabase } from "../lib/supabase";
import { StudioTreeViewer } from "./StudioTreeViewer";

type PlaceSummary = { id: string; universeId: string; lastSeenAt: string };
type StudioPluginConfig = { supabaseUrl: string; anonKey: string; studioToken: string; projectName: string };
type AutoSortCategory = {
  id: string;
  labelKey: string;
  aliases: string[];
  terms: string[];
};
type AutoSortProposal = { instance: StudioInstance; categoryId: string; systemName: string };
type AutoSortGroup = { categoryId: string; systemName: string; proposals: AutoSortProposal[] };

const autoSortCategories: AutoSortCategory[] = [
  { id: "currency", labelKey: "Currency", aliases: ["currency", "money", "economy", "monnaie", "argent", "economie"], terms: ["currency", "money", "coin", "coins", "cash", "wallet", "balance", "monnaie", "argent", "piece", "pieces", "portefeuille"] },
  { id: "inventory", labelKey: "Inventory", aliases: ["inventory", "item", "equipment", "backpack", "inventaire", "objet", "equipement"], terms: ["inventory", "inventories", "item", "items", "equipment", "backpack", "loadout", "hotbar", "tool", "tools", "inventaire", "objet", "objets", "equipement", "sac"] },
  { id: "shop", labelKey: "Shop", aliases: ["shop", "boutique", "merchant", "purchase", "achat"], terms: ["shop", "market", "merchant", "vendor", "purchase", "buy", "sell", "product", "catalog", "boutique", "marchand", "vendeur", "achat", "acheter", "produit"] },
  { id: "quests", labelKey: "Quest system", aliases: ["quest", "quests", "mission", "quete", "objectif"], terms: ["quest", "quests", "mission", "missions", "objective", "objectives", "quete", "quetes", "objectif"] },
  { id: "combat", labelKey: "Combat", aliases: ["combat", "weapon", "arme", "pvp"], terms: ["combat", "weapon", "weapons", "sword", "gun", "damage", "attack", "hitbox", "projectile", "ammo", "arme", "armes", "degat", "attaque"] },
  { id: "rounds", labelKey: "Round system", aliases: ["round", "match", "arena", "manche", "aren"], terms: ["round", "rounds", "match", "arena", "lobby", "manche", "arene", "salon"] },
  { id: "progression", labelKey: "Progression", aliases: ["progression", "level", "experience", "niveau"], terms: ["progression", "level", "levels", "xp", "experience", "rank", "skill", "niveau", "niveaux", "rang", "competence"] },
  { id: "saving", labelKey: "Save / load system", aliases: ["save", "load", "datastore", "data store", "profile", "sauvegarde", "profil"], terms: ["datastore", "data store", "save", "saving", "load", "profile", "persistence", "player data", "sauvegarde", "enregistrer", "chargement", "profil"] },
  { id: "npc-dialogue", labelKey: "NPC dialogue", aliases: ["npc", "pnj", "dialogue", "conversation"], terms: ["npc", "pnj", "dialog", "dialogue", "conversation", "talk", "parler"] },
];

function normalizeTokens(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasTerm(tokens: string[], term: string) {
  const phrase = normalizeTokens(term);
  return phrase.length > 0 && tokens.some((_, start) =>
    phrase.every((part, index) => tokens[start + index] === part)
  );
}

function classifyInstance(instance: StudioInstance) {
  const nameTokens = normalizeTokens(instance.name);
  const classTokens = normalizeTokens(instance.class_name);
  const pathTokens = instance.full_path.split("/").slice(0, -1).flatMap(normalizeTokens);
  const ranked = autoSortCategories.map(category => ({
    category,
    score: (category.terms.some(term => hasTerm(nameTokens, term)) ? 4 : 0)
      + (category.terms.some(term => hasTerm(classTokens, term)) ? 1 : 0)
      + (category.terms.some(term => hasTerm(pathTokens, term)) ? 2 : 0),
  })).filter(result => result.score > 0).sort((left, right) => right.score - left.score);

  if (!ranked.length || (ranked[1] && ranked[1].score === ranked[0].score)) return null;
  return ranked[0].category;
}

function existingSystemFor(category: AutoSortCategory, systems: string[]) {
  return systems.find(system => {
    const systemTokens = normalizeTokens(system);
    return category.aliases.some(alias => hasTerm(systemTokens, alias));
  });
}

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
  const [autoSortOpen, setAutoSortOpen] = useState(false);
  const [selectedAutoCategories, setSelectedAutoCategories] = useState<Set<string>>(() => new Set());

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
  const autoSortProposals = useMemo(() => placeInstances.flatMap(instance => {
    if (!instance.is_present || (assignmentsByInstance.get(instance.instance_key)?.length ?? 0) > 0) return [];
    const category = classifyInstance(instance);
    if (!category) return [];
    return [{
      instance,
      categoryId: category.id,
      systemName: existingSystemFor(category, systems) ?? t(category.labelKey),
    }];
  }), [placeInstances, assignmentsByInstance, systems, t]);
  const autoSortGroups = useMemo(() => {
    const groups = new Map<string, AutoSortGroup>();
    for (const proposal of autoSortProposals) {
      const group = groups.get(proposal.categoryId) ?? {
        categoryId: proposal.categoryId,
        systemName: proposal.systemName,
        proposals: [],
      };
      group.proposals.push(proposal);
      groups.set(proposal.categoryId, group);
    }
    return [...groups.values()].sort((left, right) => left.systemName.localeCompare(right.systemName));
  }, [autoSortProposals]);

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

  const openAutoSort = () => {
    setSelectedAutoCategories(new Set(autoSortGroups.map(group => group.categoryId)));
    setError("");
    setAutoSortOpen(true);
  };

  const applyAutoSort = async () => {
    const selected = autoSortGroups
      .filter(group => selectedAutoCategories.has(group.categoryId))
      .flatMap(group => group.proposals);
    if (!selected.length) return;

    setBusy("auto-sort");
    setError("");
    try {
      for (let offset = 0; offset < selected.length; offset += 250) {
        const batch = selected.slice(offset, offset + 250).map(proposal => ({
          project_id: project.id,
          place_id: selectedPlace,
          instance_key: proposal.instance.instance_key,
          system_name: proposal.systemName,
        }));
        const result = await client.from("gameforge_studio_instance_systems").insert(batch);
        if (result.error) throw result.error;
      }
      setAutoSortOpen(false);
      setSelectedAutoCategories(new Set());
      await load();
    } catch (caught) {
      console.error("GAMEFORGE could not apply automatic Studio system suggestions.", caught);
      await load();
      setError(caught instanceof Error ? caught.message : t("The automatic sorting could not be applied."));
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
            <div className="studio-system-tools-actions">
              <Button variant="secondary" disabled={!autoSortProposals.length || busy !== ""} title={autoSortProposals.length ? t("Suggest systems for unassigned objects") : t("No unassigned objects could be confidently classified.")} onClick={openAutoSort}><Sparkles size={13} />{t("Auto-sort")} {autoSortProposals.length > 0 && <span>{autoSortProposals.length}</span>}</Button>
              {systems.length > 0 && <label><span>{t("ASSIGN TO")}</span><span className="studio-select"><select value={targetSystem} onChange={event => setTargetSystem(event.target.value)} aria-label={t("System to assign")}><option value="">{t("Choose a system")}</option>{systems.map(system => <option value={system} key={system}>{system}</option>)}</select><ChevronDown size={13} /></span></label>}
            </div>
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
    {autoSortOpen && <Modal title={t("Review automatic system suggestions")} onClose={() => setAutoSortOpen(false)} wide>
      <div className="studio-auto-sort">
        <p>{t("Suggestions use object names, types, and paths only. Existing assignments are untouched, and nothing is saved until you apply the selected groups.")}</p>
        <div className="studio-auto-sort-groups">
          {autoSortGroups.map(group => {
            const category = autoSortCategories.find(item => item.id === group.categoryId);
            return <div className="studio-auto-sort-group" key={group.categoryId}>
              <input
                id={`studio-auto-sort-${group.categoryId}`}
                type="checkbox"
                checked={selectedAutoCategories.has(group.categoryId)}
                onChange={() => setSelectedAutoCategories(current => {
                  const next = new Set(current);
                  if (next.has(group.categoryId)) next.delete(group.categoryId);
                  else next.add(group.categoryId);
                  return next;
                })}
              />
              <span className="studio-auto-sort-copy">
                <label className="studio-auto-sort-group-heading" htmlFor={`studio-auto-sort-${group.categoryId}`}><strong>{category ? t(category.labelKey) : group.systemName}</strong><em>{group.proposals.length} {t("objects")}</em></label>
                <code>{group.systemName}</code>
                <details>
                  <summary>{t("Preview matching objects")}</summary>
                  <ul>{group.proposals.slice(0, 8).map(proposal => <li key={proposal.instance.instance_key} title={proposal.instance.full_path}>{proposal.instance.name} <code>{proposal.instance.class_name}</code></li>)}</ul>
                  {group.proposals.length > 8 && <small>+{group.proposals.length - 8} {t("additional objects")}</small>}
                </details>
              </span>
            </div>;
          })}
          {!autoSortGroups.length && <div className="studio-explorer-empty">{t("No unassigned objects could be confidently classified.")}</div>}
        </div>
        {error && <p className="studio-explorer-error" role="alert"><CircleAlert size={14} />{error}</p>}
        <div className="modal-actions">
          <Button variant="secondary" disabled={busy !== ""} onClick={() => setAutoSortOpen(false)}>{t("Cancel")}</Button>
          <Button disabled={!autoSortGroups.some(group => selectedAutoCategories.has(group.categoryId)) || busy !== ""} onClick={() => void applyAutoSort()}><Check size={13} />{busy === "auto-sort" ? t("Applying suggestions...") : t("Apply selected suggestions")}</Button>
        </div>
      </div>
    </Modal>}
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
