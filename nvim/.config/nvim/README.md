# Neovim config

Managed by [lazy.nvim](https://github.com/folke/lazy.nvim).

## Layout

- `init.lua` — lazy.nvim bootstrap only
- `lua/config/` — `options`, `keymaps`, `autocmds`, `ft` (filetype registry), `mason` (path helper)
- `lua/plugins/` — one lazy.nvim spec per file
- `lua/lualine/` — custom lualine components
- `lsp/` — `vim.lsp.config` server configs (0.11+)
- `ftplugin/` — one-liners calling `require("config.ft").setup(<ft>)`
- `queries/` — treesitter query overrides

## Conventions

- Plugin specs: `---@type LazySpec`, single bare spec per file, `opts` over
  `config` when the table is static, all keymaps in `keys` with sentence-case `desc`
- LSP configs: `---@type vim.lsp.Config` on the returned table
- Keymaps: `vim.keymap.set`, lowercase `<cr>`, no redundant `noremap`/`silent`
- Custom modules: LuaCATS on everything (`---@param`/`---@return` per function,
  `---@class` for state)
- Formatting: `stylua .` (config in `.stylua.toml`, mirrors `.editorconfig`)
- Type checking: lazydev.nvim in-editor; `.luarc.json` for standalone lua_ls

## Adding things

- **New plugin:** new file in `lua/plugins/` following the conventions above
- **New filetype:** registry entry in `lua/config/ft.lua` + an `ftplugin/<ft>.lua` one-liner
- **New LSP server:** `lsp/<name>.lua`, add to mason `ensure_installed`, enable in the ft registry
