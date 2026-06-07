return {
	{
		"saghen/blink.cmp",
		dependencies = {
			"rafamadriz/friendly-snippets",
			"saghen/blink.compat",
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
		},
		version = "*",
		build = "cargo build --release",
		opts_extend = { "sources.default" },
		config = function()
			if vim.g.copilot_enabled == nil then
				vim.g.copilot_enabled = vim.fn.filereadable(vim.fn.expand("~/.config/github-copilot/apps.json")) == 1
			end

			vim.keymap.set("n", "<leader>ac", function()
				if vim.g.copilot_enabled then
					vim.g.copilot_enabled = false
				elseif vim.fn.filereadable(vim.fn.expand("~/.config/github-copilot/apps.json")) == 1 then
					vim.g.copilot_enabled = true
				else
					vim.notify("Copilot: no credentials found")
					return
				end
				require("blink.cmp").reload()
				vim.notify("Copilot: " .. (vim.g.copilot_enabled and "on" or "off"))
			end, { desc = "Toggle copilot" })

			require("blink.cmp").setup({
				keymap = { preset = "enter" },
				appearance = {
					nerd_font_variant = "mono",
				},
				completion = {
					documentation = {
						auto_show = true,
						auto_show_delay_ms = 50,
					},
					menu = {
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
				},
				sources = {
					default = { "lsp", "path", "snippets", "buffer", "copilot" },
					providers = {
						copilot = {
							name = "copilot",
							module = "blink-copilot",
							score_offset = 100,
							async = true,
							enabled = function()
								return vim.g.copilot_enabled
							end,
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
