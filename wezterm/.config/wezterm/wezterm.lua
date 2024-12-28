local wezterm = require('wezterm')
local config = wezterm.config_builder()

wezterm.on("gui-startup", function()
  local _, _, window = wezterm.mux.spawn_window{}
  window:gui_window():maximize()
end)

--fonts
config.font = wezterm.font("Hack Nerd Font")
config.font_size = 15

--colors
config.colors = {
  foreground = "#fbfcfa",
  background = "#1a1a1a",
  cursor_border = "#fbfcfa",
  ansi = {
    "#1a1a1a", --black
    "#ff6188", --red
    "#a9dc76", --green
    "#ffd866", --yellow
    "#fc9867", --blue
    "#ab9df2", --magenta
    "#78dce8", --cyan
    "#fbfcfa", --white
  },
  brights = {
    "#727072", --black
    "#ec6b88", --red
    "#b3da82", --green
    "#f8d977", --yellow
    "#ee9c70", --blue
    "#a89dec", --magenta
    "#90d9e5", --cyan
    "#fbfcfa", --white
  },
}
config.force_reverse_video_cursor = true

--windows
config.window_background_opacity = .98
config.window_padding = {
  left = 1,
  right = 1,
  top = 1,
  bottom = 1,
}

config.window_frame = {
  active_titlebar_bg = "none",
  inactive_titlebar_bg = "none",
}

--tab bars
config.use_fancy_tab_bar = false
config.hide_tab_bar_if_only_one_tab = true

return config
