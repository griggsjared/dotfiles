return {
  {
    "folke/todo-comments.nvim",
    dependencies = { "nvim-lua/plenary.nvim" },
    opts = {
      highlight = {
        keyword = "bg",
      }
    }
  },
  {
    "numToStr/Comment.nvim",
    config = function()
      local ft = require('Comment.ft')
      ft.php = { '//%s', '/*%s*/' }
      ft.blade = { '{{--%s--}}', '{{!--%s--}}' }

      require("Comment").setup()
    end,
  }
}
