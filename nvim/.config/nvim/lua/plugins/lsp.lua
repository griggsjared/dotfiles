return {
	{
		"williamboman/mason.nvim",
		lazy = false,
		config = function()
			require("mason").setup()
		end,
	},
	{
		"williamboman/mason-lspconfig.nvim",
		lazy = false,
		config = function()
			require("mason-lspconfig").setup({
				ensure_installed = {
					"html",
					"somesass_ls",
					"tailwindcss",
					"intelephense",
					"lua_ls",
					"vtsls",
					"vue_ls",
					"gopls",
					"templ",
					"astro",
					"rust_analyzer",
					"zls",
					"clangd",
					"golangci_lint_ls",
					"eslint",
				},
			})
		end,
	},
	{
		"neovim/nvim-lspconfig",
		lazy = false,
		config = function()
			vim.lsp.config("lua_ls", {
				settings = {
					Lua = {
						diagnostics = {
							globals = { "vim" },
						},
						workspace = {
							library = vim.api.nvim_get_runtime_file("", true),
							checkThirdParty = false,
						},
						telemetry = {
							enable = false,
						},
					},
				},
			})

			vim.lsp.config("html", {
				filetypes = { "html", "templ", "blade" },
			})

			vim.lsp.config("somesass_ls", {
				settings = {
					scss = {
						validate = true,
						lint = {
							unknownAtRules = "ignore",
						},
					},
					less = {
						validate = true,
						lint = {
							unknownAtRules = "ignore",
						},
					},
					css = {
						validate = true,
						lint = {
							unknownAtRules = "ignore",
						},
					},
				},
			})

			vim.lsp.config("tailwindcss", {
				filetypes = {
					"html",
					"css",
					"scss",
					"less",
					"vue",
					"javascript",
					"typescript",
					"javascriptreact",
					"typescriptreact",
					"templ",
					"astro",
				},
			})

			vim.lsp.config("intelephense", {
				settings = {
					intelephense = {
						stubs = {
							"apache",
							"bcmath",
							"bz2",
							"calendar",
							"com_dotnet",
							"Core",
							"ctype",
							"curl",
							"date",
							"dba",
							"dom",
							"enchant",
							"exif",
							"FFI",
							"fileinfo",
							"filter",
							"fpm",
							"ftp",
							"gd",
							"gettext",
							"gmp",
							"hash",
							"iconv",
							"imap",
							"intl",
							"json",
							"ldap",
							"libxml",
							"mbstring",
							"meta",
							"mysqli",
							"oci8",
							"odbc",
							"openssl",
							"pcntl",
							"pcre",
							"PDO",
							"pdo_ibm",
							"pdo_mysql",
							"pdo_pgsql",
							"pdo_sqlite",
							"pgsql",
							"Phar",
							"posix",
							"pspell",
							"random",
							"readline",
							"Reflection",
							"session",
							"shmop",
							"SimpleXML",
							"snmp",
							"soap",
							"sockets",
							"sodium",
							"SPL",
							"sqlite3",
							"standard",
							"superglobals",
							"sysvmsg",
							"sysvsem",
							"sysvshm",
							"tidy",
							"tokenizer",
							"xml",
							"xmlreader",
							"xmlrpc",
							"xmlwriter",
							"xsl",
							"Zend OPcache",
							"zip",
							"zlib",
							"wordpress",
						},
					},
				},
			})

			vim.lsp.config("vtsls", {
				settings = {
					vtsls = {
						tsserver = {
							globalPlugins = {
								{
									name = "@vue/typescript-plugin",
									location = vim.fn.stdpath("data")
										.. "/mason/packages/vue-language-server/node_modules/@vue/language-server",
									languages = { "vue" },
									configNamespace = "typescript",
								},
							},
						},
					},
				},
				filetypes = { "typescript", "javascript", "javascriptreact", "typescriptreact", "vue" },
			})

			vim.lsp.config("vue_ls", {
				on_init = function(client)
					client.handlers["tsserver/request"] = function(_, result, context)
						local clients = vim.lsp.get_clients({ bufnr = context.bufnr, name = "vtsls" })
						if #clients == 0 then
							vim.notify(
								"Could not found `vtsls` lsp client, vue_lsp would not work without it.",
								vim.log.levels.ERROR
							)
							return
						end
						local ts_client = clients[1]

						local param = table.unpack(result)
						local id, command, payload = table.unpack(param)
						ts_client:exec_cmd({
							title = "tsserver request",
							command = "typescript.tsserverRequest",
							arguments = {
								command,
								payload,
							},
						}, { bufnr = context.bufnr }, function(_, r)
							local response_data = { { id, r.body } }
							---@diagnostic disable-next-line: param-type-mismatch
							client:notify("tsserver/response", response_data)
						end)
					end
				end,
				settings = {
					typescript = {
						inlayHints = {
							enumMemberValues = {
								enabled = true,
							},
							functionLikeReturnTypes = {
								enabled = true,
							},
							propertyDeclarationTypes = {
								enabled = true,
							},
							parameterTypes = {
								enabled = true,
								suppressWhenArgumentMatchesName = true,
							},
							variableTypes = {
								enabled = true,
							},
						},
					},
				},
			})

			vim.lsp.config("gopls", {
				settings = {
					gopls = {
						completeUnimported = true,
						usePlaceholders = true,
						analyses = {
							unusedparams = true,
						},
						hints = {
							parameterNames = true,
						},
					},
				},
			})

			vim.lsp.config("golangci_lint_ls", {
				root_markers = {
					".golangci.yml",
					".golangci.yaml",
					".golangci.toml",
					".golangci.json",
				},
			})

			-- laravel_ls doesnt seem top work when installing from mason, Installed manually...
			-- go install github.com/laravel-ls/laravel-ls/cmd/laravel-ls@latest
			-- manually enabled
			vim.lsp.enable("laravel_ls")

			vim.diagnostic.config({
				virtual_text = true,
				signs = {
					text = {
						[vim.diagnostic.severity.ERROR] = "󰅙",
						[vim.diagnostic.severity.WARN] = "",
						[vim.diagnostic.severity.INFO] = "󰋼",
						[vim.diagnostic.severity.HINT] = "󰌵",
					},
				},
			})

			vim.keymap.set("n", "K", function()
				vim.lsp.buf.hover({
					border = "rounded",
				})
			end, { desc = "Show hover documentation" })
			vim.keymap.set("n", "<leader>gd", vim.lsp.buf.definition, { desc = "Go to definition" })
			vim.keymap.set("n", "<leader>gr", vim.lsp.buf.references, { desc = "Show references" })
			vim.keymap.set("n", "<leader>gi", vim.lsp.buf.implementation, { desc = "Go to implementation" })
			vim.keymap.set("n", "<leader>ca", vim.lsp.buf.code_action, { desc = "Show code actions" })
			vim.keymap.set("n", "<leader>rn", vim.lsp.buf.rename, { desc = "Rename symbol" })

			vim.keymap.set("n", "<leader>xx", function()
				vim.diagnostic.config({ virtual_lines = { current_line = true }, virtual_text = false })
				vim.api.nvim_create_autocmd("CursorMoved", {
					group = vim.api.nvim_create_augroup("line-diagnostics", { clear = true }),
					callback = function()
						vim.diagnostic.config({ virtual_lines = false, virtual_text = true })
						return true
					end,
				})
			end, { desc = "Toggle inlay hints" })

			vim.keymap.set("n", "<leader>ih", function()
				vim.lsp.inlay_hint.enable(not vim.lsp.inlay_hint.is_enabled())
			end, { desc = "Toggle inlay hints" })
		end,
	},
}
