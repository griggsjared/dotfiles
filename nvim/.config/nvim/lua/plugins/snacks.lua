local keys = {
	{
		"<leader>bc",
		function()
			local buf = vim.api.nvim_get_current_buf()
			local is_last = #vim.fn.getbufinfo({ buflisted = 1 }) == 1
			Snacks.bufdelete()
			if is_last and not vim.bo[buf].buflisted then
				Snacks.dashboard.open({ buf = 0, win = 0 })
			end
		end,
		desc = "Close current buffer",
	},
	{
		"<leader>ba",
		function()
			local bufs = vim.tbl_map(function(info)
				return info.bufnr
			end, vim.fn.getbufinfo({ buflisted = 1 }))
			Snacks.bufdelete.all()
			local deleted_all = vim.iter(bufs):all(function(buf)
				return not vim.api.nvim_buf_is_valid(buf) or not vim.bo[buf].buflisted
			end)
			if deleted_all then
				Snacks.dashboard.open({ buf = 0, win = 0 })
			end
		end,
		desc = "Close all buffers",
	},
	{
		"<leader>lg",
		function()
			vim.g.snacks_lazygit_main_win = vim.api.nvim_get_current_win()
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
		"<leader>fP",
		function()
			vim.system({ "gh", "pr", "view", "--json", "number,baseRefName" }, { text = true, cwd = vim.fn.getcwd() },
				vim.schedule_wrap(function(out)
					if out.code ~= 0 then
						vim.notify("No open PR found for the current branch", vim.log.levels.ERROR)
						return
					end
					local ok, d = pcall(vim.json.decode, out.stdout)
					if not ok or not d or not d.baseRefName then
						vim.notify("Failed to parse `gh pr view` output", vim.log.levels.ERROR)
						return
					end
					Snacks.picker.git_diff({
						title = "PR #" .. d.number .. " Diff (base: " .. d.baseRefName .. ")",
						base = d.baseRefName,
					})
				end))
		end,
		desc = "GitHub PR Diff",
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
				config = {
					os = {
						edit = [[nvim --server "$NVIM" --remote-send "q" && nvim --server "$NVIM" --remote-expr "win_gotoid(g:snacks_lazygit_main_win)" && nvim --server "$NVIM" --remote {{filename}}]],
						editAtLine = [[nvim --server "$NVIM" --remote-send "q" && nvim --server "$NVIM" --remote-expr "win_gotoid(g:snacks_lazygit_main_win)" && nvim --server "$NVIM" --remote {{filename}} && nvim --server "$NVIM" --remote-send ":{{line}}<CR>"]],
						openDirInEditor = [[nvim --server "$NVIM" --remote-send "q" && nvim --server "$NVIM" --remote-expr "win_gotoid(g:snacks_lazygit_main_win)" && nvim --server "$NVIM" --remote {{dir}}]],
					},
				},
				win = {
					style = {
						border = "rounded",
					},
				},
			},
			picker = {
				enabled = true,
				main = { file = false },
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
					},
					function()
						local v = vim.version()
						local version = ("v%d.%d.%d%s"):format(v.major, v.minor, v.patch, v.prerelease and "-dev" or "")
						return {
							align = "center",
							{
								text = {
									{ version, hl = "special" },
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
