import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, ChevronUp, LocateFixed, Minus, Plus, Search, X } from "lucide-react";
import type { StudioInstance, Translator } from "../types";

type TreeNode = {
  key: string;
  name: string;
  className: string;
  fullPath: string;
  children: TreeNode[];
};

type TreeRow = { node: TreeNode; prefix: string; depth: number; hasChildren: boolean; collapsed: boolean };
type Viewport = { x: number; y: number; scale: number };

const MIN_SCALE = 0.0001;
const MAX_SCALE = 2.5;

function decodeSegment(segment: string) {
  const encodedName = segment.split("~")[0];
  try {
    return decodeURIComponent(encodedName) || segment;
  } catch {
    return encodedName || segment;
  }
}

function createTree(instances: StudioInstance[], projectName: string) {
  const root: TreeNode = {
    key: "__gameforge_root__",
    name: projectName,
    className: "Game",
    fullPath: projectName,
    children: [],
  };
  const nodes = new Map<string, TreeNode>([[root.key, root]]);

  for (const instance of instances) {
    if (!instance.is_present) continue;
    const segments = instance.instance_key.split("/");
    let parent = root;
    let key = "";

    segments.forEach((segment, index) => {
      key = key ? `${key}/${segment}` : segment;
      let node = nodes.get(key);
      if (!node) {
        const isInstance = index === segments.length - 1;
        node = {
          key,
          name: isInstance ? instance.name : decodeSegment(segment),
          className: isInstance ? instance.class_name : segment.split("~")[1] || "",
          fullPath: isInstance ? instance.full_path : "",
          children: [],
        };
        nodes.set(key, node);
        parent.children.push(node);
      } else if (index === segments.length - 1) {
        node.name = instance.name;
        node.className = instance.class_name;
        node.fullPath = instance.full_path;
      }
      parent = node;
    });
  }

  const sortChildren = (node: TreeNode) => {
    node.children.sort((left, right) => left.name.localeCompare(right.name) || left.className.localeCompare(right.className));
    node.children.forEach(sortChildren);
  };
  sortChildren(root);
  return root;
}

function flattenTree(root: TreeNode, collapsedKeys: Set<string>) {
  const rows: TreeRow[] = [];
  const stack: Array<{ node: TreeNode; guides: string; depth: number; isLast: boolean; isRoot: boolean }> = [
    { node: root, guides: "", depth: 0, isLast: true, isRoot: true },
  ];
  let maxDepth = 0;
  let maxLabelLength = 0;

  while (stack.length) {
    const current = stack.pop()!;
    const prefix = current.isRoot ? "" : `${current.guides}${current.isLast ? "└── " : "├── "}`;
    const collapsed = collapsedKeys.has(current.node.key);
    rows.push({ node: current.node, prefix, depth: current.depth, hasChildren: current.node.children.length > 0, collapsed });
    maxDepth = Math.max(maxDepth, current.depth);
    maxLabelLength = Math.max(maxLabelLength, prefix.length + current.node.name.length + current.node.className.length + 4);

    const childGuides = current.isRoot
      ? ""
      : `${current.guides}${current.isLast ? "    " : "│   "}`;
    if (collapsed) continue;
    for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
      stack.push({
        node: current.node.children[index],
        guides: childGuides,
        depth: current.depth + 1,
        isLast: index === current.node.children.length - 1,
        isRoot: false,
      });
    }
  }

  return {
    rows,
    width: Math.max(900, maxLabelLength * 9 + maxDepth * 10 + 64),
    height: Math.max(100, rows.length * 28 + 48),
  };
}

