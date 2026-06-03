local keys = {
	{
		"<leader>lg",
		function()
			Snacks.lazygit()
		end,
		desc = "Show lazygit floating window",
	},
	--- Snacks Pickers
	-- Files Picker
	{
		"<leader>ff",
		function()
			Snacks.picker.smart({
				title = "Find Files (Smart Picker)",
				filter = { cwd = true },
			})
		end,
		desc = "Find files (Smart Picker)",
		mode = { "n", "v" },
	},
	{
		"<leader>fg",
		function()
			Snacks.picker.grep({
				filter = { cwd = true },
			})
		end,
		desc = "Grep Files",
		mode = { "n", "v" },
	},
	{
		"<leader>fb",
		function()
			Snacks.picker.buffers({
				title = "Current Buffers",
				layout = {
					preset = "select",
					layout = {
						width = 0.25,
						min_width = 75,
						height = 0.25,
						min_height = 3,
					},
				},
				formatters = {
					file = {
						filename_first = true,
					},
				},
				win = {
					input = {
						keys = {
							["dd"] = { "bufdelete", mode = { "n" } },
							["tu"] = { "transfer_up", mode = { "n" } },
							["td"] = { "transfer_down", mode = { "n" } },
						},
					},
				},
			})
		end,
		desc = "Find Buffers",
	},
	{
		"<leader>fo",
		function()
			Snacks.picker.recent({
				title = "Recent Files",
				filter = { cwd = true },
			})
		end,
		desc = "Recent Files",
	},
	{
		"<leader>fO",
		function()
			Snacks.picker.recent({
				title = "Recent Files (All)",
			})
		end,
		desc = "Recent Files (All)",
	},
	{
		"<leader>fk",
		function()
			Snacks.picker.keymaps()
		end,
		desc = "Keymaps",
	},
	{
		"<leader>fz",
		function()
			Snacks.picker.highlights()
		end,
		desc = "Highlights",
	},
	{
		"<leader>ss",
		function()
			Snacks.picker.spelling({
				title = "Spelling Suggestions",
				layout = "select",
			})
		end,
		desc = "Spell Suggest",
	},
	{
		"<leader>fc",
		function()
			Snacks.picker.files({
				title = "Config Files",
				cwd = vim.fn.stdpath("config"),
			})
		end,
		desc = "Config Files",
	},
	{
		"<leader>fp",
		function()
			Snacks.picker.git_status({
				title = "Tracked Git Changes",
				layout = {
					preset = "ivy",
					layout = {
						height = .99,
						row = 0, -- Position at top
						col = 0,
						relative = "editor",
					},
				},
				win = {
					input = {
						keys = {
							["tu"] = { "transfer_up", mode = { "n" } },
							["td"] = { "transfer_down", mode = { "n" } },
						},
					},
				},
			})
		end,
		desc = "Git Status",
	},
	{
		"<leader>fr",
		function()
			Snacks.picker.resume({
				title = "Resume Last Search",
			})
		end,
		desc = "Resume Last Search",
	},
}

return {
	{
		"folke/snacks.nvim",
		priority = 1000,
		lazy = false,
		opts = {
			bigfile = { enabled = true },
			quickfile = { enabled = true },
			statuscolumn = { enabled = true },
			indent = {
				enabled = true,
				char = "┊",
				scope = {
					enabled = true,
					char = "┊",
				},
			},
			image = { enabled = true },
			lazygit = {
				enabled = true,
				win = {
					style = {
						border = "rounded",
					},
				},
			},
			picker = {
				enabled = true,
				layout = {
					preset = "ivy",
					layout = {
						backdrop = true,
						title_pos = "center",
					},
				},
				actions = {
					transfer_up = function(_, item)
						vim.cmd.TransferUpload(item.file)
					end,
					transfer_down = function(_, item)
						vim.cmd.TransferDownload(item.file)
					end,
				},
				formatters = {
					file = {
						icon_width = 3,
					},
				},
			},
			dashboard = {
				enabled = true,
				width = 50,
				sections = {
					{
						header = [[
░░░    ░░ ░░░░░░░  ░░░░░░  ░░    ░░ ░░ ░░░    ░░░
▒▒▒▒   ▒▒ ▒▒      ▒▒    ▒▒ ▒▒    ▒▒ ▒▒ ▒▒▒▒  ▒▒▒▒
▒▒ ▒▒  ▒▒ ▒▒▒▒▒   ▒▒    ▒▒ ▒▒    ▒▒ ▒▒ ▒▒ ▒▒▒▒ ▒▒
▓▓  ▓▓ ▓▓ ▓▓      ▓▓    ▓▓  ▓▓  ▓▓  ▓▓ ▓▓  ▓▓  ▓▓
██   ████ ███████  ██████    ████   ██ ██      ██
]],
						padding = 1,
						gap = 1,
					},
					function()
						local v = vim.version()
						local version = ("v%d.%d.%d%s"):format(v.major, v.minor, v.patch, v.prerelease and "-dev" or "")
						local stats = require("lazy.stats").stats()
						local ms = math.floor(stats.startuptime * 100 + 0.5) / 100
						return {
							align = "center",
							padding = 1,
							{
								text = {
									{ " Neovim ", hl = "footer" },
									{ version,    hl = "special" },
								},
							},
							{
								text = {
									{ "⚡ Loaded ", hl = "footer" },
									{ stats.loaded .. "/" .. stats.count, hl = "special" },
									{ " plugins in ", hl = "footer" },
									{ ms .. "ms", hl = "special" },
								},
							},
						}
					end,
				},
			},
		},
		keys = keys,
	},
}
