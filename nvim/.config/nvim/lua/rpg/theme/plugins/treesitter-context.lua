local M = {}

function M.get(c, _)
	return {
		TreesitterContext = { bg = c.base.dark2, fg = c.base.foreground },
		TreesitterContextBottom = { bg = c.base.dark2, sp = c.base.dimmed5 },
		TreesitterContextLineNumber = { bg = c.base.dark2, fg = c.base.dimmed3 },
		TreesitterContextSeparator = { fg = c.base.dimmed5 },
	}
end

return M
