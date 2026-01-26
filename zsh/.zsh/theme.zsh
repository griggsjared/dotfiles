# Theme management

# Theme configuration - can be overridden in ~/.zsh/private.zsh
export BAKED_THEME="${BAKED_THEME:-monokai}"

# Generate theme configs on shell init
[[ -x "$HOME/.dotfiles/colors/generate-themes.sh" ]] && "$HOME/.dotfiles/colors/generate-themes.sh"

# baked function to switch themes interactively with fzf
baked() {
  local themes=("monokai" "onedark" "catppuccin" "tokyonight" "rosepine" "gruvbox" "ember" "rpg" "dracula")
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
  
  # Show appropriate message based on environment
  if [[ -n "$GHOSTTY_RESOURCES_DIR" ]]; then
    # In Ghostty (whether in tmux or not) - show manual reload instruction
    echo "✓ Switched to $selected theme"
    echo "  → Press cmd+shift+, to reload Ghostty colors"
  else
    # Not in Ghostty
    echo "✓ Switched to $selected theme (restart terminal to apply)"
  fi
  
  # Re-source zshrc to pick up any other changes
  source "$HOME/.zshrc"
}
