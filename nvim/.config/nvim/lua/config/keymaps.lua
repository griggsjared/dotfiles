-- Spell checking
vim.keymap.set("n", "<leader>sc", "<cmd>set spell!<cr>", { desc = "Toggle spell check" })
vim.keymap.set("n", "<leader>sa", "zg", { desc = "Add word to dictionary" })

-- Delete without yanking
vim.keymap.set({ "n", "v" }, "d", '"_d', { desc = "Delete without yanking" })
vim.keymap.set("n", "D", '"_D', { desc = "Delete to EOL without yanking" })

-- Buffers
vim.keymap.set("n", "<leader><leader>", "<cmd>b#<cr>", { desc = "Go to last buffer" })
vim.keymap.set("n", "<leader>bn", "<cmd>bn<cr>", { desc = "Go to next buffer" })
vim.keymap.set("n", "<leader>bp", "<cmd>bp<cr>", { desc = "Go to previous buffer" })

-- Show hidden characters
vim.keymap.set("n", "<leader>sh", "<cmd>set list!<cr>", { desc = "Toggle hidden characters" })

-- Move selection
vim.keymap.set("v", "J", ":m '>+1<CR>gv=gv", { desc = "Move selection down" })
vim.keymap.set("v", "K", ":m '<-2<CR>gv=gv", { desc = "Move selection up" })

-- :W typo alias
vim.api.nvim_create_user_command("W", "w", { bang = false, force = true })
