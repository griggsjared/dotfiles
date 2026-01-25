# Git-related configuration

# Aliases
alias lgit='lazygit'

# nah function to stash git changes or optionally reset tracked changes
nah() {
  if [[ "$1" == "-f" || "$1" == "--force" ]]; then
    shift
    printf "This will reset any changes tracked by git. Continue? [y/N] "
    read -r reply
    if [[ "$reply" != "y" && "$reply" != "Y" ]]; then
      echo "Aborted."
      return 1
    fi
    git reset --hard && git clean -df
    return $?
  fi

  git stash push "$@"
}
