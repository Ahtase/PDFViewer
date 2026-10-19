import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

const assets = `${import.meta.env.BASE_URL}pdfjs/`;

export async function openPdfjsDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js veriyi worker'a aktarırken ArrayBuffer'ı devralır; kopyasını veriyoruz.
  return getDocument({
    data: bytes.slice(),
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
  }).promise;
}
