require("nvim-treesitter").install({ "php", "php_only" })
vim.treesitter.start()
vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
vim.opt_local.tabstop = 4
vim.opt_local.shiftwidth = 4
vim.lsp.enable({ "intelephense", "laravel_ls" })
require("Comment.ft").php = { "//%s", "/*%s*/" }
