return {
  {
    "loctvl842/monokai-pro.nvim",
    priority = 1000,
    lazy = false,
    config = function()
      local palette = require("monokai-pro.override")

      local transparent_background = true;
      if vim.g.neovide then
        transparent_background = false
      end

      require("monokai-pro").setup({
        devicons = true,
        transparent_background = transparent_background,
        terminal_colors = true,
        filter = "pro",
        overridePalette = function()
          return palette
        end,
      })

      vim.cmd([[colorscheme monokai-pro]])

      vim.api.nvim_set_hl(0, "FloatBorder", { bg = palette.dark2, fg = palette.dimmed2 })
      vim.api.nvim_set_hl(0, "NormalFloat", { bg = palette.dark2, fg = palette.text })
      vim.api.nvim_set_hl(0, "CmpItemKindCopilot", { fg = palette.cyan })
      vim.api.nvim_set_hl(0, "Visual", { bg = palette.dimmed4 })
    end,
  }
}
