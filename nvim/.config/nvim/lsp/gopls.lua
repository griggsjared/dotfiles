---@type vim.lsp.Config
return {
	settings = {
		gopls = {
			completeUnimported = true,
			usePlaceholders = true,
			analyses = {
				unusedparams = true,
			},
			hints = {
				parameterNames = true,
			},
		},
	},
}
