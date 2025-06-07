return {
	"nvimtools/none-ls.nvim",
	dependencies = {
		"nvimtools/none-ls-extras.nvim",
	},
	config = function()
		local null_ls = require("null-ls")
		null_ls.setup({
			on_attach = function() end,
			sources = {
				require("none-ls.diagnostics.eslint").with({
					prefer_local = "node_modules/.bin",
					condition = function(utils)
						return utils.root_has_file({
							".eslintrc.js",
							".eslintrc.json",
							".eslintrc",
							".eslintrc.yml",
							".eslintrc.yaml",
							".eslint.config.mjs",
							".eslint.config.cjs",
							".eslint.config.js",
						})
					end,
				}),
				null_ls.builtins.diagnostics.phpstan.with({
					condition = function(utils)
						return utils.root_has_file({
							"phpstan.neon",
							"phpstan.neon.dist",
						})
					end,
				}),
			},
		})
	end,
}
