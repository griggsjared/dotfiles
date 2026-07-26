---@class FtSpec
---@field parsers? string[] Treesitter parsers to ensure installed
---@field lsp? string[] LSP servers to enable for this buffer
---@field commentstring? string Buffer commentstring (used by built-in gc)
---@field bo? table<string, any> Buffer-local options
---@field wo? table<string, any> Window-local options

---@type table<string, FtSpec>
local registry = {
	astro = { parsers = { "astro" }, lsp = { "astro" } },
	bash = { parsers = { "bash" } },
	blade = {
		parsers = { "blade", "html", "php", "php_only" },
		lsp = { "html", "laravel_ls" },
		commentstring = "{{--%s--}}",
	},
	c = { parsers = { "c" }, lsp = { "clangd" } },
	cpp = { parsers = { "cpp" }, lsp = { "clangd" } },
	css = { parsers = { "css" }, lsp = { "cssls", "tailwindcss" } },
	go = { parsers = { "go" }, lsp = { "gopls", "golangci_lint_ls" } },
	html = { parsers = { "html" }, lsp = { "html", "tailwindcss", "cssls" } },
	javascript = {
		parsers = { "javascript" },
		lsp = { "vtsls", "tailwindcss", "eslint" },
		commentstring = "//%s",
	},
	javascriptreact = {
		parsers = { "jsx" },
		lsp = { "vtsls", "tailwindcss", "eslint" },
		commentstring = "{/*%s*/}",
	},
	json = { parsers = { "json" }, lsp = { "jsonls" } },
	lua = { parsers = { "lua" }, lsp = { "lua_ls" } },
	markdown = {
		parsers = { "markdown", "markdown_inline" },
		lsp = { "marksman" },
		wo = { wrap = true },
	},
	php = {
		parsers = { "php", "php_only" },
		lsp = { "intelephense", "laravel_ls" },
		commentstring = "//%s",
		bo = { tabstop = 4, shiftwidth = 4 },
	},
	python = { bo = { tabstop = 4, shiftwidth = 4 } },
	rust = { parsers = { "rust" }, lsp = { "rust_analyzer" } },
	sh = { parsers = { "bash" } },
	svelte = { parsers = { "svelte" }, lsp = { "svelte", "vtsls", "tailwindcss", "eslint" } },
	templ = { parsers = { "templ" }, lsp = { "templ", "html", "tailwindcss" } },
	typescript = {
		parsers = { "typescript" },
		lsp = { "vtsls", "tailwindcss", "eslint" },
		commentstring = "//%s",
	},
	typescriptreact = {
		parsers = { "tsx" },
		lsp = { "vtsls", "tailwindcss", "eslint" },
		commentstring = "{/*%s*/}",
	},
	vue = { parsers = { "vue" }, lsp = { "vtsls", "vue_ls", "tailwindcss", "eslint" } },
	zig = { parsers = { "zig" }, lsp = { "zls" } },
}

local M = {}

---Apply the registered ft spec to the current buffer.
---@param ft string Filetype key into the registry
function M.setup(ft)
	local spec = registry[ft]
	if not spec then
		vim.notify("config.ft: no spec registered for filetype: " .. ft, vim.log.levels.WARN)
		return
	end

	if spec.parsers then
		require("nvim-treesitter").install(spec.parsers)
		vim.treesitter.start()
		vim.wo.foldexpr = "v:lua.vim.treesitter.foldexpr()"
	end
	if spec.lsp then
		vim.lsp.enable(spec.lsp)
	end
	if spec.commentstring then
		vim.bo.commentstring = spec.commentstring
	end
	for name, value in pairs(spec.bo or {}) do
		vim.bo[name] = value
	end
	for name, value in pairs(spec.wo or {}) do
		vim.wo[name] = value
	end
end

return M
