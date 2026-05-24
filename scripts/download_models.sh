#!/bin/bash
# download_models.sh — Download model weights into resources/models/
# Whisper base.en (~74MB) + Mistral 7B Q4 (~4GB) or LLaMA 3.2 3B (~1.8GB)

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS_DIR="$(dirname "$SCRIPT_DIR")/resources/models"
mkdir -p "$MODELS_DIR"

echo "=== Downloading Aurelius models ==="
echo "Output: $MODELS_DIR"
echo ""

# ── Whisper base.en ──────────────────────────────────────────────────────────
WHISPER_MODEL="ggml-base.en.bin"
if [ -f "$MODELS_DIR/$WHISPER_MODEL" ]; then
  echo "✓ Whisper model already downloaded"
else
  echo ">>> Downloading Whisper base.en (~74MB)..."
  curl -L --progress-bar \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" \
    -o "$MODELS_DIR/$WHISPER_MODEL"
  echo "✓ Whisper model downloaded"
fi

echo ""

# ── LLM Model (choose size) ───────────────────────────────────────────────────
LLM_CHOICE="${1:-small}"  # Usage: ./download_models.sh [small|large]

if [ "$LLM_CHOICE" == "large" ]; then
  LLM_FILE="mistral-7b-instruct-v0.3.Q4_K_M.gguf"
  LLM_URL="https://huggingface.co/MaziyarPanahi/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3.Q4_K_M.gguf"
  LLM_SIZE="~4.1GB"
else
  LLM_FILE="llama-3.2-3b-instruct.Q4_K_M.gguf"
  LLM_URL="https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf"
  LLM_SIZE="~1.8GB"
fi

if [ -f "$MODELS_DIR/$LLM_FILE" ]; then
  echo "✓ LLM model already downloaded"
else
  echo ">>> Downloading $LLM_FILE ($LLM_SIZE)..."
  echo "    This may take a while depending on your connection."
  curl -L --progress-bar "$LLM_URL" -o "$MODELS_DIR/$LLM_FILE"
  echo "✓ LLM model downloaded"
fi

echo ""
echo "=== ✓ All models ready ==="
echo ""
ls -lh "$MODELS_DIR/"
