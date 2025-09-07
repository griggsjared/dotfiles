# Dotfiles

## Quick Start

```bash
git clone https://github.com/griggsjared/dotfiles.git ~/.dotfiles
cd ~/.dotfiles
chmod +x mac-init.sh
./mac-init.sh
stow */
```

## The Mac Init Sccript
Run `./mac-init.sh` to install or update packages and tools.
This can be run at any time, either on a new Mac or to just make sure the current environment has
has everything it need and is up to date.

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
