local M = {}

function M.get(c, _)
	return {
		LualineNormalA = { bg = c.base.green, fg = c.base.dark, bold = true },
		LualineNormalB = { bg = "NONE", fg = c.base.white },
		LualineNormalC = { bg = "NONE", fg = c.base.white },
		LualineInsertA = { bg = c.base.cyan, fg = c.base.dark, bold = true },
		LualineVisualA = { bg = c.base.magenta, fg = c.base.dark, bold = true },
		LualineReplaceA = { bg = c.base.red, fg = c.base.dark, bold = true },
		LualineCommandA = { bg = c.base.yellow, fg = c.base.dark, bold = true },
		LualineInactiveA = { bg = "NONE", fg = c.base.dimmed1 },
		LualineInactiveB = { bg = "NONE", fg = c.base.dimmed1 },
		LualineInactiveC = { bg = "NONE", fg = c.base.dimmed1 },
	}
end

return M
