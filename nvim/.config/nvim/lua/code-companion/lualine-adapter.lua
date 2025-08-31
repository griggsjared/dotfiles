local M = require("lualine.component"):extend()

function M:update_status()
	local chat = require("codecompanion").buf_get_chat(vim.api.nvim_get_current_buf())
	if not chat then
		return nil
	end

	return " " .. chat.adapter.formatted_name
end

return M
