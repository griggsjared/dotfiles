local mason = require("config.mason")

-- Inject @vue/typescript-plugin so vtsls attaches to .vue buffers,
-- which vue_ls (hybrid mode) requires. Overrides the filetypes from
-- nvim-lspconfig's bundled lsp/vtsls.lua.
---@type vim.lsp.Config
return {
	filetypes = { "typescript", "javascript", "javascriptreact", "typescriptreact", "vue" },
	settings = {
		vtsls = {
			tsserver = {
				globalPlugins = {
					{
						name = "@vue/typescript-plugin",
						location = mason.package_path(
							"vue-language-server",
							"node_modules",
							"@vue",
							"language-server"
						),
						languages = { "vue" },
						configNamespace = "typescript",
					},
				},
			},
		},
	},
}
