#!/bin/sh
# Exports the web app into web-export-checks/versions/: current/ as deploys do, and earlier/ without
# minifying, so every file has another name, standing in for the version a deploy replaces. The
# export checks' backend serves served/, which starts as a copy of current/.
set -eu
cd "$(dirname "$0")/.."
versions=web-export-checks/versions
rm -rf "$versions"
expo export --platform web --output-dir "$versions/current"
expo export --platform web --no-minify --output-dir "$versions/earlier"
cp -R "$versions/current" "$versions/served"
