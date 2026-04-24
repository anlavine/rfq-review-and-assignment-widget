/** File extensions that are parsed and displayed in the attachment/tool review panels */
export const PARSED_EXTENSIONS = [".pdf", ".xlsx", ".xls", ".xlsb", ".xlsm", ".pptx", ".pptm", ".docx"];

/** Image file extensions that are embedded inline in the email body (excluded from attachment lists) */
const INLINE_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];

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
