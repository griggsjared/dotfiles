local M = {}

M.default_config = {
	transparent_background = false,
	palette_overrides = {},
	highlight_overrides = {},
	palette = "monokai",
}

M.did_setup = false

function M.setup(opts)
	opts = opts or {}
	M.config = vim.tbl_deep_extend("force", M.default_config, opts)
	M.did_setup = true

	if vim.g.colors_name then
		vim.cmd("hi clear")
	end

	if vim.fn.exists("syntax_on") then
		vim.cmd("syntax reset")
	end

	vim.g.colors_name = "baked"
	vim.o.termguicolors = true

	local helpers = require("baked.helpers")
	local colorscheme = require("baked.colorscheme")

	if not pcall(require, "baked.palettes." .. M.config.palette) then
		vim.notify(
			"[baked] Palette '" .. M.config.palette .. "' not found. Falling back to default palette.",
			vim.log.levels.WARN
		)
		M.config.palette = M.default_config.palette
	end

	local palette = require("baked.palettes." .. M.config.palette)

	if M.config.palette_overrides and next(M.config.palette_overrides) then
		palette = vim.tbl_deep_extend("force", palette, M.config.palette_overrides)
	end

	local c = colorscheme.build(palette, helpers)

	local editor = require("baked.theme.editor")
	local syntax = require("baked.theme.syntax")
	local treesitter = require("baked.theme.treesitter")
	local lsp = require("baked.theme.lsp")
	local plugins = require("baked.theme.plugins")

	local highlights = {}
	highlights = vim.tbl_deep_extend("force", highlights, editor.get(c, helpers))
	highlights = vim.tbl_deep_extend("force", highlights, syntax.get(c, helpers))
	highlights = vim.tbl_deep_extend("force", highlights, treesitter.get(c, helpers))
	highlights = vim.tbl_deep_extend("force", highlights, lsp.get(c, helpers))
	highlights = vim.tbl_deep_extend("force", highlights, plugins.get(c, helpers))

	if M.config.transparent_background then
		local transparent_groups = {
			-- Core editor
			"Normal",
			"NormalNC",
			"SignColumn",
			"LineNr",
			"CursorLineNr",
			"FoldColumn",
			"Folded",
			"VertSplit",
			"WinSeparator",
			"EndOfBuffer",
			"NonText",
			"Conceal",
			"CursorLineFold",
			"ErrorMsg",
			"DiffText",
			-- Floats
			"NormalFloat",
			"FloatBorder",
			-- Plugins
			"TroubleNormal",
			"TroubleNormalNC",
			"TreesitterContext",
			"TreesitterContextBottom",
			"TreesitterContextLineNumber",
			"BlinkCmpMenu",
			"BlinkCmpMenuBorder",
			"BlinkCmpDocBorder",
		}

		for _, group in ipairs(transparent_groups) do
			if highlights[group] then
				highlights[group] = vim.tbl_extend("force", highlights[group], { bg = "NONE" })
			end
		end
	end

	if M.config.highlight_overrides and next(M.config.highlight_overrides) then
		highlights = vim.tbl_deep_extend("force", highlights, M.config.highlight_overrides)
	end

	for group, settings in pairs(highlights) do
		vim.api.nvim_set_hl(0, group, settings)
	end

	M.set_terminal_colors(palette)
end

function M.set_terminal_colors(palette)
	vim.g.terminal_color_0 = palette.dark2 -- black
	vim.g.terminal_color_1 = palette.red -- red
	vim.g.terminal_color_2 = palette.green -- green
	vim.g.terminal_color_3 = palette.yellow -- yellow
	vim.g.terminal_color_4 = palette.cyan -- blue (cyan)
	vim.g.terminal_color_5 = palette.magenta -- magenta
	vim.g.terminal_color_6 = palette.cyan -- cyan
	vim.g.terminal_color_7 = palette.dimmed1 -- white
	vim.g.terminal_color_8 = palette.dimmed3 -- bright black (gray)
	vim.g.terminal_color_9 = palette.red -- bright red
	vim.g.terminal_color_10 = palette.green -- bright green
	vim.g.terminal_color_11 = palette.yellow -- bright yellow
	vim.g.terminal_color_12 = palette.cyan -- bright blue (cyan)
	vim.g.terminal_color_13 = palette.magenta -- bright magenta
	vim.g.terminal_color_14 = palette.cyan -- bright cyan
	vim.g.terminal_color_15 = palette.white -- bright white
end

return M
