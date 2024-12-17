-- I am not sure why but using the table from the plugin is causing an issue.
-- Just pulling the palette tabel directly into the file instead...
-- local default_pallete = require('monokai-pro.colorscheme.palette.pro')
local default_pallete = {
  accent1 = "#ff6188", -- red
  accent2 = "#fc9867", -- orange - slots into the blue ansi
  accent3 = "#ffd866", -- yellow
  accent4 = "#a9dc76", -- green
  accent5 = "#78dce8", -- cyan
  accent6 = "#ab9df2", -- magenta
  background = "#2d2a2e",
  dark1 = "#221f22",
  dark2 = "#19181a",
  dimmed1 = "#c1c0c0", -- light grey
  dimmed2 = "#939293", -- medium grey - borders
  dimmed3 = "#727072", -- dark grey
  dimmed4 = "#5b595c", -- darker grey
  dimmed5 = "#403e41", -- darkest grey
  text = "#fcfcfa"
}

local pallete = vim.tbl_extend("force", default_pallete, {
  -- overrides
  background = "#1a1a1a",
  dark1 = "#090909",
  dark2 = "#0a0a0a",
  -- aliases
  red = default_pallete.accent1,
  orange = default_pallete.accent2,
  yellow = default_pallete.accent3,
  green = default_pallete.accent4,
  cyan = default_pallete.accent5,
  magenta = default_pallete.accent6,
})

return pallete
