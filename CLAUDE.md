# CLAUDE.md

This file provides guidance to AI coding agents when working with code in this repository.

## Critical: Editing Files in This Repo

**Always edit files in this repo's root directory, never through their symlinked system locations.**

This repo uses GNU `stow` to manage symlinks. Every config file here is symlinked into the home directory:

| Repo path | System location |
|-----------|----------------|
| `nvim/.config/nvim/` | `~/.config/nvim/` |
| `zsh/.zshrc` | `~/.zshrc` |
| `tmux/.tmux.conf` | `~/.tmux.conf` |
| `ghostty/.config/ghostty/` | `~/.config/ghostty/` |
| `claude/.claude/` | `~/.claude/` |

If you open a file via its system path (e.g. `~/.config/nvim/init.lua`), you are editing the symlink target — which resolves back to this repo — but prefer to use the repo path explicitly so the source of truth is obvious.

## Stow Commands

```sh
stow */          # Symlink all directories to ~/
stow nvim        # Symlink only nvim config
stow -D nvim     # Remove nvim symlinks
stow -R nvim     # Re-stow (delete and re-create) nvim symlinks
```

Run `stow` from the repo root.

## Bootstrap

```sh
./mac-init.sh    # Full environment setup (idempotent)
```

This installs Homebrew packages (Brewfile), Go tools (go-tools.txt), Rust toolchain (rust-toolchain.toml), NVM + Node, and Composer packages.

## Repository Structure

Each top-level directory is a stow package mirroring the XDG/home structure:

- `nvim/` — Neovim config (Lua), language-specific ftplugins
- `zsh/` — `.zshrc`, `.zprofile`, modular configs in `.zsh/`
- `tmux/` — `.tmux.conf`
- `ghostty/` — terminal emulator config + shaders/themes
- `claude/` — Claude Code config, skills, commands, agents
- `lazygit/`, `yazi/`, `neovide/`, `git/`, `ideavim/` — tool configs
- `opencode/` — AI CLI tool config (has its own node_modules)
