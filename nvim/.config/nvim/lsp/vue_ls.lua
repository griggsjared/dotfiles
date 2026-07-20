local mason = require("config.mason")

---@type vim.lsp.Config
return {
	---@param client vim.lsp.Client
	on_init = function(client)
		local retries = 0

		local function typescriptHandler(err, result, context)
			local ts_client = vim.lsp.get_clients({ bufnr = context.bufnr, name = "vtsls" })[1]

			if not ts_client then
				if retries <= 10 then
					retries = retries + 1
					vim.defer_fn(function()
						typescriptHandler(err, result, context)
					end, 100)
				else
					vim.notify(
						"Could not find `vtsls` lsp client required by `vue_ls`.",
						vim.log.levels.ERROR
					)
				end
				return
			end

			local param = table.unpack(result)
			local id, command, payload = table.unpack(param)
			ts_client:exec_cmd({
				title = "vue_request_forward",
				command = "typescript.tsserverRequest",
				arguments = { command, payload },
			}, { bufnr = context.bufnr }, function(_, r)
				local response_data = { { id, r and r.body } }
				---@diagnostic disable-next-line: param-type-mismatch
				client:notify("tsserver/response", response_data)
			end)
		end

		client.handlers["tsserver/request"] = typescriptHandler
	end,
	init_options = {
		typescript = {
			tsdk = mason.package_path("vue-language-server", "node_modules", "typescript", "lib"),
		},
	},
}
