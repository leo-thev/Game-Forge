local HttpService = game:GetService("HttpService")

local toolbar = plugin:CreateToolbar("GAMEFORGE")
local openButton = toolbar:CreateButton("Project Explorer v1.1", "Import this game's hierarchy into GAMEFORGE (v1.1)", "")
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
widget.Title = "GAMEFORGE Project Explorer v1.1"

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

local heading = makeLabel(content, "GAMEFORGE  /  PROJECT EXPLORER  /  v1.1", 24, 16)
heading.Font = Enum.Font.SourceSansBold
heading.LayoutOrder = 1
makeLabel(content, "Connect a project, then import the whole place. Large hierarchies are sent in smaller batches automatically. Only names, types, and paths are sent; script source is never read.", 52, 13).LayoutOrder = 2

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
local importButton = makeButton("Import entire game", 5)

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
		error("A hierarchy root no longer has a parent.")
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

local function postSnapshotChunk(config, placeId, scopeKey, snapshotId, rows, isFinalChunk)
	local function send(rowsToSend, finalChunk)
		local seenKeys = {}
		for _, row in ipairs(rowsToSend) do
			local issue
			local nameLength = type(row.name) == "string" and utf8.len(row.name) or nil
			local pathLength = type(row.full_path) == "string" and utf8.len(row.full_path) or nil
			if type(row.instance_key) ~= "string" or #row.instance_key < 1 or #row.instance_key > 1500 then
				issue = "instance key must contain 1-1500 characters"
			elseif row.instance_key ~= scopeKey
				and string.sub(row.instance_key, 1, #scopeKey + 1) ~= scopeKey .. "/" then
				issue = "instance key is outside its hierarchy branch"
			elseif not nameLength or nameLength > 200 then
				issue = "instance name is missing or longer than 200 characters"
			elseif not pathLength or pathLength < 1 or pathLength > 3000 then
				issue = "full path must contain 1-3000 characters"
			elseif seenKeys[row.instance_key] then
				issue = "duplicate instance key"
			end
			if issue then
				local path = tostring(row.full_path or row.instance_key or "unknown")
				if #path > 180 then
					path = string.sub(path, 1, 180) .. "..."
				end
				error("Invalid hierarchy item (" .. issue .. "): " .. path)
			end
			seenKeys[row.instance_key] = true
		end

		local body = HttpService:JSONEncode({
			studio_token = config.studioToken,
			target_place_id = tostring(placeId),
			target_universe_id = tostring(game.GameId),
			target_scope_key = scopeKey,
			snapshot_id = snapshotId,
			is_final_chunk = finalChunk,
			instance_rows = rowsToSend,
		})
		if #body > 1000000 then
			if #rowsToSend <= 1 then
				error("A hierarchy item is too large to send. Please retry the import.")
			end
			local middle = math.floor(#rowsToSend / 2)
			local first = table.create(middle)
			local second = table.create(#rowsToSend - middle)
			for index = 1, middle do
				first[index] = rowsToSend[index]
			end
			for index = middle + 1, #rowsToSend do
				second[#second + 1] = rowsToSend[index]
			end
			local requests = send(first, false)
			task.wait(0.25)
			return requests + send(second, finalChunk)
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
			local responseBody = string.gsub(response.Body or "", "[\r\n]+", " ")
			if #responseBody > 400 then
				responseBody = string.sub(responseBody, 1, 400) .. "..."
			end
			error("GAMEFORGE returned HTTP " .. tostring(response.StatusCode) .. ". Supabase: " .. responseBody)
		end
		return 1
	end

	return send(rows, isFinalChunk)
end

local function importRoot(config, root, progress)
	local scopeKey = keyFor(root)
	local snapshotId = HttpService:GenerateGUID(false)
	local rows = {}
	local imported = 0
	local chunkCount = 0

	local function sendChunk(isFinalChunk)
		local sentChunks = postSnapshotChunk(config, game.PlaceId, scopeKey, snapshotId, rows, isFinalChunk)
		imported += #rows
		chunkCount += sentChunks
		table.clear(rows)
		progress(imported, chunkCount)
		if not isFinalChunk then
			task.wait(0.25)
		end
	end

	local function add(instance, instanceKey, fullPath, depth)
		if depth > 100 then
			error("A hierarchy branch is deeper than the plugin can safely import.")
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
		if #rows >= 500 then
			sendChunk(false)
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
			add(child, instanceKey .. "/" .. segment, fullPath .. "/" .. child.Name, depth + 1)
		end
	end

	add(root, scopeKey, root:GetFullName(), 0)
	sendChunk(true)
	return imported, chunkCount
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
	if game.PlaceId == 0 then
		status.Text = "Publish or open a place with a valid Place ID before importing."
		status.TextColor3 = Color3.fromRGB(240, 145, 145)
		return
	end

	importButton.Active = false
	importButton.AutoButtonColor = false
	status.Text = "Preparing the entire game hierarchy..."
	status.TextColor3 = Color3.fromRGB(160, 174, 202)

	local ok, result = pcall(function()
		local roots = game:GetChildren()
		table.sort(roots, function(left, right)
			if left.Name == right.Name then
				return left.ClassName < right.ClassName
			end
			return left.Name < right.Name
		end)
		if #roots == 0 then
			error("This place has no hierarchy branches to import.")
		end

		local totalImported = 0
		local totalChunks = 0
		for index, root in ipairs(roots) do
			status.Text = "Importing branch " .. tostring(index) .. " of " .. tostring(#roots) .. ": " .. root.Name
			local imported, chunks = importRoot(config, root, function(branchImported, branchChunks)
				status.Text = "Importing " .. root.Name .. ": " .. tostring(branchImported) .. " instances in " .. tostring(branchChunks) .. " batches."
			end)
			totalImported += imported
			totalChunks += chunks
		end
		return { instances = totalImported, chunks = totalChunks }
	end)

	importButton.Active = true
	importButton.AutoButtonColor = true
	if ok then
		status.Size = UDim2.new(1, 0, 0, 42)
		status.Text = "Imported " .. tostring(result.instances) .. " instances in " .. tostring(result.chunks) .. " batches. Return to GAMEFORGE and refresh."
		status.TextColor3 = Color3.fromRGB(131, 215, 177)
	else
		status.Size = UDim2.new(1, 0, 0, 100)
		status.Text = tostring(result)
		status.TextColor3 = Color3.fromRGB(240, 145, 145)
	end
end)

openButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)
