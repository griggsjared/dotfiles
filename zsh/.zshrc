[[ -f "$HOME/.zsh/private.zsh" ]] && source "$HOME/.zsh/private.zsh"
[[ -f "$HOME/.docker/init-zsh.sh" ]] && source "$HOME/.docker/init-zsh.sh"
source /opt/homebrew/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh || true
source /opt/homebrew/share/zsh-autocomplete/zsh-autocomplete.plugin.zsh || true
source /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh || true

# ZSH autocomplete functions
if type brew &>/dev/null; then
    FPATH=$(brew --prefix)/share/zsh-completions:$FPATH

    setopt completealiases
    autoload -Uz compinit
    compinit -u
fi
  
[ -s "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm" ] && \. "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm"  # This loads nvm bash_completion

# ZSH auto complete - disable the up and down history 
bindkey '\e[A' up-line-or-history
bindkey '\eOA' up-line-or-history
bindkey '\e[B' down-line-or-history
bindkey '\eOB' down-line-or-history

# Enable magic space for autocomplete
bindkey ' ' magic-space  

# Open bufferline with Ctrl+e in insert moda
autoload -Uz edit-command-line
zle -N edit-command-line
bindkey '^E' edit-command-line

# Source fzf
source <(fzf --zsh)

#PROMPT CONFIG

# Set the prompt to show the current directory and git branch using vcs_info function
autoload -Uz vcs_info
zstyle ':vcs_info:*' enable git svn
zstyle ':vcs_info:git*' formats "(%b) "
precmd() {
    vcs_info
}
# Allow prompt substitution
setopt PROMPT_SUBST 

PROMPT='%F{blue}%~%f %F{red}${vcs_info_msg_0_}%f$ '

#ALIASES
alias ls='lsd -A'
alias php='valet php'
alias composer='valet composer'
alias lgit='lazygit'
alias v='nvim'
alias cat='bat -pp'
alias y='yazi'

# nah function to stash git changes or optionally reset tracked changes
nah() {
  if [[ "$1" == "-f" || "$1" == "--force" ]]; then
    shift
    printf "This will reset any changes tracked by git. Continue? [y/N] "
    read -r reply
    if [[ "$reply" != "y" && "$reply" != "Y" ]]; then
      echo "Aborted."
      return 1
    fi
    git reset --hard && git clean -df
    return $?
  fi

  git stash push "$@"
}

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

# baked function to switch themes interactively with fzf
baked() {
  local themes=("monokai" "onedark" "catppuccin" "tokyonight" "rosepine")
  local current_theme="${BAKED_THEME:-monokai}"
  local selected
  
  # Use fzf to select a theme, with current theme pre-selected
  selected="$(printf '%s\n' "${themes[@]}" | fzf --prompt="Select theme: " --height=40% --ansi --reverse --header="Current: $current_theme")"
  
  # Exit if no selection made
  if [ -z "$selected" ]; then
    return 0
  fi
  
  # Update or create the BAKED_THEME export in private.zsh
  local private_file="$HOME/.zsh/private.zsh"
  
  # Create private.zsh if it doesn't exist
  if [ ! -f "$private_file" ]; then
    touch "$private_file"
  fi
  
  # Remove existing BAKED_THEME lines and add new one
  if grep -q "^export BAKED_THEME=" "$private_file"; then
    # Delete existing uncommented BAKED_THEME lines
    sed -i '' '/^export BAKED_THEME=/d' "$private_file"
  fi
  echo "export BAKED_THEME=\"$selected\"" >> "$private_file"
  
  # Export the new theme immediately
  export BAKED_THEME="$selected"
  
  # Regenerate theme configs
  if [[ -x "$HOME/.dotfiles/colors/generate-themes.sh" ]]; then
    "$HOME/.dotfiles/colors/generate-themes.sh"
  fi
  
  # If running in Ghostty, reload its config
  if [[ "$TERM_PROGRAM" == "ghostty" ]]; then
    if [[ "$(uname)" == "Darwin" ]]; then
      osascript -e 'tell application "System Events" to keystroke "," using {command down, shift down}' 2>/dev/null
      echo "✓ Switched to $selected theme (Ghostty config reloaded)"
    else
      if command -v xdotool &>/dev/null; then
        xdotool key --clearmodifiers ctrl+shift+comma
        echo "✓ Switched to $selected theme (Ghostty config reloaded)"
      else
        echo "✓ Switched to $selected theme (press ctrl+shift+, to reload Ghostty)"
      fi
    fi
  else
    echo "✓ Switched to $selected theme (restart terminal to apply)"
  fi
  
  # Re-source zshrc to pick up any other changes
  source "$HOME/.zshrc"
}

# chpwd function automatically called when directory changes.
chpwd() {
  ls
}

#PATHS
export PATH=$HOME/.local/bin:$PATH

if [ -d $HOME/.composer/vendor/bin ]; then
  export PATH=$HOME/.composer/vendor/bin:$PATH
fi

if [ -d $HOME/go/bin ]; then
  export GOPATH=$HOME/go
  export PATH=$HOME/go/bin:$PATH
fi

if [ -d "/opt/homebrew/opt/ruby/bin" ]; then
  export PATH=/opt/homebrew/opt/ruby/bin:$PATH
  export PATH=`gem environment gemdir`/bin:$PATH
fi

if [ -d "/opt/homebrew/opt/mysql-client/bin" ]; then
  export PATH=/opt/homebrew/opt/mysql-client/bin:$PATH
fi

# ENV VARIABLES
export BAT_THEME="base16" #theme for the bat (cat replacement) command
export EDITOR=nvim

# Theme configuration - can be overridden in ~/.zsh/private.zsh
export BAKED_THEME="${BAKED_THEME:-monokai}"

# Generate theme configs on shell init
[[ -x "$HOME/.dotfiles/colors/generate-themes.sh" ]] && "$HOME/.dotfiles/colors/generate-themes.sh"

# Source FZF theme (generated by generate-themes.sh)
[[ -f "$HOME/.dotfiles/zsh/fzf-theme.zsh" ]] && source "$HOME/.dotfiles/zsh/fzf-theme.zsh"

if [[ "$TERM_PROGRAM" == "ghostty" ]]; then
    export TERM=xterm-256color
fi
