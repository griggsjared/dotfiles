# Core ZSH initialization - plugins, completions, and external sources

# Set XDG config home
export XDG_CONFIG_HOME="$HOME/.config"

# ZSH autocomplete functions
if type brew &>/dev/null; then
    FPATH=$(brew --prefix)/share/zsh-completions:$FPATH

    setopt completealiases
    autoload -Uz compinit
    
    compinit -i
fi

# Load Docker init if available
[[ -f "$HOME/.docker/init-zsh.sh" ]] && source "$HOME/.docker/init-zsh.sh"

# NVM bash completion
[ -s "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm" ] && \. "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm"

# ZSH plugins loading

# Autosuggestions
source /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh || true

# Autocomplete
zstyle ':autocomplete:*' min-input 2
zstyle ':autocomplete:*' delay 0.1
zstyle ':autocomplete:*' max-lines 10
source /opt/homebrew/share/zsh-autocomplete/zsh-autocomplete.plugin.zsh || true

# Syntax highlighting
source /opt/homebrew/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh || true
