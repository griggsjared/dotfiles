return {
  {
    "zbirenbaum/copilot.lua",
    cmd = "Copilot",
    event = "InsertEnter",
    config = function()
      require("copilot").setup({
        suggestion = {
          auto_trigger = false,
          accept_newline = true,
        },
      })

      vim.keymap.set("i", "<S-Tab>", function() require("copilot.suggestion").accept() end, { silent = true })
      vim.keymap.set("n", "<leader>cs", function() require("copilot.suggestion").toggle_auto_trigger() end,
        { silent = true })
    end,
  },
  {
    "zbirenbaum/copilot-cmp",
    after = { "copilot.lua" },
    config = function()
      require("copilot_cmp").setup()
    end,
  },
  {
    "CopilotC-Nvim/CopilotChat.nvim",
    dependencies = {
      { "zbirenbaum/copilot.lua" },
      { "nvim-lua/plenary.nvim", branch = "master" },
    },
    build = "make tiktoken",
    config = function()
      require("CopilotChat").setup({
        model = "claude-3.5-sonnet"
      })

      vim.keymap.set({ "v", "n" }, "<leader>cc", function() require("CopilotChat").toggle() end, { silent = true })
      vim.keymap.set("n", "<leader>cq",
        function()
          local input = vim.fn.input("Quick Chat: ")
          if input ~= "" then
            require("CopilotChat").ask(input, { selection = require("CopilotChat.select").buffer })
          end
        end,
        { silent = true }
      )
    end
  }
}
