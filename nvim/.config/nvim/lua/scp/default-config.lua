return {
    ["scp"] = {
        host = os.getenv("SCP_HOST"),
        username = os.getenv("SCP_USERNAME"),
        password = os.getenv("SCP_PASSWORD"),
        mappings = {
            {
                ["local"] = "",
                ["remote"] = os.getenv("SCP_REMOTE_PATH"),
            },
        },
    },
}
