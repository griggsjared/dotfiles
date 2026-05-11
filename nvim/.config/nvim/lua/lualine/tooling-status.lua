local M = {}

local spinner_frames = { "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏" }
local hrtime = (vim.uv or vim.loop).hrtime

local ignore_lsps = { ["null-ls"] = true, ["none-ls"] = true }

M.work = {}
M.conform_running = 0

M.setup_progress_tracking = function()
	local group = vim.api.nvim_create_augroup("lualine_tooling_status", { clear = true })

	pcall(vim.api.nvim_create_autocmd, "LspProgress", {
		group = group,
		callback = function(event)
			local kind = event.data.params.value.kind
			local client_id = event.data.client_id
			local prev = M.work[client_id] or 0
			local delta = kind == "begin" and 1 or (kind == "end" and -1 or 0)
			local curr = math.max(prev + delta, 0)
			if curr == 0 then
				M.work[client_id] = nil
			else
				M.work[client_id] = curr
			end

			if (prev == 0 and curr > 0) or (prev > 0 and curr == 0) then
				pcall(function()
					require("lualine").refresh({ place = { "statusline" } })
				end)
			end
		end,
	})

	vim.api.nvim_create_autocmd("User", {
		group = group,
		pattern = "ConformFormatPre",
		callback = function()
			M.conform_running = math.min(M.conform_running + 1, 10)
			if M.conform_running == 1 then
				pcall(function()
					require("lualine").refresh({ place = { "statusline" } })
				end)
			end
		end,
	})

	vim.api.nvim_create_autocmd("User", {
		group = group,
		pattern = "ConformFormatPost",
		callback = function()
			M.conform_running = math.max(M.conform_running - 1, 0)
			if M.conform_running == 0 then
				pcall(function()
					require("lualine").refresh({ place = { "statusline" } })
				end)
			end
		end,
	})

	vim.api.nvim_create_autocmd("LspDetach", {
		group = group,
		callback = function(args)
			M.work[args.data.client_id] = nil
			pcall(function()
				require("lualine").refresh({ place = { "statusline" } })
			end)
		end,
	})
end

local function is_working()
	for _, count in pairs(M.work) do
		if count > 0 then
			return true
		end
	end
	return M.conform_running > 0
end

local function get_spinner()
	return spinner_frames[math.floor(hrtime() / (1e6 * 80)) % #spinner_frames + 1]
end

local function get_info()
	local bufnr = vim.api.nvim_get_current_buf()
	local ft = vim.bo[bufnr].filetype

	local lsp_names = {}
	local lsp_formatter_names = {}
	for _, client in ipairs(vim.lsp.get_clients({ bufnr = bufnr })) do
		if not ignore_lsps[client.name] then
			table.insert(lsp_names, client.name)
			if client:supports_method("textDocument/formatting", bufnr) then
				table.insert(lsp_formatter_names, client.name)
			end
		end
	end

	local conform_names = {}
	local conform_ok, conform = pcall(require, "conform")
	if conform_ok then
		for _, f in ipairs(conform.list_formatters(bufnr) or {}) do
			if f.available then
				table.insert(conform_names, f.name)
			end
		end
	end

	local null_formatter_names = {}
	local null_linter_names = {}
	local null_ls_ok, null_ls = pcall(require, "null-ls")
	local sources_ok, null_sources = pcall(require, "null-ls.sources")

	if null_ls_ok and sources_ok then
		for _, s in ipairs(null_sources.get_available(ft, null_ls.methods.FORMATTING) or {}) do
			table.insert(null_formatter_names, s.name)
		end
		for _, s in ipairs(null_sources.get_available(ft, null_ls.methods.DIAGNOSTICS) or {}) do
			table.insert(null_linter_names, s.name)
		end
	end

	local all_formatter_names = vim.deepcopy(conform_names)
	vim.list_extend(all_formatter_names, null_formatter_names)
	vim.list_extend(all_formatter_names, lsp_formatter_names)

	return {
		lsps = { count = #lsp_names, names = lsp_names },
		formatters = { count = #all_formatter_names, names = all_formatter_names },
		linters = { count = #null_linter_names, names = null_linter_names },
	}
end

M.component = function()
	local info = get_info()
	local parts = {}

	if info.lsps.count > 0 then
		table.insert(parts, "lsp:" .. info.lsps.count)
	end
	if info.formatters.count > 0 then
		table.insert(parts, "fmt:" .. info.formatters.count)
	end
	if info.linters.count > 0 then
		table.insert(parts, "lnt:" .. info.linters.count)
	end

	if #parts == 0 then
		return ""
	end

	local text = table.concat(parts, " ")
	if is_working() then
		text = get_spinner() .. " " .. text
	end

	return text
end

M.show_popup = function()
	local info = get_info()
	local lines = {}

	if info.lsps.count > 0 then
		table.insert(lines, "lsp:   " .. table.concat(info.lsps.names, ", "))
	end
	if info.formatters.count > 0 then
		table.insert(lines, "fmt:   " .. table.concat(info.formatters.names, ", "))
	end
	if info.linters.count > 0 then
		table.insert(lines, "lnt:   " .. table.concat(info.linters.names, ", "))
	end

	if #lines == 0 then
		vim.notify("No active sources for this buffer", vim.log.levels.INFO)
		return
	end

	local buf = vim.api.nvim_create_buf(false, true)
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
	vim.bo[buf].modifiable = false
	vim.bo[buf].bufhidden = "wipe"

	local widths = vim.tbl_map(function(l)
		return vim.fn.strdisplaywidth(l)
	end, lines)
	local width = math.min(80, vim.fn.max(widths))
	local height = #lines

	local win = vim.api.nvim_open_win(buf, false, {
		relative = "win",
		win = 0,
		anchor = "SE",
		row = vim.api.nvim_win_get_height(0) - 1,
		col = vim.api.nvim_win_get_width(0) - 1,
		width = width,
		height = height,
		style = "minimal",
		border = "rounded",
		focusable = false,
		noautocmd = true,
		zindex = 50,
	})

	vim.wo[win].wrap = false

	local augroup_name = "tooling_status_popup_" .. win
	local augroup = vim.api.nvim_create_augroup(augroup_name, { clear = true })

	local function close()
		if vim.api.nvim_win_is_valid(win) then
			pcall(vim.api.nvim_win_close, win, true)
		end
		pcall(vim.api.nvim_del_augroup_by_name, augroup_name)
	end

	vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI", "InsertEnter", "BufLeave", "WinLeave" }, {
		group = augroup,
		buffer = vim.api.nvim_get_current_buf(),
		once = true,
		callback = close,
	})

	vim.defer_fn(close, 8000)
end

return M
