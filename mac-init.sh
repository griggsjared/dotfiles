#!/bin/bash

set -e

echo "Mac Environment Setup Script"
echo "==============================="

# Check if Homebrew is installed, install if not
if ! command -v brew &> /dev/null; then
    echo "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    echo "Updating Homebrew..."
    brew update
fi

echo ""
echo "Installing/Updating Homebrew Casks..."
echo "==============================="

# List of casks to install/update
casks=(
    "alt-tab"
    "jordanbaird-ice"
    "wkhtmltopdf"
    "ghostty"
    "raycast"
)

if [ ${#casks[@]} -eq 0 ]; then
  echo "No casks to install. Skipping..."
else
  for cask in "${casks[@]}"; do
      if brew list --cask "$cask" &> /dev/null; then
          echo "$cask already installed"
      else
          echo "Installing $cask..."
          brew install --cask "$cask"
      fi
  done
fi

echo ""
echo "Installing/Updating Homebrew Packages..."
echo "=================================="

# List of packages to install/update
packages=(
    "zsh-syntax-highlighting"
    "zsh-autosuggestions"
    "zsh-autocomplete"
    "zsh-completions"
    "stow"
    "tmux"
    "neovim"
    "fzf"
    "ripgrep"
    "fd"
    "lsd"
    "bat"
    "php"
    "yazi"
    "git"
    "lazygit"
    "jq"
    "btop"
    "webp"
    "wkhtmltopdf"
    "php@8.1"
    "php@8.2"
    "php@8.3"
    "php@8.4"
    "composer"
    "bun"
    "pnpm"
    "yarn"
    "go"
    "zig"
    "python"
    "ruby"
    "mysql-client"
    "ghostty"
    "raycast"
    "alt-tab"
    "jordanbaird-ice"
    "ghostty"
    "raycast"
    "sst/tap/opencode"
)

# If list is empty, skip installation with message
if [ ${#packages[@]} -eq 0 ]; then
  echo "No packages to install. Skipping..."
else
  for package in "${packages[@]}"; do
      if brew list "$package" &> /dev/null; then
          # Check if package has available updates by checking if it appears in outdated list
          if brew outdated --quiet | grep -q "^$package$"; then
              echo "Upgrading $package..."
              brew upgrade "$package"
          else
              echo "$package is up to date"
          fi
      else
          echo "Installing $package..."
          brew install "$package"
      fi
  done
fi

echo ""
echo "Installing Go Tools..."
echo "========================="

# List of Go tools to install
go_tools=(
    "golang.org/x/tools/gopls@latest"
    "github.com/griggsjared/tm@latest"
    "github.com/griggsjared/scram@latest"
)

# Check if Go is available
if command -v go &> /dev/null; then
    for tool in "${go_tools[@]}"; do
        tool_name=$(basename "$tool" | cut -d'@' -f1)
        echo "Installing $tool_name..."
        go install "$tool"
    done
    echo "Go tools installation complete"
else
    echo "WARNING: Go not found. Please ensure Go is installed and in PATH"
fi

echo ""
echo "Installing Rust via rustup..."
echo "================================="

# Check if rustup is already installed
if command -v rustup &> /dev/null; then
    echo "rustup already installed, updating..."
    rustup update
else
    echo "Installing rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # Export Cargo environment for current script session
    export PATH="$HOME/.cargo/bin:$PATH"
fi

# Ensure latest stable toolchain
echo "Setting up stable toolchain..."
rustup default stable

echo ""
echo "Installing NVM (Node Version Manager)..."
echo "==========================================="

# Check if NVM is already installed
if [ -d "$HOME/.nvm" ]; then
    echo "NVM already installed"
else
    echo "Installing NVM..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi

# Source NVM for current session
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo ""
echo "Installing Node.js via NVM..."
echo "================================"

# Install latest LTS version of Node.js
if command -v nvm &> /dev/null; then
    echo "Installing Node.js LTS..."
    nvm install --lts
    nvm use --lts
    nvm alias default lts/*
else
    echo "NVM not available in current session. Please restart your terminal and run 'nvm install --lts'"
fi

echo ""
echo "Installing/Updating Laravel Valet..."
echo "======================================="

# Check if Valet is already installed
valet_needs_install=false
if composer global show laravel/valet &> /dev/null; then
    echo "Laravel Valet already installed, checking for updates..."
    if composer global outdated laravel/valet &> /dev/null; then
        echo "Updating Laravel Valet..."
        composer global update laravel/valet
        valet_needs_install=true
    else
        echo "Laravel Valet is up to date"
    fi
else
    echo "Installing Laravel Valet..."
    composer global require laravel/valet
    valet_needs_install=true
fi

# Only run valet install if we installed or updated
if [ "$valet_needs_install" = true ]; then
    echo "Setting up Valet..."
    valet install
fi

echo ""
echo "Mac environment setup complete!"
