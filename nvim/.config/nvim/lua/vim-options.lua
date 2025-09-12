local augroup = vim.api.nvim_create_augroup("UserConfig", {})

-- General options
vim.opt.number = true -- Line numbers
vim.opt.relativenumber = true -- Relative line numbers
vim.opt.cursorline = true -- Highlight current line
vim.opt.wrap = false -- Don't wrap lines
vim.opt.scrolloff = 10 -- Keep 10 lines above/below cursor
vim.opt.sidescrolloff = 8 -- Keep 8 columns left/right of cursor
vim.g.mapleader = " " -- Set leader key to space
vim.opt.swapfile = false -- Disable swap files
vim.opt.showmode = false -- Don't show mode in command line
vim.opt.clipboard = "unnamedplus" -- Use system clipboard
vim.opt.listchars = "eol:¬,tab:>·,trail:~,extends:>,precedes:<,space:␣" -- Characters to show for special characters
vim.opt.title = true -- Enable title in terminal
vim.opt.titlelen = 0 -- Do not shorten title
vim.opt.titlestring = "nvim %{expand('%:p')}" -- Set title string to current file path

-- Indentation options
vim.opt.tabstop = 2        -- Tab width
vim.opt.shiftwidth = 2     -- Indent width
vim.opt.softtabstop = 2    -- Soft tab stop
vim.opt.expandtab = true   -- Use spaces instead of tabs
vim.opt.smartindent = true -- Smart auto-indenting
vim.opt.autoindent = true  -- Copy indent from current line

-- Set 4 space indentation for specific file types
vim.api.nvim_create_autocmd("FileType", {
  group = augroup,
  pattern = { "php", "python" },
  callback = function()
    vim.opt_local.tabstop = 4
    vim.opt_local.shiftwidth = 4
  end,
})

-- Tabs Display options
vim.opt.showtabline = 0 -- Never show tabline (0=never, 1=when multiple tabs, 2=always)

--Search options
-- vim.opt.ignorecase = true -- Case insensitive search
-- vim.opt.smartcase = true -- Case sensitive if uppercase in search

--Folding options
vim.o.foldcolumn = "0"    -- Value of 1 will show a column with the indents amounts for the line
vim.o.foldlevel = 99      -- Using ufo provider need a large value
vim.o.foldlevelstart = 99 -- Start with all folds open
vim.o.foldenable = true   -- Enable folding

--Spell checking options
vim.opt.spelllang = "en_us"
vim.opt.spell = false -- off by default

vim.api.nvim_set_keymap("n", "<leader>sc", ":set spell!<CR>", { noremap = true, desc = "Toggle for spell check" })
vim.api.nvim_set_keymap("n", "<leader>sa", "zg", { noremap = true, desc = "Add current word to dictionary" })

vim.keymap.set({ "n", "x", "v" }, "d", '"_d', { noremap = true, silent = true, desc = "Delete without yanking" })
vim.keymap.set("n", "D", '"_D', { noremap = true, silent = true, desc = "Delete to EOL without yanking" })

vim.api.nvim_set_keymap(
  "n",
  "<leader>bc",
  ":bp<bar>sp<bar>bn<bar>bd<CR>",
  { noremap = true, desc = "Close current buffer" }
)
vim.api.nvim_set_keymap("n", "<leader>ba", ":bufdo bd<CR>", { noremap = true, desc = "Close all buffers" })
vim.api.nvim_set_keymap("n", "<leader><leader>", ":b#<CR>", { noremap = true, desc = "Go to last buffer" })
vim.api.nvim_set_keymap("n", "<leader>bn", ":bn<CR>", { noremap = true, desc = "Go to next buffer" })
vim.api.nvim_set_keymap("n", "<leader>bp", ":bp<CR>", { noremap = true, desc = "Go to previous buffer" })

vim.api.nvim_set_keymap("n", "<leader>sh", ":set list!<CR>", { noremap = true, desc = "Toggle show hidden characters" })

vim.keymap.set("v", "J", ":m '>+1<CR>gv=gv")
vim.keymap.set("v", "K", ":m '<-2<CR>gv=gv")

vim.api.nvim_create_user_command("W", "w", { bang = false, force = true })

vim.o.autoread = true
vim.opt.updatetime = 300
vim.api.nvim_create_autocmd({ "FocusGained", "BufEnter", "CursorHold" }, {
  pattern = "*", -- Apply to all files
  command = "checktime",
})

-- copy the current file path relative the the cwd
vim.keymap.set('n', '<leader>yp', function()
  local path = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(0), ':.')
  if path == '' then
    return
  end
  vim.fn.setreg('+', path)
  vim.notify('Copied: ' .. path)
end, { desc = 'Copy relative file path' })

-- copy the current file name
vim.keymap.set('n', '<leader>yf', function()
  local name = vim.api.nvim_buf_get_name(0):match('[^/]*$')
  if name == '' then
    return
  end
  vim.fn.setreg('+', name)
  vim.notify('Copied: ' .. name)
end, { desc = 'Copy file name' })
