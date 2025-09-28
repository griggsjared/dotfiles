# Dotfiles

## Quick Start

```bash
git clone https://github.com/griggsjared/dotfiles.git ~/.dotfiles
cd ~/.dotfiles
chmod +x mac-init.sh
./mac-init.sh
stow */
```

## The Mac Init Script
Run `./mac-init.sh` to install or update packages and tools.
This can be run at any time, either on a new Mac or to just make sure the current environment
has everything it needs and is up to date.

### Package Management
The script uses standard configuration files for each ecosystem:

#### Homebrew (`Brewfile`)
```bash
# Install/update all packages from Brewfile
brew bundle

# Update Brewfile with currently installed packages
brew bundle dump --force

# Check what would be installed
brew bundle check
```

#### Go Tools (`go-tools.txt`)
Lists Go packages to install globally:
```bash
# Install manually
cat go-tools.txt | xargs -I {} go install {}
```

#### Node.js (`.nvmrc` + `package.json`)
- `.nvmrc`: Specifies Node.js version
- `package.json`: Global npm packages
```bash
# Install manually
nvm install && nvm use
npm install -g $(node -p "Object.keys(require('./package.json').devDependencies).join(' ')")
```

#### Rust (`rust-toolchain.toml`)
Configures Rust toolchain and components:
```bash
# Install manually
rustup show  # Reads rust-toolchain.toml automatically
```

#### Composer (`composer.json`)
Global PHP packages (like Laravel Valet):
```bash
# Install manually
composer global install
```

## Config Usage

### Install all configs
```bash
stow */
```

### Install specific configs
```bash
stow nvim zsh tmux
```

### Remove configs
```bash
stow -D nvim
```

## Config Structure

Each directory contains configs for a specific application. GNU stow creates symlinks from these directories to your home directory.

Example: `nvim/.config/nvim/` → `~/.config/nvim/`

## Troubleshooting

If stow fails due to existing files, either:
1. Remove conflicting files manually
2. Use `stow --adopt` to adopt existing files
3. Use `stow --override='.*'` to force overwrite
