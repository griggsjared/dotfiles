local M = {}

function M.get(c, hp)
	local highlights = {}
	highlights.IndentBlanklineChar = { fg = c.editorIndentGuide.background }
	highlights.IndentBlanklineContextChar = { fg = c.editorIndentGuide.activeBackground }
	highlights.IndentBlanklineContextStart = {
		sp = c.editorIndentGuide.activeBackground,
		underline = false,
	}
	highlights.IndentBlanklineSpaceChar = { fg = c.editor.background }
	highlights.IndentBlankLineIndent1 = { fg = c.base.red }
	highlights.IndentBlankLineIndent2 = { fg = c.base.blue }
	highlights.IndentBlankLineIndent3 = { fg = c.base.yellow }
	highlights.IndentBlankLineIndent4 = { fg = c.base.green }
	highlights.IndentBlankLineIndent5 = { fg = c.base.blue }
	highlights.IndentBlankLineIndent6 = { fg = c.base.magenta }
	highlights.IndentActive = { fg = hp.blend(c.base.magenta, 0.50, c.editor.background) }
	highlights.IndentInactive = { fg = c.base.dimmed5 }

	return highlights
end

return M
