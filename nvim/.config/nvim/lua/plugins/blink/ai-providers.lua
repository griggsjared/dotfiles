local blink =	require("blink.cmp")

local M = {
	active = false,
	provider = nil,
	valid_providers = { "copilot", "supermaven", "codeium" },
}

M.init = function(init_active, init_provider)
	if init_provider ~= "" then
		M.set_provider(init_provider)
    M.active = init_active == true
	end

	vim.keymap.set("n", "<leader>at", function ()
    M.toggle()
    blink.reload()
	end, { desc = "Toggle Blink CMP AI suggestions" })

  vim.api.nvim_create_user_command("BlinkCmpAiProvider", function(opts)
    M.set_provider(opts.args)
    blink.reload()
    M.show_current()
  end, { nargs = 1, desc = "Set Blink CMS AI suggesions provider" })
end

M.toggle = function()
	if M.active then
		M.active = false
		print("AI suggestions disabled")
	else
		M.active = true
		if M.provider and M.provider ~= nil then
			print("AI suggestions enabled: " .. M.provider)
		else
			print("AI suggestions enabled, but no provider set")
		end
	end
end

M.current = function()
	return M.provider
end

M.show_current = function()
	if not M.active or M.provider == nil then
		print("AI suggestions are disabled")
		return
	end
	print("Current AI provider: " .. M.provider)
end

M.set_provider = function(new_provider)
	if new_provider == M.provider or new_provider == "" then
		return
	end

	assert(vim.tbl_contains(M.valid_providers, new_provider), "Invalid provider: " .. new_provider)
	M.provider = new_provider
end

M.filter_sources = function(sources)
  if M.provider and M.active then
		table.insert(sources, M.provider)
	end
	return sources
end

return M
