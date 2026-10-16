local npm = require("config.npm")

-- vtsls's bundled TypeScript, not vue-language-server's peer dependency: npm
-- resolves that peer to typescript@latest, and TypeScript 7+ has no JS API.
-- v3 reads it only from --tsdk; init_options.typescript.tsdk is ignored.
local tsdk = npm.package_path("vtsls", "node_modules", "typescript", "lib")

---@type vim.lsp.Config
return {
	cmd = { "vue-language-server", "--stdio", tsdk and ("--tsdk=" .. tsdk) or nil },
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

			local param = unpack(result)
			local id, command, payload = unpack(param)
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
}
