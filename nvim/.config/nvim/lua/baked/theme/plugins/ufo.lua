local M = {}

function M.get(c, _)
	return {
		UfoFoldedBg = { bg = c.editor.background },
		FoldColumn = {
			bg = c.editor.background,
			fg = c.button.foreground,
		},
	}
end

return M
