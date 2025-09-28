#!/bin/bash

# Remove set -e to allow script to continue on errors
# set -e

echo "Mac Environment Setup Script"
echo "==============================="

# Function to ensure Homebrew is in PATH
ensure_brew_path() {
    if ! command -v brew &> /dev/null; then
        # Check common Homebrew installation paths
        if [ -f "/opt/homebrew/bin/brew" ]; then
            echo "Adding Homebrew to PATH (Apple Silicon)..."
            export PATH="/opt/homebrew/bin:$PATH"
        elif [ -f "/usr/local/bin/brew" ]; then
            echo "Adding Homebrew to PATH (Intel)..."
            export PATH="/usr/local/bin:$PATH"
        fi
    fi
}

# Check if Homebrew is installed, install if not
if ! command -v brew &> /dev/null; then
    echo "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Ensure brew is available after installation
    ensure_brew_path
else
    echo "Updating Homebrew..."
    brew update
fi

# Make sure brew is in PATH for the rest of the script
ensure_brew_path

echo ""
echo "Installing/Updating Homebrew Packages and Casks..."
echo "==================================================="

# Check if Brewfile exists
if [ -f "Brewfile" ]; then
    echo "Using Brewfile for package management..."
    
    # Install/update all packages and casks from Brewfile
    if command -v brew &> /dev/null; then
        echo "Running brew bundle..."
        brew bundle --verbose
        echo "Homebrew packages and casks installation complete"
    else
        echo "ERROR: Homebrew not available. Cannot process Brewfile."
    fi
else
    echo "WARNING: Brewfile not found in current directory."
    echo "Skipping Homebrew package installation."
fi

echo ""
echo "Installing Go Tools..."
echo "========================="

# Function to ensure Go is in PATH
ensure_go_path() {
    if ! command -v go &> /dev/null; then
        # Check if Go was installed via Homebrew
        if [ -f "/opt/homebrew/bin/go" ]; then
            echo "Adding Go to PATH (Apple Silicon)..."
            export PATH="/opt/homebrew/bin:$PATH"
        elif [ -f "/usr/local/bin/go" ]; then
            echo "Adding Go to PATH (Intel)..."
            export PATH="/usr/local/bin:$PATH"
        fi
    fi
}

# Ensure Go is in PATH
ensure_go_path

