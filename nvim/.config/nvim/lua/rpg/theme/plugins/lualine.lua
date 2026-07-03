local M = {}

function M.get(c, _)
	return {
		LualineNormalA = { bg = "NONE", fg = c.base.green },
		LualineNormalB = { bg = "NONE", fg = c.base.foreground },
		LualineNormalC = { bg = "NONE", fg = c.base.foreground },
		LualineInsertA = { bg = "NONE", fg = c.base.blue },
		LualineVisualA = { bg = "NONE", fg = c.base.magenta },
		LualineReplaceA = { bg = "NONE", fg = c.base.red },
		LualineCommandA = { bg = "NONE", fg = c.base.yellow },
		LualineInactiveA = { bg = "NONE", fg = c.base.dimmed1 },
		LualineInactiveB = { bg = "NONE", fg = c.base.dimmed1 },
		LualineInactiveC = { bg = "NONE", fg = c.base.dimmed1 },
	}
end

return M
