local nes_enabled = vim.env.NVIM_SIDEKUCK_NES_ENABLED or false

-- Optional allowlist: NVIM_SIDEKICK_CLIS="opencode,claude" restricts the CLIs we
-- offer to this set. It only ever narrows the list — it never adds a CLI that
-- wouldn't have shown otherwise. Empty/unset means allow all.
local allowed_clis ---@type table<string, boolean>?
if vim.env.NVIM_SIDEKICK_CLIS and vim.env.NVIM_SIDEKICK_CLIS ~= "" then
	allowed_clis = {}
	for name in vim.gsplit(vim.env.NVIM_SIDEKICK_CLIS, ",", { trimempty = true }) do
		name = vim.trim(name)
		if name ~= "" then
			allowed_clis[name] = true
		end
	end
end

-- A local (non-external) state that passes the optional allowlist
local function is_allowed_local(s)
	return not s.external and (not allowed_clis or allowed_clis[s.tool.name])
end

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
		return s.attached and is_allowed_local(s)
	end, all)
	if #running == 1 then
		dispatch(running[1])
		return
	elseif #running > 1 then
		pick(running)
		return
	end

	-- Nothing running — offer installed local tools (mirrors <leader>cc)
	local installed = vim.tbl_filter(function(s)
		return s.installed and is_allowed_local(s)
	end, all)
	if #installed == 0 then
		return
	elseif #installed == 1 then
		dispatch(installed[1])
	else
		pick(installed)
	end
end

-- Open a local CLI: directly if there's only one installed, via picker otherwise.
-- Excludes externals, not-installed, and anything outside the allowlist.
local function open_cli()
	local State = require("sidekick.cli.state")
	local sk_select = require("sidekick.cli.ui.select")
	local states = vim.tbl_filter(function(s)
		return s.installed and is_allowed_local(s)
	end, State.get())
	if #states == 0 then
		return
	end
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
end

-- Cycle focus through the open (attached, in-process) CLIs and back to the buffer.
-- Never starts a new CLI; if none are open, falls back to the open_cli picker.
local function cycle_clis()
	local State = require("sidekick.cli.state")
	local clis = vim.tbl_filter(function(s)
		return s.attached and not s.external and s.terminal
	end, State.get())
	if #clis == 0 then
		open_cli()
		return
	end
	-- stable order so cycling is deterministic across calls
	table.sort(clis, function(a, b)
		return a.session.id < b.session.id
	end)

	local current ---@type integer?
	for i, s in ipairs(clis) do
		if s.terminal:is_focused() then
			current = i
			break
		end
	end

	if not current then
		clis[1].terminal:focus() -- from a buffer: jump to the first CLI
	elseif current < #clis then
		clis[current + 1].terminal:focus() -- next CLI
	else
		-- past the last CLI: return to the editor. blur()'s wincmd-p would land on
		-- the previous CLI when cycling through several, so target an editor window.
		local editor ---@type integer?
		for _, w in ipairs(vim.api.nvim_list_wins()) do
			if not vim.w[w].sidekick_session_id and vim.api.nvim_win_get_config(w).relative == "" then
				editor = w
				break
			end
		end
		if editor then
			vim.api.nvim_set_current_win(editor)
			vim.cmd.stopinsert()
		else
			clis[current].terminal:blur()
		end
	end
end

-- Dynamically generate key mappings for each CLI
local keys = {
	{
		"<c-\\>",
		function()
			cycle_clis()
		end,
		mode = { "n", "x", "i", "t" },
		desc = "Sidekick Cycle CLIs",
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

-- <leader>cc opens a local CLI: directly if there's one, via picker if there are several
table.insert(keys, {
	"<leader>cc",
	function()
		open_cli()
	end,
	desc = "Sidekick Open CLI",
})

-- send this to a local cli
table.insert(keys, {
	"<leader>ct",
	function()
		send_local("{this}")
	end,
	desc = "Sidekick Send This to CLI",
	mode = { "x", "n" },
})

-- send file to a local cli
table.insert(keys, {
	"<leader>cf",
	function()
		send_local("{file}")
	end,
	desc = "Sidekick Send File to CLI",
})

-- send selection to a local cli
table.insert(keys, {
	"<leader>cv",
	function()
		send_local("{selection}")
	end,
	desc = "Sidekick Send Selection to CLI",
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
