#!/usr/bin/env bash

set -euo pipefail

DOTFILES="${HOME}/.dotfiles"
NVIM_PALETTES="${DOTFILES}/nvim/.config/nvim/lua/baked/palettes"
OPENCODE_THEMES="${DOTFILES}/opencode/.config/opencode/themes"
GHOSTTY_THEMES="${DOTFILES}/ghostty/.config/ghostty/themes"

extract_color() {
  local file="$1"
  local key="$2"
  grep "^\s*${key} = " "$file" | sed 's/.*= "\(#[0-9a-fA-F]*\)".*/\1/'
}

hex_to_rgb() {
  local hex="${1#\#}"
  local r=$((16#${hex:0:2}))
  local g=$((16#${hex:2:2}))
  local b=$((16#${hex:4:2}))
  echo "$r $g $b"
}

rgb_to_hex() {
  printf "#%02x%02x%02x" "$1" "$2" "$3"
}

lighten_color() {
  local hex="$1"
  local amount="${2:-10}"
  
  read -r r g b <<< "$(hex_to_rgb "$hex")"
  
  r=$(( r + (255 - r) * amount / 100 ))
  g=$(( g + (255 - g) * amount / 100 ))
  b=$(( b + (255 - b) * amount / 100 ))
  
  r=$(( r > 255 ? 255 : r ))
  g=$(( g > 255 ? 255 : g ))
  b=$(( b > 255 ? 255 : b ))
  
  rgb_to_hex "$r" "$g" "$b"
}

for palette_file in "${NVIM_PALETTES}"/*.lua; do
  theme=$(basename "$palette_file" .lua)
  echo "Generating $theme"
  
  BG=$(extract_color "$palette_file" "background")
  DARK1=$(extract_color "$palette_file" "dark1")
  WHITE=$(extract_color "$palette_file" "white")
  RED=$(extract_color "$palette_file" "red")
  CYAN=$(extract_color "$palette_file" "cyan")
  YELLOW=$(extract_color "$palette_file" "yellow")
  GREEN=$(extract_color "$palette_file" "green")
  BLUE=$(extract_color "$palette_file" "blue")
  MAGENTA=$(extract_color "$palette_file" "magenta")
  DIMMED3=$(extract_color "$palette_file" "dimmed3")
  
  BRIGHT_RED=$(lighten_color "$RED" 10)
  BRIGHT_CYAN=$(lighten_color "$CYAN" 10)
  BRIGHT_YELLOW=$(lighten_color "$YELLOW" 10)
  BRIGHT_GREEN=$(lighten_color "$GREEN" 10)
  BRIGHT_BLUE=$(lighten_color "$BLUE" 10)
  BRIGHT_MAGENTA=$(lighten_color "$MAGENTA" 10)

  cat > "${GHOSTTY_THEMES}/baked-${theme}" << EOF
foreground = ${WHITE}
background = ${BG}

palette = 0=${BG}
palette = 1=${RED}
palette = 2=${GREEN}
palette = 3=${YELLOW}
palette = 4=${BLUE}
palette = 5=${MAGENTA}
palette = 6=${CYAN}
palette = 7=${WHITE}

palette = 8=${DIMMED3}
palette = 9=${BRIGHT_RED}
palette = 10=${BRIGHT_GREEN}
palette = 11=${BRIGHT_YELLOW}
palette = 12=${BRIGHT_BLUE}
palette = 13=${BRIGHT_MAGENTA}
palette = 14=${BRIGHT_CYAN}
palette = 15=${WHITE}
EOF

  cat > "${OPENCODE_THEMES}/baked-${theme}.json" << EOF
{
  "\$schema": "https://opencode.ai/theme.json",
  "defs": {
    "background": "${DARK1}",
    "foreground": "${WHITE}",
    "black": "${BG}",
    "red": "${RED}",
    "green": "${GREEN}",
    "yellow": "${YELLOW}",
    "cyan": "${CYAN}",
    "purple": "${MAGENTA}",
    "blue": "${BLUE}",
    "white": "${WHITE}",
    "brightBlack": "${DIMMED3}",
    "brightRed": "${BRIGHT_RED}",
    "brightGreen": "${BRIGHT_GREEN}",
    "brightYellow": "${BRIGHT_YELLOW}",
    "brightCyan": "${BRIGHT_CYAN}",
    "brightPurple": "${BRIGHT_MAGENTA}",
    "brightBlue": "${BRIGHT_BLUE}",
    "brightWhite": "${WHITE}",
    "gray1": "#2c2c2c",
    "gray2": "#3e3e3e",
    "gray3": "#505050"
  },
  "theme": {
    "primary": {
      "dark": "blue",
      "light": "blue"
    },
    "secondary": {
      "dark": "purple",
      "light": "purple"
    },
    "accent": {
      "dark": "cyan",
      "light": "cyan"
    },
    "error": {
      "dark": "red",
      "light": "red"
    },
    "warning": {
      "dark": "yellow",
      "light": "yellow"
    },
    "success": {
      "dark": "green",
      "light": "green"
    },
    "info": {
      "dark": "blue",
      "light": "blue"
    },
    "text": {
      "dark": "foreground",
      "light": "black"
    },
    "textMuted": {
      "dark": "brightBlack",
      "light": "gray3"
    },
    "background": {
      "dark": "background",
      "light": "white"
    },
    "backgroundPanel": {
      "dark": "gray1",
      "light": "brightWhite"
    },
    "backgroundElement": {
      "dark": "gray2",
      "light": "white"
    },
    "border": {
      "dark": "gray2",
      "light": "gray2"
    },
    "borderActive": {
      "dark": "blue",
      "light": "blue"
    },
    "borderSubtle": {
      "dark": "gray1",
      "light": "gray1"
    },
    "diffAdded": {
      "dark": "green",
      "light": "green"
    },
    "diffRemoved": {
      "dark": "red",
      "light": "red"
    },
    "diffContext": {
      "dark": "brightBlack",
      "light": "gray3"
    },
    "diffHunkHeader": {
      "dark": "purple",
      "light": "purple"
    },
    "diffHighlightAdded": {
      "dark": "brightGreen",
      "light": "brightGreen"
    },
    "diffHighlightRemoved": {
      "dark": "brightRed",
      "light": "brightRed"
    },
    "diffAddedBg": {
      "dark": "#1a2e1a",
      "light": "#e6ffe6"
    },
    "diffRemovedBg": {
      "dark": "#2e1a1a",
      "light": "#ffe6e6"
    },
    "diffContextBg": {
      "dark": "gray1",
      "light": "brightWhite"
    },
    "diffLineNumber": {
      "dark": "brightBlack",
      "light": "gray3"
    },
    "diffAddedLineNumberBg": {
      "dark": "#1a2e1a",
      "light": "#e6ffe6"
    },
    "diffRemovedLineNumberBg": {
      "dark": "#2e1a1a",
      "light": "#ffe6e6"
    },
    "markdownText": {
      "dark": "foreground",
      "light": "black"
    },
    "markdownHeading": {
      "dark": "blue",
      "light": "blue"
    },
    "markdownLink": {
      "dark": "purple",
      "light": "purple"
    },
    "markdownLinkText": {
      "dark": "cyan",
      "light": "cyan"
    },
    "markdownCode": {
      "dark": "yellow",
      "light": "yellow"
    },
    "markdownBlockQuote": {
      "dark": "brightBlack",
      "light": "gray3"
    },
    "markdownEmph": {
      "dark": "cyan",
      "light": "cyan"
    },
    "markdownStrong": {
      "dark": "red",
      "light": "red"
    },
    "markdownHorizontalRule": {
      "dark": "gray2",
      "light": "gray2"
    },
    "markdownListItem": {
      "dark": "blue",
      "light": "blue"
    },
    "markdownListEnumeration": {
      "dark": "purple",
      "light": "purple"
    },
    "markdownImage": {
      "dark": "green",
      "light": "green"
    },
    "markdownImageText": {
      "dark": "cyan",
      "light": "cyan"
    },
    "markdownCodeBlock": {
      "dark": "foreground",
      "light": "black"
    },
    "syntaxComment": {
      "dark": "brightBlack",
      "light": "gray3"
    },
    "syntaxKeyword": {
      "dark": "red",
      "light": "red"
    },
    "syntaxFunction": {
      "dark": "green",
      "light": "green"
    },
    "syntaxVariable": {
      "dark": "foreground",
      "light": "black"
    },
    "syntaxString": {
      "dark": "yellow",
      "light": "yellow"
    },
    "syntaxNumber": {
      "dark": "purple",
      "light": "purple"
    },
    "syntaxType": {
      "dark": "blue",
      "light": "blue"
    },
    "syntaxOperator": {
      "dark": "red",
      "light": "red"
    },
    "syntaxPunctuation": {
      "dark": "foreground",
      "light": "black"
    }
  }
}
EOF

done

echo "✅ All themes synced from Neovim palettes"
