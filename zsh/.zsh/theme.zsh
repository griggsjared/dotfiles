export BAKED_THEME="${BAKED_THEME:-monokai}"

[[ -x "$HOME/.dotfiles/sync-config.sh" ]] && "$HOME/.dotfiles/sync-config.sh"

# Set OpenCode theme dynamically based on BAKED_THEME
export OPENCODE_CONFIG_CONTENT="{\"theme\":\"baked-${BAKED_THEME}\"}"

themes() {
  local themes=("monokai" "onedark" "catppuccin" "tokyonight" "rosepine" "gruvbox" "ember" "rpg" "dracula")
  local current_theme="${BAKED_THEME:-monokai}"
  local selected
  
  selected="$(printf '%s\n' "${themes[@]}" | fzf --prompt="Select theme: " --height=40% --ansi --reverse --header="Current: $current_theme")"
  
  if [ -z "$selected" ]; then
    return 0
  fi
  
  local private_file="$HOME/.zsh/private.zsh"
  
  if [ ! -f "$private_file" ]; then
    touch "$private_file"
  fi
  
  if grep -q "^export BAKED_THEME=" "$private_file"; then
    sed -i '' '/^export BAKED_THEME=/d' "$private_file"
  fi
  echo "export BAKED_THEME=\"$selected\"" >> "$private_file"
  
  export BAKED_THEME="$selected"
  
  if [[ -x "$HOME/.dotfiles/sync-config.sh" ]]; then
    "$HOME/.dotfiles/sync-config.sh"
  fi
  
  if [[ -n "$GHOSTTY_RESOURCES_DIR" ]]; then
    echo "✓ Switched to $selected theme"
    echo "  → Press cmd+shift+, to reload Ghostty colors"
  else
    echo "✓ Switched to $selected theme (restart terminal to apply)"
  fi
  
  source "$HOME/.zshrc"
}
