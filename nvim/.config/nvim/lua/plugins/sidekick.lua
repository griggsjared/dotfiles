local nes_enabled = vim.env.NVIM_SIDEKUCK_NES_ENABLED or false

-- Dynamically read up to 10 CLI env vars
local clis = {}
for i = 1, 10 do
	local cli = vim.env["NVIM_SIDEKICK_CLI_" .. i]
	if cli and cli ~= "" then
		table.insert(clis, cli)
	end
end
if #clis == 0 then
	clis[1] = "opencode" -- fallback default
end

-- the active cli will be used for CC. Any cli selected with <leader>c1..9 becomes the active one
local active_cli = clis[1]

-- Open a local session directly, skipping the picker for externally-detected sessions
local function open_local(name, opts)
	local State = require("sidekick.cli.state")
	local states = State.get({ name = name })
	for _, s in ipairs(states) do
		if not s.external then
			State.attach(s, opts or { show = true, focus = true })
			return
		end
	end
end

-- Send to a local session only, never surfacing external/tmux sessions.
-- We resolve a single target ourselves and dispatch with a session-id filter so
-- sidekick.send() never opens its own (all-sessions) picker on top of ours.
local function send_local(msg)
	local State = require("sidekick.cli.state")
	local sk_select = require("sidekick.cli.ui.select")

	-- Send to one concrete state without triggering sidekick's picker.
	-- Filtering by session id always matches exactly one attached session.
	local function dispatch(state)
		if not state then return end
		if not state.session then
			-- Not running yet: attach (start) it so we get a session to target
			state = State.attach(state, { show = true, focus = false })
		end
		require("sidekick.cli").send({ msg = msg, filter = { session = state.session.id } })
	end

	local function pick(items)
		vim.ui.select(items, {
			prompt = "Select CLI tool:",
			kind = "sidekick_cli",
			snacks = { format = sk_select.format },
			format_item = function(s)
				local parts = sk_select.format(s)
				return table.concat(vim.tbl_map(function(p) return p[1] end, parts))
			end,
		}, dispatch)
	end

	local all = State.get()

	-- Sessions actively running in this neovim instance
	local running = vim.tbl_filter(function(s)
		return s.attached and not s.external
	end, all)
	if #running == 1 then
		dispatch(running[1])
		return
	elseif #running > 1 then
		pick(running)
		return
	end

	-- Nothing running — offer installed local tools (mirrors <leader>cs)
	local installed = vim.tbl_filter(function(s)
		return s.installed and not s.external
	end, all)
	if #installed == 0 then
		return
	elseif #installed == 1 then
		dispatch(installed[1])
	else
		pick(installed)
	end
end

-- Dynamically generate key mappings for each CLI
local keys = {
	{
		"<c-\\>",
		function()
			-- If already attached to a local session, use normal focus toggle (can blur back to code)
			local State = require("sidekick.cli.state")
			local attached = vim.tbl_filter(function(s)
				return s.attached and not s.external
			end, State.get({ name = active_cli }))
			if #attached > 0 then
				require("sidekick.cli").focus({ name = active_cli })
			else
				open_local(active_cli)
			end
		end,
		mode = { "n", "x", "i", "t" },
		desc = "Sidekick Switch Focus",
	},
	{
		"<leader>cq",
		function()
			require("sidekick.cli").prompt()
		end,
		desc = "Sidekick Prompts",
		mode = { "n", "v" },
	},
}

for i, cli in ipairs(clis) do
	table.insert(keys, {
		"<leader>c" .. i,
		function()
			open_local(cli)
			-- the selected cli becomes the active one
			active_cli = cli
		end,
		desc = "Sidekick Toggle " .. cli,
		mode = { "n", "v" },
	})
end

-- <leader>cc always toggles the first CLI
table.insert(keys, {
	"<leader>cc",
	function()
		open_local(active_cli)
	end,
	desc = "Sidekick Toggle CLI " .. active_cli,
})

table.insert(keys, {
	"<leader>cs",
	function()
		local State = require("sidekick.cli.state")
		local sk_select = require("sidekick.cli.ui.select")
		-- Only show installed local sessions/tools (exclude externals and not-installed)
		local states = vim.tbl_filter(function(s)
			return s.installed and not s.external
		end, State.get())
		if #states == 0 then return end
		if #states == 1 then
			open_local(states[1].tool.name)
			return
		end
		vim.ui.select(states, {
			prompt = "Select CLI tool:",
			kind = "sidekick_cli",
			format_item = function(s)
				local parts = sk_select.format(s)
				return table.concat(vim.tbl_map(function(p) return p[1] end, parts))
			end,
			snacks = { format = sk_select.format },
		}, function(state)
			if state then open_local(state.tool.name) end
		end)
	end,
	desc = "Sidekick Show All CLIs",
})

-- send this to active cli
table.insert(keys, {
	"<leader>ct",
	function()
		send_local("{this}")
	end,
	desc = "Sidekick Send File to CLI " .. active_cli,
	mode = { "x", "n" },
})

-- send file to active cli
table.insert(keys, {
	"<leader>cf",
	function()
		send_local("{file}")
	end,
	desc = "Sidekick Send File to CLI " .. active_cli,
})

-- send selection to active cli
table.insert(keys, {
	"<leader>cv",
	function()
		send_local("{selection}")
	end,
	desc = "Send Selection to CLI " .. active_cli,
	mode = { "x" },
})

if nes_enabled then
	table.insert(keys, {
		"<tab>",
		function()
			-- if there is a next edit, jump to it, otherwise apply it if any
			if not require("sidekick").nes_jump_or_apply() then
				return "<Tab>" -- fallback to normal tab
			end
		end,
		desc = "Sidekick Toggle Next Edit",
	})
end

return {
	"folke/sidekick.nvim",
	opts = {
		nes = {
			enabled = nes_enabled,
		},
		cli = {
			prompts = {
				commit =
				"Please review the staged changes and recommend a concise git commit message. Do not create the commit, just provide the message. Follow the style most recently used in the commit history.",
			},
			tools = {
				cursor = { cmd = { "cursor-agent", "--mode", "ask" } }, -- start cursor-agent in ask mode
			}
		},
	},
	keys = keys,
}
