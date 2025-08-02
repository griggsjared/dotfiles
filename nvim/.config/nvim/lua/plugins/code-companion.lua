return {
	{
		"olimorris/codecompanion.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-treesitter/nvim-treesitter",
			"j-hui/fidget.nvim",
			"ravitemer/codecompanion-history.nvim",
		},
		config = function()
			require("codecompanion").setup({
				strategies = {
					chat = {
						adapter = "copilot",
						roles = {
							llm = function(adapter)
								return "CodeCompanion (" .. adapter.formatted_name .. ")"
							end,
							user = "Jared",
						},
						send = {
							callback = function(chat)
								vim.cmd("stopinsert")
								chat:add_buf_message({ role = "llm", content = "" })
								chat:submit()
							end,
							index = 1,
							description = "Send",
						},
					},
					inline = {
						adapter = "copilot",
					},
				},
				display = {
					chat = {
						window = {
							position = "right",
							width = 0.50,
						},
					},
				},
				adapters = {
					copilot = function()
						return require("codecompanion.adapters").extend("copilot", {
							schema = {
								model = {
									default = "claude-sonnet-4",
								},
							},
						})
					end,
					openai = function()
						return require("codecompanion.adapters").extend("openai", {
							env = {
								api_key = 'cmd:echo "$OPENAI_API_KEY"',
							},
						})
					end,
					deepseek = function()
						return require("codecompanion.adapters").extend("deepseek", {
							env = {
								api_key = 'cmd:echo "$DEEPSEEK_API_KEY"',
							},
						})
					end,
					anthropic = function()
						return require("codecompanion.adapters").extend("anthropic", {
							env = {
								api_key = 'cmd:echo "$ANTHROPIC_API_KEY"',
							},
						})
					end,
					tavily = function()
						return require("codecompanion.adapters").extend("tavily", {
							env = {
								api_key = 'cmd:echo "$TAVILY_API_KEY"',
							},
						})
					end,
					moonshot = function()
						return require("codecompanion.adapters").extend("openai_compatible", {
              name = "moonshot",
              formatted_name = "Moonshot",
							env = {
								url = "https://api.moonshot.ai",
								api_key = 'cmd:echo "$MOONSHOT_API_KEY"',
							},
							schema = {
								model = {
									default = "kimi-k2-0711-preview",
								},
							},
						})
					end,
				},
				extensions = {
					history = {
						enabled = true,
						opts = {
							expiration_days = 14,
							delete_on_clearing_chat = true,
							title_generation_opts = {
								refresh_every_n_prompts = 1,
                provider = "copilot",
                model = "gpt-4o",
							},
							max_refreshes = 10,
							chat_filter = function(chat_data)
								return chat_data.cwd == vim.fn.getcwd()
							end,
						},
					},
				},
			})

			vim.keymap.set(
				{ "n", "v" },
				"<leader>cq",
				"<cmd>CodeCompanionActions<cr>",
				{ noremap = true, silent = true, desc = "Toggle CodeCompanion Chat Actions" }
			)
			vim.keymap.set(
				{ "n", "v" },
				"<leader>cc",
				"<cmd>CodeCompanionChat Toggle<cr>",
				{ noremap = true, silent = true, desc = "Toggle CodeCompanion Chat" }
			)
			vim.cmd([[cab cc CodeCompanion]])
		end,
	},
}
