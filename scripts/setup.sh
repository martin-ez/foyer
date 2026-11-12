#!/usr/bin/env bash
# Installs what the project needs to run: the pinned Node and pnpm versions, then the dependencies.
# Works on macOS and Linux, including cloud sessions.
set -euo pipefail
cd "$(dirname "$0")/.."

node_major="$(tr -d '[:space:]' < .nvmrc)"
node_dir="$HOME/.local/share/foyer/node"
bin_dir="$HOME/.local/bin"
original_path="$PATH"
installed_node=false

has_pinned_node() {
  command -v node > /dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" = "$node_major" ]
}

# Downloads the newest release of the pinned Node major from nodejs.org into $node_dir, after
# checking it against the published checksums, and links node, npm and npx into $bin_dir.
install_node() {
  local os arch base sums file
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) echo "Cannot install Node on $(uname -s). Install Node $node_major and run this script again." >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) echo "Cannot install Node on $(uname -m). Install Node $node_major and run this script again." >&2; exit 1 ;;
  esac

  base="https://nodejs.org/dist/latest-v$node_major.x"
  sums="$(curl -fsSL "$base/SHASUMS256.txt")"
  file="$(grep -oE "node-v[0-9.]+-$os-$arch\.tar\.xz" <<< "$sums" | head -n 1)"
  if [ -z "$file" ]; then
    echo "nodejs.org has no Node $node_major build for $os-$arch." >&2
    exit 1
  fi

  echo "Installing ${file%.tar.xz} into $node_dir"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL -o "$tmp/$file" "$base/$file"
  if command -v sha256sum > /dev/null; then
    (cd "$tmp" && grep " $file\$" <<< "$sums" | sha256sum -c --quiet -)
  else
    (cd "$tmp" && grep " $file\$" <<< "$sums" | shasum -a 256 -c --quiet -)
  fi
  rm -rf "$node_dir"
  mkdir -p "$node_dir" "$bin_dir"
  tar -xJf "$tmp/$file" -C "$node_dir" --strip-components=1
  ln -sf "$node_dir/bin/node" "$node_dir/bin/npm" "$node_dir/bin/npx" "$bin_dir/"
  export PATH="$node_dir/bin:$PATH"
  installed_node=true
}

if ! has_pinned_node; then
  nvm_script="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ -s "$nvm_script" ]; then
    # shellcheck source=/dev/null
    . "$nvm_script"
    nvm install "$node_major"
  else
    install_node
  fi
fi

pnpm_spec="$(node -p 'require("./package.json").packageManager')"
if ! command -v pnpm > /dev/null; then
  # pnpm's install script swaps its launchers for its native binary.
  npm install --global --allow-scripts=pnpm "$pnpm_spec"
  if [ "$installed_node" = true ]; then
    ln -sf "$node_dir/bin/pnpm" "$bin_dir/"
  fi
fi

pnpm install --frozen-lockfile

if [ "$installed_node" = true ] && [ "$(PATH="$original_path" && command -v node)" != "$bin_dir/node" ]; then
  echo
  echo "Node $node_major is installed in $bin_dir."
  echo "Put that folder first on your PATH by adding this line to your shell profile:"
  echo "  export PATH=\"$bin_dir:\$PATH\""
fi
