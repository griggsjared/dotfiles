local function indent_info()
	local expandtab = vim.bo.expandtab
	local tabstop = vim.bo.tabstop
	local shiftwidth = vim.bo.shiftwidth

	if expandtab then
		-- Using spaces
		local width = shiftwidth ~= 0 and shiftwidth or tabstop
		return string.format("(s-%d)", width)
	else
		-- Using tabs
		return string.format("(t-%d)", tabstop)
	end
end

return indent_info
