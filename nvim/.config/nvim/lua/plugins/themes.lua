return {
	{
		dir = vim.fn.stdpath("config") .. "/lua/baked",
		priority = 1000,
		lazy = false,
		config = function()
			require("baked").setup({
				transparent_background = false,
				palette = os.getenv("BAKED_THEME") or "monokai",
			})
			vim.cmd([[colorscheme baked]])
		end,
	},
}
