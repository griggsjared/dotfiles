return {
	"nvimtools/none-ls.nvim",
	config = function()
		local null_ls = require("null-ls")
		null_ls.setup({
			sources = {
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
