require("nvim-treesitter").install({ "lua" })
vim.treesitter.start()
vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
vim.lsp.enable("lua_ls")
