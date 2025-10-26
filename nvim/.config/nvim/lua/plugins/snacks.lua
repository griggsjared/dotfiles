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
				layout = {
					preset = "select",
					layout = {
						width = 0.33,
						min_width = 30,
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
							["dd"] = { "bufdelete", mode = { "n", "i" } },
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
				layout = "select",
			})
		end,
		desc = "Spell Suggest",
	},
	{
		"<leader>fc",
		function()
			Snacks.picker.files({ cwd = vim.fn.stdpath("config") })
		end,
		desc = "Config Files",
	},
	{
		"<leader>fp",
		function()
			Snacks.picker.git_status()
		end,
		desc = "Git Status",
	},
	{
		"<leader>fr",
		function()
			Snacks.picker.resume()
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
				win = {
					style = {
						border = "rounded",
					},
				},
				layout = {
					preset = "ivy",
					layout = {
						backdrop = true,
						title_pos = "center",
					},
				},
			},
			dashboard = {
				enabled = true,
				width = 40,
				sections = {
					{
						header = [[
 ███▄    █ ▓█████  ▒█████   ██▒   █▓ ██▓ ███▄ ▄███▓
 ██ ▀█   █ ▓█   ▀ ▒██▒  ██▒▓██░   █▒▓██▒▓██▒▀█▀ ██▒
▓██  ▀█ ██▒▒███   ▒██░  ██▒ ▓██  █▒░▒██▒▓██    ▓██░
▓██▒  ▐▌██▒▒▓█  ▄ ▒██   ██░  ▒██ █░░░██░▒██    ▒██ 
▒██░   ▓██░░▒████▒░ ████▓▒░   ▒▀█░  ░██░▒██▒   ░██▒
░ ▒░   ▒ ▒ ░░ ▒░ ░░ ▒░▒░▒░    ░ ▐░  ░▓  ░ ▒░   ░  ░
░ ░░   ░ ▒░ ░ ░  ░  ░ ▒ ▒░    ░ ░░   ▒ ░░  ░      ░
░   ░ ░    ░   ░ ░ ░ ▒       ░░   ▒ ░░      ░   
      ░    ░  ░    ░ ░        ░   ░         ░   
							                    ░                 
]],
						padding = 1,
						gap = 1,
					},
					{ section = "startup", gap = 1, padding = 1 },
					{
						icon = " ",
						title = "Working Directory",
						section = "terminal",
						cmd = "pwd",
						height = 1,
						padding = 1,
						ttl = 5 * 60,
						indent = 3,
					},
					{
						icon = " ",
						title = "Git Status",
						section = "terminal",
						enabled = vim.fn.isdirectory(".git") == 1,
						cmd = "hub status --short --branch --renames",
						height = 5,
						padding = 1,
						ttl = 5 * 60,
						indent = 3,
					},
				},
			},
		},
		keys = keys,
	},
}
