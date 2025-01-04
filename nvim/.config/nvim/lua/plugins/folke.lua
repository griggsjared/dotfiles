return {
  {
    "folke/snacks.nvim",
    priority = 1000,
    lazy = false,
    opts = {
      notifier = { enabled = true },
      statuscolumn = { enabled = true },
      lazygit = { enabled = true },
      bigfile = { enabled = true },
      quickfile = { enabled = true },
      scroll = { enabled = true, speed = 2 },
      input = { enabled = true },
      dashboard = {
        enabled = true,
        width = 80,
        preset = {
          keys = {
            { icon = " ", key = "f", desc = "Find File", action = "<leader>ff" },
            { icon = " ", key = "g", desc = "Find Text", action = "<leader>fg" },
            { icon = " ", key = "r", desc = "Recent Files", action = "<leader>fo" },
            { icon = " ", key = "c", desc = "Config", action = "<leader>fc" },
            { icon = "󰒲 ", key = "L", desc = "Lazy", action = ":Lazy" },
            { icon = " ", key = "l", desc = "LazyGit", action = "<leader>lg" },
            { icon = "󰏇 ", key = "o", desc = "Oil", action = ":Oil", },
            { icon = " ", key = "q", desc = "Quit", action = ":qa" },
          },
        },
        sections = {
          {
            header = [[
▄▄    ▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄   ▄▄ ▄▄▄ ▄▄   ▄▄
█  █  █ █       █       █  █ █  █   █  █▄█  █
█   █▄█ █    ▄▄▄█   ▄   █  █▄█  █   █       █
█       █   █▄▄▄█  █ █  █       █   █       █
█  ▄    █    ▄▄▄█  █▄█  █       █   █       █
█ █ █   █   █▄▄▄█       ██     ██   █ ██▄██ █
█▄█  █▄▄█▄▄▄▄▄▄▄█▄▄▄▄▄▄▄█ █▄▄▄█ █▄▄▄█▄█   █▄█]],
            padding = 1,
            gap = 1,
          },
          { section = "startup", gap = 1, padding = 1 },
          {
            icon = " ",
            title = "Working Directory",
            section = "terminal",
            cmd = "pwd",
            height = 1,
            padding = 1,
            ttl = 5 * 60,
            indent = 3,
          },
          { section = "keys",    gap = 1, padding = 1 },
          {
            icon = " ",
            title = "Git Status",
            section = "terminal",
            enabled = vim.fn.isdirectory(".git") == 1,
            cmd = "hub status --short --branch --renames",
            height = 5,
            padding = 1,
            ttl = 5 * 60,
            indent = 3,
          },
        },
      },
    },
    keys = {
      { "<leader>sd", "<CMD>lua Snacks.dashboard()<CR>", desc = "Show the dashboard" },
      { "<leader>lg", "<CMD>lua Snacks.lazygit()<CR>",   desc = "Show the lazygit" },
    },
  },
  {
    "folke/noice.nvim",
    event = "VeryLazy",
    dependencies = {
      "MunifTanjim/nui.nvim",
    },
    config = function()
      require("noice").setup({
        lsp = {
          override = {
            ["vim.lsp.util.convert_input_to_markdown_lines"] = true,
            ["vim.lsp.util.stylize_markdown"] = true,
            ["cmp.entry.get_documentation"] = true
          },
        },
        -- you can enable a preset for easier configuration
        presets = {
          bottom_search = false,          -- use a classic bottom cmdline for search
          command_palette = false,        -- position the cmdline and popupmenu together
          long_message_to_split = true,   -- long messages will be sent to a split
          inc_rename = false,             -- enables an input dialog for inc-rename.nvim
          lsp_doc_border = true,          -- add a border to hover docs and signature help
        },
      })

      vim.api.nvim_create_autocmd("RecordingEnter", {
        callback = function()
          local msg = string.format("Register:  %s", vim.fn.reg_recording())
          _MACRO_RECORDING_STATUS = true
          vim.notify(msg, vim.log.levels.INFO, {
            title = "Macro Recording",
            keep = function() return _MACRO_RECORDING_STATUS end,
          })
        end,
        group = vim.api.nvim_create_augroup("NoiceMacroNotfication", { clear = true })
      })

      vim.api.nvim_create_autocmd("RecordingLeave", {
        callback = function()
          _MACRO_RECORDING_STATUS = false
          vim.notify("Success!", vim.log.levels.INFO, {
            title = "Macro Recording End",
            timeout = 2000,
          })
        end,
        group = vim.api.nvim_create_augroup("NoiceMacroNotficationDismiss", { clear = true })
      })
    end
  },
  {
    "folke/trouble.nvim",
    opts = {}, -- for default options, refer to the configuration section for custom setup.
    cmd = "Trouble",
    keys = {
      {
        "<leader>xx",
        "<cmd>Trouble diagnostics toggle<cr>",
        desc = "Diagnostics (Trouble)",
      },
      {
        "<leader>xX",
        "<cmd>Trouble diagnostics toggle filter.buf=0<cr>",
        desc = "Buffer Diagnostics (Trouble)",
      },
      {
        "<leader>cs",
        "<cmd>Trouble symbols toggle focus=false<cr>",
        desc = "Symbols (Trouble)",
      },
      {
        "<leader>cl",
        "<cmd>Trouble lsp toggle focus=false win.position=right<cr>",
        desc = "LSP Definitions / references / ... (Trouble)",
      },
      {
        "<leader>xL",
        "<cmd>Trouble loclist toggle<cr>",
        desc = "Location List (Trouble)",
      },
      {
        "<leader>xQ",
        "<cmd>Trouble qflist toggle<cr>",
        desc = "Quickfix List (Trouble)",
      },
    },
  }

}
