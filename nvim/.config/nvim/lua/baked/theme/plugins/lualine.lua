local M = {}

function M.get(c, _)
	return {
		LualineNormalA = { bg = "NONE", fg = c.base.green, bold = true },
		LualineNormalB = { bg = "NONE", fg = c.base.white },
		LualineNormalC = { bg = "NONE", fg = c.base.white },
		LualineInsertA = { bg = "NONE", fg = c.base.blue, bold = true },
		LualineVisualA = { bg = "NONE", fg = c.base.magenta, bold = true },
		LualineReplaceA = { bg = "NONE", fg = c.base.red, bold = true },
		LualineCommandA = { bg = "NONE", fg = c.base.yellow, bold = true },
		LualineInactiveA = { bg = "NONE", fg = c.base.dimmed1 },
		LualineInactiveB = { bg = "NONE", fg = c.base.dimmed1 },
		LualineInactiveC = { bg = "NONE", fg = c.base.dimmed1 },
	}
end

return M
