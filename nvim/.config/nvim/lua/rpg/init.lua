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
	local colorscheme = require("rpg.colorscheme")

	local palette = require("rpg.palettes.default")

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

	for group, settings in pairs(highlights) do
		vim.api.nvim_set_hl(0, group, settings)
	end

	M.set_terminal_colors(palette)
end

function M.set_terminal_colors(palette)
	vim.g.terminal_color_0 = palette.black -- black
	vim.g.terminal_color_1 = palette.red -- red
	vim.g.terminal_color_2 = palette.green -- green
	vim.g.terminal_color_3 = palette.yellow -- yellow
	vim.g.terminal_color_4 = palette.blue -- blue
	vim.g.terminal_color_5 = palette.magenta -- magenta
	vim.g.terminal_color_6 = palette.cyan -- cyan
	vim.g.terminal_color_7 = palette.white -- white
	vim.g.terminal_color_8 = palette.black -- bright black
	vim.g.terminal_color_9 = palette.red -- bright red
	vim.g.terminal_color_10 = palette.green -- bright green
	vim.g.terminal_color_11 = palette.yellow -- bright yellow
	vim.g.terminal_color_12 = palette.blue -- bright blue
	vim.g.terminal_color_13 = palette.magenta -- bright magenta
	vim.g.terminal_color_14 = palette.cyan -- bright cyan
	vim.g.terminal_color_15 = palette.white -- bright white
end

return M
