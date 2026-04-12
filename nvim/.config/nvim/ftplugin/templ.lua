require("nvim-treesitter").install({ "templ" })
vim.treesitter.start()
vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
vim.lsp.enable({ "templ", "html", "tailwindcss" })
