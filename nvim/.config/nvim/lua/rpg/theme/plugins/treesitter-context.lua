local M = {}

function M.get(c, hp)
	return {
		TreesitterContext = { bg = c.base.panel, fg = c.base.foreground },
		TreesitterContextBottom = { bg = c.base.panel, sp = c.base.dimmed5 },
		TreesitterContextLineNumber = { bg = c.base.panel, fg = c.base.dimmed3 },
		TreesitterContextSeparator = { fg = c.base.dimmed5 },
	}
end

return M
