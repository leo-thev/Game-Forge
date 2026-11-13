local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")

local toolbar = plugin:CreateToolbar("GAMEFORGE")
local openButton = toolbar:CreateButton("Project Explorer", "Import this game's hierarchy into GAMEFORGE", "")
openButton.ClickableWhenViewportHidden = true

local widgetInfo = DockWidgetPluginGuiInfo.new(
	Enum.InitialDockState.Right,
	false,
	false,
	390,
	500,
	320,
	300
)
local widget = plugin:CreateDockWidgetPluginGui("GameForgeProjectExplorer", widgetInfo)
widget.Title = "GAMEFORGE Project Explorer"

local function makeLabel(parent, text, height, textSize)
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.new(1, 0, 0, height)
	label.Font = Enum.Font.SourceSans
	label.Text = text
	label.TextColor3 = Color3.fromRGB(224, 230, 242)
	label.TextSize = textSize or 14
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextWrapped = true
	label.Parent = parent
	return label
end

local content = Instance.new("ScrollingFrame")
content.Name = "Content"
content.Size = UDim2.fromScale(1, 1)
content.BackgroundColor3 = Color3.fromRGB(17, 20, 27)
content.BorderSizePixel = 0
content.ScrollBarThickness = 6
content.CanvasSize = UDim2.new()
content.AutomaticCanvasSize = Enum.AutomaticSize.Y
content.Parent = widget

local padding = Instance.new("UIPadding")
padding.PaddingTop = UDim.new(0, 14)
padding.PaddingBottom = UDim.new(0, 14)
padding.PaddingLeft = UDim.new(0, 14)
padding.PaddingRight = UDim.new(0, 14)
padding.Parent = content

local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 9)
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Parent = content

local heading = makeLabel(content, "GAMEFORGE  /  PROJECT EXPLORER", 24, 16)
heading.Font = Enum.Font.SourceSansBold
heading.LayoutOrder = 1
makeLabel(content, "Connect a project, select one or more roots in Explorer, then import only those branches. Only names, types, and paths are sent; script source is never read.", 52, 13).LayoutOrder = 2

local configBox = Instance.new("TextBox")
configBox.Name = "ConnectionConfiguration"
configBox.Size = UDim2.new(1, 0, 0, 120)
configBox.BackgroundColor3 = Color3.fromRGB(9, 12, 17)
configBox.BorderColor3 = Color3.fromRGB(55, 63, 78)
configBox.ClearTextOnFocus = false
configBox.Font = Enum.Font.Code
configBox.MultiLine = true
configBox.PlaceholderText = "Paste the connection configuration copied from GAMEFORGE"
configBox.Text = ""
configBox.TextColor3 = Color3.fromRGB(218, 225, 238)
configBox.TextSize = 12
configBox.TextWrapped = false
configBox.TextXAlignment = Enum.TextXAlignment.Left
configBox.TextYAlignment = Enum.TextYAlignment.Top
configBox.LayoutOrder = 3
configBox.Parent = content

local function makeButton(text, order)
	local button = Instance.new("TextButton")
	button.Size = UDim2.new(1, 0, 0, 34)
	button.BackgroundColor3 = Color3.fromRGB(52, 83, 190)
	button.BorderSizePixel = 0
	button.Font = Enum.Font.SourceSansSemibold
	button.Text = text
	button.TextColor3 = Color3.fromRGB(255, 255, 255)
	button.TextSize = 14
	button.LayoutOrder = order
	button.Parent = content
	return button
end

local connectButton = makeButton("Connect", 4)
connectButton.BackgroundColor3 = Color3.fromRGB(39, 49, 73)
local importButton = makeButton("Import selected branch(es)", 5)

local status = makeLabel(content, "Not connected.", 42, 13)
status.LayoutOrder = 6
status.TextColor3 = Color3.fromRGB(160, 174, 202)

local function validConfig(value)
	return type(value) == "table"
		and type(value.supabaseUrl) == "string"
		and string.match(value.supabaseUrl, "^https://[%w%-]+%.supabase%.co$") ~= nil
		and type(value.anonKey) == "string"
		and #value.anonKey >= 20
		and #value.anonKey <= 512
		and type(value.studioToken) == "string"
		and string.match(value.studioToken, "^[a-f0-9]+$") ~= nil
		and #value.studioToken == 64
		and type(value.projectName) == "string"
		and #value.projectName <= 120
end

local function getSavedConfig()
	local saved = plugin:GetSetting("GameForgeConnection")
	if validConfig(saved) then
		return saved
	end
	return nil
end

local function segmentFor(instance)
	local parent = instance.Parent
	if not parent then
		error("A selected hierarchy root no longer has a parent.")
	end

	local siblings = parent:GetChildren()
	local originalOrder = {}
	for index, sibling in ipairs(siblings) do
		originalOrder[sibling] = index
	end
	table.sort(siblings, function(left, right)
		if left.Name ~= right.Name then
			return left.Name < right.Name
		end
		if left.ClassName ~= right.ClassName then
			return left.ClassName < right.ClassName
		end
		return originalOrder[left] < originalOrder[right]
	end)

	local ordinal = 0
	for _, sibling in ipairs(siblings) do
		if sibling.ClassName == instance.ClassName and sibling.Name == instance.Name then
			ordinal += 1
		end
		if sibling == instance then
			break
		end
	end

	if ordinal == 0 then
		error("Could not identify a selected hierarchy root.")
	end
	return HttpService:UrlEncode(instance.Name) .. "~" .. instance.ClassName .. "~" .. ordinal
