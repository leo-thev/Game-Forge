export type ScriptTemplate = { name: string; category: string; description: string; code: string };

export const templates: ScriptTemplate[] = [
  {
    name: "DataStore system",
    category: "Data",
    description: "Server-side player data with retries, autosaving and orderly shutdown.",
    code: `-- ServerScriptService / PlayerData.server.lua
-- Enable Studio Access to API Services to test DataStores in Studio.
local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local Store = DataStoreService:GetDataStore("PlayerData_v1")
local DEFAULT = { Coins = 0, Level = 1 }
local loaded = {}
local saving = {}

local function save(player)
    local data = loaded[player]
    if not data or saving[player] then return false end
    saving[player] = true
    local lastError
    for attempt = 1, 3 do
        local ok, err = pcall(function()
            Store:UpdateAsync("player_" .. player.UserId, function()
                return data
            end)
        end)
        if ok then saving[player] = nil; return true end
        lastError = err
        if attempt < 3 then task.wait(attempt) end
    end
    saving[player] = nil
    warn("Save failed for " .. player.Name .. " after 3 attempts: " .. tostring(lastError))
    return false
end

local function load(player)
    local data, lastError
    for attempt = 1, 3 do
        local ok, result = pcall(function()
            return Store:GetAsync("player_" .. player.UserId)
        end)
        if ok then data = result; break end
        lastError = result
        if attempt < 3 then task.wait(attempt) end
    end
    if lastError and data == nil then
        warn("Load failed for " .. player.Name .. " after 3 attempts: " .. tostring(lastError))
        return -- Never save defaults over data that could not be loaded.
    end
    if player.Parent ~= Players then return end
    loaded[player] = if type(data) == "table" then data else table.clone(DEFAULT)
end

Players.PlayerAdded:Connect(load)
for _, player in Players:GetPlayers() do task.spawn(load, player) end

Players.PlayerRemoving:Connect(function(player)
    save(player)
    loaded[player] = nil
    saving[player] = nil
end)

task.spawn(function()
    while task.wait(60) do
        for player in pairs(loaded) do save(player) end
    end
end)

game:BindToClose(function()
    for player in pairs(loaded) do save(player) end
end)

-- Access loaded[player] only from server scripts; never trust client-sent balances.`,
  },
  {
    name: "Inventory system",
    category: "Gameplay",
    description: "Server-owned inventory module with safe add, remove and query operations.",
    code: `-- ServerScriptService / Inventory (ModuleScript)
    local Players = game:GetService("Players")
    local Inventory = {}
local contents = {}
local MAX_STACK = 99

function Inventory.Init(player)
    contents[player.UserId] = {}
end

function Inventory.Add(player, itemId, amount)
    if type(itemId) ~= "string" or itemId == "" then return false, "Invalid item ID" end
    if type(amount) ~= "number" or amount <= 0 or amount % 1 ~= 0 then return false, "Amount must be a positive integer" end
    local items = contents[player.UserId]
    if not items then return false, "Inventory is not initialized" end
    if (items[itemId] or 0) + amount > MAX_STACK then return false end
    items[itemId] = (items[itemId] or 0) + amount
    return true
end

function Inventory.Remove(player, itemId, amount)
    if type(amount) ~= "number" or amount <= 0 or amount % 1 ~= 0 then return false end
    local items = contents[player.UserId]
    local count = items and items[itemId] or 0
    if count < amount then return false end
    items[itemId] = count - amount
    if items[itemId] == 0 then items[itemId] = nil end
    return true
end

function Inventory.Get(player)
    return table.clone(contents[player.UserId] or {})
end

function Inventory.Clear(player)
    contents[player.UserId] = nil
end

Players.PlayerAdded:Connect(Inventory.Init)
Players.PlayerRemoving:Connect(Inventory.Clear)
for _, player in Players:GetPlayers() do Inventory.Init(player) end

return Inventory`,
  },
  {
    name: "Shop system",
    category: "Gameplay",
    description: "Server-validated purchase handler; clients request item IDs, never prices.",
    code: `-- ServerScriptService / Shop.server.lua
    -- Add Tool templates named SpeedBoost and HealthPotion to ServerStorage.
    -- Create a RemoteEvent named PurchaseItem in ReplicatedStorage.
    local ReplicatedStorage = game:GetService("ReplicatedStorage")
    local ServerStorage = game:GetService("ServerStorage")
    local Players = game:GetService("Players")
    local CurrencyService = require(script.Parent:WaitForChild("CurrencyService"))
    local purchaseEvent = ReplicatedStorage:WaitForChild("PurchaseItem")
    local catalog = {
        SpeedBoost = { price = 100, toolName = "SpeedBoost" },
        HealthPotion = { price = 25, toolName = "HealthPotion" },
    }
local cooldowns = {}

purchaseEvent.OnServerEvent:Connect(function(player, itemId)
    if type(itemId) ~= "string" then return end
    local now = os.clock()
    if now - (cooldowns[player] or 0) < 0.4 then return end
    cooldowns[player] = now
    local item = catalog[itemId]
    if not item then return end
    local tool = ServerStorage:FindFirstChild(item.toolName)
    local backpack = player:FindFirstChildOfClass("Backpack")
    if not tool or not tool:IsA("Tool") or not backpack then return end
    if not CurrencyService.Spend(player, item.price) then return end
    tool:Clone().Parent = backpack
end)

Players.PlayerRemoving:Connect(function(player) cooldowns[player] = nil end)`,
  },
  {
    name: "Currency system",
    category: "Data",
    description: "Server-created leaderstats and a server-only reward helper.",
    code: `-- ServerScriptService / CurrencyService (ModuleScript)
local Players = game:GetService("Players")
local Currency = {}
    local CURRENCY_NAME = "Coins"
    local STARTING_BALANCE = 0
    local MAX_BALANCE = 1000000

    local function getCoins(player)
        local stats = player:FindFirstChild("leaderstats")
        return stats and stats:FindFirstChild(CURRENCY_NAME)
end

function Currency.Initialize(player)
    if player:FindFirstChild("leaderstats") then return end
    local stats = Instance.new("Folder")
    stats.Name = "leaderstats"
    stats.Parent = player
    local coins = Instance.new("IntValue")
    coins.Name = "Coins"
    coins.Value = STARTING_BALANCE
    coins.Parent = stats
end

function Currency.Get(player)
    local coins = getCoins(player)
    return coins and coins.Value or nil
end

function Currency.Add(player, amount)
    if type(amount) ~= "number" or amount <= 0 or amount % 1 ~= 0 then return false end
    local coins = getCoins(player)
    if not coins then return false end
    if coins.Value >= MAX_BALANCE then return false end
    coins.Value = math.min(MAX_BALANCE, coins.Value + amount)
    return true
end

function Currency.Spend(player, amount)
    if type(amount) ~= "number" or amount <= 0 or amount % 1 ~= 0 then return false end
    local coins = getCoins(player)
    if not coins or coins.Value < amount then return false end
    coins.Value -= amount
    return true
end

Players.PlayerAdded:Connect(Currency.Initialize)
for _, player in Players:GetPlayers() do Currency.Initialize(player) end

-- Require this module from trusted server scripts; persist balances with your data profile.
return Currency`,
  },
  {
    name: "Quest system",
    category: "Gameplay",
    description: "Server-side quest progress with validated objectives and one-time rewards.",
    code: `-- ServerScriptService / QuestService (ModuleScript)
    local Players = game:GetService("Players")
    local QuestService = {}
local definitions = {
    FirstSteps = { goal = 5, reward = 50 },
}
local progress = {}

function QuestService.Start(player, questId)
    if not definitions[questId] then return false end
    progress[player.UserId] = progress[player.UserId] or {}
    if progress[player.UserId][questId] then return false end
    progress[player.UserId][questId] = { count = 0, claimed = false }
    return true
end

function QuestService.Advance(player, questId, amount)
    local definition = definitions[questId]
    local playerQuests = progress[player.UserId]
    local quest = playerQuests and playerQuests[questId]
    if not definition or not quest or quest.claimed then return false end
    if type(amount) ~= "number" or amount <= 0 or amount % 1 ~= 0 then return false end
    quest.count = math.min(definition.goal, quest.count + math.floor(amount))
    if quest.count == definition.goal then
        quest.claimed = true
        -- Grant reward through your trusted server-side currency service.
        return true, definition.reward
    end
    return true, 0
end

Players.PlayerRemoving:Connect(function(player)
    progress[player.UserId] = nil
end)

return QuestService`,
  },
  {
    name: "Round system",
    category: "Gameplay",
    description: "Small server round loop with intermission and player-count checks.",
    code: `-- ServerScriptService / Rounds.server.lua
local Players = game:GetService("Players")
local INTERMISSION = 15
local ROUND_LENGTH = 120

local function waitForPlayers()
    while #Players:GetPlayers() < 2 do
        print("Waiting for at least 2 players...")
        task.wait(2)
    end
end

while true do
    waitForPlayers()
    for seconds = INTERMISSION, 1, -1 do
        print("Round starts in " .. seconds)
        task.wait(1)
    end
    print("Round started")
    for seconds = ROUND_LENGTH, 1, -1 do
        if #Players:GetPlayers() < 2 then break end
        task.wait(1)
    end
    print("Round ended")
    task.wait(5)
end`,
  },
  {
    name: "Player movement",
    category: "Character",
    description: "Server-side sprint request with type checks, bounds and cooldown.",
    code: `-- ServerScriptService / Sprint.server.lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")
    -- Create a RemoteEvent named SprintRequest in ReplicatedStorage.
    local sprintEvent = ReplicatedStorage:WaitForChild("SprintRequest")
local WALK_SPEED = 16
local SPRINT_SPEED = 24
local lastRequest = {}

sprintEvent.OnServerEvent:Connect(function(player, sprinting)
    if type(sprinting) ~= "boolean" then return end
    local now = os.clock()
    if now - (lastRequest[player] or 0) < 0.1 then return end
    lastRequest[player] = now
    local character = player.Character
    local humanoid = character and character:FindFirstChildOfClass("Humanoid")
    if humanoid then humanoid.WalkSpeed = sprinting and SPRINT_SPEED or WALK_SPEED end
end)

Players.PlayerRemoving:Connect(function(player) lastRequest[player] = nil end)
-- StarterPlayerScripts / Sprint.client.lua
local UserInputService = game:GetService("UserInputService")
local sprintRequest = game:GetService("ReplicatedStorage"):WaitForChild("SprintRequest")

UserInputService.InputBegan:Connect(function(input, processed)
    if not processed and input.KeyCode == Enum.KeyCode.LeftShift then
        sprintRequest:FireServer(true)
    end
end)

UserInputService.InputEnded:Connect(function(input)
    if input.KeyCode == Enum.KeyCode.LeftShift then
        sprintRequest:FireServer(false)
    end
end)
-- Place the first section in ServerScriptService and the second in StarterPlayerScripts.`,
  },
  {
    name: "Combat system",
    category: "Gameplay",
    description: "Server-validated tool hit with range, cooldown and alive checks.",
    code: `-- ServerScriptService / Combat.server.lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")
local attackEvent = ReplicatedStorage:WaitForChild("AttackRequest")
local RANGE, DAMAGE, COOLDOWN = 8, 20, 0.8
local lastAttack = {}

attackEvent.OnServerEvent:Connect(function(player, targetModel)
    if typeof(targetModel) ~= "Instance" or not targetModel:IsA("Model") then return end
    local now = os.clock()
    if now - (lastAttack[player] or 0) < COOLDOWN then return end
    local attacker = player.Character
    if targetModel == attacker then return end
    local targetHumanoid = targetModel:FindFirstChildOfClass("Humanoid")
    local attackerRoot = attacker and attacker:FindFirstChild("HumanoidRootPart")
    local targetRoot = targetModel:FindFirstChild("HumanoidRootPart")
    if not attackerRoot or not targetRoot or not targetHumanoid or targetHumanoid.Health <= 0 then return end
    if (attackerRoot.Position - targetRoot.Position).Magnitude > RANGE then return end
    lastAttack[player] = now
    targetHumanoid:TakeDamage(DAMAGE)
end)

Players.PlayerRemoving:Connect(function(player) lastAttack[player] = nil end)
-- Add teams, line-of-sight and weapon ownership checks for your game rules.`,
  },
  {
    name: "NPC dialogue",
    category: "Gameplay",
    description: "ProximityPrompt dialogue with explicit server-owned dialogue entries.",
    code: `-- Script inside an NPC model, containing a ProximityPrompt
    -- Server creates the RemoteEvent; add the LocalScript section to StarterPlayerScripts.
    local ReplicatedStorage = game:GetService("ReplicatedStorage")
    local prompt = script.Parent:WaitForChild("ProximityPrompt")
    local dialogueEvent = ReplicatedStorage:FindFirstChild("ShowNPCDialogue")
    if not dialogueEvent then
        dialogueEvent = Instance.new("RemoteEvent")
        dialogueEvent.Name = "ShowNPCDialogue"
        dialogueEvent.Parent = ReplicatedStorage
    end
    local dialogue = {
        "Welcome, traveler.",
        "The bridge is closed after sunset.",
    }

    prompt.Triggered:Connect(function(player)
        dialogueEvent:FireClient(player, dialogue)
    end)

    -- LocalScript / StarterPlayerScripts / Dialogue.client.lua
    local ReplicatedStorage = game:GetService("ReplicatedStorage")
    local Players = game:GetService("Players")
    local event = ReplicatedStorage:WaitForChild("ShowNPCDialogue")
    local gui = Instance.new("ScreenGui")
    gui.Name = "NPCDialogue"
    gui.ResetOnSpawn = false
    gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")
    local label = Instance.new("TextLabel")
    label.AnchorPoint = Vector2.new(0.5, 1)
    label.Position = UDim2.fromScale(0.5, 0.9)
    label.Size = UDim2.fromScale(0.72, 0.11)
    label.BackgroundColor3 = Color3.fromRGB(17, 20, 29)
    label.BackgroundTransparency = 0.08
    label.TextColor3 = Color3.fromRGB(240, 242, 249)
    label.TextSize = 20
    label.Font = Enum.Font.GothamMedium
    label.TextWrapped = true
    label.Visible = false
    label.Parent = gui
    local sequence = 0

    event.OnClientEvent:Connect(function(lines)
        if type(lines) ~= "table" then return end
        sequence += 1
        local current = sequence
        label.Visible = true
        for _, line in ipairs(lines) do
            if current ~= sequence then return end
            if type(line) ~= "string" then continue end
            label.Text = line
            task.wait(2.5)
        end
        if current == sequence then label.Visible = false end
    end)`,
  },
  {
    name: "Save / load system",
    category: "Data",
    description: "Reusable DataStore helper with protected calls and key validation.",
    code: `-- ServerScriptService / SaveService (ModuleScript)
local DataStoreService = game:GetService("DataStoreService")
local Store = DataStoreService:GetDataStore("GameSaves_v1")
local SaveService = {}

local function keyFor(userId)
    assert(type(userId) == "number" and userId > 0, "valid userId required")
    return "user_" .. userId
end

function SaveService.Load(userId)
    local ok, result = pcall(function()
        return Store:GetAsync(keyFor(userId))
    end)
    if not ok then return nil, tostring(result) end
    return result
end

function SaveService.Save(userId, data)
    assert(type(data) == "table", "data must be a table")
    local ok, result = pcall(function()
        return Store:UpdateAsync(keyFor(userId), function()
            return data
        end)
    end)
    if not ok then return false, tostring(result) end
    return true
end

return SaveService`,
  },
];
