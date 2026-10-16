local M = {}

---Return an absolute path inside the globally installed npm package that
---provides `bin`. Resolved from the executable on PATH because the global
---package directory changes with the active NVM Node version.
---@param bin string Executable name on PATH
---@param ... string Path segments under the package root
---@return string? path nil when `bin` is not on PATH
function M.package_path(bin, ...)
	local exe = vim.fn.exepath(bin)
	if exe == "" then
		return nil
	end
	local root = vim.fs.root(vim.fn.resolve(exe), "package.json")
	return root and vim.fs.joinpath(root, ...)
end

return M
