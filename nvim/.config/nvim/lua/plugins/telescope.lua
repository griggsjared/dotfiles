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

      require("telescope").setup({
        extensions = {
          ['ui-select'] = {
            require("telescope.themes").get_dropdown({}),
          },
          fzf = {
            fuzzy = true,
            override_generic_sorter = true,
            override_file_sorter = true,
          },
        },
      })

      telescope.load_extension('ui-select')
      telescope.load_extension('fzf')

      vim.keymap.set("n", "<leader>ff", telescope_builtin.find_files, {})
      vim.keymap.set("n", "<leader>fg", require("telescope.multigrep").live_multigrep, {})
      vim.keymap.set("n", "<leader>fb", telescope_builtin.buffers, {})
      vim.keymap.set("n", "<leader>fo", telescope_builtin.oldfiles, {})
      vim.keymap.set("n", "<leader>fc", function()
        telescope_builtin.find_files({
          prompt_title = "Find Config Files",
          cwd = vim.fn.stdpath("config"),
        })
      end, {})
      vim.keymap.set("n", "<leader>fp", function()
        telescope_builtin.find_files({
          prompt_title = "Find In All Project Files",
          cwd = "~/Projects",
        })
      end, {})

      local last_search = nil
      vim.keymap.set("n", "<leader><leader>", function()
        if last_search == nil then
          telescope.find_files()
          local cached_pickers = require("telescope.state").get_global_key("cached_pickers") or {}
          last_search = cached_pickers[1]
        else
          telescope.resume({ picker = last_search })
        end
      end, {})
    end,
  },
}
