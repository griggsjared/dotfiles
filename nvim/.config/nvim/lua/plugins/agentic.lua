return {
	{
		"carlos-algms/agentic.nvim",
		event = "VeryLazy",
		opts = {
			-- "claude-acp" | "gemini-acp" | "codex-acp" | "opencode-acp"
			provider = "opencode-acp",
		},
		keys = {
			{
				"<leader>CC",
				function()
					require("agentic").toggle()
				end,
				mode = { "n", "v", "i" },
				desc = "Toggle Agentic Chat",
			},
			{
				"<leader>CT",
				function()
					require("agentic").add_selection_or_file_to_context()
				end,
				mode = { "n", "v" },
				desc = "Add file or selection to Agentic to Context",
			},
			-- {
			-- 	"<C-,>",
			-- 	function()
			-- 		require("agentic").new_session()
			-- 	end,
			-- 	mode = { "n", "v", "i" },
			-- 	desc = "New Agentic Session",
			-- },
		},
	},
}
