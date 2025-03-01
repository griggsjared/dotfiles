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

      -- Indent Blankline
      vim.api.nvim_set_hl(0, "IndentRed", { fg = palette.red })
      vim.api.nvim_set_hl(0, "IndentYellow", { fg = palette.yellow })
      vim.api.nvim_set_hl(0, "IndentOrange", { fg = palette.orange })
      vim.api.nvim_set_hl(0, "IndentGreen", { fg = palette.green })
      vim.api.nvim_set_hl(0, "IndentMagenta", { fg = palette.magenta })
      vim.api.nvim_set_hl(0, "IndentCyan", { fg = palette.cyan })
      vim.api.nvim_set_hl(0, "IndentInactive", { fg = palette.dimmed4 })

      -- Render Markdown
      vim.api.nvim_set_hl(0, "RenderMarkdownHeader", { bg = palette.dark1, fg = palette.green });
      vim.api.nvim_set_hl(0, "RenderMarkdownCode", { bg = palette.dark1 });
      vim.api.nvim_set_hl(0, "RenderMarkdownCodeInline", { bg = palette.dark1 });
    end,
  }
}
