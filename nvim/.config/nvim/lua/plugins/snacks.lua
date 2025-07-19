return {
	{
		"folke/snacks.nvim",
		priority = 1000,
		lazy = false,
		opts = {
			notifier = { enabled = true },
			statuscolumn = { enabled = true },
			lazygit = { enabled = true },
			bigfile = { enabled = true },
			quickfile = { enabled = true },
			scroll = { enabled = false, speed = 2 },
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
		keys = {
			{ "<leader>sd", "<CMD>lua Snacks.dashboard()<CR>", desc = "Show the dashboard" },
			{ "<leader>lg", "<CMD>lua Snacks.lazygit()<CR>", desc = "Show the lazygit" },
		},
	},
}
