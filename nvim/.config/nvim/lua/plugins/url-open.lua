return {
	{
		"sontungexpt/url-open",
		cmd = "URLOpenUnderCursor",
		config = function()
			require("url-open").setup({
				highlight_url = {
					all_urls = {
						enabled = true,
						fg = "text",
						underline = true,
					},
					cursor_move = {
						enabled = true,
						fg = "text",
						underline = true,
					},
				}
			})
			vim.keymap.set("n", "<leader>gu", "<cmd>URLOpenUnderCursor<CR>", { noremap = true, silent = true, desc = "Goto URL under cursor" })
		end,
	},
}
