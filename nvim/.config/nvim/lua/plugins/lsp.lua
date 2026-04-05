return {
	{
		"williamboman/mason.nvim",
		dependencies = {
			"WhoIsSethDaniel/mason-tool-installer.nvim",
		},
		lazy = false,
		config = function()
			require("mason").setup()
			-- use mason-tool-installer to install linters, formatters, and daps that are not available as lsp servers
			require("mason-tool-installer").setup({
				ensure_installed = {
					--linters
					"phpcs",
					"phpstan",
					"eslint_d",
					"golangci-lint",
					--formatters
					"blade-formatter",
					"clang-format",
					"goimports",
					"php-cs-fixer",
					"pint",
				},
			})
		end,
	},
	{
		"williamboman/mason-lspconfig.nvim",
		lazy = false,
		config = function()
			require("mason-lspconfig").setup({
				-- lsps only
				ensure_installed = {
					"html",
					"cssls",
					"tailwindcss",
					"intelephense",
					"lua_ls",
					"vtsls",
					"vue_ls",
					"gopls",
					"templ",
					"astro",
					"rust_analyzer",
					"zls",
					"clangd",
					"golangci_lint_ls",
					"eslint",
					"marksman",
					"jsonls",
				},
				-- disable automatic server enabling; ftplugin files call vim.lsp.enable() explicitly
				handlers = {},
			})
		end,
	},
	{
		"neovim/nvim-lspconfig",
		lazy = false,
		config = function()
			vim.diagnostic.config({
				virtual_text = true,
				signs = {
					text = {
						[vim.diagnostic.severity.ERROR] = "󰅙",
						[vim.diagnostic.severity.WARN] = "",
						[vim.diagnostic.severity.INFO] = "󰋼",
						[vim.diagnostic.severity.HINT] = "󰌵",
					},
				},
			})

			vim.keymap.set("n", "K", vim.lsp.buf.hover, { desc = "Show hover documentation" })
			vim.keymap.set("n", "<leader>gd", vim.lsp.buf.definition, { desc = "Go to definition" })
			vim.keymap.set("n", "<leader>gr", vim.lsp.buf.references, { desc = "Show references" })
			vim.keymap.set("n", "<leader>gi", vim.lsp.buf.implementation, { desc = "Go to implementation" })
			vim.keymap.set("n", "<leader>ca", vim.lsp.buf.code_action, { desc = "Show code actions" })
			vim.keymap.set("n", "<leader>rn", vim.lsp.buf.rename, { desc = "Rename symbol" })

			vim.keymap.set("n", "<leader>xx", function()
				vim.diagnostic.config({ virtual_lines = { current_line = true }, virtual_text = false })
				vim.api.nvim_create_autocmd("CursorMoved", {
					group = vim.api.nvim_create_augroup("line-diagnostics", { clear = true }),
					callback = function()
						vim.diagnostic.config({ virtual_lines = false, virtual_text = true })
						return true
					end,
				})
			end, { desc = "Toggle inlay hints" })

			vim.keymap.set("n", "<leader>ih", function()
				vim.lsp.inlay_hint.enable(not vim.lsp.inlay_hint.is_enabled())
			end, { desc = "Toggle inlay hints" })
		end,
	},
}
