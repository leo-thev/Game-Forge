import { useMemo, useState } from "react";
import { Check, Copy, Dices, Droplets, LayoutGrid, Monitor, Palette, RefreshCw, Type, Zap } from "lucide-react";
import { Button } from "../components/UI";
import type { Translator } from "../types";

type Color = { name: string; value: string };
const starterPalettes: Color[][] = [
  [{ name: "Void", value: "#090B10" }, { name: "Surface", value: "#11141B" }, { name: "Electric", value: "#5577FF" }, { name: "Ember", value: "#FF8A4C" }, { name: "Text", value: "#E8EAF0" }],
  [{ name: "Midnight", value: "#10172A" }, { name: "Slate", value: "#25304A" }, { name: "Cyan", value: "#4DD9E8" }, { name: "Lavender", value: "#A38BFA" }, { name: "Mist", value: "#E1E9F7" }],
];
const propertyRefs = [
  { name: "UDim2", path: "Size / Position", desc: "Combines scale and offset for each axis. Prefer scale values for responsive layouts.", sample: "UDim2.new(xScale, xOffset, yScale, yOffset)" },
  { name: "AnchorPoint", path: "GuiObject", desc: "Sets the origin point used to position a GuiObject. Values range from 0 to 1.", sample: "Frame.AnchorPoint = Vector2.new(0.5, 0.5)" },
  { name: "AutomaticSize", path: "GuiObject", desc: "Allows a GuiObject to resize automatically based on its content.", sample: 'Frame.AutomaticSize = Enum.AutomaticSize.Y' },
  { name: "UIListLayout", path: "Layout", desc: "Arranges sibling UI elements in a horizontal or vertical list.", sample: 'Layout.FillDirection = Enum.FillDirection.Vertical' },
  { name: "UIScale", path: "Scaling", desc: "Applies a scaling factor to a GUI object and its descendants.", sample: "Scale.Scale = 1" },
  { name: "UITextSizeConstraint", path: "Text", desc: "Constrains the rendered text size between a minimum and maximum.", sample: "Constraint.MaxTextSize = 24" },
];

