import React, { useRef, useEffect, useState, useCallback } from "react";
import DOMPurify from "dompurify";
import { PendingRfqAttachments } from "@rfq-review-hub-widget-application/sdk";
import { Files } from "@osdk/foundry.datasets";
import client from "../client";
import css from "./HtmlBodyContent.module.css";

/** Dataset RID that stores the actual attachment files */
const ATTACHMENTS_DATASET_RID = "ri.foundry.main.dataset.1be7ce80-f8d5-411c-94c3-6fe46371a15b";

/**
 * Module-level cache: (emailId + fileName) → blob URL.
 * Persists across re-renders so navigating between packages doesn't re-fetch
 * images that were already loaded.
 */
const imageBlobCache = new Map<string, string>();

/**
 * Module-level cache for failed lookups so we don't retry them.
 */
const imageFailCache = new Set<string>();

/**
 * Regex seed for Windows file paths — starts at a drive letter (e.g. C:\).
 */
const PATH_SEED = /[A-Z]:\\/g;

/**
 * Matches a file extension — a dot followed by 1-10 alphanumeric chars, then
 * either end-of-string, whitespace, or trailing punctuation.
 */
const FILE_EXT_BOUNDARY = /\.[a-zA-Z0-9]{1,10}(?=[.,;:!?"'`\s]|$)/;

/**
 * Try to extract a Windows file path starting at `startIdx` in `text`.
 * Returns the full path string or null if this doesn't look like a real path.
 */
function extractFilePath(text: string, startIdx: number): string | null {
  const nlPos = text.indexOf("\n", startIdx);
  const lineEnd = nlPos === -1 ? text.length : nlPos;
  const candidate = text.slice(startIdx, lineEnd);

  if (candidate.indexOf("\\") === -1) return null;

  const extMatch = FILE_EXT_BOUNDARY.exec(candidate);
  if (extMatch) {
    const extEnd = extMatch.index + extMatch[0].length;
    return candidate.slice(0, extEnd);
  }

  const trimmed = candidate.replace(/[.,;:!?"'`\s]+$/, "");
  return trimmed.length > 3 ? trimmed : null;
}

/**
 * Walks all text nodes under `root` and wraps Windows file-path substrings
 * in styled <span> elements with click-to-copy behaviour.
 */
function linkifyFilePathsInDOM(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  for (const textNode of textNodes) {
    const content = textNode.textContent ?? "";
    PATH_SEED.lastIndex = 0;

    const parts: (string | { path: string })[] = [];
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = PATH_SEED.exec(content)) !== null) {
      const fp = extractFilePath(content, match.index);
      if (!fp) continue;
      if (match.index > lastIdx) {
        parts.push(content.slice(lastIdx, match.index));
      }
      parts.push({ path: fp });
      lastIdx = match.index + fp.length;
      PATH_SEED.lastIndex = lastIdx;
    }

    if (parts.length === 0) continue; // no paths found in this text node

    if (lastIdx < content.length) {
      parts.push(content.slice(lastIdx));
    }

    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (typeof part === "string") {
        frag.appendChild(document.createTextNode(part));
      } else {
        const span = document.createElement("span");
        span.className = css.filepath;
        span.setAttribute("role", "button");
        span.setAttribute("tabindex", "0");
        span.setAttribute("title", "Click to copy path");
        span.textContent = part.path;

        const pathValue = part.path;
        const handler = () => {
          navigator.clipboard.writeText(pathValue).then(() => {
            const tooltip = document.createElement("span");
            tooltip.className = css.copiedTooltip;
            tooltip.textContent = "Copied!";
            span.appendChild(tooltip);
            setTimeout(() => tooltip.remove(), 1500);
          }).catch(() => { /* ignore */ });
        };
        span.addEventListener("click", handler);
        span.addEventListener("keydown", (e) => {
          if ((e as KeyboardEvent).key === "Enter") handler();
        });

        frag.appendChild(span);
      }
    }

    textNode.parentNode?.replaceChild(frag, textNode);
  }
}

/**
 * Inline style properties related to colors/backgrounds that we want to strip
 * from email HTML so our theme variables take over consistently.
 */
const COLOR_STYLE_PROPS = [
  "color",
  "background",
  "background-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
];

/**
 * HTML attributes that carry color information (used by legacy email HTML).
 */
const COLOR_ATTRS = ["color", "bgcolor"];

/**
 * Configure DOMPurify to allow safe email HTML while stripping scripts, forms,
 * and other dangerous constructs. Also strips inline color/background styles
 * and legacy color attributes so the app theme controls all colors consistently
 * in both light and dark mode.
 */
function sanitize(html: string): string {
  // Add a hook to strip color-related inline styles and attributes from every element
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node instanceof HTMLElement) {
      // Strip color-related inline style properties
      for (const prop of COLOR_STYLE_PROPS) {
        node.style.removeProperty(prop);
      }
      // Strip legacy HTML color attributes
      for (const attr of COLOR_ATTRS) {
        node.removeAttribute(attr);
      }
    }
  });

  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "src"],
    ALLOW_UNKNOWN_PROTOCOLS: true,
    FORBID_TAGS: ["style", "form", "input", "textarea", "button", "script"],
  });

  // Remove the hook so it doesn't affect other DOMPurify calls
  DOMPurify.removeAllHooks();

  return clean;
}

