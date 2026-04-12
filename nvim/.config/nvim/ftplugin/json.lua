require("nvim-treesitter").install({ "json" })
vim.treesitter.start()
vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
vim.lsp.enable("jsonls")
