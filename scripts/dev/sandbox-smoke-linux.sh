#!/usr/bin/env bash
# Workbench sandbox smoke test — Linux bubblewrap backend.
# Validates the OS semantics the TS argv builder relies on.
# Mirrors apps/desktop/src/main/sandbox/bwrap.ts (keep in sync when the argv
# layout changes there).
set -u

if ! command -v bwrap >/dev/null 2>&1; then
  echo "sandbox smoke (linux): bwrap not found on PATH; install bubblewrap first"
  exit 2
fi

# WSL1 cannot create user namespaces — same exclusion as the TS layer.
if grep -qi microsoft /proc/version 2>/dev/null && ! grep -qiE 'WSL2|microsoft-standard' /proc/version 2>/dev/null; then
  echo "sandbox smoke (linux): WSL1 detected; bubblewrap is not supported there"
  exit 2
fi

WS="$(mktemp -d /tmp/wb-sandbox-smoke.XXXXXX)"
FAIL=0
mkdir -p "$WS/ws/.git" "$WS/xdg" "$WS/tmp"

# Argv layout mirrors buildBwrapArgs: ro-bind / first, writable overlays next,
# protected subpath ro-binds after the workspace bind, --dev/--proc on top.
bw() {
  bwrap --unshare-pid \
    --ro-bind / / \
    --bind "$WS/xdg" "$WS/xdg" \
    --bind "$WS/tmp" "$WS/tmp" \
    --bind "$WS/ws" "$WS/ws" \
    --ro-bind "$WS/ws/.git" "$WS/ws/.git" \
    --dev /dev --proc /proc "$@"
}

ok()  { echo "PASS: $1"; }
bad() { echo "FAIL: $1"; FAIL=1; }

# 1. write inside the workspace succeeds
if bw /bin/sh -c "echo hi > '$WS/ws/ok.txt'" >/dev/null 2>&1 && [ -f "$WS/ws/ok.txt" ]; then
  ok "workspace write allowed"
else
  bad "workspace write allowed"
fi

# 2. write to workspace/.git is denied (read-only bind on top)
if bw /bin/sh -c "echo hi > '$WS/ws/.git/deny.txt'" >/dev/null 2>&1; then
  bad "workspace .git write denied"
else
  ok "workspace .git write denied"
fi

# 3. write outside the sandbox roots (HOME) is denied
if bw /bin/sh -c "echo hi > '$HOME/wb-sandbox-deny.txt'" >/dev/null 2>&1; then
  bad "home write denied"
  rm -f "$HOME/wb-sandbox-deny.txt"
else
  ok "home write denied"
fi

# 4. loopback bind succeeds when network is open
if bw python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); s.close()" >/dev/null 2>&1; then
  ok "loopback bind allowed (network open)"
else
  bad "loopback bind allowed (network open)"
fi

# 5. python3 executes
if bw python3 -c "print('ok')" >/dev/null 2>&1; then
  ok "python3 exec allowed"
else
  bad "python3 exec allowed"
fi

# 6. --unshare-net blocks outbound (loopback-only policy == full isolation in phase one)
if bwrap --unshare-pid --ro-bind / / --unshare-net --dev /dev --proc /proc \
    python3 -c "import socket; s=socket.socket(); s.settimeout(2); s.connect(('8.8.8.8',53))" >/dev/null 2>&1; then
  bad "unshare-net blocks outbound"
else
  ok "unshare-net blocks outbound"
fi

rm -rf "$WS"

if [ "$FAIL" -eq 0 ]; then
  echo "sandbox smoke (linux): all passed"
else
  echo "sandbox smoke (linux): FAILED"
  exit 1
fi
