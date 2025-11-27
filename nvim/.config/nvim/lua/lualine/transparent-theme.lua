-- Lualine theme that reads from custom highlight groups
-- All colors are defined in the colorscheme, not here

local function get_hl(name)
	local hl = vim.api.nvim_get_hl(0, { name = name })
	local result = {}
	if hl.fg then
		result.fg = string.format("#%06x", hl.fg)
	end
	if hl.bg then
		result.bg = string.format("#%06x", hl.bg)
	end
	if hl.bold then
		result.gui = "bold"
	end
	return result
end

return {
	normal = {
		a = get_hl("LualineNormalA"),
		b = get_hl("LualineNormalB"),
		c = get_hl("LualineNormalC"),
	},
	insert = { a = get_hl("LualineInsertA") },
	visual = { a = get_hl("LualineVisualA") },
	replace = { a = get_hl("LualineReplaceA") },
	command = { a = get_hl("LualineCommandA") },
	inactive = {
		a = get_hl("LualineInactiveA"),
		b = get_hl("LualineInactiveB"),
		c = get_hl("LualineInactiveC"),
	},
}
