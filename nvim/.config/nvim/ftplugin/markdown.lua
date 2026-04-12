require("nvim-treesitter").install({ "markdown", "markdown_inline" })
vim.treesitter.start()
vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
vim.wo.wrap = true
vim.lsp.enable("marksman")
