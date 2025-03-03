return {
  {
    "loctvl842/monokai-pro.nvim",
    priority = 1000,
    lazy = false,
    config = function()
      local default_palette = require('monokai-pro.colorscheme.palette.pro')
      local palette = vim.tbl_extend("force", default_palette, {
        -- overrides
        background = "#1a1a1a",
        dark1 = "#090909",
        dark2 = "#0a0a0a",
        -- aliases
        red = default_palette.accent1,
        orange = default_palette.accent2,
        yellow = default_palette.accent3,
        green = default_palette.accent4,
        cyan = default_palette.accent5,
        magenta = default_palette.accent6,
      })

      local highlights = {
        FloatBorder = { bg = palette.dark2, fg = palette.dimmed2 },
        NormalFloat = { bg = palette.dark2, fg = palette.text },
        CmpItemKindCopilot = { fg = palette.cyan },
        Visual = { bg = palette.dimmed4 },
        -- Indent Blankline
        IndentActive = { fg = palette.red },
        IndentInactive = { fg = palette.dimmed4 },
        -- Render Markdown
        RenderMarkdownHeader = { bg = palette.dark1, fg = palette.green },
        RenderMarkdownCode = { bg = palette.dark1 },
        RenderMarkdownCodeInline = { bg = palette.dark1 },

        -- Treesitter Bolds
        ["@keyword"] = { bold = true },
        ["@keyword.lua"] = { bold = true },
        ["@keyword.function"] = { bold = true },
        ["@keyword.function.lua"] = { bold = true },
        ["@keyword.function.go"] = { bold = true },
        ["@keyword.type"] = { bold = true },
        ["@keyword.import"] = { bold = true },
        ["@keyword.operator"] = { bold = true },
        ["@keyword.conditional"] = { bold = true },
        ["@keyword.repeat"] = { bold = true },
        ["@keyword.return"] = { bold = true },
        -- ["@function.builtin"] = { bold = true },
        -- ["@type.builtin"] = { bold = true }
      }

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
        override = function()
          return highlights
        end
      })
      vim.cmd([[colorscheme monokai-pro]])
    end,
  },
  {
    "olimorris/onedarkpro.nvim",
    priority = 1000,
    lazy = false,
    config = function()
      local background = "#1a1a1a";
      require("onedarkpro").setup({
        colors = {
          bg = background,
        },
        options = {
          transparency = false
        },
        highlights = {
          Normal = { bg = "${none}" },
          IndentActive = { fg = "${red}" },
          IndentInactive = { fg = "${gray}" },
        },
        styles = {
          types = "italic",
          methods = "NONE",
          numbers = "NONE",
          strings = "NONE",
          comments = "italic",
          keywords = "bold",
          constants = "NONE",
          functions = "italic",
          operators = "NONE",
          variables = "NONE",
          parameters = "NONE",
          conditionals = "NONE",
          virtual_text = "NONE",
        },
        filetypes = {
          php = false
        }
      })
      -- vim.cmd([[colorscheme onedark]])
    end,
  }
}
