return {
  {
    "olimorris/codecompanion.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-treesitter/nvim-treesitter",
      "j-hui/fidget.nvim"
    },
    config = function()
      local spinner = require("plugins.code-companion.spinner")
      spinner:init()

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
            adapter = "copilot"
          },
        },
        display = {
          chat = {
            window = {
              -- position = "right",
              -- width = 0.50
              layout = "float"
            },
          },
        },
        adapters = {
          copilot = function()
            return require("codecompanion.adapters").extend("copilot", {
              schema = {
                model = {
                  default = "gemini-2.5-pro",
                }
              }
            })
          end,
          openai = function()
            return require("codecompanion.adapters").extend("openai", {
              env = {
                api_key = 'cmd:echo "$OPENAI_API_KEY"'
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

      vim.keymap.set({ "n", "v" }, "<leader>cq", "<cmd>CodeCompanionActions<cr>", { noremap = true, silent = true })
      vim.keymap.set({ "n", "v" }, "<leader>cc", "<cmd>CodeCompanionChat Toggle<cr>",
        { noremap = true, silent = true })
      vim.cmd([[cab cc CodeCompanion]])
    end,
  },
}
