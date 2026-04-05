require("nvim-treesitter").install({ "blade" })
vim.treesitter.start()
vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
vim.bo.indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
vim.lsp.enable({ "html", "laravel_ls" })
require("Comment.ft").blade = { "{{--%s--}}", "{{!--%s--}}" }
