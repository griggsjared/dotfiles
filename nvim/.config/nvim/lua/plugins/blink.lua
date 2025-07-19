return {
	{
		"saghen/blink.cmp",
		dependencies = {
			"rafamadriz/friendly-snippets",
			"fang2hou/blink-copilot",
			"saghen/blink.compat",
			{
				"supermaven-inc/supermaven-nvim",
        enabled = false,
				opts = {
					disable_inline_completion = true,
					disable_keymaps = true,
				},
			},
			{
				"huijiro/blink-cmp-supermaven",
        enabled = false,
			},
		},
		build = "cargo build --release",
		opts = {
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
				default = {
					"lsp",
					"path",
					"snippets",
					"buffer",
					"copilot",
					-- "supermaven",
				},
				providers = {
					copilot = {
						name = "copilot",
						module = "blink-copilot",
						score_offset = 100,
						transform_items = function(_, items)
							for _, item in ipairs(items) do
								item.kind_text = "Copilot"
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
								item.kind_name = "SuperMaven"
							end
							return items
						end,
						async = true,
					},
				},
			},
			fuzzy = { implementation = "prefer_rust_with_warning" },
		},
		opts_extend = { "sources.default" },
	},
}
