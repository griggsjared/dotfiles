return {
	{
		"stevearc/conform.nvim",
		opts = {},
		config = function()
			require("conform").setup({
				formatters_by_ft = {
					lua = { "stylua" },
					svelte = { "prettier", "eslint_d" },
					javascript = { "prettier", "eslint_d" },
					typescript = { "prettier", "eslint_d" },
					javascriptreact = { "prettier", "eslint_d" },
					typescriptreact = { "prettier", "eslint_d" },
					vue = { "prettier", "eslint_d" },
					blade = { "blade-formatter" },
					php = { "pint", "php_cs_fixer" },
					go = { "goimports", "gofmt" },
					c = { "clang-format" },
					cpp = { "clang-format" },
				},
				formatters = {
					pint = {
						cwd = require("conform.util").root_file({
							"vendor/bin/pint",
							"pint.json",
							"pint.json.dist",
						}),
						require_cwd = true,
					},
					php_cs_fixer = {
						cwd = require("conform.util").root_file({
							"vendor/bin/php-cs-fixer",
							".php_cs_fixer.php",
						}),
						require_cwd = true,
						prefer_local = true,
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
				require("conform").format({ async = true, lsp_format = true })
			end, { desc = "Format with Conform" })
		end,
	},
}
