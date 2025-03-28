return {
  {
    "nvim-treesitter/nvim-treesitter",
    build = ":TSUpdate",
    config = function()
      local config = require("nvim-treesitter.configs")
      config.setup({
        auto_install = true,
        highlight = { enable = true },
        indent = { enable = true },
        ensure_installed = {
          "php_only",
          "php",
          "html",
          "css",
          "javascript",
          "typescript",
          "json",
          "lua",
          "go",
          "templ",
          "blade"
        },
      })
    end,
  },
  {
    "nvim-treesitter/nvim-treesitter-context",
  },
}
