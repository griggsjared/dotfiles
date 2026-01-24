return {
	{
		-- "griggsjared/baked.nvim",
		dir = vim.fn.stdpath("config") .. "/lua/baked",
		priority = 1000,
		lazy = false,
		config = function()
			require("baked").setup({
				transparent_background = false,
				palette = "onedark"
			})
			vim.cmd([[colorscheme baked]])
		end,
	},
}
