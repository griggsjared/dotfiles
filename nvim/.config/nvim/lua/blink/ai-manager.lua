local blink = require("blink.cmp")

local M = {
	initialized = false,
	active = false,
	provider = "",
	valid_providers = {},
}

---@param provider string: the provider to use, e.g. "openai"
---@param valid_providers table: a list of valid providers, e.g. {"openai", "azure"}, the provider must be in this list
M.init = function(provider, valid_providers)
	if M.initialized == true then
		return
	end

	M.initialized = true
	M.valid_providers = valid_providers or {}

	if provider ~= "" then
		M.set_provider(provider, true)
		M.active = true
	end
end

M.is_active = function()
	return M.active and M.initialized and M.provider ~= nil
end

M.toggle = function()
	if M.initialized then
		M.active = not M.active
	end

	M.show_status()
end

M.show_status = function()
	if M.initialized == false then
		print("Blink CMP AI suggestions are not initialized")
		return
	end

	if not M.is_active() then
		print("Blink CMP AI suggestions are disabled")
		return
	end

	if M.provider and M.provider ~= nil then
		print("Blink CMP AI suggestions enabled: " .. M.provider)
	else
		print("Blink CMP AI suggestions enabled, but no provider set")
	end
end

---@return string
M.lualine_status_provider = function()
	if M.is_active() == false then
		return ""
	end

	return "ai: " .. M.provider
end

---@return string
M.lualine_status = function()
	if M.is_active() == false then
		return "ai: off"
	end

	return "ai: on"
end

M.set_provider = function(new_provider, silent)
	if M.initialized == false and not silent then
---@param new_provider string: the new provider to set, e.g. "openai"
		print("Blink CMP AI suggestions are not initialized")
		return
	end

	if new_provider == M.provider or new_provider == "" then
		return
	end

	assert(vim.tbl_contains(M.valid_providers, new_provider), "Invalid provider: " .. new_provider)
	M.provider = new_provider
	if not silent then
		M.show_status()
	end
end

M.filter_sources = function(sources)
	if M.is_active() == false then
		return sources
	end

	-- provider will be set if active
	table.insert(sources, M.provider)

	return sources
end

vim.keymap.set("n", "<leader>at", function()
	M.toggle()
	blink.reload()
end, { desc = "Toggle Blink CMP AI suggestions" })

vim.api.nvim_create_user_command("BlinkCmpAiManagerSet", function(opts)
	M.set_provider(opts.args)
	blink.reload()
end, { nargs = 1, desc = "Set Blink CMS AI suggesions provider" })

vim.api.nvim_create_user_command("BlinkCmpAiManagerToggle", function()
	M.toggle()
	blink.reload()
end, { nargs = 0, desc = "Toggle Blink CMS AI suggesions on or off" })

vim.api.nvim_create_user_command("BlinkCmpAiManagerStatus", function()
	M.show_status()
end, { nargs = 0, desc = "Show Blink CMS AI suggesions provider status" })

return M
