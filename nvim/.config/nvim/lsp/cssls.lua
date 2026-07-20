local lang_settings = {
	validate = true,
	lint = { unknownAtRules = "ignore" },
}

---@type vim.lsp.Config
return {
	settings = {
		css = lang_settings,
		less = lang_settings,
		scss = lang_settings,
	},
}
