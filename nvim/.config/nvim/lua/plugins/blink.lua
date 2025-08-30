return {
	{
		"saghen/blink.cmp",
		dependencies = {
			"rafamadriz/friendly-snippets",
			"saghen/blink.compat",
			-- SuperMaven
			{
				"supermaven-inc/supermaven-nvim",
				opts = {
					disable_inline_completion = true,
					disable_keymaps = true,
				},
			},
			{
				"huijiro/blink-cmp-supermaven",
			},
			-- Copilot
			"fang2hou/blink-copilot",
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
				end,
			},
			-- Windsurf / Codeium
			{
				"Exafunction/windsurf.nvim",
				dependencies = {
					"nvim-lua/plenary.nvim",
					"hrsh7th/nvim-cmp",
				},
				config = function()
					require("codeium").setup({
						enable_cmp_source = false,
					})
				end,
			},
		},
		version = "*",
		build = "cargo build --release",
		opts_extend = { "sources.default" },
		config = function()
			local ai = require("plugins.blink.ai-providers")
			ai.init(vim.env.NVIM_BLINK_AI_ACTIVE == true, vim.env.NVIM_BLINK_AI_PROVIDER)

			require("blink.cmp").setup({
				keymap = { preset = "enter" },
				appearance = {
					nerd_font_variant = "mono",
				},
				completion = {
					documentation = {
						auto_show = true,
						auto_show_delay_ms = 50,
						window = {
							border = "rounded",
						},
					},
					menu = {
						border = "rounded",
						draw = {
							columns = {
								{ "label", "label_description", gap = 1 },
								{ "kind" },
							},
						},
					},
					list = {
						selection = {
							preselect = false,
							auto_insert = true,
						},
					},
				},
				cmdline = {
					enabled = true,
					completion = {
						menu = {
							auto_show = true,
						},
					},
				},
				signature = {
					enabled = true,
					window = {
						border = "rounded",
					},
				},
				sources = {
					default = function()
						local base_sources = { "lsp", "path", "snippets", "buffer" }
						return ai.filter_sources(base_sources)
					end,
					providers = {
						copilot = {
							name = "copilot",
							module = "blink-copilot",
							score_offset = 100,
							transform_items = function(_, items)
								for _, item in ipairs(items) do
									item.kind_name = "Super"
								end
								return items
							end,
							async = true,
						},
						codeium = {
							name = "codeium",
							module = "codeium.blink",
							score_offset = 100,
							transform_items = function(_, items)
								for _, item in ipairs(items) do
									item.kind_name = "Super"
								end
								return items
							end,
							async = true,
						},
						supermaven = {
							name = "supermaven",
							module = "blink-cmp-supermaven",
							score_offset = 100,
							transform_items = function(_, items)
								for _, item in ipairs(items) do
									item.kind_name = "Super"
								end
								return items
							end,
							async = true,
						},
					},
				},
				fuzzy = { implementation = "prefer_rust_with_warning" },
			})
		end,
	},
}
