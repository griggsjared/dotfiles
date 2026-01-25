local M = {}

function M.get(c, _)
  return {
    RenderMarkdownHeader1 = { fg = c.base.green },
    RenderMarkdownHeader2 = { fg = c.base.magenta },
    RenderMarkdownHeader3 = { fg = c.base.yellow },
    RenderMarkdownHeader4 = { fg = c.base.orange },
    RenderMarkdownHeader5 = { fg = c.base.red },
    RenderMarkdownHeader6 = { fg = c.base.blue },
    RenderMarkdownCode = { bg = c.base.black },
    RenderMarkdownCodeInline = { bg = c.base.black },
  }
end

return M
