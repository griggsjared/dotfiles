-- Installed manually: go install github.com/laravel-ls/laravel-ls/cmd/laravel-ls@latest
---@type vim.lsp.Config
return {
	cmd = { "laravel-ls" },
	filetypes = { "php", "blade" },
	---@param bufnr integer
	---@param on_dir fun(root: string)
	root_dir = function(bufnr, on_dir)
		local artisan = vim.fs.find("artisan", {
			path = vim.api.nvim_buf_get_name(bufnr),
			upward = true,
		})[1]

		if artisan then
			on_dir(vim.fs.dirname(artisan))
		end
	end,
}
