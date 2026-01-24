local M = {}

function M.get(c, _)
	return {
		Comment = { fg = c.base.dimmed3, italic = true },
		Constant = { fg = c.base.magenta },
		String = { fg = c.base.yellow },
		Character = { fg = c.base.magenta },
		Number = { fg = c.base.magenta },
		Boolean = { fg = c.base.magenta },
		Float = { fg = c.base.magenta },
		Identifier = { fg = c.base.white },
		Function = { fg = c.base.green },
		Statement = { fg = c.base.magenta },
		Conditional = { fg = c.base.red },
		Repeat = { fg = c.base.red },
		Label = { fg = c.base.red },
		Operator = { fg = c.base.red },
		Keyword = { fg = c.base.red, italic = true },
		Exception = { fg = c.base.red },
		PreProc = { fg = c.base.yellow },
		Include = { fg = c.base.red },
		Define = { fg = c.base.red },
		Macro = { fg = c.base.red },
		PreCondit = { fg = c.base.red },
		Type = { fg = c.base.white },
		StorageClass = { fg = c.base.red, italic = true },
		Structure = { fg = c.base.cyan, italic = true },
		Typedef = { fg = c.base.red },
		Special = { fg = c.base.blue },
		SpecialChar = { fg = c.base.blue },
		Delimiter = { fg = c.base.white },
		SpecialComment = { fg = c.base.dimmed3 },
		Underlined = { underline = true },
		Bold = { bold = true },
		Italic = { italic = true },
		Error = { fg = c.inputValidation.errorForeground },
		Todo = { bg = c.editor.background, fg = c.base.magenta, bold = true },
		javaAnnotation = { fg = c.base.dimmed2 },
	}
end

return M
