# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

It is also available as `CLAUDE.md` for compatibility with Claude Code.

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
| `opencode/.config/opencode/` | `~/.config/opencode/` |
| `agents/.codex/` | `~/.codex/` |
| `agents/.agents/` | `~/.agents/` |
| `agents/.pi/agent/` | `~/.pi/agent/` |
| `yazi/.config/yazi/` | `~/.config/yazi/` |

`agents/.claude/CLAUDE.md` and `agents/.claude/skills/` are also symlinked into `~/.claude/`, `agents/.config/opencode/AGENTS.md` and `agents/.config/opencode/skills/` into `~/.config/opencode/`, and `agents/.pi/agent/AGENTS.md` into `~/.pi/agent/AGENTS.md` (for Pi).

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
- `agents/` — cross-tool agent config: AGENTS.md and skills, symlinked into `~/.codex/`, `~/.claude/`, `~/.config/opencode/`, and `~/.agents/`
- `claude/` — Claude Code-specific config: commands, agents, statusline
- `opencode/` — opencode-specific config: commands, agents, themes, opencode.json
- `yazi/` — file manager theme/config
- `lazygit/`, `neovide/`, `git/`, `ideovim/` — tool configs
