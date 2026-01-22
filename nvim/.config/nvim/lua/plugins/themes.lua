return {
	{
		"griggsjared/monokai-baked.nvim",
		priority = 1000,
		lazy = false,
		config = function()
			require("monokai-baked").setup({
				transparent_background = true,
			})
			vim.cmd([[colorscheme monokai-baked]])
		end,
	},
}
