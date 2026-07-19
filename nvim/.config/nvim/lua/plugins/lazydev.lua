---@type LazySpec
return {
	"folke/lazydev.nvim",
	ft = "lua",
	---@module "lazydev"
	---@type lazydev.Config
	opts = {
		library = {
			{ path = "${3rd}/luv/library", words = { "vim%.uv" } },
			{ path = "snacks.nvim", words = { "Snacks" } },
		},
	},
}
