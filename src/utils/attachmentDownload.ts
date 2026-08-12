import JSZip from "jszip";

export const ATTACHMENT_DATASET_RID =
  "ri.foundry.main.dataset.1be7ce80-f8d5-411c-94c3-6fe46371a15b";

export interface DownloadableAttachment {
  readonly fileName?: string;
  readonly filepath?: string;
}

function buildAttachmentUrl(filepath: string): string {
  return `https://integrity.palantirfoundry.com/foundry-data-proxy/api/web/dataproxy/datasets/${ATTACHMENT_DATASET_RID}/views/master/${filepath}`;
}

async function fetchAttachmentBlob(att: DownloadableAttachment): Promise<Blob> {
  const response = await fetch(buildAttachmentUrl(att.filepath ?? ""), { credentials: "include" });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  return response.blob();
}

/** Module-level cache so re-opening the preview modal / re-clicking the same
 *  attachment doesn't refetch it. Keyed by `filepath` (the dataset path,
 *  stable per attachment row); never evicted — attachments are small and few
 *  per package, same tradeoff as the CID-image cache in HtmlBodyContent. */
const previewBlobCache = new Map<string, Promise<Blob>>();

/**
 * Fetches an attachment's content for in-app preview, caching the in-flight
 * (and resolved) promise per `filepath` so repeated previews of the same
 * file don't hit the network again.
 */
export function fetchAttachmentBlobForPreview(att: DownloadableAttachment): Promise<Blob> {
  const key = att.filepath ?? "";
  const cached = previewBlobCache.get(key);
  if (cached) return cached;
  const promise = fetchAttachmentBlob(att);
  previewBlobCache.set(key, promise);
  // Don't cache a rejected fetch — let the next attempt retry.
  promise.catch(() => previewBlobCache.delete(key));
  return promise;
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}

/** Strips characters that aren't safe to use in a downloaded file name. */
function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "-").trim() || "download";
}

/**
 * Fetches an attachment's content from the Foundry data-proxy dataset and
 * triggers a browser download via a temporary anchor click.
 */
export async function downloadAttachment(att: DownloadableAttachment): Promise<void> {
  const blob = await fetchAttachmentBlob(att);
  triggerBlobDownload(blob, att.fileName ?? att.filepath ?? "download");
}

/**
 * Fetches every attachment and bundles them into a single .zip, then
 * triggers one download for the zip. Attachments that fail to fetch are
 * skipped (logged, not included) rather than aborting the whole batch —
 * a single broken file shouldn't prevent downloading the rest.
 */
export async function downloadAttachmentsAsZip(
  attachments: DownloadableAttachment[],
  zipFileName: string,
): Promise<void> {
  const zip = new JSZip();

  const fetched = await Promise.all(
    attachments
      .filter((att) => !!att.filepath)
      .map(async (att) => {
        try {
          return { att, blob: await fetchAttachmentBlob(att) };
        } catch (e) {
          console.error("Failed to fetch attachment for zip:", att.fileName, e);
          return null;
        }
      }),
  );

  // De-duplicate file names within the zip — JSZip silently overwrites an
  // existing entry of the same name otherwise.
  const usedNames = new Set<string>();
  for (const result of fetched) {
    if (!result) continue;
    let name = result.att.fileName ?? result.att.filepath ?? "file";
    if (usedNames.has(name)) {
      const dot = name.lastIndexOf(".");
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let n = 2;
      while (usedNames.has(`${base} (${n})${ext}`)) n++;
      name = `${base} (${n})${ext}`;
    }
    usedNames.add(name);
    zip.file(name, result.blob);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerBlobDownload(zipBlob, sanitizeFileName(zipFileName));
}
