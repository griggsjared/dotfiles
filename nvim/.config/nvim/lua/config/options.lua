-- General
vim.opt.number = true -- Line numbers
vim.opt.relativenumber = true -- Relative line numbers
vim.opt.cursorline = true -- Highlight current line
vim.opt.wrap = false -- Don't wrap lines
vim.opt.scrolloff = 10 -- Keep lines above/below cursor
vim.opt.sidescrolloff = 8 -- Keep columns left/right of cursor
vim.opt.mousescroll = "ver:3,hor:0"
vim.opt.swapfile = false -- Disable swap files
vim.opt.showmode = false -- Don't show mode in command line
vim.opt.clipboard = "unnamedplus" -- Use system clipboard
vim.opt.listchars = "eol:¬,tab:>·,trail:~,extends:>,precedes:<,space:␣" -- Invisible character glyphs
vim.opt.title = true -- Enable title in terminal
vim.opt.titlelen = 0 -- Do not shorten title
vim.opt.titlestring = "nvim %{expand('%:p')}" -- Title shows current file path
vim.opt.winborder = "rounded" -- Rounded window borders
vim.opt.autoread = true -- Reload files changed outside Neovim
vim.opt.updatetime = 300

-- Indentation
vim.opt.tabstop = 2 -- Tab width
vim.opt.shiftwidth = 2 -- Indent width
vim.opt.softtabstop = 2 -- Soft tab stop
vim.opt.expandtab = true -- Use spaces instead of tabs
vim.opt.smartindent = true -- Smart auto-indenting
vim.opt.autoindent = true -- Copy indent from current line

-- Tabs
vim.opt.showtabline = 0 -- 0=never, 1=when multiple, 2=always

-- Folding (ufo provider needs large foldlevel)
vim.opt.foldcolumn = "0"
vim.opt.foldlevel = 99
vim.opt.foldlevelstart = 99
vim.opt.foldenable = true

-- Spell checking (off by default)
vim.opt.spelllang = "en_us"
vim.opt.spell = false
