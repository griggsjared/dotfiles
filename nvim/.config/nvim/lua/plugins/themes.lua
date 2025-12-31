return {
	{
		"loctvl842/monokai-pro.nvim",
		priority = 1000,
		lazy = false,
		config = function()
			local default_palette = require("monokai-pro.colorscheme.palette.pro")
			local color_helper = require("monokai-pro.color_helper")
			local palette = vim.tbl_extend("force", default_palette, {
				-- overrides
				background = "#1a1a1a",
				-- dark1 = "#090909",
				-- dark2 = "#0a0a0a",
				-- dark1 = "#141414",
				-- dark2 = "#0e0e0e",
				dark1 = "#171717",
				dark2 = "#101010",

				-- aliases
				red = default_palette.accent1,
				orange = default_palette.accent2,
				yellow = default_palette.accent3,
				green = default_palette.accent4,
				cyan = default_palette.accent5,
				magenta = default_palette.accent6,
			})

			local highlights = {
				FloatBorder = { bg = palette.dark1, fg = palette.dimmed2 },
				FloatTitle = { bg = palette.green, fg = palette.dark1, bold = true },
				NormalFloat = { bg = palette.dark1, fg = palette.text },
				Visual = { bg = palette.dimmed4 },
				CursorLineNr = { fg = palette.green },
				SnacksDashboardHeader = { fg = palette.green },
				-- Statusline transparent background
				StatusLine = { bg = "NONE" },
				StatusLineNC = { bg = "NONE" },
				-- Lualine custom highlight groups
				LualineNormalA = { bg = palette.green, fg = palette.dark2, bold = true },
				LualineNormalB = { bg = "NONE", fg = palette.text },
				LualineNormalC = { bg = "NONE", fg = palette.text },
				LualineInsertA = { bg = palette.cyan, fg = palette.dark2, bold = true },
				LualineVisualA = { bg = palette.magenta, fg = palette.dark2, bold = true },
				LualineReplaceA = { bg = palette.red, fg = palette.dark2, bold = true },
				LualineCommandA = { bg = palette.yellow, fg = palette.dark2, bold = true },
				LualineInactiveA = { bg = "NONE", fg = palette.dimmed1 },
				LualineInactiveB = { bg = "NONE", fg = palette.dimmed1 },
				LualineInactiveC = { bg = "NONE", fg = palette.dimmed1 },
				-- Snacks Picker
				SnacksPicker = { bg = palette.background },
				SnacksPickerBorder = { bg = palette.background, fg = palette.dimmed2 },
				SnacksPickerPreview = { bg = palette.background },
				SnacksPickerDir = { fg = palette.dimmed1 },
				SnacksPickerCursorLine = { bg = palette.dimmed5 },
				SnacksPickerListCursorLine = { bg = palette.dimmed5 },
				SnacksPickerBoxCursorLine = { bg = palette.dimmed5 },
				SnacksPickerBufFlags = { fg = palette.red },
				SnacksPickerCol = { fg = palette.cyan, bg = "none" },
				SnacksPickerPathIgnored = { fg = palette.dimmed1 },
				SnacksPickerUnselected = { fg = palette.dimmed1 },
				SnacksPickerPathHidden = { fg = palette.dimmed1 },
				SnacksPickerKeymapRhs = { fg = palette.dimmed1 },
				SnacksPickerTotals = { fg = palette.dimmed1 },
				SnacksPickerGitStatusIgnored = { fg = palette.dimmed1 },
				SnacksPickerGitStatusUntracked = { fg = palette.dimmed1 },
				-- Indent Blankline
				IndentActive = { fg = color_helper.blend(palette.magenta, 0.50, palette.background) },
				IndentInactive = { fg = palette.dimmed5 },
				-- Render Markdown
				RenderMarkdownHeader1 = { fg = palette.green },
				RenderMarkdownHeader2 = { fg = palette.magenta },
				RenderMarkdownHeader3 = { fg = palette.yellow },
				RenderMarkdownHeader4 = { fg = palette.orange },
				RenderMarkdownHeader5 = { fg = palette.red },
				RenderMarkdownHeader6 = { fg = palette.cyan },
				RenderMarkdownCode = { bg = palette.dark1 },
				RenderMarkdownCodeInline = { bg = palette.dark1 },
				-- CMP
				CmpItemKindCopilot = { fg = palette.cyan },
				-- Blink
				BlinkCmpMenu = { bg = palette.dark1, fg = palette.text },
				BlinkCmpMenuBorder = { bg = palette.dark1, fg = palette.dimmed2 },
				BlinkCmpDocBorder = { bg = palette.dark1, fg = palette.dimmed2 },
				BlinkCmpMenuSelection = { bg = palette.dimmed5 },
				BlinkCmpKindCopilot = { fg = palette.magenta },
				-- Treesitter
				["@keyword"] = { bold = true },
				["@keyword.lua"] = { bold = true },
				["@keyword.function"] = { bold = true, italic = false },
				["@keyword.function.lua"] = { bold = true, italic = false },
				["@keyword.function.go"] = { bold = true, italic = false },
				["@keyword.type"] = { bold = true },
				["@keyword.import"] = { bold = true },
				["@keyword.operator"] = { bold = true },
				["@keyword.conditional"] = { bold = true },
				["@keyword.repeat"] = { bold = true },
				["@keyword.return"] = { bold = true },
				-- ["@function.builtin"] = { bold = true },
				-- ["@type.builtin"] = { bold = true }
			}

			require("monokai-pro").setup({
				devicons = true,
				transparent_background = false,
				terminal_colors = true,
				filter = "pro",
				overridePalette = function()
					return palette
				end,
				override = function()
					return highlights
				end,
			})

			vim.cmd([[colorscheme monokai-pro]])
		end,
	},
	{
		"olimorris/onedarkpro.nvim",
		priority = 1000,
		lazy = false,
		config = function()
			local background = "#1a1a1a"
			require("onedarkpro").setup({
				colors = {
					bg = background,
				},
				options = {
					transparency = false,
				},
				highlights = {
					Normal = { bg = "${none}" },
					IndentActive = { fg = "${red}" },
					IndentInactive = { fg = "${gray}" },
					-- Statusline transparent background
					StatusLine = { bg = "${none}" },
					StatusLineNC = { bg = "${none}" },
					-- Lualine custom highlight groups
					LualineNormalA = { bg = "${green}", fg = "${bg}", bold = true },
					LualineNormalB = { bg = "${none}", fg = "${fg}" },
					LualineNormalC = { bg = "${none}", fg = "${fg}" },
					LualineInsertA = { bg = "${blue}", fg = "${bg}", bold = true },
					LualineVisualA = { bg = "${purple}", fg = "${bg}", bold = true },
					LualineReplaceA = { bg = "${red}", fg = "${bg}", bold = true },
					LualineCommandA = { bg = "${yellow}", fg = "${bg}", bold = true },
					LualineInactiveA = { bg = "${none}", fg = "${gray}" },
					LualineInactiveB = { bg = "${none}", fg = "${gray}" },
					LualineInactiveC = { bg = "${none}", fg = "${gray}" },
				},
				styles = {
					types = "italic",
					methods = "NONE",
					numbers = "NONE",
					strings = "NONE",
					comments = "italic",
					keywords = "bold",
					constants = "NONE",
					functions = "italic",
					operators = "NONE",
					variables = "NONE",
					parameters = "NONE",
					conditionals = "NONE",
					virtual_text = "NONE",
				},
				filetypes = {
					php = false,
				},
			})
			-- vim.cmd([[colorscheme onedark]])
		end,
	},
}
