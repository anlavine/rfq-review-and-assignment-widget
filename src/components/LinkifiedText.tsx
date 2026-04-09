import React, { useState } from "react";
import css from "./LinkifiedText.module.css";

/**
 * Combined regex that matches:
 * 1. URLs — http:// or https:// followed by non-whitespace, non-angle-bracket chars.
 *    Strips common trailing punctuation that is unlikely to be part of the URL.
 * 2. Windows file paths — drive letter followed by backslash-separated segments.
 */
const LINK_PATTERN =
  /(https?:\/\/[^\s<>)\]]+[^\s<>)\].,;:!?"'`])|([A-Z]:\\(?:[^\s<>]+[^\s<>.,;:!?"'`\\]))/g;

interface Segment {
  type: "text" | "url" | "filepath";
  value: string;
}

function tokenize(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;

  // Reset regex state
  LINK_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = LINK_PATTERN.exec(text)) !== null) {
    // Push any preceding plain text
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }

    if (match[1]) {
      segments.push({ type: "url", value: match[1] });
    } else if (match[2]) {
      segments.push({ type: "filepath", value: match[2] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Push any remaining plain text
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}

function CopyableFilePath({ path }: { path: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: do nothing
    }
  };

  return (
    <span
      className={css.filepath}
      role="button"
      tabIndex={0}
      title="Click to copy path"
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleClick(e as unknown as React.MouseEvent);
      }}
    >
      {path}
      {copied && <span className={css.copiedTooltip}>Copied!</span>}
    </span>
  );
}

interface LinkifiedTextProps {
  text: string;
}

/**
 * Renders plain text with embedded URLs as clickable links and Windows file
 * paths as click-to-copy spans.
 */
function LinkifiedText({ text }: LinkifiedTextProps): React.ReactElement {
  const segments = tokenize(text);

  return (
    <>
      {segments.map((seg, i) => {
        switch (seg.type) {
          case "url":
            return (
              <a
                key={i}
                href={seg.value}
                target="_blank"
                rel="noopener noreferrer"
                className={css.link}
              >
                {seg.value}
              </a>
            );
          case "filepath":
            return <CopyableFilePath key={i} path={seg.value} />;
          default:
            return <React.Fragment key={i}>{seg.value}</React.Fragment>;
        }
      })}
    </>
  );
}

export default LinkifiedText;
