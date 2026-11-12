#!/usr/bin/env bash
# Installs what the project needs to run: the pinned Node and pnpm versions, then the dependencies.
# Works on macOS and Linux, including cloud sessions.
set -euo pipefail
cd "$(dirname "$0")/.."

node_major="$(tr -d '[:space:]' < .nvmrc)"
if ! command -v node > /dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "$node_major" ]; then
  nvm_script="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ ! -s "$nvm_script" ]; then
    echo "Node $node_major is required. Install it, or install nvm and run this script again." >&2
    exit 1
  fi
  # shellcheck source=/dev/null
  . "$nvm_script"
  nvm install "$node_major"
fi

pnpm_spec="$(node -p 'require("./package.json").packageManager')"
if ! command -v pnpm > /dev/null; then
  npm install --global "$pnpm_spec"
fi

pnpm install --frozen-lockfile
