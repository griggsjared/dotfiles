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
			-- Minuet / Ollama
			{
				"milanglacier/minuet-ai.nvim",
				config = function()
					require("minuet").setup({
						provider = "openai_fim_compatible",
						n_completions = 1,
						context_window = 512,
						provider_options = {
							openai_fim_compatible = {
								api_key = "TERM",
								name = "Ollama",
								end_point = "http://localhost:11434/v1/completions",
                model = "qwen2.5-coder:1.5b",
								optional = {
									max_tokens = 256,
									top_p = 0.9,
								},
							},
						},
					})
				end,
			},
		},
		version = "*",
		build = "cargo build --release",
		opts_extend = { "sources.default" },
		config = function()
			local ai_manager = require("blink.ai-manager")

			-- must have a default provider set in env to use ai sources
			local default_provider = vim.env.NVIM_BLINK_AI_PROVIDER
			if default_provider then
				ai_manager.init(default_provider, {
					"copilot",
					"codeium",
					"supermaven",
          "minuet",
				})
			end

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
						return ai_manager.filter_sources({
							"lsp",
							"path",
							"snippets",
							"buffer",
						})
					end,
					providers = {
						copilot = {
							name = "copilot",
							module = "blink-copilot",
							score_offset = 100,
							async = true,
							transform_items = function(_, items)
								for _, item in ipairs(items) do
									item.kind_name = "Super"
								end
								return items
							end,
						},
						codeium = {
							name = "codeium",
							module = "codeium.blink",
							score_offset = 100,
							async = true,
							transform_items = function(_, items)
								for _, item in ipairs(items) do
									item.kind_name = "Super"
								end
								return items
							end,
						},
						supermaven = {
							name = "supermaven",
							module = "blink-cmp-supermaven",
							score_offset = 100,
							async = true,
							transform_items = function(_, items)
								for _, item in ipairs(items) do
									item.kind_name = "Super"
								end
								return items
							end,
						},
						minuet = {
							name = "minuet",
							module = "minuet.blink",
							score_offset = 100,
							timeout_ms = 3000,
							async = true,
							transform_items = function(_, items)
								for _, item in ipairs(items) do
									item.kind_name = "Super"
								end
								return items
							end,
						},
					},
				},
				fuzzy = { implementation = "prefer_rust_with_warning" },
			})
		end,
	},
}
