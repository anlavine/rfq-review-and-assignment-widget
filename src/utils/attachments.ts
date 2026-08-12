/** File extensions that are parsed and displayed in the attachment/tool review panels */
export const PARSED_EXTENSIONS = [".pdf", ".xlsx", ".xls", ".xlsb", ".xlsm", ".pptx", ".pptm", ".docx"];

/** Image file extensions that are embedded inline in the email body (excluded from attachment lists) */
const INLINE_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];

/** Spreadsheet extensions SheetJS can parse — rendered as an HTML table in the attachment preview. */
const EXCEL_EXTENSIONS = [".xlsx", ".xls", ".xlsb", ".xlsm"];

export type AttachmentPreviewKind = "image" | "pdf" | "excel" | "none";

/**
 * Classifies a file name into how the attachment preview modal should
 * render it: a real image (`<img>`), a PDF (browser-native `<iframe>`), a
 * spreadsheet (parsed client-side with SheetJS into an HTML table), or
 * `"none"` — no in-app preview, fall back to a download prompt.
 */
export function getAttachmentPreviewKind(fileName: string): AttachmentPreviewKind {
  const lower = fileName.toLowerCase();
  if (INLINE_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "image";
  if (lower.endsWith(".pdf")) return "pdf";
  if (EXCEL_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "excel";
  return "none";
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
};

/**
 * Resolves the MIME type a browser needs to render this file inline (in an
 * `<img>`/`<iframe>`) based on its extension. The Foundry data-proxy
 * response doesn't reliably set a correct `Content-Type` header, so the
 * fetched blob's own `.type` can't be trusted — callers should re-wrap the
 * blob with this type before creating an object URL for preview. Returns
 * `null` for kinds that aren't rendered via a typed blob (e.g. "excel",
 * which is parsed rather than displayed directly).
 */
export function getPreviewMimeType(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  for (const [ext, mime] of Object.entries(IMAGE_MIME_TYPES)) {
    if (lower.endsWith(ext)) return mime;
  }
  return null;
}

/**
 * Returns true if the filename is an inline image that should be excluded
 * from attachment lists and badge counts.
 */
export function isInlineImage(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return INLINE_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Returns true if the filename is a parsable attachment (not an inline image).
 */
export function isParsedAttachment(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return PARSED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Filters an attachment file name list to exclude inline images.
 * Returns only non-image file names.
 */
export function excludeInlineImages(fileNames: string[]): string[] {
  return fileNames.filter((name) => !isInlineImage(name));
}

export interface ZipGroupableAttachment {
  readonly fileName?: string;
  readonly filepath?: string;
  readonly sourceZipFilename?: string;
}

/**
 * Filters a list of attachments down to every file that is not itself a zip
 * archive. An attachment is treated as a zip archive when at least one other
 * attachment in the list references it via `sourceZipFilename` — the zip's
 * extracted children are still included, only the archive itself is dropped.
 *
 * A zip with no captured children (nothing in the dataset references it)
 * is not detected as a zip and is left in the result — there's no
 * extension/content-type fallback, only this structural check.
 *
 * Mirrors the de-dup rule used when rendering the attachment list: duplicate
 * rows sharing the same `fileName` are collapsed to one survivor before the
 * zip check runs, so a child whose `sourceZipFilename` points at a removed
 * duplicate still resolves to the correct surviving zip.
 */
export function excludeZipArchives<T extends ZipGroupableAttachment>(attachments: T[]): T[] {
  const deduped = attachments.filter((att, idx, arr) => {
    const name = att.fileName ?? "";
    return arr.findIndex((a) => (a.fileName ?? "") === name) === idx;
  });

  const zipFilepathToSurvivor = new Map<string, string>();
  for (const att of attachments) {
    if (!att.filepath) continue;
    const survivor = deduped.find((d) => (d.fileName ?? "") === (att.fileName ?? ""));
    if (survivor && survivor.filepath && survivor.filepath !== att.filepath) {
      zipFilepathToSurvivor.set(att.filepath, survivor.filepath);
    }
  }

  const zipParentPaths = new Set<string>();
  const seenChildNames = new Set<string>();
  for (const att of attachments) {
    const srcZip = att.sourceZipFilename;
    if (!srcZip) continue;
    const childName = att.fileName ?? "";
    if (seenChildNames.has(childName)) continue;
    seenChildNames.add(childName);
    zipParentPaths.add(zipFilepathToSurvivor.get(srcZip) ?? srcZip);
  }

  return deduped.filter((att) => !zipParentPaths.has(att.filepath ?? ""));
}
