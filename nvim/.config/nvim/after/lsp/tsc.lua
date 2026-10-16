-- TypeScript 7 (tsc --lsp) cannot load tsserver plugins, so Vue projects stay
-- on vtsls (see after/lsp/vtsls.lua). The bundled config is loaded directly to
-- wrap its root_dir; cmd comes from the same chunk because both share its
-- per-root binary cache.
local base = dofile(vim.api.nvim_get_runtime_file("lsp/tsc.lua", false)[1])

local function is_vue_project(bufnr)
	local pkg = vim.fs.find("package.json", {
		upward = true,
		path = vim.fs.dirname(vim.api.nvim_buf_get_name(bufnr)),
	})[1]
	local text = pkg and table.concat(vim.fn.readfile(pkg), "\n") or ""
	return text:find('"vue"%s*:') ~= nil or text:find('"nuxt"%s*:') ~= nil
end

---@type vim.lsp.Config
return {
	cmd = base.cmd,
	root_dir = function(bufnr, on_dir)
		if not is_vue_project(bufnr) then
			base.root_dir(bufnr, on_dir)
		end
	end,
}
