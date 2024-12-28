return {
  {
    "stevearc/oil.nvim",
    opts = {},
    dependencies = { { "echasnovski/mini.icons", opts = {} } },
    config = function()
      require("oil").setup({
        icons = require("mini.icons"),
        default_file_explorer = true,
        delete_to_trash = true,
        skip_confirm_for_simple_edits = true,
        view_options = {
          show_hidden = true,
          is_always_hidden = function(name)
            local black_list = {
              ".git/",
              ".DS_Store",
            }
            for _, v in ipairs(black_list) do
              if name:match(v) then
                return true
              end
            end
          end,
        },
        keymaps = {
          ["<leader><esc>"] = "actions.close",
          ["<esc><esc>"] = "actions.close"
        },
      })

      vim.keymap.set("n", "-", "<CMD>Oil<CR>", { desc = "Open parent directory" })
    end,
  },
}
