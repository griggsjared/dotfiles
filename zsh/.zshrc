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
  file="$(fzf --query="$initial_query" --height=40% --ansi --preview='bat --style=numbers --color=always {}' --preview-window=right:60%:wrap --border)"
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
export FZF_DEFAULT_OPTS=$FZF_DEFAULT_OPTS' --color=fg:#fbfcfa,bg:#1a1a1a,hl:#78dce8 --color=fg+:#fbfcfa,bg+:#1a1a1a,hl+:#78dce8 --color=info:#a9dc76,prompt:#ff6188,pointer:#fc9867 --color=marker:#a9dc76,spinner:#ab9df2,header:#fc9867'

if [[ "$TERM_PROGRAM" == "ghostty" ]]; then
    export TERM=xterm-256color
fi

# Load private configuration
[[ -f "$HOME/.zsh/private.zsh" ]] && source "$HOME/.zsh/private.zsh"
