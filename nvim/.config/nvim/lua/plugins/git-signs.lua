--- Toggle blame: close existing blame window or open a new one.
---@return nil
local function toggle_blame()
	for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
		local buf = vim.api.nvim_win_get_buf(win)
		if vim.bo[buf].filetype == "gitsigns-blame" then
			vim.api.nvim_win_close(win, true)
			return
		end
	end
	require("gitsigns").blame()
end

---@type LazySpec
return {
	"lewis6991/gitsigns.nvim",
	lazy = false,
	keys = {
		{ "<leader>pp", "<cmd>Gitsigns preview_hunk_inline<cr>", desc = "Preview hunk" },
		{ "<leader>pr", "<cmd>Gitsigns reset_hunk<cr>", desc = "Reset git hunk" },
		{ "<leader>ps", "<cmd>Gitsigns stage_hunk<cr>", desc = "Stage git hunk" },
		{ "<leader>pb", toggle_blame, desc = "Toggle full git blame UI" },
		{
			"<leader>pl",
			"<cmd>Gitsigns toggle_current_line_blame<cr>",
			desc = "Toggle current line blame",
		},
	},
	config = function()
		require("gitsigns").setup({ current_line_blame = true })
	end,
}
