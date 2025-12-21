return {
	{
		dir = vim.fn.stdpath("config"),
		name = "yank-ref",
		config = function()
			local function current_relative_path()
				local path = vim.fn.fnamemodify(vim.api.nvim_buf_get_name(0), ":.")
				if path == "" then
					return nil
				end
				return path
			end

			vim.keymap.set({ "n", "x" }, "<leader>yt", function()
				local path = current_relative_path()
				if not path then
					return
				end

				local mode = vim.fn.mode()
				local is_visual = mode == "v" or mode == "V" or mode == "\022"

				local ref
				if is_visual then
					local start_pos = vim.fn.getpos("'<")
					local end_pos = vim.fn.getpos("'>")
					local start_line, start_col = start_pos[2], start_pos[3]
					local end_line, end_col = end_pos[2], end_pos[3]

					if start_line > end_line or (start_line == end_line and start_col > end_col) then
						start_line, end_line = end_line, start_line
						start_col, end_col = end_col, start_col
					end

					if mode == "V" then
						ref = string.format("@%s:L%d-L%d", path, start_line, end_line)
					else
						ref = string.format("@%s:L%d:C%d-L%d:C%d", path, start_line, start_col, end_line, end_col)
					end
				else
					local cursor = vim.api.nvim_win_get_cursor(0)
					local line = cursor[1]
					local col = cursor[2] + 1
					ref = string.format("@%s:L%d:C%d", path, line, col)
				end

				vim.fn.setreg("+", ref)
				vim.notify("Copied: " .. ref)
			end, { desc = "Copy file reference" })

			vim.keymap.set("n", "<leader>yf", function()
				local path = current_relative_path()
				if not path then
					return
				end

				local ref = "@" .. path
				vim.fn.setreg("+", ref)
				vim.notify("Copied: " .. ref)
			end, { desc = "Copy file reference (no line)" })
		end,
	},
}
