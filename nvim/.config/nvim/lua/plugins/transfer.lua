return {
  "coffebar/transfer.nvim",
  lazy = true,
  cmd = { "TransferInit", "DiffRemote", "TransferUpload", "TransferDownload", "TransferDirDiff", "TransferRepeat" },
  config = function()
    require("transfer").setup()
		vim.keymap.set("n", "<leader>ur", "<cmd>DiffRemote<cr>", { desc = "Diff with remote" })
    vim.keymap.set("n", "<leader>uu", "<cmd>TransferUpload<cr>", { desc = "Upload file to remote" })
    vim.keymap.set("n", "<leader>ud", "<cmd>TransferDownload<cr>", { desc = "Download file from remote" })
  end,
}
