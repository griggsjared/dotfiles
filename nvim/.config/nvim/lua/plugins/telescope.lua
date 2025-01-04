return {
  {
    "nvim-telescope/telescope.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
      'nvim-telescope/telescope-ui-select.nvim',
      { 'nvim-telescope/telescope-fzf-native.nvim', build = 'make' }
    },
    config = function()
      local telescope = require("telescope")
      local telescope_builtin = require("telescope.builtin")
      local telescope_themes = require("telescope.themes")
      local telescope_actions = require("telescope.actions")
      local telescope_multigrep = require("telescope.multigrep")

      telescope.setup({
        extensions = {
          ['ui-select'] = {
            telescope_themes.get_dropdown({}),
          },
          fzf = {
            fuzzy = true,
            override_generic_sorter = true,
            override_file_sorter = true,
          },
        },
        pickers = {
          buffers = {
            theme = "ivy",
          },
          spell_suggest = {
            theme = "dropdown",
          }
        },
        defaults = {
          mappings = {
            i = {
              ["<esc>"] = telescope_actions.close,
            }
          }
        }
      })

      telescope.load_extension('ui-select')
      telescope.load_extension('fzf')

      vim.keymap.set("n", "<leader>ff", telescope_builtin.find_files, { desc = "Find Files" })
      vim.keymap.set({"n", "v"}, "<leader>fg", telescope_multigrep.live_multigrep, { desc = "Grep Files w/ Glob" })
      vim.keymap.set("n", "<leader>fb", telescope_builtin.buffers, { desc = "Find Current Buffers" })
      vim.keymap.set("n", "<leader>fo", function()
        telescope_builtin.oldfiles({
          cwd_only = true,
          prompt_title = "Old Files (Project)"
        })
      end, { desc = "Find Recenty Opened Files in CWD/Project" })
      vim.keymap.set("n", "<leader>fO", function()
        telescope_builtin.oldfiles({
          cwd_only = false,
          default_term = "foobar",
          prompt_title = "Old Files (All)"
        })
      end, { desc = "Find Recenty Opened Files" })
      vim.keymap.set("n", "<leader>fi", telescope_builtin.current_buffer_fuzzy_find, {
        desc = "Grep In Current Buffer",
      })
      vim.keymap.set("n", "<leader>ss", telescope_builtin.spell_suggest, { desc = "Spell Suggest" })
      vim.keymap.set("n", "<leader>fh", telescope_builtin.help_tags, { desc = "Find Help Tags" })
      vim.keymap.set("n", "<leader>fk", telescope_builtin.keymaps, { desc = "Find Keymaps" })
      vim.keymap.set("n", "<leader>fc", function()
        telescope_builtin.find_files({
          prompt_title = "Find Config Files",
          cwd = vim.fn.stdpath("config"),
        })
      end, { desc = "Find Config Files" })
      vim.keymap.set("n", "<leader>fp", function()
        telescope_builtin.find_files({
          prompt_title = "Find In All Project Files",
          cwd = "~/Projects",
        })
      end, { desc = "Find In All Project Files" })

      local last_search = nil
      vim.keymap.set("n", "<leader><leader>", function()
        if last_search == nil then
          telescope_builtin.find_files()
          local cached_pickers = require("telescope.state").get_global_key("cached_pickers") or {}
          last_search = cached_pickers[1]
        else
          telescope_builtin.resume({ picker = last_search })
        end
      end, {})
    end,
  },
}
