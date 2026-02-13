# File and directory navigation

# Aliases
alias ls='lsd -A'
alias y='yazi'

# Kill process listening on a port
kport() {
  if [[ -z "$1" ]]; then
    echo "Usage: kport <port>"
    return 1
  fi

  local pid
  pid=$(lsof -ti :"$1")

  if [[ -z "$pid" ]]; then
    echo "No process is listening on port $1"
    return 1
  fi

  kill -15 "$pid"
}

# chpwd function automatically called when directory changes
chpwd() {
  ls
}
