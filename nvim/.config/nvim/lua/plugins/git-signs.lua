return {
	{
		"lewis6991/gitsigns.nvim",
		config = function()
			local gitsigns = require("gitsigns")
			gitsigns.setup({
				current_line_blame = true,
			})

			local function toggle_blame()
				for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
					local buf = vim.api.nvim_win_get_buf(win)
					if vim.bo[buf].filetype == "gitsigns-blame" then
						vim.api.nvim_win_close(win, true)
						return
					end
				end

				gitsigns.blame()
			end

			vim.keymap.set("n", "<leader>pp", ":Gitsigns preview_hunk_inline<CR>", { desc = "Preview hunk" })
			vim.keymap.set("n", "<leader>pr", ":Gitsigns reset_hunk<CR>", { desc = "Reset git hunk" })
			vim.keymap.set("n", "<leader>ps", ":Gitsigns stage_hunk<CR>", { desc = "Stage git hunk" })
			vim.keymap.set("n", "<leader>pb", toggle_blame, { desc = "Toggle full git blame UI" })
			vim.keymap.set("n", "<leader>pl", ":Gitsigns toggle_current_line_blame<CR>", { desc = "Toggle current line blame" })
		end,
	},
}
