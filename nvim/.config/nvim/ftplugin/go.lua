require("nvim-treesitter").install({ "go" })
vim.treesitter.start()
vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
vim.bo.indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
vim.lsp.enable({ "gopls", "golangci_lint_ls" })
