import React, { useState } from "react";
import css from "./LinkifiedText.module.css";

/**
 * Regex for URLs — http:// or https:// followed by non-whitespace, non-angle-bracket chars.
 * Strips common trailing punctuation that is unlikely to be part of the URL.
 */
const URL_PATTERN =
  /https?:\/\/[^\s<>)\]]+[^\s<>)\].,;:!?"'`]/g;

/**
 * Regex seed for Windows file paths — starts at a drive letter (e.g. C:\) and
 * captures the position. We then extend the match manually segment-by-segment
 * so that spaces within path segments (e.g. "My Documents") are included but
 * we stop at the right boundary.
 */
const PATH_SEED = /[A-Z]:\\/g;

/**
 * Matches a file extension — a dot followed by 1-10 alphanumeric chars, then
 * either end-of-string, whitespace, or trailing punctuation. We use this to
 * find where a filename ends when the path doesn't sit at the end of a line.
 */
const FILE_EXT_BOUNDARY = /\.[a-zA-Z0-9]{1,10}(?=[.,;:!?"'`\s]|$)/;

/**
 * Try to extract a Windows file path starting at `startIdx` in `text`.
 * Returns the full path string or null if this doesn't look like a real path.
 *
 * Strategy (in priority order):
 *   1. If there's a file extension boundary (e.g. ".xlsx " or ".pdf,"), cut
 *      there — this is the most reliable signal regardless of line position.
 *   2. Otherwise the path is a folder path (no file extension). Consume
 *      everything to the end of the line and trim trailing whitespace /
 *      punctuation. In practice these folder paths are almost always at the
 *      end of a line (followed by a newline or end-of-string).
 */
function extractFilePath(text: string, startIdx: number): string | null {
  // Grab from start to end-of-line (or end-of-string)
  const nlPos = text.indexOf("\n", startIdx);
  const lineEnd = nlPos === -1 ? text.length : nlPos;
  const candidate = text.slice(startIdx, lineEnd);

  // Must have at least one backslash segment after the drive letter
  if (candidate.indexOf("\\") === -1) return null;

  // 1. Try to find a file extension boundary to cut at. This handles paths
  //    like "C:\My Docs\file.xlsx for details" → stops at ".xlsx".
  const extMatch = FILE_EXT_BOUNDARY.exec(candidate);
  if (extMatch) {
    const extEnd = extMatch.index + extMatch[0].length;
    return candidate.slice(0, extEnd);
  }

  // 2. No file extension — this is a folder path. Consume to end-of-line
  //    and trim trailing whitespace / punctuation.
  const trimmed = candidate.replace(/[.,;:!?"'`\s]+$/, "");
  return trimmed.length > 3 ? trimmed : null;
}

interface Segment {
  type: "text" | "url" | "filepath";
  value: string;
}

function tokenize(text: string): Segment[] {
  // Collect all candidate matches with their positions, then sort by position.
  const candidates: { start: number; end: number; type: "url" | "filepath"; value: string }[] = [];

  // 1. URLs
  URL_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_PATTERN.exec(text)) !== null) {
    candidates.push({ start: m.index, end: m.index + m[0].length, type: "url", value: m[0] });
  }

  // 2. File paths (seed + manual extension)
  PATH_SEED.lastIndex = 0;
  while ((m = PATH_SEED.exec(text)) !== null) {
    const fp = extractFilePath(text, m.index);
    if (fp) {
      candidates.push({ start: m.index, end: m.index + fp.length, type: "filepath", value: fp });
    }
  }

  // Sort by start position; on ties, longer match wins
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);

  // Build segments, skipping overlapping matches
  const segments: Segment[] = [];
  let lastIndex = 0;

  for (const c of candidates) {
    if (c.start < lastIndex) continue; // overlaps with previous match — skip

    if (c.start > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, c.start) });
    }

    segments.push({ type: c.type, value: c.value });
    lastIndex = c.end;
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
