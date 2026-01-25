# FZF configuration and related functions

# Source fzf
source <(fzf --zsh)

# FZF color scheme using terminal ANSI colors
export FZF_DEFAULT_OPTS="
  --color=fg:white,bg:black,hl:yellow
  --color=fg+:white,bg+:black,hl+:yellow
  --color=info:cyan,prompt:magenta,pointer:red
  --color=marker:green,spinner:yellow,header:cyan
  --color=border:white,label:white,query:white
  --color=gutter:black
"

# vf (vim find) function to find files with fzf and open in neovim
vf() {
  local initial_query="$1"
  local file
  file="$(fzf --query="$initial_query" --height=40% --ansi --preview='bat --style=numbers --color=always {}' --preview-window=right:60%:wrap)"
  if [ -z "$file" ]; then
    return 0
  fi
  nvim -- "$file"
}

# tmf (tmux find) function to find tmux sessions with fzf and connect to them
tmf() {
  local initial_query="$1"
  local session
  session="$(tm ls-all | fzf --query="$initial_query" --height=20% --ansi --reverse --select-1 --exit-0)"
  if [ -z "$session" ]; then
    return 0
  fi
  tm "${session%% *}"
}
