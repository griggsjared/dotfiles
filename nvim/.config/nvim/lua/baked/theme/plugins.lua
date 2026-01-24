local M = {}

function M.get(c, hp)
	local highlights = {}

	local plugins = {
		"blink", -- Blink.cmp completion
		"gitsigns", -- Git decorations
		"indent-blankline", -- Indent guides
		"lazy", -- Lazy.nvim plugin manager
		"lualine", -- Statusline
		"markdown", -- Render Markdown
		"marks", -- Marks.nvim (bookmarks/marks)
		"mason", -- LSP/DAP manager
		"oil", -- Oil.nvim file explorer
		"quicker", -- Quicker.nvim (quickfix enhancement)
		"snacks", -- Snacks.nvim (dashboard, picker, lazygit)
		"treesitter-context", -- Treesitter Context (sticky context)
		"trouble", -- Trouble.nvim (diagnostics viewer)
		"ufo", -- Folding
	}

	for _, plugin in ipairs(plugins) do
		local ok, module = pcall(require, "baked.theme.plugins." .. plugin)
		if ok then
			local plugin_highlights = module.get(c, hp)
			highlights = vim.tbl_deep_extend("force", highlights, plugin_highlights)
		end
	end

	return highlights
end

return M
