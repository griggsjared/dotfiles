return {
	{
		"stevearc/conform.nvim",
		opts = {},
		config = function()
			require("conform").setup({
				formatters_by_ft = {
					lua = { "stylua" },
          svelte = { "prettier" },
					javascript = { "prettier" },
					typescript = { "prettier" },
          javascriptreact = { "prettier" },
          typescriptreact = { "prettier" },
					vue = { "prettier" },
					blade = { "blade-formatter" },
					php = { "pint" },
					go = { "goimports", "gofmt" },
					c = { "clang-format" },
					cpp = { "clang-format" },
				},
				formatters = {
					pint = {
						require_cwd = true,
					},
					prettier = {
						cwd = require("conform.util").root_file({
							".prettierrc",
							".prettierrc.json",
							".prettierrc.yaml",
							".prettierrc.yml",
							".prettierrc.js",
							",prettierrc.cjs",
							"prettier.config.js",
						}),
						require_cwd = true,
					},
				},
			})
			vim.keymap.set("n", "<leader>gf", function()
				require("conform").format({ async = true, lsp_format = "fallback" })
			end, { desc = "Format with Conform" })
		end,
	},
}
