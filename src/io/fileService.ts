import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export async function pickPdfs(): Promise<string[]> {
  const result = await open({
    multiple: true,
    directory: false,
    filters: [{ name: "PDF", extensions: ["pdf", "PDF"] }],
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

export async function readPdf(path: string): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("read_pdf", { path });
  return new Uint8Array(buf);
}

/** İlk kayıtta `<dosya>.pdf.bak` yedeği alınır, yazma atomiktir (geçici dosya + rename). */
export async function savePdf(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("save_pdf", bytes, { headers: { "x-path": encodeURIComponent(path) } });
}

export async function initialFiles(): Promise<string[]> {
  return invoke<string[]>("initial_files");
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
