local M = {}

function M.get(c, _)
	return {
		OilDir = { fg = c.base.blue },
		OilDirIcon = { fg = c.base.blue },
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
		OilTypeDir = { fg = c.base.blue },
		OilTypeFifo = { fg = c.base.magenta },
		OilTypeFile = { fg = c.base.white },
		OilTypeLink = { fg = c.base.magenta },
		OilTypeSocket = { fg = c.base.red },
		OilWinbar = { bg = c.base.black, fg = c.base.dimmed1 },
		OilWinbarNC = { bg = c.base.black, fg = c.base.dimmed3 },
	}
end

return M
