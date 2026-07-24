local rpg_path = vim.fn.expand("~/projects/rpg-nvim")
local rpg_spec = vim.fn.isdirectory(rpg_path) == 1 and { dir = rpg_path }
	or { "griggsjared/rpg.nvim" }

---@type LazySpec
return {
	vim.tbl_extend("force", rpg_spec, {
		priority = 1000,
		lazy = false,
		config = function()
			require("rpg").setup({
				transparent_background = false,
			})
			vim.cmd([[colorscheme rpg]])
		end,
	}),
}
