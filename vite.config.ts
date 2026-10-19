import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

// pdf.js'in çalışma zamanında yüklediği dosyalar (CJK cmap'leri, standart fontlar,
// JBIG2/JPX decoder wasm'ları, ICC profilleri) /pdfjs altında sunulur.
const pdfjsAssets = ["cmaps", "standard_fonts", "wasm", "iccs"].map((dir) => ({
  src: `node_modules/pdfjs-dist/${dir}/*`,
  dest: `pdfjs/${dir}`,
  // Eklenti varsayılan olarak tam yolu korur (pdfjs/wasm/node_modules/...); düzleştir.
  rename: { stripBase: true as const },
}));

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), viteStaticCopy({ targets: pdfjsAssets })],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // macOS 11+ WebKit ve WebKitGTK top-level await ve modern sözdizimini destekler.
    target: "es2022",
    // Dosyalar yerelden yüklenir; pdf.js tek parça kalabilir.
    chunkSizeWarningLimit: 2500,
  },
}));
