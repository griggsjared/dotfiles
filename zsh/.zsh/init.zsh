# Core ZSH initialization - plugins, completions, and external sources

# Set XDG config home
export XDG_CONFIG_HOME="$HOME/.config"

# ZSH autocomplete functions (must load BEFORE plugins)
if type brew &>/dev/null; then
    FPATH=$(brew --prefix)/share/zsh-completions:$FPATH

    setopt completealiases
    
    # Fix homebrew share permissions to prevent "insecure directories" warning
    # Homebrew sometimes sets group write (775) which ZSH considers insecure
    [[ -d /opt/homebrew/share ]] && chmod 755 /opt/homebrew/share 2>/dev/null
    
    autoload -Uz compinit
    compinit
fi

# Load Docker init if available
[[ -f "$HOME/.docker/init-zsh.sh" ]] && source "$HOME/.docker/init-zsh.sh"

# NVM bash completion
[ -s "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm" ] && \. "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm"

# ZSH plugins loading

# Autosuggestions
ZSH_AUTOSUGGEST_USE_ASYNC=1
ZSH_AUTOSUGGEST_BUFFER_MAX_SIZE=20
source /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh || true

# Autocomplete
zstyle ':autocomplete:*' min-input 2
zstyle ':autocomplete:*' delay 0.1
zstyle ':autocomplete:*' max-lines 10
source /opt/homebrew/share/zsh-autocomplete/zsh-autocomplete.plugin.zsh || true

# Syntax highlighting
source /opt/homebrew/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh || true
