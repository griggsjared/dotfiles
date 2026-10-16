local mason = require("config.mason")

-- The bundled config is loaded directly to wrap its root_dir.
local base = dofile(vim.api.nvim_get_runtime_file("lsp/vtsls.lua", false)[1])

local function is_vue_project(bufnr)
	local pkg = vim.fs.find("package.json", {
		upward = true,
		path = vim.fs.dirname(vim.api.nvim_buf_get_name(bufnr)),
	})[1]
	local text = pkg and table.concat(vim.fn.readfile(pkg), "\n") or ""
	return text:find('"vue"%s*:') ~= nil or text:find('"nuxt"%s*:') ~= nil
end

-- Inject @vue/typescript-plugin so vtsls attaches to .vue buffers,
-- which vue_ls (hybrid mode) requires. Overrides the filetypes from
-- nvim-lspconfig's bundled lsp/vtsls.lua. Only Vue projects use vtsls;
-- everything else uses TypeScript 7 (see after/lsp/tsc.lua), which cannot
-- load the Vue plugin.
---@type vim.lsp.Config
return {
	filetypes = { "typescript", "javascript", "javascriptreact", "typescriptreact", "vue" },
	root_dir = function(bufnr, on_dir)
		if vim.bo[bufnr].filetype == "vue" or is_vue_project(bufnr) then
			base.root_dir(bufnr, on_dir)
		end
	end,
	settings = {
		vtsls = {
			tsserver = {
				globalPlugins = {
					{
						name = "@vue/typescript-plugin",
						location = mason.package_path(
							"vue-language-server",
							"node_modules",
							"@vue",
							"language-server"
						),
						languages = { "vue" },
						configNamespace = "typescript",
					},
				},
			},
		},
	},
}
