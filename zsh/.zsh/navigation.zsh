# File and directory navigation

# Aliases
alias ls='eza -A --icons --group-directories-first --git'

# Kill process listening on a port
kport() {
  if [[ -z "$1" ]]; then
    echo "Usage: kport <port>"
    return 1
  fi

  local pids
  pids=("${(@f)$(lsof -ti :"$1")}")

  if [[ ${#pids} -eq 0 ]]; then
    echo "No process is listening on port $1"
    return 1
  fi

  kill -15 "${pids[@]}" 2>/dev/null &&
    echo "Killed process(es) on port $1: ${pids[*]}" || {
    sleep 1
    if kill -9 "${pids[@]}" 2>/dev/null; then
      echo "Force-killed process(es) on port $1: ${pids[*]}"
    else
      echo "Failed to kill process(es) on port $1: ${pids[*]}" >&2
      return 1
    fi
  }
}

# chpwd function automatically called when directory changes
chpwd() {
  ls
}
