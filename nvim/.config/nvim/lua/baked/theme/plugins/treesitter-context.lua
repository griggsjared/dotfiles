local M = {}

function M.get(c, _)
	return {
		TreesitterContext = { bg = c.base.dark, fg = c.base.white },
		TreesitterContextBottom = { bg = c.base.dark, sp = c.base.dimmed5 },
		TreesitterContextLineNumber = { bg = c.base.dark, fg = c.base.dimmed3 },
		TreesitterContextSeparator = { fg = c.base.dimmed5 },
	}
end

return M
