require("nvim-treesitter").install({ "css" })
vim.treesitter.start()
vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
vim.lsp.enable({ "cssls", "tailwindcss" })
