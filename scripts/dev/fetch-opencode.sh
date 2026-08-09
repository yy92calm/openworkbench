#!/usr/bin/env bash
# Fetch the pinned OpenCode binary and place it as an Electron sidecar
# (apps/desktop/binaries/opencode or opencode.exe).
# Runs per-platform locally and in CI so the binary never lives in git.
# Skips the download when the binary for this triple is already in place —
# pass `force` as the first arg to redownload regardless.
set -euo pipefail

OPENCODE_VERSION="${OPENCODE_VERSION:-1.17.13}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="$ROOT/apps/desktop/binaries"
mkdir -p "$OUT_DIR"

FORCE=false
if [ "${1:-}" = "force" ]; then
  FORCE=true
  shift
fi

# Resolve the Rust target triple (arg 1 overrides; else host).
TRIPLE="${1:-$(rustc -Vv | sed -n 's/host: //p')}"

case "$TRIPLE" in
  aarch64-apple-darwin)         ASSET="opencode-darwin-arm64.zip" ;;
  x86_64-apple-darwin)          ASSET="opencode-darwin-x64.zip" ;;
  x86_64-pc-windows-msvc)       ASSET="opencode-windows-x64.zip" ;;
  aarch64-pc-windows-msvc)      ASSET="opencode-windows-arm64.zip" ;;
  x86_64-unknown-linux-gnu)     ASSET="opencode-linux-x64.tar.gz" ;;
  aarch64-unknown-linux-gnu)    ASSET="opencode-linux-arm64.tar.gz" ;;
  *) echo "Unsupported triple: $TRIPLE" >&2; exit 1 ;;
esac

# The binary name the archive extracts: opencode.exe on Windows, opencode elsewhere.
BIN_NAME="opencode"
[ "$ASSET" = "opencode-windows-x64.zip" ] || [ "$ASSET" = "opencode-windows-arm64.zip" ] && BIN_NAME="opencode.exe"
OUT_BIN="$OUT_DIR/$BIN_NAME"

# Cache: skip the download when the target binary is already present.
if [ "$FORCE" = "false" ] && [ -f "$OUT_BIN" ]; then
  echo "Sidecar already present ($OUT_BIN) — skipping download (pass 'force' to redownload)."
  exit 0
fi

URL="https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/${ASSET}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "Downloading $URL"
curl -fsSL "$URL" -o "$TMP/$ASSET"
case "$ASSET" in
  *.tar.gz) tar -xzf "$TMP/$ASSET" -C "$TMP" ;;
  *)
    if command -v unzip >/dev/null 2>&1; then
      unzip -oq "$TMP/$ASSET" -d "$TMP"
    else
      tar -xf "$TMP/$ASSET" -C "$TMP"   # bsdtar (macOS/Windows) extracts zip
    fi
    ;;
esac

# The archive contains an `opencode` (or opencode.exe) binary.
BIN="$(find "$TMP" -type f -name "$BIN_NAME" | head -1)"
cp "$BIN" "$OUT_BIN"
chmod +x "$OUT_BIN"
echo "Placed sidecar for $TRIPLE in $OUT_DIR"
