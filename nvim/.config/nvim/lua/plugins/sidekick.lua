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

-- Dynamically generate key mappings for each CLI
local keys = {
	{
		"<c-\\>",
		function()
			require("sidekick.cli").focus({ name = active_cli })
		end,
		mode = { "n", "x", "i", "t" },
		desc = "Sidekick Switch Focus",
	},
	{
		"<leader>cq",
		function()
			require("sidekick.cli").select_prompt()
		end,
		desc = "Sidekick Prompts",
		mode = { "n", "v" },
	},
}

for i, cli in ipairs(clis) do
	table.insert(keys, {
		"<leader>c" .. i,
		function()
			require("sidekick.cli").toggle({ name = cli, focus = true, diagnostics = true })
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
		require("sidekick.cli").toggle({ name = active_cli, focus = true, diagnostics = true })
	end,
	desc = "Sidekick Toggle CLI " .. active_cli,
})

-- send this to active cli
table.insert(keys, {
	"<leader>ct",
	function()
		require("sidekick.cli").send({ msg = "{this}", name = active_cli })
	end,
	desc = "Sidekick Send File to CLI " .. active_cli,
	mode = { "x", "n" },
})

-- send file to active cli
table.insert(keys, {
	"<leader>cf",
	function()
		require("sidekick.cli").send({ msg = "{file}", name = active_cli })
	end,
	desc = "Sidekick Send File to CLI " .. active_cli,
})

-- send selection to active cli
table.insert(keys, {
	"<leader>cv",
	function()
		require("sidekick.cli").send({ msg = "{selection}", name = active_cli })
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
	},
	keys = keys,
}
