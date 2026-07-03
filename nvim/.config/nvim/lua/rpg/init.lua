local M = {}

M.default_config = {
	transparent_background = false,
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

	vim.g.colors_name = "rpg"
	vim.o.termguicolors = true

	local helpers = require("rpg.helpers")
	local palette = require("rpg.palettes.default")
	local colorscheme = require("rpg.colorscheme")

	local c = colorscheme.build(palette, helpers)

	local editor = require("rpg.theme.editor")
	local syntax = require("rpg.theme.syntax")
	local treesitter = require("rpg.theme.treesitter")
	local lsp = require("rpg.theme.lsp")
	local plugins = require("rpg.theme.plugins")

	local highlights = {}
	highlights = vim.tbl_deep_extend("force", highlights, editor.get(c, helpers))
	highlights = vim.tbl_deep_extend("force", highlights, syntax.get(c, helpers))
	highlights = vim.tbl_deep_extend("force", highlights, treesitter.get(c, helpers))
	highlights = vim.tbl_deep_extend("force", highlights, lsp.get(c, helpers))
	highlights = vim.tbl_deep_extend("force", highlights, plugins.get(c, helpers))

	M.apply_transparency(highlights)

	for group, settings in pairs(highlights) do
		vim.api.nvim_set_hl(0, group, settings)
	end

	M.set_terminal_colors(c)
end

function M.apply_transparency(highlights)
	if not M.config.transparent_background then return end

	local transparent_groups = {
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
		"NormalFloat",
		"FloatBorder",
		"TroubleNormal",
		"TroubleNormalNC",
		"TreesitterContext",
		"TreesitterContextBottom",
		"TreesitterContextLineNumber",
		"BlinkCmpMenu",
		"BlinkCmpMenuBorder",
		"BlinkCmpDocBorder",
		"SnacksDashboardNormal",
		"SnacksPicker",
		"SnacksPickerBorder",
		"SnacksPickerPreview",
	}

	for _, group in ipairs(transparent_groups) do
		if highlights[group] then
			highlights[group] = vim.tbl_extend("force", highlights[group], { bg = "NONE" })
		end
	end
end

function M.set_terminal_colors(c)
	vim.g.terminal_color_0 = c.base.background -- black
	vim.g.terminal_color_1 = c.base.red -- red
	vim.g.terminal_color_2 = c.base.green -- green
	vim.g.terminal_color_3 = c.base.yellow -- yellow
	vim.g.terminal_color_4 = c.base.blue -- blue
	vim.g.terminal_color_5 = c.base.magenta -- magenta
	vim.g.terminal_color_6 = c.base.cyan -- cyan
	vim.g.terminal_color_7 = c.base.foreground -- white
	vim.g.terminal_color_8 = c.base.background -- bright black
	vim.g.terminal_color_9 = c.base.red -- bright red
	vim.g.terminal_color_10 = c.base.green -- bright green
	vim.g.terminal_color_11 = c.base.yellow -- bright yellow
	vim.g.terminal_color_12 = c.base.blue -- bright blue
	vim.g.terminal_color_13 = c.base.magenta -- bright magenta
	vim.g.terminal_color_14 = c.base.cyan -- bright cyan
	vim.g.terminal_color_15 = c.base.foreground -- bright white
end

return M
