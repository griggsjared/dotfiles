local M = {}

function M.get(c, _)
	return {
		QuickFixLine = { bg = c.base.dimmed5, fg = c.base.white },
		QuickerHeader = { fg = c.base.green, bold = true },
		QuickerFilename = { fg = c.base.cyan, bold = true },
		QuickerLineNr = { fg = c.base.dimmed2 },
		QuickerText = { fg = c.base.white },
		QuickerType = { fg = c.base.yellow },
		QuickerError = { fg = c.base.red },
		QuickerWarning = { fg = c.base.yellow },
		QuickerInfo = { fg = c.base.cyan },
		QuickerHint = { fg = c.base.green },
		QuickerValid = { fg = c.base.green },
		QuickerInvalid = { fg = c.base.dimmed3 },
		QuickerSign = { fg = c.base.magenta },
	}
end

return M
