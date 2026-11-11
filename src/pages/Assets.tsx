import { useEffect, useMemo, useState } from "react";
import { Box, ChevronDown, FolderPlus, Heart, Image as ImageIcon, Layers3, Plus, StickyNote, Trash2 } from "lucide-react";
import type { AssetCategory, AssetItem, Translator } from "../types";
import { Button, EmptyState, Field, IconButton, Modal, SearchBox } from "../components/UI";

const categories: AssetCategory[] = ["Models", "Animations", "Sounds", "Decals", "Images", "Meshes", "Plugins"];

function AssetThumbnail({ asset, t }: { asset: AssetItem; t: Translator }) {
  const [url, setUrl] = useState(asset.imageUrl ?? "");
  const [loading, setLoading] = useState(!asset.imageUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (asset.imageUrl) { setUrl(asset.imageUrl); setLoading(false); return; }
    const controller = new AbortController();
    setUrl("");
    setLoading(true);
    fetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${encodeURIComponent(asset.assetId)}&size=420x420&format=Png&isCircular=false`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Thumbnail request failed: ${response.status}`);
        return response.json() as Promise<{ data?: { state?: string; imageUrl?: string }[] }>;
      })
      .then(result => {
        const thumbnail = result.data?.[0];
        if (thumbnail?.state === "Completed" && thumbnail.imageUrl) setUrl(thumbnail.imageUrl);
        else setFailed(true);
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [asset.assetId, asset.imageUrl]);
  if (url && !failed) return <img src={url} alt={asset.name} onError={() => setFailed(true)} />;
  return <div className={`asset-no-preview ${loading ? "asset-preview-loading" : ""}`}><div className="asset-no-preview-icon"><Box size={22} /></div><span>{t(loading ? "LOADING ROBLOX PREVIEW" : "PREVIEW UNAVAILABLE")}</span></div>;
}

