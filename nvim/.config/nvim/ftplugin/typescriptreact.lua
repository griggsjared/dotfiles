require("nvim-treesitter").install({ "tsx" })
vim.treesitter.start()
vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
vim.lsp.enable({ "vtsls", "tailwindcss", "eslint" })
require("Comment.ft").typescriptreact = { "//%s", "{/*%s*/}" }