function randomHex() {
  return `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
}

export function DesignLab({ onToast, t }: { onToast: (message: string, type?: "error") => void; t: Translator }) {
  const [palette, setPalette] = useState(starterPalettes[0]);
  const [gradientStart, setGradientStart] = useState("#5577FF");
  const [gradientEnd, setGradientEnd] = useState("#FF8A4C");
  const [angle, setAngle] = useState(135);
  const [designWidth, setDesignWidth] = useState(1920);
  const [designHeight, setDesignHeight] = useState(1080);
  const [targetWidth, setTargetWidth] = useState(1280);
  const [targetHeight, setTargetHeight] = useState(720);
  const [activeTab, setActiveTab] = useState("Palette");
  const [copied, setCopied] = useState("");
  const scale = useMemo(() => Math.min(targetWidth / designWidth, targetHeight / designHeight), [targetWidth, targetHeight, designWidth, designHeight]);
  const gradient = `linear-gradient(${angle}deg, ${gradientStart}, ${gradientEnd})`;
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label); onToast(`${label.startsWith("#") ? t("Color") : t(label)} ${t("copied to clipboard")}`); window.setTimeout(() => setCopied(""), 1600);
    } catch (error) {
      console.error("GAMEFORGE could not access the clipboard.", error);
      onToast(t("Clipboard access failed. Check browser permissions."), "error");
    }
  };
  const shuffle = () => setPalette(["Void", "Surface", "Electric", "Ember", "Text"].map(name => ({ name, value: randomHex() })));
  const paletteConfig = JSON.stringify(Object.fromEntries(palette.map(color => [color.name.toLowerCase(), color.value])), null, 2);
  const scaledConfig = `-- LocalScript parent: your ScreenGui
-- Reference: ${designWidth}x${designHeight}; sample target: ${targetWidth}x${targetHeight} (scale ${scale.toFixed(3)}x)
local screenGui = script.Parent
local uiScale = screenGui:FindFirstChildOfClass("UIScale") or Instance.new("UIScale")
uiScale.Parent = screenGui
local referenceResolution = Vector2.new(${designWidth}, ${designHeight})

local function updateScale()
    local camera = workspace.CurrentCamera
    if not camera then return end
    local viewport = camera.ViewportSize
    uiScale.Scale = math.min(
        viewport.X / referenceResolution.X,
        viewport.Y / referenceResolution.Y
    )
end

updateScale()
local camera = workspace.CurrentCamera
if camera then
    camera:GetPropertyChangedSignal("ViewportSize"):Connect(updateScale)
end`;
  return <div className="page-content design-page">
    <div className="module-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> {t("FROM PIXELS TO PLAYERS")}</div><h1>{t("UI & Design Lab")}</h1><p>{t("Explore a visual language for your game and take the specs straight into Studio.")}</p></div><div className="design-badge"><Palette size={15} /> {t("DESIGN SYSTEM")}</div></div>
    <div className="design-tabs">{[{ name: "Palette", icon: Palette }, { name: "Components", icon: LayoutGrid }, { name: "Typography", icon: Type }, { name: "Scaling", icon: Monitor }, { name: "GUI reference", icon: Zap }].map(tab => <button key={tab.name} onClick={() => setActiveTab(tab.name)} className={activeTab === tab.name ? "design-tab-active" : ""}><tab.icon size={14} />{t(tab.name)}</button>)}</div>
    {activeTab === "Palette" && <div className="design-section"><div className="design-section-heading"><div><div className="eyebrow">01 / {t("COLOR LANGUAGE")}</div><h2>{t("A palette with a point of view.")}</h2><p>{t("Build and copy color systems for your next experience.")}</p></div><div className="section-actions"><Button variant="secondary" onClick={shuffle}><Dices size={14} /> {t("Generate")}</Button><Button onClick={() => void copy(paletteConfig, "Palette config")}><Copy size={14} /> {t("Copy tokens")}</Button></div></div><div className="palette-board"><div className="palette-colors">{palette.map((color, index) => <div className={`palette-swatch swatch-${index}`} key={index} style={{ backgroundColor: color.value }}><span className="swatch-index">0{index + 1}</span><div className="swatch-label"><strong>{color.name}</strong><button title={t("Copy color value")} onClick={() => void copy(color.value, color.value)}>{copied === color.value ? <Check size={12} /> : <Copy size={12} />} {color.value}</button></div></div>)}</div><div className="palette-editor"><div className="palette-editor-heading"><span>{t("COLOR TOKENS")}</span><button onClick={shuffle}><RefreshCw size={12} /> {t("Regenerate")}</button></div>{palette.map((color, index) => <label key={index} className="palette-token"><span className="color-input-preview" style={{ backgroundColor: color.value }}><input type="color" value={color.value} aria-label={`${t(color.name)} ${t("color")}`} onChange={event => setPalette(palette.map((item, i) => i === index ? { ...item, value: event.target.value.toUpperCase() } : item))} /></span><span>{t(color.name)}</span><input value={color.value} maxLength={7} onChange={event => { const val = event.target.value.toUpperCase(); if (/^#[0-9A-F]{0,6}$/.test(val)) setPalette(palette.map((item, i) => i === index ? { ...item, value: val } : item)); }} /><button title={t("Copy") + " " + t(color.name)} onClick={() => void copy(color.value, color.name)}>{copied === color.value ? <Check size={13} /> : <Copy size={13} />}</button></label>)}</div></div>
      <div className="gradient-row"><div className="gradient-preview"><div className="gradient-preview-art" style={{ background: gradient }}><div className="gradient-glass-card"><Droplets size={15} /><span>{t("THE DEEP END")}</span></div></div><div className="gradient-preview-caption"><span><b>{t("LIVE GRADIENT")}</b><small>{t("Rendered in CSS")} · {angle}°</small></span><button aria-label={t("Copy gradient")} onClick={() => void copy(gradient, "Gradient")}>{copied === "Gradient" ? <Check size={13} /> : <Copy size={13} />}</button></div></div><div className="gradient-controls"><div className="eyebrow">02 / {t("GRADIENT MIXER")}</div><h3>{t("Set the atmosphere.")}</h3><div className="gradient-color-pickers"><label><span>{t("START COLOR")}</span><input type="color" value={gradientStart} onChange={event => setGradientStart(event.target.value)} /><code>{gradientStart}</code></label><span className="gradient-transition">→</span><label><span>{t("END COLOR")}</span><input type="color" value={gradientEnd} onChange={event => setGradientEnd(event.target.value)} /><code>{gradientEnd}</code></label></div><label className="angle-control"><span>{t("ANGLE")} <b>{angle}°</b></span><input type="range" min="0" max="360" value={angle} onChange={event => setAngle(Number(event.target.value))} /></label><Button variant="secondary" onClick={() => void copy(gradient, "Gradient CSS")}><Copy size={13} /> {t("Copy CSS gradient")}</Button></div></div>
    </div>}
    {activeTab === "Components" && <div className="design-section"><div className="design-section-heading"><div><div className="eyebrow">03 / {t("COMPONENT LIBRARY")}</div><h2>{t("Built to feel like a game.")}</h2><p>{t("Preview adaptable building blocks for an in-game interface.")}</p></div><Button variant="secondary" onClick={() => void copy(`-- GAMEFORGE UI CONFIG\n${paletteConfig}`, "Component configuration")}><Copy size={14} /> {t("Copy UI config")}</Button></div><div className="component-grid"><div className="component-card"><div className="component-card-label">{t("PRIMARY BUTTON")} <span>01</span></div><div className="component-preview preview-buttons"><button className="demo-button">{t("PLAY NOW")} <span>→</span></button><button className="demo-button-outline">{t("BUILD LOADOUT")}</button><button className="demo-button-icon"><Zap size={15} fill="currentColor" /> 250</button></div><div className="component-card-foot">{t("Roblox TextButton · UICorner · UIStroke")}</div></div><div className="component-card"><div className="component-card-label">{t("GAME PANEL")} <span>02</span></div><div className="component-preview"><div className="demo-game-panel"><div className="demo-panel-title"><span>◈</span> {t("DAILY QUEST")} <small>01 / 03</small></div><div className="demo-quest">{t("Collect 10 crystals")}</div><div className="demo-progress"><i /></div><div className="demo-panel-foot">{t("7 / 10 collected")} <span>+100 XP</span></div></div></div><div className="component-card-foot">{t("Frame · UIGradient · UIListLayout")}</div></div><div className="component-card"><div className="component-card-label">{t("STATUS CHIP")} <span>03</span></div><div className="component-preview preview-chips"><span className="demo-chip chip-active"><i /> {t("ONLINE")}</span><span className="demo-chip chip-rare">✦ {t("RARE DROP")}</span><span className="demo-chip chip-level">LVL. 24</span></div><div className="component-card-foot">{t("TextLabel · UIPadding · AutomaticSize")}</div></div></div></div>}
    {activeTab === "Typography" && <div className="design-section"><div className="design-section-heading"><div><div className="eyebrow">04 / {t("TYPE SYSTEM")}</div><h2>{t("Make every word count.")}</h2><p>{t("Scale, weight and hierarchy — previewed for your next game.")}</p></div><Button variant="secondary" onClick={() => void copy("Title / Space Grotesk · 32px · Bold\nHeading / Space Grotesk · 22px · Semibold\nBody / DM Sans · 14px · Regular\nLabel / DM Mono · 10px · Medium", "Typography scale")}><Copy size={14} /> {t("Copy type scale")}</Button></div><div className="type-sheet">{[{ name: "DISPLAY", font: "Space Grotesk", size: "42px", sample: "THE LAST FRONTIER", weight: 700 }, { name: "HEADING", font: "Space Grotesk", size: "25px", sample: "Your next adventure.", weight: 600 }, { name: "BODY", font: "DM Sans", size: "15px", sample: "A new world is waiting just beyond the horizon.", weight: 400 }, { name: "UI LABEL", font: "DM Mono", size: "11px", sample: "QUEST UPDATED  /  +250 XP", weight: 500 }].map(item => <div className="type-row" key={item.name}><div className="type-meta"><b>{t(item.name)}</b><span>{item.font} · {item.size}</span></div><div style={{ fontFamily: `'${item.font}', sans-serif`, fontSize: item.size, fontWeight: item.weight }}>{t(item.sample)}</div></div>)}</div></div>}
    {activeTab === "Scaling" && <div className="design-section"><div className="design-section-heading"><div><div className="eyebrow">05 / {t("RESPONSIVE UI")}</div><h2>{t("Design once. Scale everywhere.")}</h2><p>{t("Estimate a proportional UIScale factor between target viewports.")}</p></div></div><div className="scaling-layout"><div className="scaling-inputs"><div className="eyebrow">{t("REFERENCE CANVAS")}</div><div className="dimension-row"><label>{t("Width")}<input type="number" min="1" value={designWidth} onChange={event => setDesignWidth(Math.max(1, Number(event.target.value)))} /></label><span>×</span><label>{t("Height")}<input type="number" min="1" value={designHeight} onChange={event => setDesignHeight(Math.max(1, Number(event.target.value)))} /></label></div><div className="eyebrow target-label">{t("TARGET VIEWPORT")}</div><div className="dimension-row"><label>{t("Width")}<input type="number" min="1" value={targetWidth} onChange={event => setTargetWidth(Math.max(1, Number(event.target.value)))} /></label><span>×</span><label>{t("Height")}<input type="number" min="1" value={targetHeight} onChange={event => setTargetHeight(Math.max(1, Number(event.target.value)))} /></label></div><div className="scale-result"><span>{t("UNIFORM SCALE FACTOR")}</span><strong>{scale.toFixed(3)}<small>×</small></strong><p>{t("Applied to fit the full reference canvas inside the target viewport.")}</p><Button variant="secondary" onClick={() => void copy(scaledConfig, "Scaling configuration")}><Copy size={13} /> {t("Copy Roblox snippet")}</Button></div></div><div className="scale-preview"><div className="preview-screen"><div className="preview-screen-inner" style={{ width: `${Math.min(90, scale * 100)}%`, aspectRatio: `${designWidth}/${designHeight}` }}><span>{t("YOUR GAME UI")}</span><div className="preview-screen-boxes"><i /><i /><i /></div></div></div><div className="preview-dimensions"><span>{t("REFERENCE")} <b>{designWidth} × {designHeight}</b></span><span>{t("TARGET")} <b>{targetWidth} × {targetHeight}</b></span></div></div></div></div>}
    {activeTab === "GUI reference" && <div className="design-section"><div className="design-section-heading"><div><div className="eyebrow">06 / {t("ROBLOX GUI REFERENCE")}</div><h2>{t("Properties worth knowing.")}</h2><p>{t("Quick reminders for common Roblox GUI classes and properties.")}</p></div><a className="text-link" href="https://create.roblox.com/docs/ui" target="_blank" rel="noreferrer">{t("Official UI docs")} ↗</a></div><div className="property-list">{propertyRefs.map((item, index) => <article className="property-row" key={item.name}><span className="property-index">0{index + 1}</span><div className="property-info"><div><h3>{item.name}</h3><span>{t(item.path)}</span></div><p>{t(item.desc)}</p><code>{item.sample}</code></div><button title={t("Copy property example")} onClick={() => void copy(item.sample, item.name)}>{copied === item.name ? <Check size={14} /> : <Copy size={14} />}</button></article>)}</div></div>}
  </div>;
}