export function Assets({ assets, setAssets, collections, setCollections, onToast, newAssetRequest = 0, onAssetRequestHandled, t }: { assets: AssetItem[]; setAssets: (assets: AssetItem[]) => void; collections: string[]; setCollections: (values: string[]) => void; onToast: (message: string) => void; newAssetRequest?: number; onAssetRequestHandled?: () => void; t: Translator }) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All assets");
  const [activeCollection, setActiveCollection] = useState("All collections");
  const [modal, setModal] = useState<"asset" | "collection" | null>(null);
  const [editing, setEditing] = useState<AssetItem | null>(null);
  const [name, setName] = useState("");
  const [assetId, setAssetId] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<AssetCategory>("Models");
  const [collection, setCollection] = useState(collections[0] ?? "Favorites");
  const [notes, setNotes] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [oldestFirst, setOldestFirst] = useState(false);
  useEffect(() => {
    if (newAssetRequest > 0) {
      openForm();
      onAssetRequestHandled?.();
    }
  }, [newAssetRequest, onAssetRequestHandled]);
  const openForm = (asset?: AssetItem) => {
    setEditing(asset ?? null); setName(asset?.name ?? ""); setAssetId(asset?.assetId ?? ""); setDescription(asset?.description ?? "");
    setCategory(asset?.category ?? "Models"); setCollection(asset?.collection ?? collections[0] ?? "Favorites"); setNotes(asset?.notes ?? ""); setImageUrl(asset?.imageUrl ?? ""); setModal("asset");
  };
  const filtered = useMemo(() => {
    const matches = assets.filter(asset =>
      (activeCategory === "Favorites" ? asset.favorite : activeCategory === "All assets" || asset.category === activeCategory)
      && (activeCollection === "All collections" || asset.collection === activeCollection)
      && `${asset.name} ${asset.assetId} ${asset.description} ${asset.notes}`.toLowerCase().includes(query.toLowerCase())
    );
    return oldestFirst ? matches.reverse() : matches;
  }, [assets, activeCategory, activeCollection, query, oldestFirst]);
  const saveAsset = () => {
    const updated: AssetItem = { id: editing?.id ?? crypto.randomUUID(), name: name.trim(), assetId: assetId.trim(), description: description.trim(), category, collection, notes: notes.trim(), favorite: editing?.favorite ?? false, imageUrl: imageUrl.trim() || undefined };
    setAssets(editing ? assets.map(asset => asset.id === editing.id ? updated : asset) : [updated, ...assets]);
    setModal(null); onToast(t(editing ? "Asset updated" : "Asset added to your library"));
  };
  const saveCollection = () => {
    const value = collectionName.trim();
    if (!value || collections.some(item => item.toLowerCase() === value.toLowerCase())) return;
    setCollections([...collections, value]); setActiveCollection(value); setCollectionName(""); setModal(null); onToast(t("Collection created"));
  };
  const deleteAsset = (asset: AssetItem) => {
    if (!window.confirm(`${t("Remove")} « ${asset.name} » ${t("Remove from your library?")}`)) return;
    setAssets(assets.filter(item => item.id !== asset.id)); onToast(t("Asset removed"));
  };
  return <div className="page-content assets-page">
    <div className="module-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> {t("YOUR CREATOR LIBRARY")}</div><h1>{t("Asset")} <span>{t("Manager")}</span></h1><p>{t("Keep track of the models, audio and visuals that power your game.")}</p></div><div className="module-heading-actions"><Button variant="secondary" onClick={() => setModal("collection")}><FolderPlus size={15} /> {t("New collection")}</Button><Button onClick={() => openForm()}><Plus size={15} /> {t("Add asset")}</Button></div></div>
    <div className="asset-toolbar"><SearchBox value={query} onChange={setQuery} placeholder={t("Search name, ID, notes...")} /><label className="select-filter"><span className="sr-only">{t("Collection filter")}</span><Layers3 size={14} /><select value={activeCollection} onChange={event => setActiveCollection(event.target.value)}><option value="All collections">{t("All collections")}</option>{collections.map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></label><div className="asset-count"><span />{assets.length} {t(assets.length === 1 ? "asset" : "assets")} {t("saved")}</div></div>
    <div className="asset-layout"><aside className="asset-filter"><div className="filter-label">{t("LIBRARY")}</div><button className={activeCategory === "All assets" ? "asset-filter-active" : ""} onClick={() => setActiveCategory("All assets")}><Box size={15} />{t("All assets")}<span>{assets.length}</span></button><button className={activeCategory === "Favorites" ? "asset-filter-active" : ""} onClick={() => setActiveCategory("Favorites")}><Heart size={15} />{t("Favorites")}<span>{assets.filter(item => item.favorite).length}</span></button><div className="filter-label filter-label-spaced">{t("CATEGORIES")}</div>{categories.map((item, index) => <button key={item} className={activeCategory === item ? "asset-filter-active" : ""} onClick={() => setActiveCategory(item)}><span className={`category-glyph glyph-${index}`}><ImageIcon size={13} /></span>{t(item)}<span>{assets.filter(asset => asset.category === item).length}</span></button>)}</aside>
      <section className="asset-results"><div className="asset-results-top"><div><h2>{t(activeCategory === "All assets" ? "All assets" : activeCategory)}</h2><p>{filtered.length} {t(filtered.length === 1 ? "result" : "results")}{activeCollection !== "All collections" ? ` ${t("in")} ${activeCollection}` : ""}</p></div><button className="sort-control" onClick={() => setOldestFirst(!oldestFirst)}>{t(oldestFirst ? "Oldest first" : "Newest first")} <ChevronDown size={13} /></button></div>
        {filtered.length ? <div className="asset-grid">{filtered.map(asset => <article className="asset-card" key={asset.id}><div className="asset-preview"><AssetThumbnail asset={asset} t={t} /><div className="asset-card-top"><span className="asset-type">{t(asset.category)}</span><IconButton label={t(asset.favorite ? "Unfavorite asset" : "Favorite asset")} onClick={() => setAssets(assets.map(item => item.id === asset.id ? { ...item, favorite: !item.favorite } : item))}><Heart size={14} className={asset.favorite ? "favorite-fill" : ""} /></IconButton></div></div><div className="asset-card-content"><div className="asset-card-title"><h3><button className="asset-edit-button" onClick={() => openForm(asset)}>{asset.name}</button></h3><button aria-label={`${t("Remove")} ${asset.name}`} onClick={() => deleteAsset(asset)}><Trash2 size={13} /></button></div><p>{asset.description || t("No description added.")}</p><div className="asset-card-meta"><span className="asset-id-label">ID <b>{asset.assetId}</b></span><span className="asset-collection-tag">{asset.collection}</span></div>{asset.notes && <div className="asset-note-preview"><StickyNote size={12} />{asset.notes}</div>}</div></article>)}</div> : <EmptyState icon={<Box size={20} />} title={t(query || activeCategory !== "All assets" ? "No matching assets" : "Your library starts here")} description={t(query || activeCategory !== "All assets" ? "Try another search or category filter." : "Add an asset using an ID from your Roblox Creator Dashboard. Public Roblox thumbnails are fetched only for asset IDs you save.")} action={!assets.length && <Button onClick={() => openForm()}><Plus size={14} /> {t("Add your first asset")}</Button>} />}
      </section>
    </div>
    {modal === "asset" && <Modal title={t(editing ? "Edit asset" : "Add to library")} onClose={() => setModal(null)}><div className="modal-body"><Field label={t("Asset name")} placeholder={t("e.g. Forest environment pack")} value={name} onChange={event => setName(event.target.value)} autoFocus /><Field label={t("Roblox asset ID")} placeholder={t("Enter the real ID from Creator Dashboard")} value={assetId} onChange={event => setAssetId(event.target.value.replace(/\D/g, ""))} inputMode="numeric" /><p className="field-hint">{t("Only use IDs you have verified. Public Roblox thumbnails are looked up using this ID; previews are never fabricated.")}</p><label className="field"><span>{t("Category")}</span><select value={category} onChange={event => setCategory(event.target.value as AssetCategory)}>{categories.map(item => <option key={item} value={item}>{t(item)}</option>)}</select></label><label className="field"><span>{t("Collection")}</span><select value={collection} onChange={event => setCollection(event.target.value)}>{collections.map(item => <option key={item}>{item}</option>)}</select></label><label className="field"><span>{t("Description")}</span><textarea rows={2} placeholder={t("What is this asset for?")} value={description} onChange={event => setDescription(event.target.value)} /></label><label className="field"><span>{t("Notes")}</span><textarea rows={2} placeholder={t("Licensing, source, usage...")} value={notes} onChange={event => setNotes(event.target.value)} /></label><div className="modal-actions"><Button variant="secondary" onClick={() => setModal(null)}>{t("Cancel")}</Button><Button disabled={!name.trim() || !assetId.trim() || !/^\d+$/.test(assetId)} onClick={saveAsset}>{t(editing ? "Save changes" : "Add asset")}</Button></div></div></Modal>}
    {modal === "collection" && <Modal title={t("Create a collection")} onClose={() => setModal(null)}><div className="modal-body"><Field label={t("Collection name")} placeholder={t("e.g. Environment kit")} value={collectionName} onChange={event => setCollectionName(event.target.value)} autoFocus onKeyDown={event => { if (event.key === "Enter") saveCollection(); }} /><div className="modal-actions"><Button variant="secondary" onClick={() => setModal(null)}>{t("Cancel")}</Button><Button disabled={!collectionName.trim() || collections.some(item => item.toLowerCase() === collectionName.trim().toLowerCase())} onClick={saveCollection}>{t("Create collection")}</Button></div></div></Modal>}
  </div>;
}
