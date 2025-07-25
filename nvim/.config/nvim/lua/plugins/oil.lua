return {
  {
    "stevearc/oil.nvim",
    opts = {},
    dependencies = { { "echasnovski/mini.icons", opts = {} } },
    config = function()
      function _G.get_oil_winbar()
        local dir = require("oil").get_current_dir()
        if dir then
          return vim.fn.fnamemodify(dir, ":~")
        else
          return vim.api.nvim_buf_get_name(0)
        end
      end

      local detail = false

      require("oil").setup({
        icons = require("mini.icons"),
        default_file_explorer = true,
        delete_to_trash = true,
        skip_confirm_for_simple_edits = true,
        win_options = {
          winbar = "%!v:lua.get_oil_winbar()",
        },
        view_options = {
          show_hidden = true,
          is_always_hidden = function(name)
            local black_list = {
              ".git/",
              ".DS_Store",
              ".null-ls*"
            }
            for _, v in ipairs(black_list) do
              if name:match(v) then
                return true
              end
            end
          end,
        },
        keymaps = {
          ["<C-p>"] = { "actions.preview", opts = { vertical = true, split = "botright" } },
          ["<leader><esc>"] = "actions.close",
          ["q"] = "actions.close",
          ["gd"] = {
            desc = "Toggle file detail view",
            callback = function()
              detail = not detail
              if detail then
                require("oil").set_columns({ "icon", "permissions", "size", "mtime" })
              else
                require("oil").set_columns({ "icon" })
              end
            end,
          },
        },
      })
      vim.keymap.set("n", "-", function ()
        require("oil").open()
      end, { desc = "Open parent directory (oil.nvim)" })
    end,
  },
}
