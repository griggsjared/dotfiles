local M = {}

function M.get(c, _)
	return {
		MasonNormal = { link = "LazyNormal" },
		MasonHeader = { link = "LazyH1" },
		MasonHeaderSecondary = {
			bg = c.base.yellow,
			fg = c.base.background,
			bold = true,
		},
		MasonHighlight = { fg = c.base.blue },
		MasonHighlightBlock = { bg = c.base.yellow, fg = c.base.background },
		MasonHighlightBlockBold = { link = "LazyH1" },
		MasonHighlightSecondary = { fg = c.base.blue },
		MasonHighlightBlockSecondary = {
			bg = c.base.blue,
			fg = c.base.background,
		},
		MasonHighlightBlockBoldSecondary = {
			bg = c.base.blue,
			fg = c.base.background,
			bold = true,
		},
		MasonMuted = { fg = c.base.dimmed3 },
		MasonMutedBlock = {
			bg = c.base.dimmed3,
			fg = c.base.background,
		},
		MasonMutedBlockBold = {
			bg = c.base.dimmed3,
			fg = c.base.background,
			bold = true,
		},
		MasonError = { fg = c.base.red },
	}
end

return M
