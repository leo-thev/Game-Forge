import { useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { Braces, Check, ChevronDown, Copy, Download, ExternalLink, FileCode2, RefreshCw, Shapes, Sparkles } from "lucide-react";
import { Button, Field } from "../components/UI";
import { downloadText } from "../lib/storage";
import type { Translator } from "../types";

type SystemType = "Currency" | "Shop" | "Inventory" | "Loot rarity" | "Daily rewards" | "Chest & cooldown" | "Progression";
type Values = Record<string, string>;

const systemTabs: { name: SystemType; caption: string; icon: string }[] = [
  { name: "Currency", caption: "Wallet & economy", icon: "◈" },
  { name: "Shop", caption: "Purchases", icon: "⌑" },
  { name: "Inventory", caption: "Items & storage", icon: "▤" },
  { name: "Loot rarity", caption: "Drop tables", icon: "◇" },
  { name: "Daily rewards", caption: "Retention loop", icon: "▦" },
  { name: "Chest & cooldown", caption: "Timed rewards", icon: "▣" },
  { name: "Progression", caption: "XP & levels", icon: "↗" },
];

const officialReferences: Record<SystemType, { label: string; url: string }[]> = {
  Currency: [
    { label: "Data stores", url: "https://create.roblox.com/docs/cloud-services/data-stores" },
    { label: "Security tactics", url: "https://create.roblox.com/docs/scripting/security/security-tactics" },
  ],
  Shop: [
    { label: "Remote events", url: "https://create.roblox.com/docs/scripting/events/remote" },
    { label: "Security tactics", url: "https://create.roblox.com/docs/scripting/security/security-tactics" },
  ],
  Inventory: [
    { label: "ModuleScripts", url: "https://create.roblox.com/docs/scripting/module" },
    { label: "Data stores", url: "https://create.roblox.com/docs/cloud-services/data-stores" },
  ],
  "Loot rarity": [
    { label: "Random API", url: "https://create.roblox.com/docs/reference/engine/datatypes/Random" },
    { label: "Security tactics", url: "https://create.roblox.com/docs/scripting/security/security-tactics" },
  ],
  "Daily rewards": [
    { label: "Data stores", url: "https://create.roblox.com/docs/cloud-services/data-stores" },
    { label: "Players API", url: "https://create.roblox.com/docs/reference/engine/classes/Players" },
  ],
  "Chest & cooldown": [
    { label: "ProximityPrompt API", url: "https://create.roblox.com/docs/reference/engine/classes/ProximityPrompt" },
    { label: "Security tactics", url: "https://create.roblox.com/docs/scripting/security/security-tactics" },
  ],
  Progression: [
    { label: "Data stores", url: "https://create.roblox.com/docs/cloud-services/data-stores" },
    { label: "Players API", url: "https://create.roblox.com/docs/reference/engine/classes/Players" },
  ],
};

const initialValues: Record<SystemType, Values> = {
  Currency: { currencyName: "Coins", start: "0", max: "1000000", reward: "25" },
  Shop: { itemName: "SpeedBoost", itemCost: "100", currencyName: "Coins", cooldown: "0.5" },
  Inventory: { maxSlots: "30", maxStack: "99", itemName: "Item" },
  "Loot rarity": { common: "60", uncommon: "25", rare: "10", epic: "4", legendary: "1" },
  "Daily rewards": { days: "7", firstReward: "50", increment: "25", cooldown: "20" },
  "Chest & cooldown": { chestName: "StarterChest", reward: "100", cooldown: "3600", maxDistance: "12" },
  Progression: { xpBase: "100", multiplier: "1.25", maxLevel: "50", xpPerAction: "10" },
};

const fieldInfo: Record<SystemType, { key: string; label: string; type?: string }[]> = {
  Currency: [{ key: "currencyName", label: "Currency name" }, { key: "start", label: "Starting balance", type: "number" }, { key: "max", label: "Maximum balance", type: "number" }, { key: "reward", label: "Reward per action", type: "number" }],
  Shop: [{ key: "itemName", label: "Item ID" }, { key: "itemCost", label: "Item cost", type: "number" }, { key: "currencyName", label: "Currency name" }, { key: "cooldown", label: "Request cooldown (seconds)", type: "number" }],
  Inventory: [{ key: "maxSlots", label: "Maximum slots", type: "number" }, { key: "maxStack", label: "Maximum stack size", type: "number" }, { key: "itemName", label: "Example item ID" }],
  "Loot rarity": [{ key: "common", label: "Common weight", type: "number" }, { key: "uncommon", label: "Uncommon weight", type: "number" }, { key: "rare", label: "Rare weight", type: "number" }, { key: "epic", label: "Epic weight", type: "number" }, { key: "legendary", label: "Legendary weight", type: "number" }],
  "Daily rewards": [{ key: "days", label: "Reward streak length", type: "number" }, { key: "firstReward", label: "Day one reward", type: "number" }, { key: "increment", label: "Daily increment", type: "number" }, { key: "cooldown", label: "Claim interval (hours)", type: "number" }],
  "Chest & cooldown": [{ key: "chestName", label: "Chest ID" }, { key: "reward", label: "Reward amount", type: "number" }, { key: "cooldown", label: "Cooldown (seconds)", type: "number" }, { key: "maxDistance", label: "Maximum interaction distance", type: "number" }],
  Progression: [{ key: "xpBase", label: "XP required at level 1", type: "number" }, { key: "multiplier", label: "Per-level multiplier", type: "number" }, { key: "maxLevel", label: "Level cap", type: "number" }, { key: "xpPerAction", label: "XP per action", type: "number" }],
};

const number = (values: Values, name: string) => Number(values[name]);
const quote = (value: string) => `"${value.replace(/[^a-zA-Z0-9_ -]/g, "")}"`;

function generate(type: SystemType, v: Values) {
  switch (type) {
    case "Currency": return `-- ServerScriptService / CurrencyService (ModuleScript)
-- Keep all balance changes on the server. Persist profile data with DataStoreService.
local CurrencyService = {}
local Players = game:GetService("Players")
local CURRENCY_NAME = ${quote(v.currencyName)}
local STARTING_BALANCE = ${number(v, "start")}
local MAX_BALANCE = ${number(v, "max")}
local REWARD_AMOUNT = ${number(v, "reward")}
local balances = {}

function CurrencyService.Initialize(player)
    balances[player.UserId] = STARTING_BALANCE
end

function CurrencyService.Get(player)
    return balances[player.UserId] or STARTING_BALANCE
end

function CurrencyService.Add(player, amount)
    if type(amount) ~= "number" or amount <= 0 or amount % 1 ~= 0 then return false end
    local current = CurrencyService.Get(player)
    balances[player.UserId] = math.min(MAX_BALANCE, current + amount)
    return true
end

function CurrencyService.GrantActionReward(player)
    return CurrencyService.Add(player, REWARD_AMOUNT)
end

function CurrencyService.Remove(player, amount)
    if type(amount) ~= "number" or amount <= 0 or amount % 1 ~= 0 then return false end
    local current = CurrencyService.Get(player)
    if current < amount then return false end
    balances[player.UserId] = current - amount
    return true
end

function CurrencyService.Clear(player)
    balances[player.UserId] = nil
end

Players.PlayerAdded:Connect(CurrencyService.Initialize)
Players.PlayerRemoving:Connect(CurrencyService.Clear)
for _, player in Players:GetPlayers() do CurrencyService.Initialize(player) end

-- Persist balances through your server profile / DataStore service before shipping.
return CurrencyService`;
    case "Shop": return `-- ServerScriptService / Shop.server.lua
-- Create a RemoteEvent named PurchaseItem in ReplicatedStorage.
-- Purchases charge ${quote(v.currencyName)} through your server-side CurrencyService.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")
local CurrencyService = require(script.Parent:WaitForChild("CurrencyService"))
local InventoryService = require(script.Parent:WaitForChild("InventoryService"))
local purchaseEvent = ReplicatedStorage:WaitForChild("PurchaseItem")
local REQUEST_COOLDOWN = ${number(v, "cooldown")}
local CATALOG = {
    [${quote(v.itemName)}] = { price = ${number(v, "itemCost")} },
}
local lastRequest = {}

purchaseEvent.OnServerEvent:Connect(function(player, itemId)
    if type(itemId) ~= "string" then return end
    local now = os.clock()
    if now - (lastRequest[player] or 0) < REQUEST_COOLDOWN then return end
    lastRequest[player] = now
    local item = CATALOG[itemId]
    if not item then return end
    if CurrencyService.Get(player) < item.price then return end
    if not InventoryService.Add(player, itemId, 1) then return end
    if not CurrencyService.Remove(player, item.price) then
        InventoryService.Remove(player, itemId, 1)
        return
    end
end)

Players.PlayerRemoving:Connect(function(player) lastRequest[player] = nil end)`;
    case "Inventory": return `-- ServerScriptService / InventoryService (ModuleScript)
local InventoryService = {}
local Players = game:GetService("Players")
local MAX_SLOTS = ${number(v, "maxSlots")}
local MAX_STACK = ${number(v, "maxStack")}
local inventories = {}

function InventoryService.Initialize(player)
    inventories[player.UserId] = {}
end

function InventoryService.Add(player, itemId, amount)
    if type(itemId) ~= "string" or itemId == "" then return false end
    if type(amount) ~= "number" or amount <= 0 or amount % 1 ~= 0 then return false end
    local items = inventories[player.UserId]
    if not items then return false end
    local usedSlots = 0
    for _ in pairs(items) do usedSlots += 1 end
    if not items[itemId] and usedSlots >= MAX_SLOTS then return false end
    if (items[itemId] or 0) + amount > MAX_STACK then return false end
    items[itemId] = (items[itemId] or 0) + amount
    return true
end

function InventoryService.Remove(player, itemId, amount)
    local items = inventories[player.UserId]
    local count = items and items[itemId] or 0
    if type(amount) ~= "number" or amount <= 0 or count < amount then return false end
    items[itemId] = count - amount
    if items[itemId] == 0 then items[itemId] = nil end
    return true
end

function InventoryService.Get(player)
    local items = inventories[player.UserId] or {}
    return table.clone(items)
end

function InventoryService.Clear(player)
    inventories[player.UserId] = nil
end

Players.PlayerAdded:Connect(InventoryService.Initialize)
Players.PlayerRemoving:Connect(InventoryService.Clear)
for _, player in Players:GetPlayers() do InventoryService.Initialize(player) end

-- Example item ID: ${v.itemName}
return InventoryService`;
    case "Loot rarity": return `-- ServerScriptService / LootTable (ModuleScript)
-- Weights are relative chances; the combined weight is ${Object.values(v).reduce((sum, item) => sum + Number(item), 0)}.
local LootTable = {}
local RARITIES = {
    { name = "Common", weight = ${number(v, "common")} },
    { name = "Uncommon", weight = ${number(v, "uncommon")} },
    { name = "Rare", weight = ${number(v, "rare")} },
    { name = "Epic", weight = ${number(v, "epic")} },
    { name = "Legendary", weight = ${number(v, "legendary")} },
}

function LootTable.Roll(randomObject)
    local rng = randomObject or Random.new()
    local total = 0
    for _, rarity in ipairs(RARITIES) do total += rarity.weight end
    if total <= 0 then return nil end
    local roll = rng:NextNumber(0, total)
    local cursor = 0
    for _, rarity in ipairs(RARITIES) do
        cursor += rarity.weight
        if roll <= cursor then return rarity.name end
    end
    return RARITIES[#RARITIES].name
end

return LootTable`;
    case "Daily rewards": {
      const count = Math.max(1, Math.min(30, Math.floor(number(v, "days"))));
      const rewards = Array.from({ length: count }, (_, index) => `    ${number(v, "firstReward") + index * number(v, "increment")},`).join("\n");
      return `-- ServerScriptService / DailyRewards (ModuleScript)
-- Store each player's last claim timestamp and streak in their server profile.
local DailyRewards = {}
local CLAIM_INTERVAL = ${number(v, "cooldown")} * 60 * 60
local REWARDS = {
${rewards}
}

function DailyRewards.GetRewards()
    return table.clone(REWARDS)
end

function DailyRewards.TryClaim(profile, now)
    now = now or os.time()
    local lastClaim = profile.lastDailyClaim or 0
    if now - lastClaim < CLAIM_INTERVAL then
        return false, CLAIM_INTERVAL - (now - lastClaim)
    end
    local streak = profile.dailyStreak or 0
    if lastClaim > 0 and now - lastClaim > CLAIM_INTERVAL * 2 then streak = 0 end
    local day = (streak % #REWARDS) + 1
    profile.lastDailyClaim = now
    profile.dailyStreak = streak + 1
    return true, REWARDS[day], day
end

return DailyRewards`;
    }
    case "Chest & cooldown": return `-- Script inside a chest model with a ProximityPrompt
-- Replace grantReward with your server-owned currency / inventory service.
local Players = game:GetService("Players")
local chest = script.Parent
local prompt = chest:WaitForChild("ProximityPrompt")
local CHEST_ID = ${quote(v.chestName)}
local REWARD = ${number(v, "reward")}
local COOLDOWN = ${number(v, "cooldown")}
local MAX_DISTANCE = ${number(v, "maxDistance")}
local claimedAt = {}
prompt.MaxActivationDistance = MAX_DISTANCE

local function grantReward(player, amount)
    -- Example: require(game.ServerScriptService.CurrencyService).Add(player, amount)
    print(("Grant %d reward to %s from %s"):format(amount, player.Name, CHEST_ID))
end

prompt.Triggered:Connect(function(player)
    local now = os.time()
    if now - (claimedAt[player.UserId] or 0) < COOLDOWN then return end
    claimedAt[player.UserId] = now
    grantReward(player, REWARD)
end)

Players.PlayerRemoving:Connect(function(player)
    claimedAt[player.UserId] = nil
end)`;
    case "Progression": return `-- ServerScriptService / ProgressionService (ModuleScript)
local ProgressionService = {}
local Players = game:GetService("Players")
local BASE_XP = ${number(v, "xpBase")}
local LEVEL_MULTIPLIER = ${number(v, "multiplier")}
local MAX_LEVEL = ${number(v, "maxLevel")}
local ACTION_XP = ${number(v, "xpPerAction")}
local profiles = {}

function ProgressionService.Initialize(player)
    profiles[player.UserId] = { level = 1, xp = 0 }
end

function ProgressionService.XPForNextLevel(level)
    return math.floor(BASE_XP * (LEVEL_MULTIPLIER ^ (level - 1)))
end

function ProgressionService.AddXP(player, amount)
    local profile = profiles[player.UserId]
    if not profile or type(amount) ~= "number" or amount <= 0 then return false end
    profile.xp += math.floor(amount)
    while profile.level < MAX_LEVEL and profile.xp >= ProgressionService.XPForNextLevel(profile.level) do
        profile.xp -= ProgressionService.XPForNextLevel(profile.level)
        profile.level += 1
    end
    if profile.level >= MAX_LEVEL then profile.xp = 0 end
    return true, profile.level, profile.xp
end

function ProgressionService.Get(player)
    local profile = profiles[player.UserId]
    return profile and table.clone(profile) or nil
end

function ProgressionService.GrantActionXP(player)
    return ProgressionService.AddXP(player, ACTION_XP)
end

function ProgressionService.Clear(player)
    profiles[player.UserId] = nil
end

Players.PlayerAdded:Connect(ProgressionService.Initialize)
Players.PlayerRemoving:Connect(ProgressionService.Clear)
for _, player in Players:GetPlayers() do ProgressionService.Initialize(player) end

-- Persist profiles through your server profile / DataStore service before shipping.
return ProgressionService`;
  }
}

export function Generator({ onToast, t, theme }: { onToast: (message: string, type?: "error") => void; t: Translator; theme: "dark" | "light" }) {
  const [selected, setSelected] = useState<SystemType>("Currency");
  const [valuesBySystem, setValuesBySystem] = useState(initialValues);
  const [code, setCode] = useState(generate("Currency", initialValues.Currency));
  const values = valuesBySystem[selected];
  const valid = useMemo(() => {
    const numericFields = fieldInfo[selected].filter(field => field.type === "number");
    const numericValuesValid = numericFields.every(field => {
      const value = Number(values[field.key]);
      if (!Number.isFinite(value)) return false;
      if (selected === "Loot rarity") return value >= 0 && Number.isInteger(value);
      if (field.key === "start") return value >= 0 && Number.isInteger(value);
      if (field.key === "multiplier" || field.key === "cooldown") return value > 0;
      return value > 0 && Number.isInteger(value);
    });
    const weightTotal = ["common", "uncommon", "rare", "epic", "legendary"].reduce((total, key) => total + Number(values[key]), 0);
    const streakLength = Number(values.days);
    const currencyBoundsValid = selected !== "Currency" || number(values, "start") <= number(values, "max");
    return numericValuesValid && currencyBoundsValid && (selected !== "Loot rarity" || weightTotal > 0) && (selected !== "Daily rewards" || streakLength <= 30);
  }, [selected, values]);
  const update = (key: string, value: string) => {
    const updated = { ...values, [key]: value };
    setValuesBySystem({ ...valuesBySystem, [selected]: updated });
    setCode(generate(selected, updated));
  };
  const selectSystem = (name: SystemType) => {
    setSelected(name);
    setCode(generate(name, valuesBySystem[name]));
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); onToast(t("Generated Luau copied to clipboard")); }
    catch (error) { console.error("GAMEFORGE could not access the clipboard.", error); onToast(t("Clipboard access failed. Check browser permissions."), "error"); }
  };
  return <div className="page-content generator-page">
    <div className="module-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> {t("CONFIGURE. GENERATE. SHIP.")}</div><h1>{t("System")} <span>{t("Generator")}</span></h1><p>{t("Configure a game system. Get a real, editable Luau starting point.")}</p></div><div className="generator-live"><span className="status-pulse" /> {t("LIVE PREVIEW")}</div></div>
    <div className="generator-layout">
      <aside className="generator-sidebar"><div className="generator-side-label">{t("SYSTEM BLUEPRINTS")} <span>07</span></div>{systemTabs.map(tab => <button key={tab.name} onClick={() => selectSystem(tab.name)} className={`generator-tab ${selected === tab.name ? "generator-tab-active" : ""}`}><span className="generator-tab-icon">{tab.icon}</span><span><b>{t(tab.name)}</b><small>{t(tab.caption)}</small></span><span className="generator-tab-arrow">↗</span></button>)}<div className="generator-tip"><Sparkles size={14} /><b>{t("Made for real games")}</b><p>{t("Generated code runs on the server. Review and adapt it to your project before shipping.")}</p></div></aside>
      <section className="generator-main"><div className="generator-config"><div className="config-heading"><div><div className="eyebrow">01 / {t("CONFIGURATION")}</div><h2>{t(selected)}</h2><p>{t("Set your parameters below. The preview updates as you type.")}</p></div><button className="reset-config" onClick={() => { const fresh = initialValues[selected]; setValuesBySystem({ ...valuesBySystem, [selected]: fresh }); setCode(generate(selected, fresh)); }}><RefreshCw size={13} /> {t("Reset")}</button></div><div className="config-fields">{fieldInfo[selected].map(field => <Field key={field.key} label={t(field.label)} type={field.type ?? "text"} min={field.type === "number" ? "0" : undefined} step={field.key === "multiplier" || field.key === "cooldown" ? "0.1" : "1"} value={values[field.key]} onChange={event => update(field.key, event.target.value)} />)}</div>{selected === "Loot rarity" && <div className="rarity-preview">{fieldInfo[selected].map((field, index) => { const total = Object.values(values).reduce((sum, weight) => sum + Number(weight), 0); return <div key={field.key} style={{ width: `${total ? Number(values[field.key]) / total * 100 : 0}%` }} className={`rarity-segment rarity-${index}`} title={`${t(field.label)}: ${values[field.key]}`} />; })}</div>}<div className="config-footer"><span className={valid ? "" : "config-invalid"}><span className="status-pulse" /> {t(valid ? "VALUES VALIDATED" : "CHECK CONFIGURATION")}</span><span>{Object.keys(values).length} {t("PARAMETERS")}</span></div><div className="generator-references"><strong>{t("Official references")}</strong>{officialReferences[selected].map(reference => <a key={reference.url} href={reference.url} target="_blank" rel="noreferrer"><ExternalLink size={12} />{t(reference.label)}</a>)}</div></div>
        <div className="code-preview"><div className="code-preview-header"><div className="code-preview-title"><div className="eyebrow">02 / {t("GENERATED OUTPUT")}</div><div className="code-preview-file"><FileCode2 size={15} /><strong>{selected.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-$/, "")}</strong><span>.luau</span></div></div><div className="code-preview-actions"><Button variant="secondary" disabled={!valid} onClick={() => void copy()}><Copy size={14} /> {t("Copy")}</Button><Button disabled={!valid} onClick={() => downloadText(`${selected.toLowerCase().replace(/[^a-z]+/g, "-")}.luau`, code)}><Download size={14} /> {t("Export .luau")}</Button></div></div><div className="generator-editor"><Editor height="100%" language="lua" theme={theme === "light" ? "vs" : "vs-dark"} value={code} onChange={value => setCode(value ?? "")} options={{ fontSize: 12, fontFamily: "'DM Mono', monospace", minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 16 }, lineNumbersMinChars: 3, wordWrap: "on", tabSize: 4 }} /></div><div className="generator-code-footer"><span><Braces size={13} /> {t("Editable Luau output")}</span><span>{code.split("\n").length} {t("lines")}</span></div></div>
        {!valid && <div className="generator-warning">{t("Check numeric values: amounts must be valid whole numbers, rarity weights may be zero but need a non-zero total, and daily streaks are limited to 30 days.")}</div>}
      </section>
    </div>
  </div>;
}
