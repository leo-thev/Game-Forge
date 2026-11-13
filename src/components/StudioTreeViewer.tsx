import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { LocateFixed, Minus, Plus, X } from "lucide-react";
import type { StudioInstance, Translator } from "../types";

type TreeNode = {
  key: string;
  name: string;
  className: string;
  fullPath: string;
  children: TreeNode[];
};

type PositionedNode = TreeNode & { x: number; y: number; depth: number };
type Viewport = { x: number; y: number; scale: number };

const NODE_WIDTH = 168;
const NODE_HEIGHT = 58;
const LEAF_GAP = 198;
const LEVEL_GAP = 106;
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

function layoutTree(root: TreeNode) {
  const nodes: PositionedNode[] = [];
  const edges: Array<{ key: string; path: string }> = [];
  let leafIndex = 0;
  let maxDepth = 0;

  const position = (node: TreeNode, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    let x: number;
    if (!node.children.length) {
      x = leafIndex * LEAF_GAP + NODE_WIDTH / 2 + 36;
      leafIndex += 1;
    } else {
      const childXs = node.children.map(child => position(child, depth + 1));
      x = (childXs[0] + childXs[childXs.length - 1]) / 2;
      node.children.forEach((child, index) => {
        const childX = childXs[index];
        const startX = x;
        const startY = depth * LEVEL_GAP + 54 + NODE_HEIGHT;
        const endY = (depth + 1) * LEVEL_GAP + 54;
        const bendY = (startY + endY) / 2;
        edges.push({
          key: child.key,
          path: `M ${startX} ${startY} V ${bendY} H ${childX} V ${endY}`,
        });
      });
    }

    nodes.push({ ...node, x, y: depth * LEVEL_GAP + 54, depth });
    return x;
  };

  position(root, 0);
  return {
    nodes,
    edges,
    width: Math.max(900, leafIndex * LEAF_GAP + 120),
    height: (maxDepth + 1) * LEVEL_GAP + 110,
    rootX: nodes.find(node => node.key === root.key)?.x ?? 0,
  };
}

export function StudioTreeViewer({ instances, projectName, t, onClose }: {
  instances: StudioInstance[];
  projectName: string;
  t: Translator;
  onClose: () => void;
}) {
  const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
  const tree = useMemo(() => createTree(instances, projectName), [instances, projectName]);
  const layout = useMemo(() => layoutTree(tree), [tree]);
  const objectCount = layout.nodes.length - 1;
  const [viewport, setViewport] = useState<Viewport>(() => ({
    x: window.innerWidth / 2 - layout.rootX * 0.9,
    y: 28,
    scale: 0.9,
  }));
  const [canvasSize, setCanvasSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const resize = () => setCanvasSize({ width: window.innerWidth, height: window.innerHeight });
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keydown);
    };
  }, [onClose]);

  const centerOnRoot = () => {
    setViewport({ x: canvasSize.width / 2 - layout.rootX * 0.9, y: 28, scale: 0.9 });
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
      y: (canvasSize.height - 100 - layout.height * scale) / 2 + 70,
    });
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

  return createPortal(
    <section className="studio-tree-viewer" role="dialog" aria-modal="true" aria-label={t("Full-screen game hierarchy")}>
      <header className="studio-tree-header">
        <div className="studio-tree-title">
          <strong>{t("Game hierarchy")}</strong>
          <span>{projectName}</span>
          <span>{objectCount} {t("objects")}</span>
        </div>
        <div className="studio-tree-controls">
          <span className="studio-tree-hint">{t("Drag to move · Scroll to zoom")}</span>
          <button type="button" onClick={() => zoomAtCenter(1 / 1.2)} aria-label={t("Zoom out")} title={t("Zoom out")}><Minus size={16} /></button>
          <span className="studio-tree-zoom">{zoomLabel}</span>
          <button type="button" onClick={() => zoomAtCenter(1.2)} aria-label={t("Zoom in")} title={t("Zoom in")}><Plus size={16} /></button>
          <button type="button" onClick={fitTree} aria-label={t("Fit hierarchy")} title={t("Fit hierarchy")}><LocateFixed size={16} /></button>
          <button type="button" onClick={centerOnRoot} aria-label={t("Center hierarchy")} title={t("Center hierarchy")}><span className="studio-tree-reset">0</span></button>
          <button type="button" className="studio-tree-close" onClick={onClose} aria-label={t("Close hierarchy")} title={t("Close hierarchy")}><X size={17} /></button>
        </div>
      </header>
      <div
        className="studio-tree-canvas"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {layout.nodes.length > 1 ? <svg
          className="studio-tree-svg"
          width={layout.width}
          height={layout.height}
          style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}
          role="img"
          aria-label={`${objectCount} ${t("objects")}`}
        >
          <g className="studio-tree-edges">{layout.edges.map(edge => <path key={edge.key} d={edge.path} />)}</g>
          <g className="studio-tree-nodes">
            {layout.nodes.map(node => <g className={`studio-tree-node ${node.depth === 0 ? "studio-tree-node-root" : ""}`} key={node.key} transform={`translate(${node.x - NODE_WIDTH / 2}, ${node.y})`}>
              <title>{node.fullPath || node.name}{node.className ? ` · ${node.className}` : ""}</title>
              <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx="8" />
              <text className="studio-tree-node-name" x="12" y="24">{node.name.length > 22 ? `${node.name.slice(0, 21)}…` : node.name}</text>
              <text className="studio-tree-node-class" x="12" y="43">{node.className}</text>
            </g>)}
          </g>
        </svg> : <div className="studio-tree-empty">{t("No instances match this filter.")}</div>}
      </div>
    </section>,
    document.body,
  );
}
