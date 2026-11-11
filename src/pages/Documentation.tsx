import { useMemo, useState } from "react";
import { ArrowUpRight, BookOpen, ExternalLink, FileCode2, Globe2, Search, ShieldCheck } from "lucide-react";
import { docs } from "../data/docs";
import { EmptyState, SearchBox } from "../components/UI";
import type { Translator } from "../types";

const categories = ["All topics", ...new Set(docs.map(entry => entry.category))];

export function Documentation({ t }: { t: Translator }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All topics");
  const results = useMemo(() => docs.filter(entry =>
    (category === "All topics" || entry.category === category)
    && `${entry.title} ${t(entry.title)} ${entry.summary} ${t(entry.summary)} ${entry.category} ${t(entry.category)} ${entry.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())
  ), [query, category, t]);
  return <div className="page-content docs-page">
    <div className="docs-hero"><div className="docs-hero-copy"><div className="eyebrow"><span className="eyebrow-line" /> {t("YOUR SOURCE OF TRUTH")}</div><h1>{t("The knowledge")}<br /><span>{t("behind the build.")}</span></h1><p>{t("A carefully curated index of official Roblox and Luau documentation. Every link opens the original source.")}</p><div className="docs-source-badge"><ShieldCheck size={14} /> {t("OFFICIAL ROBLOX & LUAU SOURCES")}</div></div><div className="docs-hero-symbol"><div className="docs-orbit docs-orbit-one" /><div className="docs-orbit docs-orbit-two" /><BookOpen size={42} /></div><div className="docs-hero-grid" /></div>
    <div className="docs-search-row"><SearchBox value={query} onChange={setQuery} placeholder={t("Search Luau, DataStores, RemoteEvents...")} /><span className="docs-result-count">{results.length} {t(results.length === 1 ? "REFERENCE" : "REFERENCES")}</span></div>
    <div className="docs-content"><aside className="docs-categories"><div className="filter-label">{t("BROWSE BY TOPIC")}</div>{categories.map(item => <button key={item} className={category === item ? "docs-category-active" : ""} onClick={() => setCategory(item)}>{t(item)}<span>{item === "All topics" ? docs.length : docs.filter(entry => entry.category === item).length}</span></button>)}<a className="official-docs-link" href="https://create.roblox.com/docs" target="_blank" rel="noreferrer"><Globe2 size={14} /> {t("Creator documentation")} <ArrowUpRight size={13} /></a></aside><section className="docs-results">{results.length ? results.map((entry, index) => <a className="doc-entry" key={entry.title} href={entry.url} target="_blank" rel="noreferrer"><div className="doc-entry-index">{String(index + 1).padStart(2, "0")}</div><div className="doc-entry-body"><div className="doc-entry-top"><span className="doc-category-tag">{t(entry.category)}</span><span className="doc-domain">{t("OFFICIAL SOURCE")}</span></div><h2>{t(entry.title)}</h2><p>{t(entry.summary)}</p><div className="doc-tags">{entry.tags.slice(0, 4).map(tag => <span key={tag}>{tag}</span>)}</div></div><span className="doc-external"><ExternalLink size={15} /></span></a>) : <EmptyState icon={<Search size={20} />} title={t("No references found")} description={t("Try a different search term or browse another topic.")} />}</section></div>
    <div className="docs-disclaimer"><FileCode2 size={14} /><span>{t("API details can change. Always verify signatures and behavior against the official Creator documentation and current engine reference.")}</span><a href="https://create.roblox.com/docs/reference/engine" target="_blank" rel="noreferrer">{t("Engine reference")} ↗</a></div>
  </div>;
}
