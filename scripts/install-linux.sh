#!/usr/bin/env bash
# PDFViewer'ı kullanıcı dizinine kurar (sudo gerekmez).
# Kaldırmak için: scripts/install-linux.sh --uninstall
set -euo pipefail

cd "$(dirname "$0")/.."
APP=pdfviewer
BIN_DIR="$HOME/.local/bin"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
DESKTOP_FILE="$DATA_DIR/applications/$APP.desktop"
ICON_DIR="$DATA_DIR/icons/hicolor"

refresh_caches() {
  update-desktop-database "$DATA_DIR/applications" 2>/dev/null || true
  gtk-update-icon-cache -q -t "$ICON_DIR" 2>/dev/null || true
  # KDE (Plasma 6/5) başlatıcı önbelleği
  kbuildsycoca6 --noincremental >/dev/null 2>&1 || kbuildsycoca5 --noincremental >/dev/null 2>&1 || true
}

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$BIN_DIR/$APP" "$DESKTOP_FILE"
  for size in 32x32 64x64 128x128 256x256 512x512 scalable; do
    rm -f "$ICON_DIR/$size/apps/$APP".{png,svg}
  done
  refresh_caches
  echo "PDFViewer kaldırıldı."
  exit 0
fi

echo "==> Sürüm derlemesi alınıyor (birkaç dakika sürebilir)…"
npm run tauri -- build --no-bundle

echo "==> Kuruluyor…"
install -Dm755 "src-tauri/target/release/$APP" "$BIN_DIR/$APP"

install -Dm644 src-tauri/icons/32x32.png "$ICON_DIR/32x32/apps/$APP.png"
install -Dm644 src-tauri/icons/64x64.png "$ICON_DIR/64x64/apps/$APP.png"
install -Dm644 src-tauri/icons/128x128.png "$ICON_DIR/128x128/apps/$APP.png"
install -Dm644 "src-tauri/icons/128x128@2x.png" "$ICON_DIR/256x256/apps/$APP.png"
install -Dm644 src-tauri/icons/icon.png "$ICON_DIR/512x512/apps/$APP.png"
install -Dm644 app-icon.svg "$ICON_DIR/scalable/apps/$APP.svg"

mkdir -p "$(dirname "$DESKTOP_FILE")"
cat > "$DESKTOP_FILE" <<DESKTOP
[Desktop Entry]
Type=Application
Name=PDFViewer
GenericName=PDF Okuyucu
Comment=PDF okuma, vurgulama ve not alma
Exec=$BIN_DIR/$APP %F
Icon=$APP
Terminal=false
Categories=Office;Viewer;
MimeType=application/pdf;
Keywords=pdf;okuyucu;not;highlight;
StartupWMClass=$APP
DESKTOP

refresh_caches
echo "==> Tamam. Uygulama menüsünde ve KRunner'da 'PDFViewer' olarak görünür."
