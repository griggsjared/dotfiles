return {
	{
		"lewis6991/gitsigns.nvim",
		config = function()
			require("gitsigns").setup({
				current_line_blame = true,
			})
			vim.keymap.set("n", "<leader>pp", ":Gitsigns preview_hunk_inline<CR>", { desc = "Preview hunk" })
			vim.keymap.set("n", "<leader>pr", ":Gitsigns reset_hunk<CR>", { desc = "Reset git hunk" })
			vim.keymap.set("n", "<leader>ps", ":Gitsigns stage_hunk<CR>", { desc = "Stage git hunk" })
		end,
	},
}
