import React, { useRef, useEffect, useState, useCallback } from "react";
import DOMPurify from "dompurify";
import css from "./HtmlBodyContent.module.css";

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
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["style", "form", "input", "textarea", "button", "script"],
  });

  // Remove the hook so it doesn't affect other DOMPurify calls
  DOMPurify.removeAllHooks();

  return clean;
}

interface HtmlBodyContentProps {
  html: string;
  className?: string;
}

/**
 * Renders sanitized HTML email body content. After rendering, walks the DOM to
 * make Windows file paths clickable (click-to-copy).
 */
function HtmlBodyContent({ html, className }: HtmlBodyContentProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [safeHtml] = useState(() => sanitize(html));

  const linkifyPaths = useCallback(() => {
    if (containerRef.current) {
      linkifyFilePathsInDOM(containerRef.current);
    }
  }, []);

  useEffect(() => {
    linkifyPaths();
  }, [safeHtml, linkifyPaths]);

  return (
    <div
      ref={containerRef}
      className={`${css.htmlBody} ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

export default HtmlBodyContent;
