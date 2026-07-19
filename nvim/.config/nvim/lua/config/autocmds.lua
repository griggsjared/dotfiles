local group = vim.api.nvim_create_augroup("config.autocmds", { clear = true })

-- Reload files changed outside Neovim
vim.api.nvim_create_autocmd({ "FocusGained", "BufEnter", "CursorHold" }, {
	group = group,
	pattern = "*",
	command = "checktime",
	desc = "Check for external file changes",
})

-- Treat .env and .env.* files as shell-style env files
vim.filetype.add({
	filename = { [".env"] = "sh" },
	pattern = { ["%.env%..+"] = "sh" },
})
