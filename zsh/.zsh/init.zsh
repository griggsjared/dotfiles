# Core ZSH initialization - plugins, completions, and external sources

# Set XDG config home
export XDG_CONFIG_HOME="$HOME/.config"

# Load Docker init if available
[[ -f "$HOME/.docker/init-zsh.sh" ]] && source "$HOME/.docker/init-zsh.sh"

# ZSH plugins
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

# NVM bash completion
[ -s "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm" ] && \. "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm"
