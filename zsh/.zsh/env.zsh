# Environment variables and PATH configuration

# Local bin
export PATH=$HOME/.local/bin:$PATH

# Composer
if [ -d $HOME/.composer/vendor/bin ]; then
  export PATH=$HOME/.composer/vendor/bin:$PATH
fi

# Go
if [ -d $HOME/go/bin ]; then
  export GOPATH=$HOME/go
  export PATH=$HOME/go/bin:$PATH
fi

# Ruby
if [ -d "/opt/homebrew/opt/ruby/bin" ]; then
  export PATH=/opt/homebrew/opt/ruby/bin:$PATH
  export PATH=`gem environment gemdir`/bin:$PATH
fi

# MySQL client
if [ -d "/opt/homebrew/opt/mysql-client/bin" ]; then
  export PATH=/opt/homebrew/opt/mysql-client/bin:$PATH
fi

# Valet aliases (PHP development)
alias php='valet php'
alias composer='valet composer'
