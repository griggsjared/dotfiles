---@type LazySpec
return {
	"sontungexpt/url-open",
	event = "VeryLazy",
	cmd = "URLOpenUnderCursor",
	keys = {
		{ "<leader>gu", "<cmd>URLOpenUnderCursor<cr>", desc = "Open URL under cursor" },
	},
	opts = {
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
		},
	},
}
