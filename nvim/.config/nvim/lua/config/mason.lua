local M = {}

---Return an absolute path inside a Mason-installed package.
---@param ... string Path segments under mason/packages/
---@return string
function M.package_path(...)
	return vim.fs.joinpath(vim.fn.stdpath("data"), "mason", "packages", ...)
end

return M
