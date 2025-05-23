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
	      copilot_model = 'gpt-4o-copilot'
	    })

	    vim.keymap.set("i", "<S-Tab>", function() require("copilot.suggestion").accept() end, { silent = true })
	    vim.keymap.set("n", "<leader>cs", function() require("copilot.suggestion").toggle_auto_trigger() end,
	      { silent = true })
	  end,
	}
}
