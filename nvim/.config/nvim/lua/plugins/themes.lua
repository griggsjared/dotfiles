return {
	{
		dir = vim.fn.stdpath("config") .. "/rpg.nvim",
		priority = 1000,
		lazy = false,
		config = function()
			require("rpg").setup({
				transparent_background = true,
			})
			vim.cmd([[colorscheme rpg]])
		end,
	},
}
