local function sidekick_status(active)
	local cli = vim.b.sidekick_cli and vim.b.sidekick_cli.name
	if not cli then
		return ""
	end
	if not active then
		return cli
	end
	return "  " .. cli
end

return sidekick_status
