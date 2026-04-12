require("nvim-treesitter").install({ "zig" })
vim.treesitter.start()
vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
vim.lsp.enable("zls")
