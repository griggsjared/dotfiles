# Prompt configuration

# Set up version control info for prompt
autoload -Uz vcs_info
zstyle ':vcs_info:*' enable git svn
zstyle ':vcs_info:git*' formats "(%b) "

# Update vcs_info before each prompt
precmd() {
    vcs_info
}

# Allow prompt substitution
setopt PROMPT_SUBST 

# Set the prompt to show current directory and git branch
PROMPT='%F{blue}%~%f %F{red}${vcs_info_msg_0_}%f$ '
