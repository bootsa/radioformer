#!/usr/bin/env bash
# Runs a command; if it fails, repeats the tail of its output as a GitHub Actions error
# annotation so the failure is readable without downloading the full log.
# usage: scripts/ci-run.sh <title> <command...>
set -uo pipefail
title="$1"; shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
code=${PIPESTATUS[0]}
if [ "$code" -ne 0 ]; then
  msg="$(tail -n 40 "$log" | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | head -c 3500 | awk '{printf "%s%%0A", $0}')"
  echo "::error title=${title} failed (exit ${code})::${msg}"
fi
exit "$code"
