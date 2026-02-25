# PHP development - Valet aliases and artisan completions

# Valet aliases
alias php='valet php'
alias composer='valet composer'

# Cached artisan completions (overrides stock _artisan from zsh-completions)
# Auto-refreshes every 10 completions per project
_artisan_get_command_list () {
    local cache_dir="/tmp/artisan_completions"
    local cache_key=$(echo "$PWD" | md5)
    local cache_file="$cache_dir/$cache_key"
    local hits_file="$cache_file.hits"
    local max_hits=10

    [[ -d "$cache_dir" ]] || mkdir -p "$cache_dir"

    local hits=0
    [[ -f "$hits_file" ]] && hits=$(<"$hits_file")

    if [[ ! -f "$cache_file" ]] || (( hits >= max_hits )); then
        php artisan --no-ansi 2>/dev/null | \
            sed "1,/Available commands/d" | \
            awk '/ [a-z]+/ { print $1 }' | \
            sed -E 's/^[ ]+//g' | \
            sed -E 's/[:]+/\\:/g' | \
            sed -E 's/[ ]{2,}/\:/g' > "$cache_file"
        echo 0 > "$hits_file"
    else
        echo $(( hits + 1 )) > "$hits_file"
    fi

    cat "$cache_file"
}

_artisan () {
    if [ -f artisan ]; then
        local -a commands
        IFS=$'\n'
        commands=(`_artisan_get_command_list`)
        _describe 'commands' commands
    fi
}

compdef _artisan php artisan
compdef _artisan artisan