end

local function keyFor(instance)
	if instance == game then
		return ""
	end
	local parentKey = keyFor(instance.Parent)
	local segment = segmentFor(instance)
	return parentKey == "" and segment or parentKey .. "/" .. segment
end

local function getSelectedRoots()
	local selected = Selection:Get()
	local roots = {}
	for _, candidate in ipairs(selected) do
		if candidate ~= game and candidate:IsDescendantOf(game) then
			local nested = false
			for _, other in ipairs(selected) do
				if other ~= candidate and candidate:IsDescendantOf(other) then
					nested = true
					break
				end
			end
			if not nested then
				table.insert(roots, candidate)
			end
		end
	end
	if #roots == 0 then
		error("Select one or more folders, models, or services in Studio's Explorer before importing.")
	end
	return roots
end

local function buildSnapshot(root)
	if game.PlaceId == 0 then
		error("Publish or open a place with a valid Place ID before importing.")
	end

	local rows = {}
	local rootKey = keyFor(root)
	local rootPath = root:GetFullName()
	local function add(instance, instanceKey, fullPath, depth)
		if depth > 100 then
			error("The hierarchy is deeper than the plugin can safely import.")
		end
		if #instanceKey > 1500 or #fullPath > 3000 then
			error("A hierarchy path is too long to import.")
		end
		table.insert(rows, {
			instance_key = instanceKey,
			name = instance.Name,
			class_name = instance.ClassName,
			full_path = fullPath,
		})
		if #rows > 3000 then
			error("This selected branch has more than 3,000 instances. Select a smaller folder or model inside it and import that branch separately.")
		end

		local children = instance:GetChildren()
		local originalOrder = {}
		for index, child in ipairs(children) do
			originalOrder[child] = index
		end
		table.sort(children, function(left, right)
			if left.Name == right.Name then
				if left.ClassName == right.ClassName then
					return originalOrder[left] < originalOrder[right]
				end
				return left.ClassName < right.ClassName
			end
			return left.Name < right.Name
		end)

		local duplicateCounts = {}
		for _, child in ipairs(children) do
			local duplicateKey = child.ClassName .. "\0" .. child.Name
			duplicateCounts[duplicateKey] = (duplicateCounts[duplicateKey] or 0) + 1
			local ordinal = duplicateCounts[duplicateKey]
			local segment = HttpService:UrlEncode(child.Name) .. "~" .. child.ClassName .. "~" .. ordinal
			local childKey = instanceKey .. "/" .. segment
			local childPath = fullPath .. "/" .. child.Name
			add(child, childKey, childPath, depth + 1)
		end
	end

	add(root, rootKey, rootPath, 0)
	return rows, rootKey
end

connectButton.Activated:Connect(function()
	local ok, decoded = pcall(function()
		return HttpService:JSONDecode(configBox.Text)
	end)
	if not ok or not validConfig(decoded) then
		status.Text = "Invalid configuration. Copy a new one from the GAMEFORGE project."
		status.TextColor3 = Color3.fromRGB(240, 145, 145)
		return
	end

	plugin:SetSetting("GameForgeConnection", decoded)
	configBox.Text = ""
	status.Text = "Connected to " .. decoded.projectName .. ". You can now import the hierarchy."
	status.TextColor3 = Color3.fromRGB(131, 215, 177)
end)

importButton.Activated:Connect(function()
	local config = getSavedConfig()
	if not config then
		status.Text = "Connect a GAMEFORGE project first."
		status.TextColor3 = Color3.fromRGB(240, 145, 145)
		return
	end

	importButton.Active = false
	importButton.AutoButtonColor = false
	status.Text = "Reading selected branches and sending metadata..."
	status.TextColor3 = Color3.fromRGB(160, 174, 202)

	local ok, result = pcall(function()
		local roots = getSelectedRoots()
		local totalImported = 0
		for index, root in ipairs(roots) do
			status.Text = "Reading branch " .. tostring(index) .. " of " .. tostring(#roots) .. ": " .. root:GetFullName()
			local rows, scopeKey = buildSnapshot(root)
			local body = HttpService:JSONEncode({
				studio_token = config.studioToken,
				target_place_id = tostring(game.PlaceId),
				target_universe_id = tostring(game.GameId),
				target_scope_key = scopeKey,
				instance_rows = rows,
			})
			if #body > 4000000 then
				error("The selected branch is too large to send. Select a smaller folder or model inside it.")
			end
			local response = HttpService:RequestAsync({
				Url = config.supabaseUrl .. "/rest/v1/rpc/gameforge_studio_upsert_snapshot",
				Method = "POST",
				Headers = {
					["Content-Type"] = "application/json",
					["apikey"] = config.anonKey,
					["Authorization"] = "Bearer " .. config.anonKey,
				},
				Body = body,
			})
			if not response.Success then
				error("GAMEFORGE returned HTTP " .. tostring(response.StatusCode) .. " while importing " .. root:GetFullName() .. ". Check the connection and try again.")
			end
			totalImported += #rows
		end
		return totalImported
	end)

	importButton.Active = true
	importButton.AutoButtonColor = true
	if ok then
		status.Text = "Imported " .. tostring(result) .. " instances from the selected branch(es). Return to GAMEFORGE and refresh."
		status.TextColor3 = Color3.fromRGB(131, 215, 177)
	else
		status.Text = tostring(result)
		status.TextColor3 = Color3.fromRGB(240, 145, 145)
	end
end)

openButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)
