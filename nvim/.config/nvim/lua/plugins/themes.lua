return {
	{
		"griggsjared/baked.nvim",
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
