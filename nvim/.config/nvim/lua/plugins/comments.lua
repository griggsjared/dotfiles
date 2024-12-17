return {
  "numToStr/Comment.nvim",
  config = function()
    local ft = require('Comment.ft')
    ft.php = {'//%s', '/*%s*/'}
    ft.blade = {'{{--%s--}}', '{{!--%s--}}'}

    require("Comment").setup()
  end,
}
