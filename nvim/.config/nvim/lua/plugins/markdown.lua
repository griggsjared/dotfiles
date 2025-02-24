return {
  -- {
  --   "OXY2DEV/markview.nvim",
  --   lazy = false,
  --   config = function()
  --     local presets = require("markview.presets");
  --     require("markview").setup({
  --       preview = {
  --         filetypes = { "markdown", "codecompanion" },
  --         ignore_buftypes = {},
  --         icon_provider = "mini",
  --       },
  --       markdown = {
  --         headings = presets.headings.glow
  --       }
  --     })
  --   end,
  -- }
  {
    'MeanderingProgrammer/render-markdown.nvim',
    dependencies = { 'nvim-treesitter/nvim-treesitter', 'nvim-tree/nvim-web-devicons' },
    ft = { "markdown", "codecompanion" },
    config = function()
      local palette = require("monokai-pro.override")

      vim.api.nvim_set_hl(0, "RenderMarkdownHeader", { bg = palette.dark1, fg = palette.green });
      vim.api.nvim_set_hl(0, "RenderMarkdownCode", { bg = palette.dark1 });
      vim.api.nvim_set_hl(0, "RenderMarkdownCodeInline", { bg = palette.dark1 });

      require('render-markdown').setup({
        heading = {
          backgrounds = {
            "RenderMarkdownHeader"
          },
          foregrounds = {
            "RenderMarkdownHeader"
          },
        }
      })
    end
  }
}
