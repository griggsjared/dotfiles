return {
  {
    "lukas-reineke/indent-blankline.nvim",
    main = "ibl",
    config = function()
      local hooks = require("ibl.hooks")

      require("ibl").setup({
        scope = {
          highlight = {
            "IndentActive",
          }
        },
        indent = {
          char = "┊",
          highlight = {
            "IndentInactive"
          }
        },
      });

      hooks.register(hooks.type.SCOPE_HIGHLIGHT, hooks.builtin.scope_highlight_from_extmark)
    end,
  },
}
