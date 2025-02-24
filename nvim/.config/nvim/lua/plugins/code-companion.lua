return {
  {
    "olimorris/codecompanion.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-treesitter/nvim-treesitter",
      "j-hui/fidget.nvim"
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
            }
          },
          inline = {
            adapter = "copilot"
          },
        },
        display = {
          chat = {
            window = {
              position = "right",
              width = 0.40
            },
          },
        },
        adapters = {
          copilot = function()
            return require("codecompanion.adapters").extend("copilot", {
              schema = {
                model = {
                  default = "claude-3.5-sonnet",
                }
              }
            })
          end,
          deepseek = function()
            return require("codecompanion.adapters").extend("deepseek", {
              env = {
                api_key = 'cmd:echo "$DEEPSEEK_API_KEY"'
              },
            })
          end,
          anthropic = function()
            return require("codecompanion.adapters").extend("anthropic", {
              env = {
                api_key = 'cmd:echo "$ANTHROPIC_API_KEY"'
              },
            })
          end
        }
      })

      require("plugins.code-companion.spinner"):init()

      vim.keymap.set({ "n", "v" }, "<leader>cq", "<cmd>CodeCompanionActions<cr>", { noremap = true, silent = true })
      vim.keymap.set({ "n", "v" }, "<leader>cc", "<cmd>CodeCompanionChat Toggle<cr>",
        { noremap = true, silent = true })
      vim.cmd([[cab cc CodeCompanion]])
    end,
  },
}
