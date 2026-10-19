import { ask, message } from "@tauri-apps/plugin-dialog";
import { readAnnotations, type ReadResult } from "../annotations/pdfReader";
import { writeAnnotations } from "../annotations/pdfWriter";
import { annotationBounds, type Annotation } from "../annotations/model";
import { fileName, pickPdfs, readPdf, savePdf } from "../io/fileService";
import { openPdfjsDocument } from "../viewer/pdfjs";
import { runtimes } from "./registry";
import { useStore } from "./store";

export async function openWithDialog() {
  await openPaths(await pickPdfs());
}

export async function openPaths(paths: string[]) {
  const store = useStore.getState();
  for (const path of paths) {
    const existing = useStore.getState().tabs.find((t) => t.path === path);
    if (existing) {
      store.activateTab(existing.id);
      continue;
    }
    try {
      await openPath(path);
    } catch (e) {
      store.showToast(`${fileName(path)} açılamadı: ${errorMessage(e)}`, "error");
    }
  }
}

async function openPath(path: string) {
  const bytes = await readPdf(path);
  const [pdfDoc, read] = await Promise.all([
    openPdfjsDocument(bytes),
    readAnnotations(bytes).catch((e): ReadResult & { failed: string } => ({
      annotations: [],
      pdfjsHiddenIds: [],
      encrypted: false,
      signed: false,
      failed: errorMessage(e),
    })),
  ]);

  // Overlay'in çizdiği annotation'ları pdf.js canvas'a çizmesin (AnnotationMode.ENABLE_STORAGE ile çalışır).
  for (const id of read.pdfjsHiddenIds) pdfDoc.annotationStorage.setValue(id, { noView: true });

  const id = crypto.randomUUID();
  runtimes.set(id, {
    pdfDoc,
    bytes,
    managedRefs: read.annotations.map((a) => a.ref!).filter(Boolean),
  });

  let readOnlyReason: string | undefined;
  if ("failed" in read) readOnlyReason = `Annotation'lar okunamadı (${read.failed}); bu dosyada not alma kapalı.`;
  else if (read.encrypted) readOnlyReason = "Şifreli PDF: not alma bu dosyada desteklenmiyor.";

  useStore.getState().addTab({
    id,
    path,
    name: fileName(path),
    numPages: pdfDoc.numPages,
    currentPage: 1,
    scale: 1,
    annotations: read.annotations,
    version: 0,
    savedVersion: 0,
    saveState: "saved",
    readOnlyReason,
    signed: read.signed,
  });
}

const inFlight = new Map<string, Promise<void>>();
const signedApproved = new Set<string>();

/** Sekmeyi kaydeder. Aynı sekme için eşzamanlı kayıtları sıraya koyar. */
export function saveTab(tabId: string): Promise<void> {
  const prev = inFlight.get(tabId) ?? Promise.resolve();
  const next = prev.then(() => doSave(tabId));
  inFlight.set(tabId, next.finally(() => inFlight.get(tabId) === next && inFlight.delete(tabId)));
  return next;
}

async function doSave(tabId: string) {
  const store = useStore.getState();
  const tab = store.tabs.find((t) => t.id === tabId);
  const rt = runtimes.get(tabId);
  if (!tab || !rt || tab.readOnlyReason || tab.version === tab.savedVersion) return;

  if (tab.signed && !signedApproved.has(tabId)) {
    const ok = await ask(
      "Bu PDF dijital olarak imzalanmış. Notları kaydetmek dosyayı yeniden yazar ve imzayı geçersiz kılar. Yine de kaydedilsin mi?",
      { title: "İmzalı PDF", kind: "warning", okLabel: "Kaydet", cancelLabel: "Vazgeç" },
    );
    if (!ok) return;
    signedApproved.add(tabId);
  }

  const version = tab.version;
  store.updateTab(tabId, { saveState: "saving" });
  try {
    const { bytes, refs } = await writeAnnotations(rt.bytes, tab.annotations, rt.managedRefs);
    await savePdf(tab.path, bytes);
    rt.bytes = bytes;
    rt.managedRefs = Object.values(refs);
    useStore.getState().markSaved(tabId, version, refs);
  } catch (e) {
    useStore.getState().updateTab(tabId, { saveState: "error", saveError: errorMessage(e) });
    useStore.getState().showToast(`Kaydedilemedi: ${errorMessage(e)}`, "error");
  }
}

const SAVE = "Kaydet";
const DISCARD = "Kaydetme";
const CANCEL = "Vazgeç";

/** Kaydedilmemiş değişiklik varsa sorar. Dönüş: sekme kapatılabilir mi. */
async function confirmUnsaved(tabId: string): Promise<boolean> {
  const tab = useStore.getState().tabs.find((t) => t.id === tabId);
  if (!tab || tab.version === tab.savedVersion) return true;
  useStore.getState().activateTab(tabId);
  const result = await message(`"${tab.name}" dosyasındaki değişiklikler kaydedilmedi. Kapatmadan önce kaydetmek ister misin?`, {
    title: "Kaydedilmemiş değişiklikler",
    kind: "warning",
    buttons: { yes: SAVE, no: DISCARD, cancel: CANCEL },
  });
  // Plugin, özel etiketlerde etiketi ya da Yes/No/Cancel döndürebilir.
  if (result === SAVE || result === "Yes") {
    await saveTab(tabId);
    const after = useStore.getState().tabs.find((t) => t.id === tabId);
    return !after || after.version === after.savedVersion;
  }
  return result === DISCARD || result === "No";
}

export async function closeTab(tabId: string): Promise<boolean> {
  if (!useStore.getState().tabs.some((t) => t.id === tabId)) return true;
  if (!(await confirmUnsaved(tabId))) return false;
  const rt = runtimes.get(tabId);
  runtimes.delete(tabId);
  useStore.getState().closeTab(tabId);
  rt?.viewer?.cleanup();
  await rt?.pdfDoc.loadingTask.destroy();
  return true;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Annotation'ın bulunduğu yere kaydırır ve seçer. */
export function revealAnnotation(tabId: string, ann: Annotation) {
  const viewer = runtimes.get(tabId)?.viewer;
  if (!viewer) return;
  const [minX, , , maxY] = annotationBounds(ann);
  viewer.scrollPageIntoView({
    pageNumber: ann.pageIndex + 1,
    destArray: [null, { name: "XYZ" }, Math.max(0, minX - 40), maxY + 60, null],
    allowNegativeOffset: false,
  });
  useStore.getState().selectAnnotation(ann.id);
}

export function goToPage(tabId: string, pageNumber: number) {
  const viewer = runtimes.get(tabId)?.viewer;
  if (viewer && pageNumber >= 1 && pageNumber <= viewer.pagesCount) viewer.currentPageNumber = pageNumber;
}

export function zoom(tabId: string, how: "in" | "out" | "page-width" | "page-fit" | "reset") {
  const viewer = runtimes.get(tabId)?.viewer;
  if (!viewer) return;
  if (how === "in") viewer.increaseScale();
  else if (how === "out") viewer.decreaseScale();
  else if (how === "reset") viewer.currentScaleValue = "1";
  else viewer.currentScaleValue = how;
}
