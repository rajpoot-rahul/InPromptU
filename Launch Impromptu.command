#!/bin/zsh
set -e
TASK_ROOT="$(cd "$(dirname "$0")" && pwd)"
if [[ -d "/Applications/Impromptu.app" ]]; then
  open "/Applications/Impromptu.app"
elif [[ -d "$HOME/Applications/Impromptu.app" ]]; then
  open "$HOME/Applications/Impromptu.app"

else
  cd "$TASK_ROOT"
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  npm start
fi
