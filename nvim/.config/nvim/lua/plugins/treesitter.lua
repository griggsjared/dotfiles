---@type LazySpec[]
return {
	{
		"nvim-treesitter/nvim-treesitter",
		branch = "main",
		lazy = false,
		build = ":TSUpdate",
		opts = {
			install_dir = vim.fn.stdpath("data") .. "/site",
		},
	},
	{
		"nvim-treesitter/nvim-treesitter-context",
		opts = {
			enable = true,
			max_lines = 5,
		},
	},
}
