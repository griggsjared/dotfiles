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

      require("ibl").setup({
        scope = { highlight = highlight },
        indent = { char = "┊", highlight = inactive_highlight },
      })

      hooks.register(hooks.type.SCOPE_HIGHLIGHT, hooks.builtin.scope_highlight_from_extmark)
    end,
  },
}
