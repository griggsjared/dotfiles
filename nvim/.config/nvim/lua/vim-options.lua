vim.cmd("set expandtab") -- Use spaces instead of tab
vim.cmd("set tabstop=2") -- Number of spaces that a <Tab> in the file counts for
vim.cmd("set softtabstop=2") -- Number of spaces that a <Tab> counts for while performing editing operations
vim.cmd("set shiftwidth=2") -- Number of spaces to use for each step of (auto)indent
vim.cmd("set smartindent") -- Do smart auto indenting when starting a new line
vim.cmd("set autoindent") -- Copy indent from current line when starting a new line
vim.cmd("set clipboard=unnamedplus") -- Use system clipboard
vim.cmd("set listchars=eol:¬,tab:>·,trail:~,extends:>,precedes:<,space:␣") -- highlight special characters

vim.g.mapleader = " "
vim.opt.swapfile = false

vim.wo.number = true
vim.wo.relativenumber = true
vim.wo.cursorline = true

vim.opt.title = true
vim.opt.titlelen = 0 -- do not shorten title
vim.opt.titlestring = 'nvim %{expand("%:p")}'

vim.o.foldcolumn = "0" -- Value of 1 will show a column with the indents amounts for the line
vim.o.foldlevel = 99 -- Using ufo provider need a large value, feel free to decrease the value
vim.o.foldlevelstart = 99
vim.o.foldenable = true

vim.opt.spelllang = 'en_us'
vim.opt.spell = false -- off by default

--map Del and backspace to the empty register in visual mode
vim.api.nvim_set_keymap("v", '<Del>', '"_d', { noremap = true })
vim.api.nvim_set_keymap("v", '<BS>', '"_d', { noremap = true })

--add toggle for spell check
vim.api.nvim_set_keymap("n", "<leader>sc", ":set spell!<CR>", { noremap = true })
-- add current word to dictionary
vim.api.nvim_set_keymap("n", "<leader>sa", "zg", { noremap = true })

--add close the current buffer and all buffers
vim.api.nvim_set_keymap("n", "<leader>bc", ":bp<bar>sp<bar>bn<bar>bd<CR>", { noremap = true })
vim.api.nvim_set_keymap("n", "<leader>ba", ":bufdo bd<CR>", { noremap = true })

--go to last buffer
vim.api.nvim_set_keymap("n", "<leader><leader>", ":b#<CR>", { noremap = true })
vim.api.nvim_set_keymap("n", "<leader>bl", ":b#<CR>", { noremap = true })

-- go to next buffer
vim.api.nvim_set_keymap("n", "<leader>bn", ":bn<CR>", { noremap = true })
vim.api.nvim_set_keymap("n", "<leader>bp", ":bp<CR>", { noremap = true })

--toggle to show hidden characters
vim.api.nvim_set_keymap("n", "<leader>sh", ":set list!<CR>", { noremap = true })

