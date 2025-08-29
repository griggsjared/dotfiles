return {
	{
		"zbirenbaum/copilot.lua",
		cmd = "Copilot",
		event = "InsertEnter",
		config = function()
			require("copilot").setup({
				suggestion = {
					auto_trigger = false,
					accept_newline = true,
				},
			})

			vim.keymap.set("i", "<S-Tab>", function()
				require("copilot.suggestion").accept()
			end, { silent = true, desc = "Toggle Copilot auto-trigger (<leader>cs)" })

      local copilot_inline_enabled = false;
			vim.keymap.set("n", "<leader>cs", function()
        require("copilot.suggestion").toggle_auto_trigger()
        if copilot_inline_enabled then
          copilot_inline_enabled = false
          print("Copilot inline suggestion disabled")
        else
          copilot_inline_enabled = true
          print("Copilot inline suggestion enabled")
        end
			end, { silent = true, desc = "Toggle Copilot auto-trigger (<leader>cs)" })

			local copilot_enabled = true
			vim.keymap.set("n", "<leader>cp", function()
				if copilot_enabled then
					vim.cmd("Copilot disable")
					copilot_enabled = false
					print("Copilot disabled")
				else
					vim.cmd("Copilot enable")
					copilot_enabled = true
					print("Copilot enabled")
				end
			end, { silent = true, desc = "Toggle Copilot auto-trigger (<leader>cs)" })
		end,
	},
}
