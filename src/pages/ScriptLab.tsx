import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { Code2, Copy, Download, ExternalLink, FileCode2, FilePlus2, Heart, History, Library, Plus, Search, Trash2 } from "lucide-react";
import type { ScriptItem, ScriptVersion, Translator } from "../types";
import { templates } from "../data/templates";
import { Button, EmptyState, Field, IconButton, Modal, SearchBox } from "../components/UI";
import { downloadText } from "../lib/storage";

type Props = { scripts: ScriptItem[]; setScripts: (scripts: ScriptItem[]) => void; fontSize: number; theme: "dark" | "light"; onToast: (message: string, type?: "error") => void; newScriptRequest?: number; onScriptRequestHandled?: () => void; t: Translator };

function setupLuau(monaco: typeof import("monaco-editor")) {
  if (monaco.languages.getLanguages().some(language => language.id === "luau")) return;
  monaco.languages.register({ id: "luau", extensions: [".lua", ".luau"] });
  monaco.languages.setMonarchTokensProvider("luau", {
    keywords: ["and", "break", "do", "else", "elseif", "end", "false", "for", "function", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while", "continue", "export", "type", "typeof"],
    tokenizer: {
      root: [
        [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
        [/[A-Z][\w.]*/, "type.identifier"],
        [/\d+(\.\d+)?/, "number"],
        [/--\[\[/, "comment", "@comment"],
        [/--.*$/, "comment"],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/"/, "string", "@string"],
        [/'([^'\\]|\\.)*$/, "string.invalid"],
        [/'/, "string", "@stringSingle"],
        [/[{}()[\]]/, "@brackets"],
        [/[+\-*/%=<>~#^]+/, "operator"],
        [/[;,.]/, "delimiter"],
      ],
      comment: [[/[^\]]+/, "comment"], [/\]\]/, "comment", "@pop"]],
      string: [[/[^\\"]+/, "string"], [/\\./, "string.escape"], [/"/, "string", "@pop"]],
      stringSingle: [[/[^\\']+/, "string"], [/\\./, "string.escape"], [/'/, "string", "@pop"]],
    },
  });
  monaco.languages.setLanguageConfiguration("luau", {
    comments: { lineComment: "--", blockComment: ["--[[", "]]"] },
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" }, { open: '"', close: '"' }, { open: "'", close: "'" }],
    indentationRules: { increaseIndentPattern: /^\s*(function|if|for|while|repeat|do|then)\b.*$|^\s*[{([]\s*$/, decreaseIndentPattern: /^\s*(end|else|elseif|until)\b|^\s*[}\])]/ },
  });
}

export function ScriptLab({ scripts, setScripts, fontSize, theme, onToast, newScriptRequest = 0, onScriptRequestHandled, t }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All scripts");
  const [activeId, setActiveId] = useState<string | null>(scripts[0]?.id ?? null);
  const [draft, setDraft] = useState(scripts[0]?.code ?? "");
  const [draftName, setDraftName] = useState(scripts[0]?.name ?? "");
  const [isDirty, setIsDirty] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("Gameplay");
  useEffect(() => {
    if (newScriptRequest > 0) {
      setShowNew(true);
      onScriptRequestHandled?.();
    }
  }, [newScriptRequest, onScriptRequestHandled]);
  const active = scripts.find(script => script.id === activeId) ?? null;
  const activeHistory = active?.history ?? [];
  const categories = ["All scripts", ...new Set(scripts.map(script => script.category))];
  const filtered = useMemo(() => scripts.filter(script => (category === "All scripts" || script.category === category) && `${script.name} ${script.category}`.toLowerCase().includes(query.toLowerCase())), [scripts, category, query]);

  const openScript = (script: ScriptItem) => { setActiveId(script.id); setDraft(script.code); setDraftName(script.name); setIsDirty(false); };
  const saveActive = () => {
    if (!active) return;
    const savedAt = new Date().toISOString();
    const nextName = draftName.trim() || active.name;
    const changed = nextName !== active.name || draft !== active.code;
    setScripts(scripts.map(script => script.id === active.id ? {
      ...script,
      name: nextName,
      code: draft,
      updatedAt: savedAt,
      history: changed
        ? [{ name: active.name, code: active.code, savedAt }, ...(active.history ?? [])].slice(0, 20)
        : active.history,
    } : script));
    setIsDirty(false);
    onToast(t("Script saved to your workspace"));
  };
  const restoreVersion = (version: ScriptVersion) => {
    if (!active) return;
    if (isDirty && !window.confirm(t("Restore this version and discard unsaved changes?"))) return;
    const savedAt = new Date().toISOString();
    const restored: ScriptItem = {
      ...active,
      name: version.name,
      code: version.code,
      updatedAt: savedAt,
      history: [{ name: active.name, code: active.code, savedAt }, ...(active.history ?? [])].slice(0, 20),
    };
    setScripts(scripts.map(script => script.id === active.id ? restored : script));
    openScript(restored);
    setShowHistory(false);
    onToast(t("Script version restored"));
  };
  const createScript = (name: string, categoryName: string, code = "-- Write your Luau script here\n") => {
    const script = { id: crypto.randomUUID(), name, category: categoryName, code, updatedAt: new Date().toISOString(), favorite: false, history: [] };
    setScripts([script, ...scripts]); openScript(script); setShowNew(false); setShowTemplates(false); setNewName("");
    onToast(`${name} ${t("added to Script Lab")}`);
  };
  const deleteActive = () => {
    if (!active || !window.confirm(`${t("Delete")} « ${active.name} » ? ${t("This cannot be undone.")}`)) return;
    const remaining = scripts.filter(script => script.id !== active.id);
    setScripts(remaining);
    if (remaining[0]) openScript(remaining[0]); else { setActiveId(null); setDraft(""); setDraftName(""); }
    onToast(t("Script deleted"));
  };
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(draft); onToast(t("Code copied to clipboard")); }
    catch (error) { console.error("GAMEFORGE could not access the clipboard.", error); onToast(t("Clipboard access failed. Check browser permissions."), "error"); }
  };

  return <div className="page-content script-page">
    <div className="module-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> {t("LUAU WORKSPACE")}</div><h1>{t("Script")} <span>{t("Lab")}</span></h1><p>{t("Your code, your systems. A focused space to build and organize game logic.")}</p></div><div className="module-heading-actions"><Button variant="secondary" onClick={() => setShowTemplates(true)}><Library size={15} /> {t("Templates")} <span className="button-count">{templates.length}</span></Button><Button onClick={() => setShowNew(true)}><FilePlus2 size={15} /> {t("New script")}</Button></div></div>
    <div className="script-workbench">
      <aside className="script-rail"><div className="script-rail-heading"><span>{t("EXPLORER")}</span><IconButton label={t("Create script")} onClick={() => setShowNew(true)}><Plus size={15} /></IconButton></div><SearchBox value={query} onChange={setQuery} placeholder={t("Find a script...")} /><div className="script-categories">{categories.map(item => <button key={item} className={category === item ? "category-active" : ""} onClick={() => setCategory(item)}>{t(item)}<span>{item === "All scripts" ? scripts.length : scripts.filter(script => script.category === item).length}</span></button>)}</div><div className="script-file-list">{filtered.map(script => <button className={`script-file ${script.id === activeId ? "script-file-active" : ""}`} key={script.id} onClick={() => openScript(script)}><FileCode2 size={15} /><span><b>{script.name}</b><small>{t(script.category)}</small></span>{script.favorite && <Heart size={12} className="favorite-fill" />}</button>)}{filtered.length === 0 && <div className="rail-empty">{t(scripts.length ? "No scripts match this filter." : "Your scripts will appear here.")}</div>}</div><button className="template-shortcut" onClick={() => setShowTemplates(true)}><SparkleDot />{t("Browse template library")} <span>↗</span></button></aside>
      <section className="editor-surface">
        {active ? <>
          <div className="editor-topline"><div className="editor-breadcrumb"><FileCode2 size={14} /><input className="editor-name" aria-label={t("Script name")} value={draftName} onChange={event => { setDraftName(event.target.value); setIsDirty(true); }} /> <span className="extension-badge">.luau</span>{isDirty && <span className="unsaved-dot" title={t("Unsaved changes")} />}</div><div className="editor-actions"><IconButton label={t("Version history")} onClick={() => setShowHistory(true)}><History size={15} /><span className="script-history-count">{active.history?.length ?? 0}</span></IconButton><IconButton label={t(active.favorite ? "Remove from favorites" : "Add to favorites")} onClick={() => { const updated = scripts.map(item => item.id === active.id ? { ...item, favorite: !item.favorite } : item); setScripts(updated); }}><Heart size={15} className={active.favorite ? "favorite-fill" : ""} /></IconButton><IconButton label={t("Copy code")} onClick={() => void copyCode()}><Copy size={15} /></IconButton><IconButton label={t("Download script")} onClick={() => downloadText(`${draftName || "script"}.luau`, draft, "text/plain")}><Download size={15} /></IconButton><IconButton label={t("Delete script")} onClick={deleteActive}><Trash2 size={15} /></IconButton><Button variant="primary" className="save-button" onClick={saveActive} disabled={!isDirty}>{t("Save changes")}</Button></div></div>
          <div className="editor-tabs"><span className="editor-tab active"><span className="tab-dot" />{draftName || active.name}<span className="tab-extension">.luau</span></span><span className="editor-tab-info">{t(active.category)}</span></div>
          <div className="monaco-wrap"><Editor height="100%" language="luau" theme={theme === "light" ? "vs" : "vs-dark"} value={draft} beforeMount={setupLuau} onChange={value => { setDraft(value ?? ""); setIsDirty(true); }} options={{ fontSize, fontFamily: "'DM Mono', monospace", minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 18 }, lineNumbersMinChars: 3, renderLineHighlight: "gutter", wordWrap: "on", tabSize: 4, smoothScrolling: true, cursorBlinking: "smooth", bracketPairColorization: { enabled: true }, overviewRulerBorder: false }} /></div>
          <div className="editor-status"><span><span className="status-pulse" /> LUAU</span><span>UTF-8</span><span>SPACES: 4</span><span>Ln {draft.split("\n").length}, Col 1</span></div>
        </> : <EmptyState icon={<Code2 size={22} />} title={t("Start with a blank script")} description={t("Create your first script or pick a documented starter from the template library.")} action={<div className="empty-actions"><Button onClick={() => setShowNew(true)}><Plus size={14} /> {t("New script")}</Button><Button variant="secondary" onClick={() => setShowTemplates(true)}>{t("Browse templates")}</Button></div>} />}
      </section>
    </div>
    {showNew && <Modal title={t("Create a script")} onClose={() => setShowNew(false)}><div className="modal-body"><Field label={t("Script name")} placeholder={t("e.g. PlayerController")} value={newName} onChange={event => setNewName(event.target.value)} autoFocus /><label className="field"><span>{t("System category")}</span><select value={newCategory} onChange={event => setNewCategory(event.target.value)}>{["Gameplay", "Data", "Character", "UI", "Utilities"].map(item => <option key={item}>{t(item)}</option>)}</select></label><div className="modal-actions"><Button variant="secondary" onClick={() => setShowNew(false)}>{t("Cancel")}</Button><Button disabled={!newName.trim()} onClick={() => createScript(newName.trim(), newCategory)}>{t("Create script")}</Button></div></div></Modal>}
    {showTemplates && <Modal title={t("Starter templates")} onClose={() => setShowTemplates(false)} wide><div className="template-modal-intro">{t("Functional Luau starters. Choose one to add an editable copy to your workspace.")}</div><div className="template-grid">{templates.map((template, index) => <article key={template.name} className="template-card"><button type="button" className="template-card-select" onClick={() => createScript(template.name, template.category, template.code)}><span className="template-index">{String(index + 1).padStart(2, "0")}</span><strong>{t(template.name)}</strong><p>{t(template.description)}</p><span className="template-use">{t("Add to Script Lab")} <span>→</span></span></button><a className="template-reference" href={template.name === "DataStore system" || template.name === "Save/load system" ? "https://create.roblox.com/docs/cloud-services/data-stores" : template.name === "NPC dialogue" || template.name === "Combat system" || template.name === "Shop system" ? "https://create.roblox.com/docs/scripting/events/remote" : template.name === "Player movement" ? "https://create.roblox.com/docs/reference/engine/classes/Humanoid" : "https://create.roblox.com/docs/scripting/module"} target="_blank" rel="noreferrer"><ExternalLink size={11} /> {t("Official Roblox reference")}</a></article>)}</div></Modal>}
    {showHistory && <Modal title={t("Version history")} onClose={() => setShowHistory(false)} wide><div className="script-history-intro">{t("Each saved change keeps the previous version. Up to 20 versions are kept per script.")}</div>{activeHistory.length ? <div className="script-history-list">{activeHistory.map((version, index) => <article className="script-history-entry" key={`${version.savedAt}-${index}`}><div><strong>{version.name}</strong><time dateTime={version.savedAt}>{new Date(version.savedAt).toLocaleString()}</time><pre>{version.code.slice(0, 240)}{version.code.length > 240 ? "…" : ""}</pre></div><Button variant="secondary" onClick={() => restoreVersion(version)}>{t("Restore version")}</Button></article>)}</div> : <div className="script-history-empty">{t("No saved versions yet. Save a change to create the first version.")}</div>}</Modal>}
  </div>;
}

function SparkleDot() { return <span className="sparkle-dot"><Code2 size={13} /></span>; }
