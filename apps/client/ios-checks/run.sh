#!/bin/sh
# Runs the Maestro flows in ios-checks/, or the ones given, on the booted iPad simulator, and copies
# the screenshots they take into ios-checks/screenshots/. The app must be installed there, and the
# local backend and Expo's development server running.
set -eu
cd "$(dirname "$0")/.."

fail() {
  echo "$1" >&2
  echo "docs/development.md explains how to run the iPad app on the simulator." >&2
  exit 1
}

xcrun simctl list devices booted | grep -q "iPad" || fail "No iPad simulator is booted."
curl -s -o /dev/null --max-time 5 http://localhost:8787 ||
  fail "The local backend doesn't answer at http://localhost:8787."
curl -s -o /dev/null --max-time 5 http://localhost:8081/status ||
  fail "Expo's development server doesn't answer at http://localhost:8081."

rm -rf ios-checks/results ios-checks/screenshots
[ $# -gt 0 ] || set -- ios-checks
status=0
MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true \
  maestro test --test-output-dir ios-checks/results "$@" || status=$?
mkdir -p ios-checks/screenshots
find ios-checks/results -path "*/takeScreenshot/*.png" -exec cp {} ios-checks/screenshots/ \;
exit "$status"
