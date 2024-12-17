return {
  "romgrk/barbar.nvim",
  dependencies = {
    'lewis6991/gitsigns.nvim',
    'nvim-tree/nvim-web-devicons',
  },
  config = function()
    vim.keymap.set("n", "<A-,>", ":BufferPrevious<CR>", { noremap = true, silent = true })
    vim.keymap.set("n", "<A-.>", ":BufferNext<CR>", { noremap = true, silent = true })
    vim.keymap.set("n", "<A-<>", ":BufferMovePrevious<CR>", { noremap = true, silent = true })
    vim.keymap.set("n", "<A->>", ":BufferMoveNext<CR>", { noremap = true, silent = true })
    vim.keymap.set("n", "<A-1>", ":BufferGoto 1<CR>", { noremap = true, silent = true })
    vim.keymap.set("n", "<A-2>", ":BufferGoto 2<CR>", { noremap = true, silent = true })
    vim.keymap.set("n", "<A-3>", ":BufferGoto 3<CR>", { noremap = true, silent = true })
    vim.keymap.set("n", "<A-4>", ":BufferGoto 4<CR>", { noremap = true, silent = true })
    vim.keymap.set("n", "<A-5>", ":BufferGoto 5<CR>", { noremap = true, silent = true })
    vim.keymap.set("n", "<A-6>", ":BufferGoto 6<CR>", { noremap = true, silent = true })
    vim.keymap.set("n", "<A-7>", ":BufferGoto 7<CR>", { noremap = true, silent = true })
    vim.keymap.set("n", "<A-8>", ":BufferGoto 8<CR>", { noremap = true, silent = true })
    vim.keymap.set("n", "<A-9>", ":BufferLast<CR>", { noremap = true, silent = true })
    vim.keymap.set("n", "<A-c>", ":BufferClose<CR>", { noremap = true, silent = true })
  end
}
