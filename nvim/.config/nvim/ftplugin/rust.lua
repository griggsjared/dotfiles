require("nvim-treesitter").install({ "rust" })
vim.treesitter.start()
vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
vim.lsp.enable("rust_analyzer")
