#!/usr/bin/env bash
# Run a command from the repo root with the Node version in .nvmrc, when nvm
# can provide it. Otherwise fall back to whatever `node` is on PATH.
cd "$(dirname "$0")/.." || exit 1

nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
if [ -s "$nvm_sh" ]; then
  . "$nvm_sh"
  if ! nvm use >/dev/null 2>&1; then
    { nvm install >/dev/null 2>&1 && nvm use >/dev/null 2>&1; } ||
      echo "with-node: couldn't switch to Node $(cat .nvmrc); using $(node -v)" >&2
  fi
fi

exec "$@"
