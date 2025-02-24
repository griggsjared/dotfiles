return {
  "nvimtools/none-ls.nvim",
  dependencies = {
    "nvimtools/none-ls-extras.nvim",
  },
  config = function()
    local null_ls = require("null-ls")
    null_ls.setup({
      on_attach = function() end,
      sources = {
        null_ls.builtins.formatting.stylua,
        require("none-ls.diagnostics.eslint").with({
          prefer_local = "node_modules/.bin",
          condition = function(utils)
            return utils.root_has_file({
              ".eslintrc.js",
              ".eslintrc.json",
              ".eslintrc",
              ".eslintrc.yml",
              ".eslintrc.yaml",
              ".eslint.config.mjs",
              ".eslint.config.cjs",
              ".eslint.config.js",
            })
          end,
        }),
        null_ls.builtins.formatting.prettier.with({
          prefer_local = "node_modules/.bin",
          condition = function(utils)
            return utils.root_has_file({
              ".prettierrc",
              ".prettierrc.json",
              ".prettierrc.yaml",
              ".prettierrc.yml",
              ".prettierrc.js",
              ".prettierrc.cjs",
              "prettier.config.js",
            })
          end,
          filetypes = {
            "javascript",
            "javascriptreact",
            "typescript",
            "typescriptreact",
            "json",
            "yaml",
            "markdown",
            "css",
            "scss",
            "html",
            "vue",
            "svelte",
            "graphql",
            "lua",
          },
        }),
        null_ls.builtins.formatting.goimports.with({
          filetypes = { "go" },
        }),
        null_ls.builtins.formatting.gofmt.with({
          filetypes = { "go" },
        }),
        null_ls.builtins.formatting.pint.with({
          prefer_local = "vendor/bin",
          filetypes = { "php" },
          condition = function(utils)
            return utils.root_has_file({ "vendor/bin/pint", "pint.json" })
          end,
        }),
        null_ls.builtins.diagnostics.phpstan.with({
          condition = function(utils)
            return utils.root_has_file({
              "phpstan.neon",
              "phpstan.neon.dist",
            })
          end,
        }),
        null_ls.builtins.formatting.blade_formatter.with({
          filetypes = { "blade" },
        }),
        null_ls.builtins.formatting.clang_format.with({
          filetypes = { "c", "cpp", "objc", "objcpp" },
        }),
      },
    })

    vim.keymap.set("n", "<leader>gf", vim.lsp.buf.format, {})
  end,
}