export function StudioTreeViewer({ instances, projectName, t, onClose }: {
  instances: StudioInstance[];
  projectName: string;
  t: Translator;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
  const tree = useMemo(() => createTree(instances, projectName), [instances, projectName]);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set());
  const layout = useMemo(() => flattenTree(tree, collapsedKeys), [tree, collapsedKeys]);
  const allRows = useMemo(() => flattenTree(tree, new Set()).rows, [tree]);
  const objectCount = allRows.length - 1;
  const [viewport, setViewport] = useState<Viewport>({ x: 28, y: 22, scale: 1 });
  const [canvasSize, setCanvasSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [query, setQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);

  useEffect(() => {
    const resize = () => {
      const bounds = canvasRef.current?.getBoundingClientRect();
      setCanvasSize({
        width: bounds?.width ?? window.innerWidth,
        height: bounds?.height ?? window.innerHeight,
      });
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", keydown);
    const observer = new ResizeObserver(resize);
    if (canvasRef.current) observer.observe(canvasRef.current);
    resize();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keydown);
      observer.disconnect();
    };
  }, [onClose]);

  const matches = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return [];
    return allRows.filter(({ node }) =>
      `${node.name} ${node.className} ${node.fullPath}`.toLocaleLowerCase().includes(normalizedQuery)
    );
  }, [allRows, query]);

  const centerOnRoot = () => {
    setViewport({ x: 28, y: 22, scale: 1 });
  };

  const zoomAtCenter = (factor: number) => {
    setViewport(current => {
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor));
      const centerX = canvasSize.width / 2;
      const centerY = canvasSize.height / 2;
      return {
        scale,
        x: centerX - (centerX - current.x) * scale / current.scale,
        y: centerY - (centerY - current.y) * scale / current.scale,
      };
    });
  };

  const fitTree = () => {
    const scale = Math.max(MIN_SCALE, Math.min(1, (canvasSize.width - 80) / layout.width, (canvasSize.height - 150) / layout.height));
    setViewport({
      scale,
      x: (canvasSize.width - layout.width * scale) / 2,
      y: (canvasSize.height - layout.height * scale) / 2,
    });
  };

  const navigateMatch = (direction: 1 | -1) => {
    if (!matches.length) return;
    const nextIndex = activeMatchIndex < 0
      ? direction === 1 ? 0 : matches.length - 1
      : (activeMatchIndex + direction + matches.length) % matches.length;
    const match = matches[nextIndex];
    const nextCollapsedKeys = new Set(collapsedKeys);
    nextCollapsedKeys.delete(tree.key);
    const segments = match.node.key.split("/");
    let ancestorKey = "";
    for (const segment of segments.slice(0, -1)) {
      ancestorKey = ancestorKey ? `${ancestorKey}/${segment}` : segment;
      nextCollapsedKeys.delete(ancestorKey);
    }

    const nextRows = flattenTree(tree, nextCollapsedKeys).rows;
    const rowIndex = nextRows.findIndex(row => row.node.key === match.node.key);
    setCollapsedKeys(nextCollapsedKeys);
    setActiveMatchIndex(nextIndex);
    setViewport(current => ({
      ...current,
      y: canvasSize.height / 2 - (Math.max(0, rowIndex) * 28 + 18) * current.scale,
    }));
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      navigateMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      setQuery("");
      setActiveMatchIndex(-1);
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - bounds.left;
    const cursorY = event.clientY - bounds.top;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, viewport.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12)));
    setViewport({
      scale,
      x: cursorX - (cursorX - viewport.x) * scale / viewport.scale,
      y: cursorY - (cursorY - viewport.y) * scale / viewport.scale,
    });
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.target instanceof HTMLElement && event.target.closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: viewport.x,
      y: viewport.y,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setViewport(current => ({
      ...current,
      x: drag.x + event.clientX - drag.clientX,
      y: drag.y + event.clientY - drag.clientY,
    }));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };
  const zoomLabel = viewport.scale < 0.01
    ? `${(viewport.scale * 100).toFixed(2)}%`
    : `${Math.round(viewport.scale * 100)}%`;
  const activeMatchKey = activeMatchIndex >= 0 ? matches[activeMatchIndex]?.node.key : undefined;

  return createPortal(
    <section className="studio-tree-viewer" role="dialog" aria-modal="true" aria-label={t("Full-screen game hierarchy")}>
      <header className="studio-tree-header">
        <div className="studio-tree-title">
          <strong>{t("Game hierarchy")}</strong>
          <span>{projectName}</span>
          <span>{objectCount} {t("objects")}</span>
        </div>
        <div className="studio-tree-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={event => { setQuery(event.target.value); setActiveMatchIndex(-1); }}
            onKeyDown={handleSearchKeyDown}
            placeholder={t("Search in hierarchy...")}
            aria-label={t("Search in hierarchy")}
          />
          {query && <span className="studio-tree-match-count" role="status" aria-live="polite">
            {matches.length ? `${activeMatchIndex < 0 ? 0 : activeMatchIndex + 1} / ${matches.length}` : t("No matches")}
          </span>}
          <button type="button" onClick={() => navigateMatch(-1)} disabled={!matches.length} aria-label={t("Previous match")} title={t("Previous match")}><ChevronUp size={15} /></button>
          <button type="button" onClick={() => navigateMatch(1)} disabled={!matches.length} aria-label={t("Next match")} title={t("Next match")}><ChevronDown size={15} /></button>
        </div>
        <div className="studio-tree-controls">
          <span className="studio-tree-hint">{t("Drag to move · Scroll to zoom · Enter for next match")}</span>
          <button type="button" onClick={() => zoomAtCenter(1 / 1.2)} aria-label={t("Zoom out")} title={t("Zoom out")}><Minus size={16} /></button>
          <span className="studio-tree-zoom">{zoomLabel}</span>
          <button type="button" onClick={() => zoomAtCenter(1.2)} aria-label={t("Zoom in")} title={t("Zoom in")}><Plus size={16} /></button>
          <button type="button" onClick={fitTree} aria-label={t("Fit hierarchy")} title={t("Fit hierarchy")}><LocateFixed size={16} /></button>
          <button type="button" onClick={centerOnRoot} aria-label={t("Center hierarchy")} title={t("Center hierarchy")}><span className="studio-tree-reset">0</span></button>
          <button type="button" className="studio-tree-close" onClick={onClose} aria-label={t("Close hierarchy")} title={t("Close hierarchy")}><X size={17} /></button>
        </div>
      </header>
      <div
        ref={canvasRef}
        className="studio-tree-canvas"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {layout.rows.length > 1 ? <div
          className="studio-tree-lines"
          style={{
            width: layout.width,
            minHeight: layout.height,
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          }}
          role="tree"
          aria-label={`${objectCount} ${t("objects")}`}
        >
          {layout.rows.map(({ node, prefix, depth, hasChildren, collapsed }) => <div
            className={`studio-tree-line ${depth === 0 ? "studio-tree-line-root" : ""} ${node.key === activeMatchKey ? "studio-tree-line-active" : ""}`}
            key={node.key}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={hasChildren ? !collapsed : undefined}
            aria-label={`${node.name}${node.className ? ` · ${node.className}` : ""}`}
            title={node.fullPath || node.name}
          >
            {hasChildren
              ? <button
                type="button"
                className="studio-tree-collapse"
                onClick={() => setCollapsedKeys(current => {
                  const next = new Set(current);
                  if (next.has(node.key)) next.delete(node.key);
                  else next.add(node.key);
                  return next;
                })}
                aria-label={t(collapsed ? "Expand branch" : "Collapse branch")}
                title={t(collapsed ? "Expand branch" : "Collapse branch")}
              >{collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button>
              : <span className="studio-tree-collapse-spacer" />}
            <code className="studio-tree-prefix">{prefix}</code>
            <span className="studio-tree-line-name">{node.name}</span>
            {node.className && <span className="studio-tree-line-class">{node.className}</span>}
          </div>)}
        </div> : <div className="studio-tree-empty">{t("No instances match this filter.")}</div>}
      </div>
    </section>,
    document.body,
  );
}
