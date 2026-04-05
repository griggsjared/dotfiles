require("nvim-treesitter").install({ "vue" })
vim.treesitter.start()
vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
vim.bo.indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"

-- Inject @vue/typescript-plugin so vtsls attaches to .vue buffers,
-- which vue_ls (hybrid mode) requires. vim.lsp.config() overrides the
-- filetypes set by nvim-lspconfig's own lsp/vtsls.lua in the runtimepath.
vim.lsp.config("vtsls", {
	filetypes = { "typescript", "javascript", "javascriptreact", "typescriptreact", "vue" },
	settings = {
		vtsls = {
			tsserver = {
				globalPlugins = {
					{
						name = "@vue/typescript-plugin",
						location = vim.fn.stdpath("data")
							.. "/mason/packages/vue-language-server/node_modules/@vue/language-server",
						languages = { "vue" },
						configNamespace = "typescript",
					},
				},
			},
		},
	},
})

vim.lsp.enable({ "vtsls", "vue_ls", "tailwindcss", "eslint" })
