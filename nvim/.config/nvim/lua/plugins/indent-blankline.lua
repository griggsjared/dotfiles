return {
  {
    "lukas-reineke/indent-blankline.nvim",
    main = "ibl",
    config = function()
      local highlight = {
        "IndentRed",
        "IndentYellow",
        "IndentOrange",
        "IndentGreen",
        "IndentMagenta",
        "IndentCyan",
      }

      local inactive_highlight = {
        "IndentInactive",
      }

      local hooks = require("ibl.hooks")
      local palette = require("monokai-pro.override")

      hooks.register(hooks.type.HIGHLIGHT_SETUP, function()
        vim.api.nvim_set_hl(0, "IndentRed", { fg = palette.red })
        vim.api.nvim_set_hl(0, "IndentYellow", { fg = palette.yellow })
        vim.api.nvim_set_hl(0, "IndentOrange", { fg = palette.orange })
        vim.api.nvim_set_hl(0, "IndentGreen", { fg = palette.green })
        vim.api.nvim_set_hl(0, "IndentMagenta", { fg = palette.magenta })
        vim.api.nvim_set_hl(0, "IndentCyan", { fg = palette.cyan })
        vim.api.nvim_set_hl(0, "IndentInactive", { fg = palette.dimmed4 })
      end)

      require("ibl").setup({
        scope = { highlight = highlight },
        indent = { char = "┊", highlight = inactive_highlight },
      })

      hooks.register(hooks.type.SCOPE_HIGHLIGHT, hooks.builtin.scope_highlight_from_extmark)
    end,
  },
}
