return {
	"rachartier/tiny-glimmer.nvim",
	event = "VeryLazy",
	priority = 10, -- Low priority to catch other plugins' keybindings
	config = function()
		require("tiny-glimmer").setup({
			enable = true,
			overwrite = {
				auto_map = true,
				yank = {
					enabled = true,
				},
				search = {
					enabled = true,
				},
				paste = {
					enabled = true,
				},
				undo = {
					enabled = true,
				},
				redo = {
					enabled = true,
				},
			}
		})
	end,
}
