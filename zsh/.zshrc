source $HOME/.docker/init-zsh.sh || true 
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

# ZSH auto complete - disable the up and down history 
bindkey '\e[A' up-line-or-history
bindkey '\eOA' up-line-or-history
bindkey '\e[B' down-line-or-history
bindkey '\eOB' down-line-or-history

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

#PATHS

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
source $HOME/.zsh/private.zsh || true