# Check if Go is available and go-tools.txt exists
if command -v go &> /dev/null; then
    if [ -f "go-tools.txt" ]; then
        echo "Installing Go tools from go-tools.txt..."
        while IFS= read -r tool || [ -n "$tool" ]; do
            # Skip empty lines and comments
            [[ -z "$tool" || "$tool" =~ ^#.*$ ]] && continue
            
            tool_name=$(basename "$tool" | cut -d'@' -f1)
            echo "Installing $tool_name..."
            go install "$tool"
        done < go-tools.txt
        echo "Go tools installation complete"
    else
        echo "WARNING: go-tools.txt not found. Skipping Go tools installation."
    fi
else
    echo "WARNING: Go not found. Skipping Go tools installation."
    echo "Please run this script again after Go is properly installed and in PATH."
fi

echo ""
echo "Installing Rust via rustup..."
echo "================================="

# Function to ensure Rust/Cargo is in PATH
ensure_rust_path() {
    if ! command -v rustup &> /dev/null || ! command -v cargo &> /dev/null; then
        if [ -f "$HOME/.cargo/env" ]; then
            echo "Sourcing Cargo environment..."
            source "$HOME/.cargo/env"
        elif [ -d "$HOME/.cargo/bin" ]; then
            echo "Adding Cargo to PATH..."
            export PATH="$HOME/.cargo/bin:$PATH"
        fi
    fi
}

# Check if rustup is already installed
if command -v rustup &> /dev/null; then
    echo "rustup already installed, updating..."
    rustup update
else
    echo "Installing rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # Ensure Rust is available for current script session
    ensure_rust_path
fi

# Ensure Rust is in PATH for the rest of the script
ensure_rust_path

# Configure Rust toolchain using rust-toolchain.toml if available
if command -v rustup &> /dev/null; then
    if [ -f "rust-toolchain.toml" ]; then
        echo "Configuring Rust toolchain from rust-toolchain.toml..."
        rustup show  # This will automatically install/configure based on rust-toolchain.toml
        echo "Rust toolchain configuration complete"
    else
        echo "Setting up stable toolchain..."
        rustup default stable
    fi
else
    echo "WARNING: rustup not available. Please restart your terminal and run this script again."
fi

echo ""
echo "Installing NVM (Node Version Manager)..."
echo "==========================================="

# Function to ensure NVM is sourced
ensure_nvm_sourced() {
    export NVM_DIR="$HOME/.nvm"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
        echo "Sourcing NVM..."
        \. "$NVM_DIR/nvm.sh"
    fi
    if [ -s "$NVM_DIR/bash_completion" ]; then
        \. "$NVM_DIR/bash_completion"
    fi
}

# Check if NVM is already installed
if [ -d "$HOME/.nvm" ]; then
    echo "NVM already installed"
else
    echo "Installing NVM..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
fi

# Ensure NVM is sourced for current session
ensure_nvm_sourced

echo ""
echo "Installing Node.js via NVM..."
echo "================================"

# Install Node.js version specified in .nvmrc
if command -v nvm &> /dev/null; then
    if [ -f ".nvmrc" ]; then
        echo "Installing Node.js version from .nvmrc..."
        nvm install
        nvm use
        nvm alias default $(cat .nvmrc)
        
        # Install global npm packages if package.json exists
        if [ -f "package.json" ]; then
            echo "Installing global npm packages from package.json..."
            npm install -g $(node -p "
                const pkg = require('./package.json');
                Object.keys({...pkg.dependencies, ...pkg.devDependencies}).join(' ')
            ")
            echo "Global npm packages installation complete"
        fi
    else
        echo "Installing Node.js LTS (no .nvmrc found)..."
        nvm install --lts
        nvm use --lts
        nvm alias default lts/*
    fi
else
    echo "WARNING: NVM not available in current session."
    echo "Please restart your terminal and run this script again for Node.js installation."
fi

echo ""
echo "Installing/Updating Composer Packages..."
echo "========================================="

# Function to ensure Composer is in PATH
ensure_composer_path() {
    if ! command -v composer &> /dev/null; then
        # Check common Composer installation paths
        if [ -f "/opt/homebrew/bin/composer" ]; then
            echo "Adding Composer to PATH (Apple Silicon)..."
            export PATH="/opt/homebrew/bin:$PATH"
        elif [ -f "/usr/local/bin/composer" ]; then
            echo "Adding Composer to PATH (Intel)..."
            export PATH="/usr/local/bin:$PATH"
        fi
    fi
    
    # Also ensure Composer global bin is in PATH
    if [ -d "$HOME/.composer/vendor/bin" ]; then
        if [[ ":$PATH:" != *":$HOME/.composer/vendor/bin:"* ]]; then
            echo "Adding Composer global bin to PATH..."
            export PATH="$HOME/.composer/vendor/bin:$PATH"
        fi
    fi
}

# Function to ensure Valet is in PATH
ensure_valet_path() {
    if ! command -v valet &> /dev/null; then
        if [ -f "$HOME/.composer/vendor/bin/valet" ]; then
            echo "Adding Valet to PATH..."
            export PATH="$HOME/.composer/vendor/bin:$PATH"
        fi
    fi
}

# Ensure Composer is in PATH
ensure_composer_path

# Check if Composer is available and composer.json exists
if ! command -v composer &> /dev/null; then
    echo "WARNING: Composer not found. Skipping Composer packages installation."
    echo "Please run this script again after Composer is properly installed and in PATH."
elif [ -f "composer.json" ]; then
    echo "Installing Composer packages from composer.json..."
    
    # Install global packages
    composer global install --no-dev --optimize-autoloader
    
    # Ensure Valet is in PATH
    ensure_valet_path
    
    # Check if Valet was installed and needs setup
    if command -v valet &> /dev/null; then
        # Check if Valet is already installed/configured
        if ! valet status &> /dev/null; then
            echo "Setting up Valet..."
            valet install
        else
            echo "Valet is already configured"
        fi
    else
        echo "WARNING: Valet not found in PATH after installation."
        echo "Please restart your terminal and run 'valet install' manually."
    fi
    
    echo "Composer packages installation complete"
else
    echo "WARNING: composer.json not found. Skipping Composer packages installation."
fi

echo ""
echo "Mac environment setup complete!"
echo ""
echo "======================================="
echo "IMPORTANT NOTES:"
echo "======================================="
echo "Some tools may require a terminal restart to work properly."
echo "If you encountered warnings above, you may need to:"
echo ""
echo "1. Restart your terminal/shell session"
echo "2. Run this script again to complete any skipped installations"
echo "3. Manually run any suggested commands mentioned in warnings"
echo ""
echo "To verify installations, restart your terminal and check:"
echo "- brew --version"
echo "- go version"
echo "- rustc --version"
echo "- nvm --version"
echo "- composer --version"
echo "- valet --version (if applicable)"
echo ""
