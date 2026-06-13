return {
	{
		"saghen/blink.cmp",
		init = function()
			local copilot_default_on = vim.env.NVIM_COPILOT_ENABLED == "1"
			if vim.g.copilot_enabled == nil then
				vim.g.copilot_enabled = copilot_default_on
			end
		end,
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
					if not vim.g.copilot_enabled then
						vim.cmd("Copilot disable")
					end
				end,
			},
		},
		version = "*",
		build = "cargo build --release",
		opts_extend = { "sources.default" },
		config = function()
			local function set_copilot_enabled(enabled)
				vim.g.copilot_enabled = enabled
				require("blink.cmp").reload()
				vim.cmd("Copilot " .. (enabled and "enable" or "disable"))
			end

			vim.keymap.set("n", "<leader>ac", function()
				if vim.g.copilot_enabled then
					set_copilot_enabled(false)
				elseif vim.fn.filereadable(vim.fn.expand("~/.config/github-copilot/apps.json")) == 1 then
					set_copilot_enabled(true)
				else
					vim.notify("Copilot: no credentials found")
					return
				end
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
