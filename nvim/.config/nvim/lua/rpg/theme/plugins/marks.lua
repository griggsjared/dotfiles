local M = {}

function M.get(c, _)
	return {
		MarkSignHL = { fg = c.base.blue, bold = true },
		MarkSignNumHL = { fg = c.base.blue },
		MarkVirtTextHL = { fg = c.base.dimmed3, italic = true },
		MarkVirtTextHLa = { fg = c.base.green },
		MarkVirtTextHLb = { fg = c.base.blue },
		MarkVirtTextHLc = { fg = c.base.yellow },
		MarkVirtTextHLd = { fg = c.base.blue },
		MarkVirtTextHLe = { fg = c.base.red },
		MarkVirtTextHLf = { fg = c.base.magenta },
		MarkVirtTextHLg = { fg = c.base.green },
		MarkVirtTextHLh = { fg = c.base.blue },
		MarkVirtTextHLi = { fg = c.base.yellow },
		MarkVirtTextHLj = { fg = c.base.blue },
		MarkSignHLa = { fg = c.base.green, bold = true },
		MarkSignHLb = { fg = c.base.blue, bold = true },
		MarkSignHLc = { fg = c.base.yellow, bold = true },
		MarkSignHLd = { fg = c.base.blue, bold = true },
		MarkSignHLe = { fg = c.base.red, bold = true },
		MarkSignHLf = { fg = c.base.magenta, bold = true },
		MarkSignHLg = { fg = c.base.green, bold = true },
		MarkSignHLh = { fg = c.base.blue, bold = true },
		MarkSignHLi = { fg = c.base.yellow, bold = true },
		MarkSignHLj = { fg = c.base.blue, bold = true },
	}
end

return M
