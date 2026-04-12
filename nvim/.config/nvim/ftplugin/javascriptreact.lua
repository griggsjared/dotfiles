require("nvim-treesitter").install({ "jsx" })
vim.treesitter.start()
vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
vim.lsp.enable({ "vtsls", "tailwindcss", "eslint" })
require("Comment.ft").javascriptreact = { "//%s", "{/*%s*/}" }
