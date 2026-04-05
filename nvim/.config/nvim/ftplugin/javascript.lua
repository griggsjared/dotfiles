require("nvim-treesitter").install({ "javascript" })
vim.treesitter.start()
vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
vim.bo.indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
vim.lsp.enable({ "vtsls", "tailwindcss", "eslint" })
require("Comment.ft").javascript = { "//%s", "{/*%s*/}" }
