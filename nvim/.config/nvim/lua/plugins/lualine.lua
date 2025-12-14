return {
	"nvim-lualine/lualine.nvim",
	dependencies = { "nvim-tree/nvim-web-devicons", "saghen/blink.cmp" },
	config = function()
		local blink_ai_manager_status = require("blink.ai-manager").lualine_status
		local indent_info = require("lualine.indent-info")
		local transparent_theme = require("lualine.transparent-theme")
		local sidekick_status =  {
      function()
        return " "
      end,
      cond = function()
        return #require("sidekick.status").cli() > 0
      end,
      color = function()
        return "Special"
      end,
    }

		require("lualine").setup({
			sections = {
				lualine_a = { "mode" },
				lualine_b = { "branch", "diff", "diagnostics" },
				lualine_c = {
					{
						"filename",
						path = 1,
					},
				},
				lualine_x = {
					{
						"lsp_status",
						icon = "",
						ignore_lsp = {
							"copilot",
						},
					},
					blink_ai_manager_status,
					indent_info,
					"fileformat",
					"filetype",
				},
				lualine_y = { "progress" },
				lualine_z = { "location" },
			},
			options = {
				theme = transparent_theme,
				section_separators = "",
				component_separators = "",
			},
			extensions = {
				{
					filetypes = { "snacks_dashboard" },
					sections = {},
				},
				{
					filetypes = { "sidekick_terminal" },
					sections = {
						lualine_a = { sidekick_status },
					},
					inactive_sections = {
					},
				},
				{
					filetypes = { "oil" },
					sections = {
						lualine_a = {
							"mode",
						},
						lualine_b = {
							function()
								local ok, oil = pcall(require, "oil")
								if not ok then
									return ""
								end

								local path = vim.fn.fnamemodify(oil.get_current_dir(), ":~")
								return path .. " %m"
							end,
						},
					},
				},
			},
		})
	end,
}
