local M = {}

function M.get(c, _)
	return {
		OilDir = { fg = c.base.cyan, bold = true },
		OilDirIcon = { fg = c.base.cyan },
		OilLink = { fg = c.base.magenta },
		OilLinkTarget = { fg = c.base.dimmed3 },
		OilCopy = { fg = c.base.yellow, bold = true },
		OilMove = { fg = c.base.magenta, bold = true },
		OilChange = { fg = c.base.blue, bold = true },
		OilCreate = { fg = c.base.green, bold = true },
		OilDelete = { fg = c.base.red, bold = true },
		OilPermissionNone = { fg = c.base.dimmed4 },
		OilPermissionRead = { fg = c.base.yellow },
		OilPermissionWrite = { fg = c.base.blue },
		OilPermissionExecute = { fg = c.base.green },
		OilTypeDir = { fg = c.base.cyan },
		OilTypeFifo = { fg = c.base.magenta },
		OilTypeFile = { fg = c.base.white },
		OilTypeLink = { fg = c.base.magenta },
		OilTypeSocket = { fg = c.base.red },
		OilWinbar = { bg = c.base.black, fg = c.base.dimmed1 },
		OilWinbarNC = { bg = c.base.black, fg = c.base.dimmed3 },
	}
end

return M
