local M = {}

function M.get(c, _)
	return {
		SnacksDashboardNormal = { bg = c.editor.background, fg = c.editor.foreground },
		SnacksDashboardDesc = { fg = c.base.dimmed1 },
		SnacksDashboardIcon = { fg = c.base.blue },
		SnacksDashboardHeader = { fg = c.base.green },
		SnacksPicker = { bg = c.editor.background },
		SnacksPickerBorder = { bg = c.editor.background, fg = c.base.dimmed2 },
		SnacksPickerPreview = { bg = c.editor.background },
		SnacksPickerDir = { fg = c.base.dimmed1 },
		SnacksPickerCursorLine = { bg = c.base.dimmed5 },
		SnacksPickerListCursorLine = { bg = c.base.dimmed5 },
		SnacksPickerBoxCursorLine = { bg = c.base.dimmed5 },
		SnacksPickerBufFlags = { fg = c.base.red },
		SnacksPickerCol = { fg = c.base.blue, bg = "none" },
		SnacksPickerPathIgnored = { fg = c.base.dimmed1 },
		SnacksPickerUnselected = { fg = c.base.dimmed1 },
		SnacksPickerPathHidden = { fg = c.base.dimmed1 },
		SnacksPickerKeymapRhs = { fg = c.base.dimmed1 },
		SnacksPickerTotals = { fg = c.base.dimmed1 },
		SnacksPickerGitStatusIgnored = { fg = c.base.dimmed1 },
		SnacksPickerGitStatusUntracked = { fg = c.base.dimmed1 },
	}
end

return M
