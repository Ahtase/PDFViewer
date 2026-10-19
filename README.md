# PDFViewer

macOS ve Linux için PDF okuyucu ve not alma uygulaması (Tauri 2 + React + PDF.js).

Highlight, metin notu ve kalem çizimleri **PDF'in içine standart annotation olarak** yazılır. Dosyayı başka bir uygulamada (Preview, Okular, telefon vb.) açtığında notlar görünür.

## Özellikler

- Highlight (düzenlenebilir palet, opaklık, kalınlık), metin notu, kalem, silgi
- Notları sürükleyip taşıma (sayfalar arasında da)
- Geri al / yinele (⌘/Ctrl+Z, ⇧⌘Z)
- Arama, içindekiler, küçük resimler, notlar paneli; kenar çubuğu yeniden boyutlandırılabilir
- Sekmeler, tek sayfa / iki sayfa / kitap görünümü
- ⌘/Ctrl + tekerlek ile yakınlaştırma, el aracı ile kaydırma (G veya Boşluk basılı)
- Elle kaydetme (⌘/Ctrl+S); kaydetmeden kapatırken sorar, ilk kayıtta `.bak` yedeği alır

## Geliştirme

Gereksinimler: Node.js 20+, Rust, [Tauri önkoşulları](https://tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev      # geliştirme
npm test               # birim testleri
npm run typecheck
```

## Derleme

```sh
npm run tauri build    # macOS: .app / .dmg, Linux: .deb / .rpm / AppImage
npm run install:linux  # Linux: ~/.local altına kurar (menüde görünür)
```

Uygulama simgesi `app-icon.svg` dosyasından üretilir: `npm run icon`.

## Lisanslar

- Gömülü yazı tipi Noto Sans, SIL Open Font License altındadır (`src/assets/fonts/OFL.txt`).
