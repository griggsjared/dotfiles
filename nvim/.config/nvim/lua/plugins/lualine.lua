return {
	"nvim-lualine/lualine.nvim",
	dependencies = { "nvim-tree/nvim-web-devicons" },
	config = function()
    local codecompanion_model = require("plugins.code-companion.lualine-model")
    local codecompanion_adapter = require("plugins.code-companion.lualine-adapter")
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
						icon = "",
					},
					"encoding",
					"fileformat",
					"filetype",
				},
				lualine_y = { "progress" },
				lualine_z = { "location" },
			},
			options = {
				section_separators = "",
				component_separators = "",
			},
			extensions = {
				{
					filetypes = { "codecompanion" },
					sections = {
						lualine_a = { "mode" },
						lualine_b = {
							codecompanion_adapter,
						},
						lualine_c = {
							codecompanion_model,
						},
						lualine_x = {},
						lualine_y = {
							"progress",
						},
						lualine_z = {
							"location",
						},
					},
					inactive_sections = {
						lualine_a = {},
						lualine_b = {
							codecompanion_adapter,
						},
						lualine_c = {},
						lualine_x = {},
						lualine_y = {
							"progress",
						},
						lualine_z = {},
					},
				},
			},
		})
	end,
}
