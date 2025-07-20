local state = {
	floating = {
		buf = -1,
		win = -1,
	},
}

local create_floating_lazygit = function(opts)
	opts = opts or {}

	local width = vim.o.columns
	local height = vim.o.lines

	local win_width = math.floor(width * 0.8)
	local win_height = math.floor(height * 0.8)

	local row = math.floor((height - win_height) / 2)
	local col = math.floor((width - win_width) / 2)

	local buf = nil
	if opts.buf and vim.api.nvim_buf_is_valid(opts.buf) then
		buf = opts.buf
	else
		buf = vim.api.nvim_create_buf(false, true)
	end

	local win_config = {
		relative = "editor",
		width = win_width,
		height = win_height,
		row = row,
		col = col,
		style = "minimal",
		border = "rounded",
		title = "LazyGit",
		focusable = true,
	}
	local win = vim.api.nvim_open_win(buf, true, win_config)

	if vim.bo[buf].buftype ~= "terminal" then
		vim.api.nvim_buf_call(buf, function()
			vim.cmd("terminal lazygit")
		end)

		vim.api.nvim_create_autocmd("TermClose", {
			buffer = buf,
			callback = function()
				if vim.api.nvim_buf_is_valid(buf) then
					vim.api.nvim_buf_delete(buf, { force = true })
				end
				state.floating.buf = -1
				state.floating.win = -1
			end,
			once = true,
		})

		vim.bo[buf].modifiable = false
		vim.wo[win].number = false
		vim.wo[win].relativenumber = false

		vim.cmd("startinsert")
	end

	return {
		buf = buf,
		win = win,
	}
end

local toggle_lazygit = function()
	if not vim.api.nvim_win_is_valid(state.floating.win) then
		state.floating = create_floating_lazygit({ buf = state.floating.buf })
	else
		vim.api.nvim_win_hide(state.floating.win)
	end
end

vim.api.nvim_create_user_command("Lazygit", toggle_lazygit, {})

vim.keymap.set("n", "<leader>lg", toggle_lazygit, { noremap = true, silent = true, desc = "Toggle LazyGit Floating Window" })

return {}
