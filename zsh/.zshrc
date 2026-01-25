# Source private config first (can override defaults)
[[ -f "$HOME/.zsh/private.zsh" ]] && source "$HOME/.zsh/private.zsh"

# Core ZSH configuration - must load first
source "$HOME/.zsh/init.zsh"

# UI configuration
source "$HOME/.zsh/prompt.zsh"
source "$HOME/.zsh/keybindings.zsh"

# Tool-specific configuration
source "$HOME/.zsh/fzf.zsh"
source "$HOME/.zsh/git.zsh"
source "$HOME/.zsh/editor.zsh"
source "$HOME/.zsh/navigation.zsh"
source "$HOME/.zsh/theme.zsh"

# Environment must load last (PATH additions, etc.)
source "$HOME/.zsh/env.zsh"
