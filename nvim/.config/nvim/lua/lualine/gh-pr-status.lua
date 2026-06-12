local cache = { cwd = nil, result = nil, at = 0 }
local TTL = 30000

local hls = {
	OPEN   = { name = "LualineGhOpen",   link = "diffAdded" },
	DRAFT  = { name = "LualineGhDraft",  link = "Comment" },
	MERGED = { name = "LualineGhMerged", link = "Keyword" },
	CLOSED = { name = "LualineGhClosed", link = "DiagnosticError" },
}

for _, h in pairs(hls) do
	vim.api.nvim_set_hl(0, h.name, { link = h.link })
end

vim.api.nvim_create_autocmd("DirChanged", {
	group = vim.api.nvim_create_augroup("lualine_gh_status", { clear = true }),
	callback = function() cache.cwd = nil end,
})

return function()
	local cwd = vim.fn.getcwd()
	local now = vim.uv.now()

	if cache.cwd == cwd and (now - cache.at) < TTL then
		return cache.result or ""
	end

	cache.cwd, cache.at, cache.result = cwd, now, nil

	vim.system({ "gh", "pr", "view", "--json", "number,isDraft,state" }, { text = true, cwd = cwd },
		vim.schedule_wrap(function(out)
			if out.code ~= 0 then return end
			local ok, d = pcall(vim.json.decode, out.stdout)
			if not ok or not d then return end
			local state = (d.state == "OPEN" and d.isDraft) and "DRAFT" or d.state
			local h = hls[state] or hls.OPEN
			cache.result = "%#" .. h.name .. "#PR#" .. d.number .. "%*"
			pcall(require("lualine").refresh, { place = { "statusline" } })
		end))

	return ""
end
