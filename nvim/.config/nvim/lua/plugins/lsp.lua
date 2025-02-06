return {
  {
    "hrsh7th/cmp-nvim-lsp",
  },
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
    opts = {
      auto_install = true,
    },
    config = function()
      require("mason-lspconfig").setup({
        ensure_installed = {
          "html",
          "somesass_ls",
          "tailwindcss",
          "intelephense",
          "lua_ls",
          "ts_ls",
          "volar",
          "gopls",
          "templ",
        },
      })
    end,
  },
  {
    "neovim/nvim-lspconfig",
    lazy = false,
    config = function()
      local symbols = { Error = "󰅙", Info = "󰋼", Hint = "󰌵", Warn = "" }

      for name, icon in pairs(symbols) do
        local hl = "DiagnosticSign" .. name
        vim.fn.sign_define(hl, { text = icon, numhl = hl, texthl = hl })
      end

      local orig_util_open_floating_preview = vim.lsp.util.open_floating_preview
      function vim.lsp.util.open_floating_preview(contents, syntax, opts, ...)
        opts = opts or {}
        opts.border = opts.border
            or {
              { "╭", "FloatBorder" },
              { "─", "FloatBorder" },
              { "╮", "FloatBorder" },
              { "│", "FloatBorder" },
              { "╯", "FloatBorder" },
              { "─", "FloatBorder" },
              { "╰", "FloatBorder" },
              { "│", "FloatBorder" },
            }
        return orig_util_open_floating_preview(contents, syntax, opts, ...)
      end

      local lspconfig = require("lspconfig")
      local mason_lspconfig = require("mason-lspconfig")
      local cmp_nvim_lsp = require("cmp_nvim_lsp")

      --cmp capabilities for each lsp server
      local capabilities = cmp_nvim_lsp.default_capabilities()

      -- setup handlers for each lsp server
      mason_lspconfig.setup_handlers({

        -- automatically setup lsp for all installed.
        -- function(server)
        --   lspconfig[server].setup({
        --     capabilities = capabilities,
        --   })
        -- end,

        -- add specific setup for some servers
        ["lua_ls"] = function()
          lspconfig["lua_ls"].setup({
            capabilities = capabilities,
            settings = {
              Lua = {
                diagnostics = {
                  globals = { "vim" },
                },
              },
            },
          })
        end,

        ["html"] = function()
          lspconfig["html"].setup({
            capabilities = capabilities,
            filetypes = { "html", "templ", "blade" },
          })
        end,

        ["somesass_ls"] = function()
          lspconfig["somesass_ls"].setup({
            capabilities = capabilities,
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
        end,

        ["tailwindcss"] = function()
          lspconfig["tailwindcss"].setup({
            capabilities = capabilities,
            filetypes = { "html", "css", "scss", "less", "vue", "javascript", "typescript", "javascriptreact", "typescriptreact", "templ" },
          })
        end,

        ["intelephense"] = function()
          lspconfig["intelephense"].setup({
            capabilities = capabilities,
            filetypes = { "php" },
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
                  "wordpress"
                }
              }
            }
          })
        end,

        ["gopls"] = function()
          lspconfig["gopls"].setup({
            capabilities = capabilities,
            cmd = { "gopls" },
            filetypes = { "go", "gomod", "gowork", "gotmpl" },
            settings = {
              gopls = {
                completeUnimported = true,
                usePlaceholders = true,
                analyses = {
                  unusedparams = true,
                },
              },
            },
          })
        end,

        ["rust_analyzer"] = function()
          lspconfig["rust_analyzer"].setup({
            capabilities = capabilities,
            settings = {
              ["rust-analyzer"] = {
                checkOnSave = {
                  command = "clippy",
                },
              },
            },
          })
        end,

        ["zls"] = function()
          lspconfig["zls"].setup({
            capabilities = capabilities,
            settings = {
              zls = {
                checkOnSave = {
                  command = "clippy",
                },
              },
            },
          })
          vim.g.zig_fmt_autosave = 0
        end,

        ["volar"] = function()
          lspconfig["volar"].setup({
            -- NOTE: Uncomment to enable volar in file types other than vue.
            -- (Similar to Takeover Mode)
            -- IMPORTANT: Make sure tsserver has a tsserver.config.json and tsserver.json file for your project!
            -- filetypes = { "vue", "javascript", "typescript", "javascriptreact", "typescriptreact", "json" },

            -- NOTE: Uncomment to restrict Volar to only Vue/Nuxt projects. This will enable Volar to work alongside other language servers (tsserver).

            -- root_dir = require("lspconfig").util.root_pattern(
            --   "vue.config.js",
            --   "vue.config.ts",
            --   "nuxt.config.js",
            --   "nuxt.config.ts"
            -- ),
            init_options = {
              vue = {
                hybridMode = false,
              },
              -- NOTE: This might not be needed. Uncomment if you encounter issues.
              typescript = {
                tsdk = vim.fn.getcwd() .. "/node_modules/typescript/lib",
              },
            },
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
        end,

        ["ts_ls"] = function()
          local mason_packages = vim.fn.stdpath("data") .. "/mason/packages"
          local volar_path = mason_packages .. "/vue-language-server/node_modules/@vue/language-server"

          lspconfig["ts_ls"].setup({
            -- NOTE: To enable hybridMode, change HybrideMode to true above and uncomment the following filetypes block.

            -- filetypes = { "typescript", "javascript", "javascriptreact", "typescriptreact", "vue" },
            init_options = {
              plugins = {
                {
                  name = "@vue/typescript-plugin",
                  location = volar_path,
                  languages = { "vue" },
                },
              },
            },
            settings = {
              typescript = {
                inlayHints = {
                  includeInlayParameterNameHints = "all",
                  includeInlayParameterNameHintsWhenArgumentMatchesName = true,
                  includeInlayFunctionParameterTypeHints = true,
                  includeInlayVariableTypeHints = true,
                  includeInlayVariableTypeHintsWhenTypeMatchesName = true,
                  includeInlayPropertyDeclarationTypeHints = true,
                  includeInlayFunctionLikeReturnTypeHints = true,
                  includeInlayEnumMemberValueHints = true,
                },
              },
            },
          })
        end,
      })

      vim.keymap.set("n", "K", vim.lsp.buf.hover, {})
      vim.keymap.set("n", "<leader>gd", vim.lsp.buf.definition, {})
      vim.keymap.set("n", "<leader>gr", vim.lsp.buf.references, {})
      vim.keymap.set("n", "<leader>ca", vim.lsp.buf.code_action, {})
      vim.keymap.set("n", "<leader>rn", vim.lsp.buf.rename, {})
    end,
  },
}
