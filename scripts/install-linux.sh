#!/bin/sh
# Per-user Linux install (no sudo): adds Localify to the Applications menu and
# to the "Open With" list for MP3 / OGG files. Run after building with
# `npm run install:linux` (or `electron-builder --linux dir`).
#   sh scripts/install-linux.sh             install / update
#   sh scripts/install-linux.sh --uninstall remove
set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DATA=${XDG_DATA_HOME:-$HOME/.local/share}
APP_DIR=$DATA/localify/app
DESKTOP=$DATA/applications/localify.desktop
ICONS=$DATA/icons/hicolor
BIN=$HOME/.local/bin/localify

refresh() {
  command -v update-desktop-database >/dev/null && update-desktop-database "$DATA/applications" 2>/dev/null || true
  command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$ICONS" 2>/dev/null || true
}

if [ "$1" = "--uninstall" ]; then
  rm -rf "$DATA/localify" "$DESKTOP" "$BIN"
  find "$ICONS" -name localify.png -delete 2>/dev/null || true
  refresh
  echo "Localify removed."
  exit 0
fi

SRC=$ROOT/dist/linux-unpacked
[ -x "$SRC/localify" ] || { echo "Build first: npx electron-builder --linux dir" >&2; exit 1; }

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR" "$DATA/applications" "$HOME/.local/bin"
cp -a "$SRC/." "$APP_DIR/"
ln -sf "$APP_DIR/localify" "$BIN"

for png in "$ROOT"/build/icons/*x*.png; do
  size=$(basename "$png" .png)
  mkdir -p "$ICONS/$size/apps"
  cp "$png" "$ICONS/$size/apps/localify.png"
done

cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=Localify
GenericName=Music Player
Comment=Play your local MP3 and OGG music library
Exec="$APP_DIR/localify" %U
Icon=localify
Terminal=false
StartupWMClass=localify
Categories=AudioVideo;Audio;Player;
Keywords=music;audio;player;mp3;ogg;
MimeType=audio/mpeg;audio/mp3;audio/x-mp3;audio/ogg;audio/x-vorbis+ogg;audio/vorbis;audio/x-vorbis;
EOF

refresh
echo "Localify installed: Applications menu + Open With for MP3/OGG."
