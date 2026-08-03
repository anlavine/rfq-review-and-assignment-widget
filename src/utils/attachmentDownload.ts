export const ATTACHMENT_DATASET_RID =
  "ri.foundry.main.dataset.1be7ce80-f8d5-411c-94c3-6fe46371a15b";

export interface DownloadableAttachment {
  readonly fileName?: string;
  readonly filepath?: string;
}

/**
 * Fetches an attachment's content from the Foundry data-proxy dataset and
 * triggers a browser download via a temporary anchor click.
 */
export async function downloadAttachment(att: DownloadableAttachment): Promise<void> {
  const displayName = att.fileName ?? att.filepath ?? "download";
  const url = `https://integrity.palantirfoundry.com/foundry-data-proxy/api/web/dataproxy/datasets/${ATTACHMENT_DATASET_RID}/views/master/${att.filepath}`;
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = displayName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}
