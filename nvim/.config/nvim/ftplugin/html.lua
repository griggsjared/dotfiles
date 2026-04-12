require("nvim-treesitter").install({ "html" })
vim.treesitter.start()
vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
vim.lsp.enable({ "html", "tailwindcss", "cssls" })
