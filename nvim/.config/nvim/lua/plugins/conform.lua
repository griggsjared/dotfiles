return {
	{
		"stevearc/conform.nvim",
		opts = {},
		config = function()
			local util = require("conform.util")
			require("conform").setup({
				formatters_by_ft = {
					lua = { "stylua" },
					svelte = { "prettier", "eslint_d" },
					javascript = { "prettier", "eslint_d" },
					typescript = { "prettier", "eslint_d" },
					javascriptreact = { "prettier", "eslint_d" },
					typescriptreact = { "prettier", "eslint_d" },
					vue = { "prettier", "eslint_d" },
					css = { "prettier" },
					blade = { "blade-formatter" },
					php = { "pint", "php_cs_fixer", stop_after_first = true },
					go = { "goimports", "gofmt" },
					c = { "clang-format" },
					cpp = { "clang-format" },
				},
				formatters = {
					pint = {
						inherit = true,
						cwd = util.root_file({ "composer.json", ".git" }),
						require_cwd = true,
						condition = function(_, ctx)
							local root = vim.fs.root(ctx.dirname, { "composer.json", ".git" })
							if not root then return false end
							return vim.fn.executable(root .. "/vendor/bin/pint") == 1
									or #vim.fs.find({ "pint.json", "pint.json.dist" }, { path = ctx.dirname, upward = true, stop = root }) >
									0
						end,
					},
					php_cs_fixer = {
						inherit = true,
						cwd = util.root_file({ "composer.json", ".git" }),
						require_cwd = true,
						condition = function(_, ctx)
							local root = vim.fs.root(ctx.dirname, { "composer.json", ".git" })
							if not root then return false end
							return vim.fn.executable(root .. "/vendor/bin/php-cs-fixer") == 1
									or
									#vim.fs.find({ ".php-cs-fixer.php", ".php-cs-fixer.dist.php", "php-cs-fixer.php" },
										{ path = ctx.dirname, upward = true, stop = root }) > 0
						end,
					},
					prettier = {
						cwd = require("conform.util").root_file({
							".prettierrc",
							".prettierrc.json",
							".prettierrc.yaml",
							".prettierrc.yml",
							".prettierrc.js",
							".prettierrc.cjs",
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
