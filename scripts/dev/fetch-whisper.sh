#!/usr/bin/env bash
set -euo pipefail

# Download whisper.cpp binary + tiny model into apps/desktop/binaries/whisper/
# macOS:   copy from Homebrew install
# Windows: user must compile from source (see instructions below)
# Model:   ggml-tiny-q5_1.bin (~31MB quantized) from HuggingFace

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TARGET="$PROJECT_ROOT/apps/desktop/binaries/whisper"

echo "=== Whisper.cpp 模型下载 ==="

mkdir -p "$TARGET"

OS="$(uname -s)"

# 1. Binary
if [[ "$OS" == "Darwin" ]]; then
  BREW_BIN="$(brew --prefix)/bin/whisper-cli"
  if [[ ! -L "$BREW_BIN" && ! -f "$BREW_BIN" ]]; then
    echo "  whisper-cli not found via Homebrew. Install with: brew install whisper-cpp"
    exit 1
  fi
  RESOLVED="$(readlink -f "$BREW_BIN" 2>/dev/null || echo "$BREW_BIN")"
  cp -f "$RESOLVED" "$TARGET/whisper-cli"
  chmod +x "$TARGET/whisper-cli"
  echo "  ✓ binary: whisper-cli (macOS)"
else
  echo "  ⚠ 非 macOS 环境，跳过二进制复制。"
  echo "  Windows 用户请手动编译 whisper.cpp 并将 whisper-cli.exe 放入:"
  echo "    $TARGET/whisper-cli.exe"
  echo ""
  echo "  编译步骤:"
  echo "    git clone https://github.com/ggerganov/whisper.cpp"
  echo "    cd whisper.cpp"
  echo "    cmake -B build -DBUILD_SHARED_LIBS=OFF"
  echo "    cmake --build build --config Release -j"
  echo "    copy build\\bin\\Release\\whisper-cli.exe $TARGET\\"
fi

# 2. Download ggml-tiny-q5_1.bin model (quantized, ~31MB)
MODEL_NAME="ggml-tiny-q5_1.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL_NAME"
if [[ ! -f "$TARGET/$MODEL_NAME" ]]; then
  echo "  Downloading $MODEL_NAME (~31MB)..."
  curl -L -o "$TARGET/$MODEL_NAME" "$MODEL_URL"
else
  echo "  ✓ model: $MODEL_NAME (already exists)"
fi

echo "=== Whisper.cpp 就绪 ==="
ls -lh "$TARGET"
