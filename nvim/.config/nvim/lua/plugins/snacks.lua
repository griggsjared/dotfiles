-- Git does not record where a branch was created from, so guess: the reflog's
-- "Created from" entry, then the ref the branch has the fewest commits past,
-- then the remote's default branch.
local function detect_branch_base(cwd)
	local function git(args)
		local out = vim.system(vim.list_extend({ "git" }, args), { text = true, cwd = cwd }):wait()
		return out.code == 0 and vim.trim(out.stdout) or nil
	end

	local branch = git({ "branch", "--show-current" }) or ""
	-- A remote copy of this branch (origin/feat on feat) would show an empty diff.
	-- Each remote's HEAD shortens to the bare remote name (origin) and duplicates
	-- the default branch, so skip those too.
	local skip = { [branch] = true }
	for remote in (git({ "remote" }) or ""):gmatch("%S+") do
		skip[remote] = true
		skip[remote .. "/" .. branch] = true
		skip["refs/remotes/" .. remote .. "/" .. branch] = true
	end
	if branch ~= "" then
		local reflog = git({ "reflog", "show", "--format=%gs", "refs/heads/" .. branch }) or ""
		local lines = vim.split(reflog, "\n")
		local from = lines[#lines]:match("^branch: Created from (.+)$")
		if
			from
			and from ~= "HEAD"
			and not skip[from]
			and git({ "rev-parse", "--verify", "--quiet", from .. "^{commit}" })
		then
			return from, "reflog"
		end
	end

	local default = git({ "symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD" })
	local refs = git({
		"for-each-ref",
		"--format=%(refname:short) %(ahead-behind:HEAD)",
		"refs/heads",
		"refs/remotes",
	}) or ""
	local best, best_behind, best_ahead
	for line in refs:gmatch("[^\n]+") do
		-- ahead: commits the ref has that HEAD lacks; behind: commits HEAD has that the ref lacks.
		local ref, ahead, behind = line:match("^(%S+) (%d+) (%d+)$")
		ahead, behind = tonumber(ahead), tonumber(behind)
		-- behind == 0 with ahead > 0: the ref already has every commit on this branch, so it can't be the base.
		if ref and not skip[ref] and not (behind == 0 and ahead > 0) then
			local better = not best
				or behind < best_behind
				or (behind == best_behind and ref == default)
				or (behind == best_behind and best ~= default and ahead < best_ahead)
			if better then
				best, best_behind, best_ahead = ref, behind, ahead
			end
		end
	end
	if best then
		return best, "nearest branch"
	end

	if default then
		return default, "origin/HEAD"
	end
end

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
		"<leader>fn",
		function()
			local dirs = vim.fs.find({ "_notes", ".notes" }, {
				path = vim.fn.getcwd(),
				type = "directory",
				limit = math.huge,
			})
			if #dirs == 0 then
				vim.notify("No notes directories found", vim.log.levels.INFO)
				return
			end
			Snacks.picker.files({
				title = "Find Notes",
				dirs = dirs,
				hidden = true,
				ignored = true,
			})
		end,
		desc = "Find notes",
		mode = { "n", "v" },
	},
	{
		"<leader>fg",
		function()
			Snacks.picker.grep({
				filter = { cwd = true },
			})
		end,
		desc = "Grep files",
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
		desc = "Find buffers",
	},
	{
		"<leader>fo",
		function()
			Snacks.picker.recent({
				title = "Recent Files",
				filter = { cwd = true },
			})
		end,
		desc = "Recent files",
	},
	{
		"<leader>fO",
		function()
			Snacks.picker.recent({
				title = "Recent Files (All)",
			})
		end,
		desc = "Recent files (all)",
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
		desc = "Spell suggest",
	},
	{
		"<leader>fc",
		function()
			Snacks.picker.files({
				title = "Config Files",
				cwd = vim.fn.stdpath("config"),
			})
		end,
		desc = "Config files",
	},
	{
		"<leader>fp",
		function()
			Snacks.picker.git_status({
				title = "Tracked Git Changes",
				layout = {
					preset = "ivy",
					layout = {
						height = 0.99,
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
							["<c-d>"] = { "git_diff_open", mode = { "n", "i" } },
						},
					},
					list = {
						keys = {
							["<c-d>"] = "git_diff_open",
						},
					},
				},
			})
		end,
		desc = "Git status",
	},
	{
		"<leader>fP",
		function()
			local cwd = vim.fn.getcwd()
			vim.system(
				{ "gh", "pr", "view", "--json", "number,baseRefName" },
				{ text = true, cwd = cwd },
				vim.schedule_wrap(function(out)
					local ok, d = pcall(vim.json.decode, out.stdout)
					local title, base
					if out.code == 0 and ok and d and d.baseRefName then
						title = "PR #" .. d.number .. " Diff (base: " .. d.baseRefName .. ")"
						base = d.baseRefName
					else
						local source
						base, source = detect_branch_base(cwd)
						if not base then
							vim.notify("No open PR and no base branch found", vim.log.levels.ERROR)
							return
						end
						title = "Branch Diff (base: " .. base .. ", via " .. source .. ")"
					end
					Snacks.picker({
						title = title,
						-- git diff never lists untracked files, so take only those from git status.
						multi = { "git_diff", "git_status" },
						transform = function(item)
							if item.status and item.status ~= "??" then
								return false
							end
						end,
						base = base,
						group = true,
						win = {
							input = {
								keys = {
									["<c-d>"] = { "git_diff_open", mode = { "n", "i" } },
								},
							},
							list = {
								keys = {
									["<c-d>"] = "git_diff_open",
								},
							},
						},
						layout = {
							preset = "ivy",
							layout = {
								height = 0.99,
								row = 0, -- Position at top
								col = 0,
								relative = "editor",
							},
						},
					})
				end)
			)
		end,
		desc = "PR or branch diff",
	},
	{
		"<leader>fr",
		function()
			Snacks.picker.resume({
				title = "Resume Last Search",
			})
		end,
		desc = "Resume last search",
	},
}

---@type LazySpec
return {
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
		image = {
			enabled = true,
			convert = {
				magick = {
					svg = { "-density", 192, "-background", "none", "{src}[{page}]" },
				},
			},
		},
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
			win = {
				input = {
					keys = {
						["-"] = { function() end, mode = { "n" } },
					},
				},
			},
			actions = {
				git_diff_open = function(picker, item)
					if not item then
						return
					end
					if item.status == "??" then
						vim.notify("Cannot diff an untracked file", vim.log.levels.INFO)
						return
					end
					local base = "HEAD"
					if picker.opts.base then
						local out = vim
							.system(
								{ "git", "merge-base", "HEAD", picker.opts.base },
								{ text = true, cwd = picker:cwd() }
							)
							:wait()
						if out.code ~= 0 then
							vim.notify("Failed to resolve PR diff base", vim.log.levels.ERROR)
							return
						end
						base = vim.trim(out.stdout)
					end
					picker:norm(function()
						Snacks.picker.actions.jump(picker, item, {})
						local buf = vim.api.nvim_get_current_buf()
						local attached = vim.wait(2000, function()
							local status = vim.b[buf].gitsigns_status_dict
							return status and status.added ~= nil
						end)
						if not attached then
							vim.notify("Gitsigns could not attach to this file", vim.log.levels.WARN)
							return
						end
						require("gitsigns").diffthis(base, { vertical = true })
					end)
				end,
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
					local version = ("v%d.%d.%d%s"):format(
						v.major,
						v.minor,
						v.patch,
						v.prerelease and "-dev" or ""
					)
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
}
