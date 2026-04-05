return {
	{
		"nvim-treesitter/nvim-treesitter",
		branch = "main",
		lazy = false,
		build = ":TSUpdate",
		config = function()
			require("nvim-treesitter").setup({
				install_dir = vim.fn.stdpath("data") .. "/site",
			})

			require("nvim-treesitter").install({
				"bash",
				"php_only",
				"php",
				"html",
				"css",
				"javascript",
				"typescript",
				"json",
				"lua",
				"go",
				"templ",
				"blade",
				"markdown",
				"markdown_inline",
				"vue",
				"tsx",
				"jsx"
			})

			local parsersInstalled = require("nvim-treesitter").get_installed("parsers")
			local treesitterStart = vim.api.nvim_create_augroup("treesitter-start-files", {})

			for _, parser in pairs(parsersInstalled) do
				local filetypes = vim.treesitter.language.get_filetypes(parser)
				vim.api.nvim_create_autocmd({ "FileType" }, {
					group = treesitterStart,
					pattern = filetypes,
					callback = function()
						vim.treesitter.start()
						vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
						vim.bo.indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
					end,
				})
			end
		end,
	},
	{
		"nvim-treesitter/nvim-treesitter-context",
		config = function()
			require("treesitter-context").setup({
				enable = true,
				max_lines = 5,
			})
		end,
	},
}
