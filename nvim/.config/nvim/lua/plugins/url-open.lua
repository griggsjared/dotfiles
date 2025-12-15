return {
	{
		"sontungexpt/url-open",
		event = "VeryLazy",
		cmd = "URLOpenUnderCursor",
		config = function()
			local status_ok, url_open = pcall(require, "url-open")
			if not status_ok then
				return
			end
			url_open.setup({
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
