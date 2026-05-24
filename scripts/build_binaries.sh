#!/bin/bash
# build_binaries.sh — Build whisper.cpp and llama.cpp for macOS (Apple Silicon + Intel)
# Run this once to populate resources/bin/ before building the DMG

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$ROOT_DIR/resources/bin"
BUILD_TMP="$ROOT_DIR/build/tmp"

# Build for the host architecture. A forced universal (arm64;x86_64) build
# fails to link on Intel Macs because Homebrew OpenSSL (needed by llama.cpp's
# HTTPS support) is single-arch. Override with ARCH=... for a universal build
# only if you have universal OpenSSL installed.
ARCH="${ARCH:-$(uname -m)}"
echo "Target architecture: $ARCH"

mkdir -p "$BIN_DIR" "$BUILD_TMP"

echo "=== Building Aurelius native binaries ==="
echo "Output: $BIN_DIR"
echo ""

# ── 1. whisper.cpp ───────────────────────────────────────────────────────────
echo ">>> Building whisper.cpp..."
cd "$BUILD_TMP"

if [ ! -d "whisper.cpp" ]; then
  git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git
fi

cd whisper.cpp
cmake -B build \
  -DCMAKE_BUILD_TYPE=Release \
  -DWHISPER_METAL=ON \
  -DWHISPER_NO_AVX=OFF \
  -DCMAKE_OSX_ARCHITECTURES="$ARCH"
cmake --build build --config Release -j$(sysctl -n hw.logicalcpu)

cp build/bin/main "$BIN_DIR/whisper-cpp"
echo "✓ whisper-cpp built → $BIN_DIR/whisper-cpp"

# ── 2. llama.cpp ─────────────────────────────────────────────────────────────
echo ""
echo ">>> Building llama.cpp..."
cd "$BUILD_TMP"

if [ ! -d "llama.cpp" ]; then
  git clone --depth 1 https://github.com/ggerganov/llama.cpp.git
fi

cd llama.cpp
cmake -B build \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLAMA_METAL=ON \
  -DCMAKE_OSX_ARCHITECTURES="$ARCH"
cmake --build build --config Release --target llama-cli -j$(sysctl -n hw.logicalcpu)

cp build/bin/llama-cli "$BIN_DIR/llama-cli"
echo "✓ llama-cli built → $BIN_DIR/llama-cli"

# ── 3. Strip & sign ──────────────────────────────────────────────────────────
echo ""
echo ">>> Stripping debug symbols..."
strip "$BIN_DIR/whisper-cpp" "$BIN_DIR/llama-cli"

echo ""
echo ">>> File sizes:"
ls -lh "$BIN_DIR/"

echo ""
echo "=== ✓ All binaries built successfully ==="
echo "Run './scripts/download_models.sh' next to download model weights."
