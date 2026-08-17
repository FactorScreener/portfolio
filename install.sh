#!/usr/bin/env bash
# Portfolio one-time installer for macOS and Linux.
# Usage:  bash install.sh
set -euo pipefail

REPO_ZIP="https://github.com/FactorScreener/portfolio/archive/refs/heads/master.zip"
APP_URL="http://localhost:8787"

echo
echo "============================================================"
echo "  Portfolio installer"
echo
echo "  This runs a one-time setup on your computer:"
echo "    1. Install Bun - the free engine that runs the app"
echo "    2. Download the app to your Downloads folder"
echo "    3. Build it"
echo "    4. Start it and open your browser"
echo
echo "  Nothing is uploaded anywhere. Your data stays on this"
echo "  computer."
echo "============================================================"
echo

# ---- 1. Bun --------------------------------------------------------------
if command -v bun >/dev/null 2>&1; then
  BUN="$(command -v bun)"
elif [ -x "$HOME/.bun/bin/bun" ]; then
  BUN="$HOME/.bun/bin/bun"
else
  echo "[1/5] Bun is not installed. Installing it now..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://bun.sh/install | bash
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://bun.sh/install | bash
  else
    echo "Neither curl nor wget was found. Please install one of them,"
    echo "then run this installer again."
    exit 1
  fi
  BUN="$HOME/.bun/bin/bun"
  if [ ! -x "$BUN" ]; then
    echo
    echo "Bun did not finish installing. You can install it yourself"
    echo "from https://bun.sh and then run this installer again."
    exit 1
  fi
fi
echo "[1/5] Bun is ready."

# ---- 2. Where to install -------------------------------------------------
echo
DEFAULT_DIR="$HOME/Downloads"
read -r -p "[2/5] Press Enter for $DEFAULT_DIR, or type another folder: " APP_DIR || APP_DIR=""
APP_DIR="${APP_DIR:-$DEFAULT_DIR}"
APP_DIR="${APP_DIR/#\~/$HOME}"
mkdir -p "$APP_DIR"

# ---- 3. Download ---------------------------------------------------------
echo
echo "[3/5] Downloading the app from GitHub..."
ZIP="$APP_DIR/portfolio-master.zip"
if command -v curl >/dev/null 2>&1; then
  curl -fL --retry 2 -o "$ZIP" "$REPO_ZIP"
else
  wget -q -O "$ZIP" "$REPO_ZIP"
fi

# ---- 4. Unpack -----------------------------------------------------------
echo "[4/5] Unpacking the app..."
APP_PATH="$APP_DIR/FactorScreener.com Portfolio"
UNPACKED="$APP_DIR/portfolio-master"
HAD_DB=0
if [ -f "$APP_PATH/data/portfolio.sqlite" ]; then
  cp "$APP_PATH/data/portfolio.sqlite" "${TMPDIR:-/tmp}/portfolio.sqlite.bak"
  HAD_DB=1
fi
rm -rf "$APP_PATH" "$UNPACKED"
if command -v unzip >/dev/null 2>&1; then
  unzip -q "$ZIP" -d "$APP_DIR"
elif command -v python3 >/dev/null 2>&1; then
  python3 -m zipfile -e "$ZIP" "$APP_DIR"
else
  echo "No unzip tool found. Please install 'unzip' and run this again."
  exit 1
fi
mv "$UNPACKED" "$APP_PATH"
rm -f "$ZIP"
if [ "$HAD_DB" = "1" ]; then
  mkdir -p "$APP_PATH/data"
  cp "${TMPDIR:-/tmp}/portfolio.sqlite.bak" "$APP_PATH/data/portfolio.sqlite"
  rm -f "${TMPDIR:-/tmp}/portfolio.sqlite.bak"
  echo "Kept your saved settings from the previous install."
fi

# ---- 5. Build ------------------------------------------------------------
echo "[5/5] Installing packages and building. First run takes a minute..."
cd "$APP_PATH"
"$BUN" install
"$BUN" run build

echo
echo "============================================================"
echo "  Setup complete!"
echo
echo "  The app lives in: $APP_PATH"
echo "  Your browser should open at $APP_URL in a moment."
echo
echo "  NEXT TIME, run this installer again - it updates the app"
echo "  to the latest version and starts it."
echo
echo "  Keep this window open while you use the app."
echo "  Press Ctrl+C here to stop it."
echo "============================================================"
echo

# ---- Start now -----------------------------------------------------------
if [ "$(uname)" = "Darwin" ]; then
  (sleep 2; open "$APP_URL" 2>/dev/null || true) &
else
  (sleep 2; xdg-open "$APP_URL" 2>/dev/null || true) &
fi
exec "$BUN" start
