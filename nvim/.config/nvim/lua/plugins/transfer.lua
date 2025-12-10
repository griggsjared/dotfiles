return {
	"coffebar/transfer.nvim",
	lazy = true,
	cmd = {
		"TransferInit",
		"DiffRemote",
		"TransferUpload",
		"TransferDownload",
		"TransferDirDiff",
		"TransferRepeat",
		"TransferGitStaged",
	},
	config = function()
		require("transfer").setup()
		vim.keymap.set("n", "<leader>td", "<cmd>DiffRemote<cr>", { desc = "Diff with remote" })
		vim.keymap.set("n", "<leader>tu", "<cmd>TransferUpload<cr>", { desc = "Upload file to remote" })
		vim.keymap.set("n", "<leader>td", "<cmd>TransferDownload<cr>", { desc = "Download file from remote" })

		-- Custom command to upload all git-changed files
		vim.api.nvim_create_user_command("TransferGitStaged", function()
			local git_root = vim.fn.systemlist("git rev-parse --show-toplevel")[1]
			if vim.v.shell_error ~= 0 then
				vim.notify("Not in a git repository", vim.log.levels.ERROR)
				return
			end

			local staged_files = vim.fn.systemlist("git diff --cached --name-only")

			if #staged_files == 0 then
				vim.notify("No staged files to transfer", vim.log.levels.INFO)
				return
			end

			vim.notify("Transferring " .. #staged_files .. " staged file(s)...", vim.log.levels.INFO)

			-- Upload each file
			for _, file in ipairs(staged_files) do
				local full_path = git_root .. "/" .. file
				require("transfer.transfer").upload_file(full_path)
			end

			vim.notify("Finished transferring git-changed files", vim.log.levels.INFO)
		end, { desc = "Upload all git-staged files to remote" })

		vim.keymap.set("n", "<leader>tg", "<cmd>TransferGitStaged<cr>", { desc = "Upload git-staged files to remote" })
	end,
}
