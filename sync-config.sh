#!/usr/bin/env bash

set -euo pipefail

THEME="${BAKED_THEME:-monokai}"
DOTFILES="${HOME}/.dotfiles"

if [[ "$THEME" != "monokai" && "$THEME" != "onedark" && "$THEME" != "catppuccin" && "$THEME" != "tokyonight" && "$THEME" != "rosepine" && "$THEME" != "gruvbox" && "$THEME" != "ember" && "$THEME" != "rpg" && "$THEME" != "dracula" ]]; then
  THEME="monokai"
fi

mkdir -p "${DOTFILES}/ghostty/.config/ghostty"
cat > "${DOTFILES}/ghostty/.config/ghostty/active-theme.conf" << EOF
theme = baked-${THEME}
EOF

mkdir -p "${DOTFILES}/tmux"
cat > "${DOTFILES}/tmux/active-theme.conf" << 'EOF'
EOF


