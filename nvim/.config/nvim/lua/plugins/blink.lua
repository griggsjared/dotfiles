return {
  {
    "saghen/blink.cmp",
    dependencies = {
      "rafamadriz/friendly-snippets",
      "fang2hou/blink-copilot",
    },
    -- version = "1.*",
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
        },
        providers = {
          copilot = {
            name = "copilot",
            module = "blink-copilot",
            score_offset = 100,
            transform_items = function(_, items)
              local CompletionItemKind = vim.deepcopy(require("blink.cmp.types").CompletionItemKind)
              local kind_idx = #CompletionItemKind + 1

              for _, item in ipairs(items) do
                item.kind = kind_idx
                item.kind_text = "Copilot"
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
