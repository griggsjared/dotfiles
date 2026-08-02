-- Installed via: composer global require laravel/lsp
---@type vim.lsp.Config
return {
	cmd = { "laravel-lsp" },
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
