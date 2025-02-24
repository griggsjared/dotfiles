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
}
