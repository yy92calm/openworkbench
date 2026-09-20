#!/usr/bin/env bash
# Workbench sandbox smoke test — macOS Seatbelt backend.
# Validates the OS semantics the TS policy renderer relies on.
# Mirrors apps/desktop/src/main/sandbox/seatbelt.ts (keep in sync when the
# profile skeleton changes there).
set -u

# Normalize TMPDIR (no trailing slash) — Seatbelt subpath matching is a plain
# string prefix, so a double slash would break every allow rule.
TMPDIR="${TMPDIR:-/tmp}"
TMPDIR="${TMPDIR%/}"

WS="$(mktemp -d "$TMPDIR/wb-sandbox-smoke.XXXXXX")"
PROFILE="$WS/workbench-sandbox.sb"
FAIL=0

mkdir -p "$WS/ws/.git" "$WS/ws/.workbench" "$WS/xdg" "$WS/tmp"

# Escape the dot in the path for the protected-subpath deny regex.
GIT_RE="$(printf '%s' "$WS/ws/.git" | sed 's/\./\\./g')"
WB_RE="$(printf '%s' "$WS/ws/.workbench" | sed 's/\./\\./g')"

cat > "$PROFILE" <<EOF
(version 1)
(deny default)
(allow process-exec*)
(allow process-fork)
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup)
(allow iokit-open)
(allow system-socket)
(allow file-read*)
(allow file-test-existence)
(allow file-write* (subpath "$WS/ws") (subpath "/private$WS/ws") (subpath "$WS/xdg") (subpath "/private$WS/xdg") (subpath "$WS/tmp") (subpath "/private$WS/tmp") (subpath "/tmp") (subpath "/private/tmp") (subpath "/var/tmp") (subpath "/private/var/tmp"))
(deny file-write* (regex #"^(/private)?${GIT_RE}(/|\$)"))
(deny file-write* (regex #"^(/private)?${WB_RE}(/|\$)"))
(allow network-outbound)
(allow network-bind)
(allow network-inbound)
EOF

sb() { /usr/bin/sandbox-exec -f "$PROFILE" "$@"; }

ok()   { echo "PASS: $1"; }
bad()  { echo "FAIL: $1"; FAIL=1; }

# 1. write inside the workspace succeeds
if sb /bin/sh -c "echo hi > '$WS/ws/ok.txt'" >/dev/null 2>&1 && [ -f "$WS/ws/ok.txt" ]; then
  ok "workspace write allowed"
else
  bad "workspace write allowed"
fi

# 2. write to workspace/.git is denied
if sb /bin/sh -c "echo hi > '$WS/ws/.git/deny.txt'" >/dev/null 2>&1; then
  bad "workspace .git write denied"
else
  ok "workspace .git write denied"
fi

# 2b. write to workspace/.workbench is denied (second protected subpath)
if sb /bin/sh -c "echo hi > '$WS/ws/.workbench/deny.txt'" >/dev/null 2>&1; then
  bad "workspace .workbench write denied"
else
  ok "workspace .workbench write denied"
fi

# 3. write outside the sandbox roots (HOME) is denied
if sb /bin/sh -c "echo hi > '$HOME/wb-sandbox-deny.txt'" >/dev/null 2>&1; then
  bad "home write denied"
  rm -f "$HOME/wb-sandbox-deny.txt"
else
  ok "home write denied"
fi

# 4. loopback bind succeeds (sidecar HTTP server requirement)
if sb python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); s.close()" >/dev/null 2>&1; then
  ok "loopback bind allowed"
else
  bad "loopback bind allowed"
fi

# 5. python3 executes (PATH resolution + exec + temp scratch)
if sb python3 -c "print('ok')" >/dev/null 2>&1; then
  ok "python3 exec allowed"
else
  bad "python3 exec allowed"
fi

rm -rf "$WS"

if [ "$FAIL" -eq 0 ]; then
  echo "sandbox smoke (darwin): all passed"
else
  echo "sandbox smoke (darwin): FAILED"
  exit 1
fi
