return {
  {
    "lewis6991/gitsigns.nvim",
    config = function()
      require("gitsigns").setup()
      vim.keymap.set("n", "<leader>gp", ":Gitsigns preview_hunk<CR>", { desc = "Toggle git blame for current line" })
      vim.keymap.set("n", "<leader>gt", ":Gitsigns toggle_current_line_blame<CR>", { desc = "Toggle git blame for current line" })
    end,
  },
}
