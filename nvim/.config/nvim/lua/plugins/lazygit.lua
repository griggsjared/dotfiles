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
		title_pos = "center",
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
				if vim.api.nvim_win_is_valid(win) then
					vim.api.nvim_win_close(win, true)
				end
				if vim.api.nvim_buf_is_valid(buf) then
					vim.schedule(function()
						vim.api.nvim_buf_delete(buf, { force = true })
					end)
				end
				state.floating.buf = -1
				state.floating.win = -1
			end,
			once = true,
		})

		vim.bo[buf].modifiable = false
		vim.wo[win].number = false
		vim.wo[win].relativenumber = false

		vim.api.nvim_buf_set_keymap(
			buf,
			"t",
			"<Esc>",
			"<C-\\><C-n>:lua vim.api.nvim_win_close(" .. win .. ", true)<CR>",
			{ noremap = true, silent = true }
		)

		vim.cmd("startinsert")
	end

	return {
		buf = buf,
		win = win,
	}
end

local toggle_lazygit = function()
	if
		vim.api.nvim_win_is_valid(state.floating.win)
		and vim.api.nvim_buf_is_valid(state.floating.buf)
		and vim.bo[state.floating.buf].buftype == "terminal"
	then
		vim.api.nvim_win_hide(state.floating.win)
	else
		state.floating.buf = -1
		state.floating.win = -1
		state.floating = create_floating_lazygit({ buf = state.floating.buf })
	end
end

vim.api.nvim_create_user_command("Lazygit", toggle_lazygit, {})

vim.keymap.set(
	"n",
	"<leader>lg",
	toggle_lazygit,
	{ noremap = true, silent = true, desc = "Toggle LazyGit Floating Window" }
)

return {}
