require("nvim-treesitter").install({ "astro" })
vim.treesitter.start()
vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
vim.lsp.enable("astro")
