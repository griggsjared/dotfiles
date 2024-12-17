return {
  {
    "loctvl842/monokai-pro.nvim",
    lazy = false,
    config = function()
      local pallete = require("monokai-pro.override")

      require("monokai-pro").setup({
        devicons = true,
        transparent_background = true,
        terminal_colors = true,
        filter = "pro",
        overridePalette = function()
          return pallete
        end,
      })

      vim.cmd([[colorscheme monokai-pro]])

      vim.api.nvim_set_hl(0, "FloatBorder", { bg = pallete.dark2, fg = pallete.dimmed2 })
      vim.api.nvim_set_hl(0, "NormalFloat", { bg = pallete.dark2, fg = pallete.text })
      vim.api.nvim_set_hl(0, "CmpItemKindCopilot", { fg = pallete.cyan })
    end,
  }
}
