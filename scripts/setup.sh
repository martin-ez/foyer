#!/usr/bin/env bash
# Installs pnpm if it's missing, then the dependencies, which bring the Node version the project
# runs on. Installing pnpm needs Node, so it first installs the major version in .nvmrc if needed.
# On macOS, it also installs Maestro, which checks the iPad app on the simulator, and the Java it
# runs on if that's missing.
# Works on macOS and Linux, including cloud sessions.
set -euo pipefail
cd "$(dirname "$0")/.."

node_major="$(tr -d '[:space:]' < .nvmrc)"
node_dir="$HOME/.local/share/foyer/node"
maestro_version="2.12.1"
maestro_sha256="54dbb0716425626604973cbb374c585ca30272375d9ce15177a1152765ddd9d7"
maestro_dir="$HOME/.local/share/foyer/maestro"
java_major=21
java_dir="$HOME/.local/share/foyer/java"
bin_dir="$HOME/.local/bin"
original_path="$PATH"
installed_node=false
installed="" # the programs installed in $bin_dir that people run, to check the PATH finds them
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

has_pinned_node() {
  command -v node > /dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" = "$node_major" ]
}

# Fails unless the file's SHA-256 checksum is the one given. It compares the two itself, because
# `sha256sum -c` on macOS passes a checksum line it can't read, such as an empty checksum.
check_sha256() {
  local file="$1" expected="$2" actual
  if command -v sha256sum > /dev/null; then
    actual="$(sha256sum "$file" | cut -d ' ' -f 1)"
  else
    actual="$(shasum -a 256 "$file" | cut -d ' ' -f 1)"
  fi
  if [ "$actual" != "$expected" ]; then
    echo "The checksum of $(basename "$file") is $actual, not $expected." >&2
    return 1
  fi
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
  curl -fsSL -o "$tmp/$file" "$base/$file"
  check_sha256 "$tmp/$file" "$(grep " $file\$" <<< "$sums" | cut -d ' ' -f 1)"
  rm -rf "$node_dir"
  mkdir -p "$node_dir" "$bin_dir"
  tar -xJf "$tmp/$file" -C "$node_dir" --strip-components=1
  ln -sf "$node_dir/bin/node" "$node_dir/bin/npm" "$node_dir/bin/npx" "$bin_dir/"
  export PATH="$node_dir/bin:$PATH"
  installed_node=true
}

# Whether the Java that Maestro would run, from JAVA_HOME or the PATH, is version 17 or newer, as
# Maestro needs. On macOS, `java` is always on the PATH, and fails when no Java is installed.
has_java_for_maestro() {
  local java="${JAVA_HOME:+$JAVA_HOME/bin/java}" major
  major="$("${java:-java}" -version 2>&1 | sed -nE 's/.* version "([0-9]+).*/\1/p' | head -n 1)" || true
  [ -n "$major" ] && [ "$major" -ge 17 ]
}

# Downloads the newest Eclipse Temurin Java runtime of the pinned major from Adoptium into
# $java_dir, after checking it against the published checksum, and links java into $bin_dir.
install_java() {
  local arch release link sum
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    arm64) arch=aarch64 ;;
    *) echo "Cannot install Java on $(uname -m). Install Java 17 or newer and run this script again." >&2; exit 1 ;;
  esac

  release="$(curl -fsSL "https://api.adoptium.net/v3/assets/latest/$java_major/hotspot?architecture=$arch&image_type=jre&os=mac&vendor=eclipse")"
  link="$(plutil -extract 0.binary.package.link raw -o - - <<< "$release")"
  sum="$(plutil -extract 0.binary.package.checksum raw -o - - <<< "$release")"

  echo "Installing Java $java_major into $java_dir"
  curl -fsSL -o "$tmp/java.tar.gz" "$link"
  check_sha256 "$tmp/java.tar.gz" "$sum"
  rm -rf "$java_dir"
  mkdir -p "$java_dir" "$bin_dir"
  tar -xzf "$tmp/java.tar.gz" -C "$java_dir" --strip-components=1
  ln -sf "$java_dir/Contents/Home/bin/java" "$bin_dir/"
  installed="$installed java"
}

# Downloads the pinned Maestro command-line tool from its GitHub release into $maestro_dir, after
# checking it against the checksum above, and links maestro into $bin_dir.
install_maestro() {
  echo "Installing Maestro $maestro_version into $maestro_dir"
  curl -fsSL -o "$tmp/maestro.zip" \
    "https://github.com/mobile-dev-inc/maestro/releases/download/cli-$maestro_version/maestro.zip"
  check_sha256 "$tmp/maestro.zip" "$maestro_sha256"
  unzip -q "$tmp/maestro.zip" -d "$tmp"
  rm -rf "$maestro_dir"
  mkdir -p "$(dirname "$maestro_dir")" "$bin_dir"
  mv "$tmp/maestro" "$maestro_dir"
  ln -sf "$maestro_dir/bin/maestro" "$bin_dir/"
  installed="$installed maestro"
}

if ! command -v pnpm > /dev/null; then
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

  npm install --global --allow-scripts=pnpm "$(node -p 'require("./package.json").packageManager')"
  if [ "$installed_node" = true ]; then
    ln -sf "$node_dir/bin/pnpm" "$bin_dir/"
    installed="$installed pnpm"
  fi
fi

pnpm install --frozen-lockfile

# The iPad simulator, and so Maestro, needs macOS.
if [ "$(uname -s)" = Darwin ]; then
  if ! has_java_for_maestro; then
    install_java
  fi
  if [ ! -f "$maestro_dir/lib/maestro-cli-$maestro_version.jar" ]; then
    install_maestro
  fi
fi

not_found=""
for program in $installed; do
  if [ "$(PATH="$original_path" && command -v "$program")" != "$bin_dir/$program" ]; then
    not_found="$not_found $program"
  fi
done
if [ -n "$not_found" ]; then
  echo
  echo "Installed in $bin_dir, where your PATH doesn't find them first:$not_found"
  echo "Put that folder first on your PATH by adding this line to your shell profile:"
  echo "  export PATH=\"$bin_dir:\$PATH\""
fi