/**
 * Extracts the filename from a cid: src attribute.
 * e.g. "cid:image002.png@01DCD312.0BA6DFF0" → "image002.png"
 */
function extractCidFileName(src: string): string | null {
  if (!src.startsWith("cid:")) return null;
  const withoutPrefix = src.slice(4); // remove "cid:"
  const atIndex = withoutPrefix.indexOf("@");
  const fileName = atIndex >= 0 ? withoutPrefix.slice(0, atIndex) : withoutPrefix;
  return fileName.trim() || null;
}

/**
 * Resolves a single CID image: looks up the PendingRfqAttachments object,
 * fetches the file content from the attachments dataset, and returns a blob URL.
 */
async function resolveCidImage(emailId: string, fileName: string): Promise<string | null> {
  const cacheKey = `${emailId}::${fileName}`;

  // Check caches
  const cached = imageBlobCache.get(cacheKey);
  if (cached) return cached;
  if (imageFailCache.has(cacheKey)) return null;

  try {
    // 1. Find the attachment object by emailId + fileName
    const page = await client(PendingRfqAttachments)
      .where({
        $and: [
          { emailId: { $eq: emailId } },
          { fileName: { $eq: fileName } },
        ],
      })
      .fetchPage({ $pageSize: 1 });

    const attachment = page.data[0];
    if (!attachment?.filepath) {
      imageFailCache.add(cacheKey);
      return null;
    }

    // 2. Fetch the file content from the attachments dataset
    const response = await Files.content(client, ATTACHMENTS_DATASET_RID, attachment.filepath);
    const blob = await response.blob();

    // 3. Create a blob URL
    const blobUrl = URL.createObjectURL(blob);
    imageBlobCache.set(cacheKey, blobUrl);
    return blobUrl;
  } catch (e) {
    console.error(`Failed to resolve CID image ${fileName} for email ${emailId}:`, e);
    imageFailCache.add(cacheKey);
    return null;
  }
}

/**
 * Walks all <img> elements in the container, finds ones with cid: sources,
 * and resolves them to blob URLs from the attachments dataset.
 */
async function resolveInlineImages(
  root: HTMLElement,
  emailId: string,
  isCancelled: () => boolean,
): Promise<void> {
  const imgs = root.querySelectorAll<HTMLImageElement>("img[src]");
  const cidImgs: { img: HTMLImageElement; fileName: string }[] = [];

  for (const img of imgs) {
    const src = img.getAttribute("src") ?? "";
    const fileName = extractCidFileName(src);
    if (fileName) {
      // Add a loading class while we resolve
      img.classList.add(css.imgLoading);
      img.removeAttribute("src");
      cidImgs.push({ img, fileName });
    }
  }

  if (cidImgs.length === 0) return;

  // Resolve all CID images in parallel
  await Promise.all(
    cidImgs.map(async ({ img, fileName }) => {
      if (isCancelled()) return;
      const blobUrl = await resolveCidImage(emailId, fileName);
      if (isCancelled()) return;

      if (blobUrl) {
        img.src = blobUrl;
        img.classList.remove(css.imgLoading);
      } else {
        // Hide broken images
        img.classList.remove(css.imgLoading);
        img.classList.add(css.imgFailed);
      }
    }),
  );
}

interface HtmlBodyContentProps {
  html: string;
  emailId?: string;
  className?: string;
}

/**
 * Renders sanitized HTML email body content. After rendering, walks the DOM to
 * make Windows file paths clickable (click-to-copy) and resolve inline CID
 * images from the attachments dataset.
 */
function HtmlBodyContent({ html, emailId, className }: HtmlBodyContentProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [safeHtml] = useState(() => sanitize(html));

  const postProcess = useCallback(() => {
    if (containerRef.current) {
      linkifyFilePathsInDOM(containerRef.current);
    }
  }, []);

  useEffect(() => {
    postProcess();
  }, [safeHtml, postProcess]);

  // Resolve CID images after render
  useEffect(() => {
    if (!containerRef.current || !emailId) return;

    let cancelled = false;
    resolveInlineImages(containerRef.current, emailId, () => cancelled);

    return () => {
      cancelled = true;
    };
  }, [safeHtml, emailId]);

  return (
    <div
      ref={containerRef}
      className={`${css.htmlBody} ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

export default HtmlBodyContent;
