local nes_enabled = vim.env.NVIM_SIDEKICK_NES_ENABLED == "1"

-- Optional allowlist: NVIM_SIDEKICK_CLIS="opencode,claude" restricts the CLIs we
-- offer to this set. It only ever narrows the list — it never adds a CLI that
-- wouldn't have shown otherwise. Empty/unset means allow all.
local allowed_clis ---@type table<string, integer>?
if vim.env.NVIM_SIDEKICK_CLIS and vim.env.NVIM_SIDEKICK_CLIS ~= "" then
	allowed_clis = {}
	local rank = 0
	for name in vim.gsplit(vim.env.NVIM_SIDEKICK_CLIS, ",", { trimempty = true }) do
		name = vim.trim(name)
		if name ~= "" and not allowed_clis[name] then
			rank = rank + 1
			allowed_clis[name] = rank
		end
	end
end

-- A local (non-external) state that passes the optional allowlist
local function is_allowed_local(s)
	return not s.external and (not allowed_clis or allowed_clis[s.tool.name])
end

local function order_allowed(states)
	if not allowed_clis then
		return states
	end
	local original_order = {}
	for i, state in ipairs(states) do
		original_order[state] = i
	end
	table.sort(states, function(a, b)
		local a_rank = allowed_clis[a.tool.name]
		local b_rank = allowed_clis[b.tool.name]
		return a_rank == b_rank and original_order[a] < original_order[b] or a_rank < b_rank
	end)
	return states
end

local function format_cli_item(s)
	local parts = require("sidekick.cli.ui.select").format(s)
	return table.concat(vim.tbl_map(function(p)
		return p[1]
	end, parts))
end

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

local function send_local(message)
	local State = require("sidekick.cli.state")
	local sk_select = require("sidekick.cli.ui.select")

	local function dispatch(state)
		if not state then
			return
		end
		if not state.session then
			state = State.attach(state, { show = true, focus = false })
		end
		local opts = type(message) == "string" and { msg = message } or vim.deepcopy(message)
		opts.filter = { session = state.session.id }
		require("sidekick.cli").send(opts)
	end

	local function pick(items)
		vim.ui.select(items, {
			prompt = "Select CLI tool:",
			kind = "sidekick_cli",
			snacks = { format = sk_select.format },
			format_item = format_cli_item,
		}, dispatch)
	end

	local all = State.get()

	local running = order_allowed(vim.tbl_filter(function(s)
		return s.attached and is_allowed_local(s)
	end, all))
	if #running == 1 then
		dispatch(running[1])
		return
	elseif #running > 1 then
		pick(running)
		return
	end

	local installed = order_allowed(vim.tbl_filter(function(s)
		return s.installed and is_allowed_local(s)
	end, all))
	if #installed == 0 then
		return
	elseif #installed == 1 then
		dispatch(installed[1])
	else
		pick(installed)
	end
end

local function open_cli()
	local State = require("sidekick.cli.state")
	local sk_select = require("sidekick.cli.ui.select")
	local states = order_allowed(vim.tbl_filter(function(s)
		return s.installed and is_allowed_local(s)
	end, State.get()))
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
		format_item = format_cli_item,
		snacks = { format = sk_select.format },
	}, function(state)
		if state then
			open_local(state.tool.name)
		end
	end)
end

local function cycle_clis()
	local State = require("sidekick.cli.state")
	local clis = vim.tbl_filter(function(s)
		return s.attached and not s.external and s.terminal
	end, State.get())
	if #clis == 0 then
		open_cli()
		return
	end
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
		clis[1].terminal:focus()
	elseif current < #clis then
		clis[current + 1].terminal:focus()
	else
		local editor ---@type integer?
		for _, w in ipairs(vim.api.nvim_list_wins()) do
			local buf = vim.api.nvim_win_get_buf(w)
			if
				not vim.w[w].sidekick_session_id
				and vim.api.nvim_win_get_config(w).relative == ""
				and vim.bo[buf].buftype == ""
			then
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

-- Dynamic key mappings
local keys = {
	{
		"<c-\\>",
		function()
			cycle_clis()
		end,
		mode = { "n", "x", "i", "t" },
		desc = "Sidekick cycle CLIs",
	},
	{
		"<leader>cq",
		function()
			require("sidekick.cli").prompt(function(_, text)
				if text then
					send_local({ text = text })
				end
			end)
		end,
		desc = "Sidekick prompts",
		mode = { "n", "v" },
	},
	{
		"<leader>cc",
		function()
			open_cli()
		end,
		desc = "Sidekick open CLI",
	},
	{
		"<leader>ct",
		function()
			send_local("{this}")
		end,
		desc = "Sidekick send this to CLI",
		mode = { "x", "n" },
	},
	{
		"<leader>cf",
		function()
			send_local("{file}")
		end,
		desc = "Sidekick send file to CLI",
	},
	{
		"<leader>cv",
		function()
			send_local("{selection}")
		end,
		desc = "Sidekick send selection to CLI",
		mode = { "x" },
	},
}

if nes_enabled then
	keys[#keys + 1] = {
		"<tab>",
		function()
			if not require("sidekick").nes_jump_or_apply() then
				return "<Tab>"
			end
		end,
		desc = "Sidekick toggle next edit",
	}
end

---@type LazySpec
return {
	"folke/sidekick.nvim",
	opts = {
		nes = {
			enabled = nes_enabled,
		},
		cli = {
			prompts = {
				commit = "Please review the staged changes and recommend a concise git commit message. Do not create the commit, just provide the message. Follow the style most recently used in the commit history.",
			},
			tools = {
				cursor = { cmd = { "cursor-agent", "--mode", "ask" } },
			},
			win = {
				wo = {
					winhighlight = "",
				},
			},
		},
	},
	keys = keys,
}
