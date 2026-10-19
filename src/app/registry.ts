import type { PDFDocumentProxy } from "pdfjs-dist";
import type { EventBus, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { RefKey } from "../annotations/model";

/**
 * Sekme başına, store'a konamayan (serileştirilemeyen / büyük) nesneler.
 * `bytes` diskteki son hâldir; kayıt bunun üzerine yapılır. `managedRefs` bu baytlarda
 * bizim yönettiğimiz annotation nesneleridir.
 */
export interface TabRuntime {
  pdfDoc: PDFDocumentProxy;
  bytes: Uint8Array;
  managedRefs: RefKey[];
  viewer?: PDFViewer;
  eventBus?: EventBus;
  linkService?: PDFLinkService;
  findController?: PDFFindController;
}

export const runtimes = new Map<string, TabRuntime>();
