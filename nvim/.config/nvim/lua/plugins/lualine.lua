return {
	"nvim-lualine/lualine.nvim",
	dependencies = { "nvim-tree/nvim-web-devicons", "saghen/blink.cmp" },
	config = function()
		local indent_info = require("lualine.indent-info")
		local transparent_theme = require("lualine.transparent-theme")
		local sidekick_status = require("lualine.sidekick-status")
		local tooling_status = require("lualine.tooling-status")
		local gh_pr_status = require("lualine.gh-pr-status")

		tooling_status.setup_progress_tracking()

		vim.keymap.set("n", "<leader>lp", tooling_status.show_popup, { desc = "Show active tooling sources popup" })

		require("lualine").setup({
			sections = {
				lualine_a = { "mode" },
				lualine_b = {
					{
						"branch",
						fmt = function(str)
							local max = 40
							if vim.fn.strchars(str) > max then
								return vim.fn.strcharpart(str, 0, max - 1) .. "…"
							end
							return str
						end,
					},
					gh_pr_status,
					"diff",
					"diagnostics",
				},
				lualine_c = {
					{
						"filename",
						path = 1,
					},
				},
				lualine_x = {
					{ tooling_status.component, on_click = tooling_status.show_popup },
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
						lualine_a = {
							{
								function ()
									return sidekick_status(true)
								end
							}
						},
					},
					inactive_sections = {
						lualine_a = {
							{
								function ()
									return sidekick_status(false)
								end
							}
						}
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
