# Key bindings

# ZSH auto complete - disable the up and down history 
bindkey '\e[A' up-line-or-history
bindkey '\eOA' up-line-or-history
bindkey '\e[B' down-line-or-history
bindkey '\eOB' down-line-or-history

# Enable magic space for autocomplete
bindkey ' ' magic-space  

# Open buffer in editor with Ctrl+E
autoload -Uz edit-command-line
zle -N edit-command-line
bindkey '^E' edit-command-line
