return {
	{
		"MeanderingProgrammer/render-markdown.nvim",
		dependencies = { "nvim-treesitter/nvim-treesitter", "nvim-tree/nvim-web-devicons" },
		ft = { "markdown", "codecompanion" },
		config = function()
			require("render-markdown").setup({
				heading = {
					position = "inline",
					backgrounds = {
						"RenderMarkdownHeader1",
						"RenderMarkdownHeader2",
						"RenderMarkdownHeader3",
						"RenderMarkdownHeader4",
						"RenderMarkdownHeader5",
						"RenderMarkdownHeader6",
					},
					foregrounds = {
						"RenderMarkdownHeader1",
						"RenderMarkdownHeader2",
						"RenderMarkdownHeader3",
						"RenderMarkdownHeader4",
						"RenderMarkdownHeader5",
						"RenderMarkdownHeader6",
					},
				},
			})
		end,
	},
}
