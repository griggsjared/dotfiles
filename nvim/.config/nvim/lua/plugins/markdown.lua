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
