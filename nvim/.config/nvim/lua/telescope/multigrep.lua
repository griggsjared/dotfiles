local pickers = require("telescope.pickers")
local finders = require("telescope.finders")
local sorters = require("telescope.sorters")
local make_entry = require("telescope.make_entry")
local conf = require("telescope.config").values

local M = {}

M.live_multigrep = function(opts)
  opts = opts or {}
  opts.cwd = opts.cwd or vim.fn.getcwd()

  local finder = finders.new_async_job({
    command_generator = function(prompt)
      if not prompt or prompt == "" then
        return nil
      end

      local parts = vim.split(prompt, "  ")
      local args = { "rg" }

      if parts[1] then
        table.insert(args, "-e")
        table.insert(args, parts[1])
      end

      if parts[2] then
        table.insert(args, "-g")
        table.insert(args, parts[2])
      end

      return vim.tbl_flatten({
        args,
        {
          "--color=never",
          "--no-heading",
          "--with-filename",
          "--line-number",
          "--column",
          "--smart-case"
        }
      })
    end,
    entry_maker = make_entry.gen_from_vimgrep(opts),
    cwd = opts.cwd,
  })

  pickers.new(opts, {
    prompt_title = "Live Multi Grep",
    finder = finder,
    debounce = 100,
    previewer = conf.grep_previewer(opts),
    sorter = sorters.highlighter_only(opts),
  }):find()
end

return M
