---@type LazySpec
return {
	"rachartier/tiny-glimmer.nvim",
	event = "VeryLazy",
	priority = 10, -- Low priority to catch other plugins' keybindings
	opts = {
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
		},
	},
}
