import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import css from "./AssignmentPackageCard.module.css";
import { getPriorityColorClass } from "../utils/priorityColor";
import { formatReceivedDatetime } from "../utils/formatReceivedDatetime";
import { excludeZipArchives } from "../utils/attachments";
import { downloadAttachmentsAsZip } from "../utils/attachmentDownload";
import { categorizeWorkType } from "../utils/workType";
import type { AssignmentItem, AssignmentMode } from "./AssignmentPackageList";

function formatDate(date: string | undefined): string {
  if (!date) return "—";
  try {
    const parts = date.split("T")[0].split("-");
    const local = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return local.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return date;
  }
}

function buildVehicleLine(oem?: string, platform?: string, modelYear?: string): string {
  const parts = [oem, platform, modelYear].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

const PRIORITY_CLASSES = {
  high: css.cardBorderHigh,
  medium: css.cardBorderMedium,
  low: css.cardBorderLow,
};

/** Fixed left-to-right ordering for tag bands, so a given tag's color always
 *  appears in the same relative order among a package's other tags. */
const TAG_ORDER = [
  "Targets",
  "Waiting for Data",
  "Repeat Request",
  "Duplicate",
  "Update Quote",
  "No Quote",
] as const;

/** Map a tag string to its color band class — mirrors the ingestion view's badge colors. */
function getTagBandClass(tag: string): string {
  switch (tag) {
    case "Targets": return css.tagBandTargets;
    case "Waiting for Data": return css.tagBandWaitingForData;
    case "Repeat Request": return css.tagBandRepeatRequest;
    case "Duplicate": return css.tagBandDuplicate;
    case "Update Quote": return css.tagBandUpdateQuote;
    case "No Quote": return css.tagBandNoQuote;
    default: return css.tagBandDefault;
  }
}

/**
 * Popover listing each tag by name with a color dot matching its band.
 * Rendered via a portal so it can escape the row's `overflow` clipping.
 */
function TagsPopover({
  tags,
  triggerRef,
}: {
  tags: string[];
  triggerRef: React.RefObject<HTMLElement | null>;
}): React.ReactElement | null {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.top - 4, left: rect.left + rect.width / 2 });
    }
  }, [triggerRef]);

  if (!pos) return null;

  return ReactDOM.createPortal(
    <div
      className={css.tagsPopover}
      style={{ top: pos.top, left: pos.left, transform: "translate(-50%, -100%)" }}
    >
      {tags.map((tag, i) => (
        <span key={i} className={css.popoverTagRow}>
          <span className={`${css.popoverDot} ${getTagBandClass(tag)}`} />
          {tag}
        </span>
      ))}
    </div>,
    document.body,
  );
}

/**
 * Popover listing the files a click on the download icon will download.
 * Rendered via a portal so it can escape the row's `overflow` clipping.
 */
function FileListPopover({
  fileNames,
  triggerRef,
}: {
  fileNames: string[];
  triggerRef: React.RefObject<HTMLElement | null>;
}): React.ReactElement | null {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.top - 4, left: rect.left + rect.width / 2 });
    }
  }, [triggerRef]);

  if (!pos) return null;

  return ReactDOM.createPortal(
    <div
      className={css.filesPopover}
      style={{ top: pos.top, left: pos.left, transform: "translate(-50%, -100%)" }}
    >
      <div className={css.filesPopoverTitle}>Files to download</div>
      {fileNames.map((name, i) => (
        <span key={i} className={css.popoverFileRow}>{name}</span>
      ))}
    </div>,
    document.body,
  );
}

export interface AssignmentPackageCardProps {
  item: AssignmentItem;
  isSelected: boolean;
  onSelect: (id: string, type: "pending" | "rfq") => void;
  mode: AssignmentMode;
  /** Tags for this package — rendered as color bands in the trailing tags column. */
  tags: string[];
  /** Resolved display name for `item.assigneeId`, or null if unresolved/unassigned. */
  assigneeName: string | null;
  /** Resolved customer display name, or null while unresolved/unavailable. */
  customerName: string | null;
}

/**
 * Single-line row for a package in the Assignment tab's list. Columns (left
 * to right): email subject, customer, OEM/platform/model year, received
 * date, due date, assignee, a trailing icon slot, and tag color bands.
 */
export default function AssignmentPackageCard({
  item,
  isSelected,
  onSelect,
  mode,
  tags,
  assigneeName,
  customerName,
}: AssignmentPackageCardProps): React.ReactElement {
  const id = String(item.pkg.$primaryKey);
  const orderedTags: string[] = (TAG_ORDER as readonly string[]).filter((t) => tags.includes(t))
    .concat(tags.filter((t) => !(TAG_ORDER as readonly string[]).includes(t)));
  const [showTagsPopover, setShowTagsPopover] = useState(false);
  const tagsRef = useRef<HTMLDivElement | null>(null);
  const downloadableAttachments = excludeZipArchives(item.attachments);
  const [showDownloadPopover, setShowDownloadPopover] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const downloadRef = useRef<HTMLSpanElement | null>(null);
  const priorityBorderClass = getPriorityColorClass(item.priorityScore, PRIORITY_CLASSES);
  const isPending = item.type === "pending";

  const title = isPending
    ? item.pkg.subject ?? item.pkg.packageName ?? "[Unnamed Package]"
    : item.pkg.packageName ?? "[Unnamed Package]";

  const handleDownloadAll = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadAttachmentsAsZip(downloadableAttachments, `${title}.zip`);
    } catch (err) {
      console.error("Download all failed:", err);
    } finally {
      setIsDownloading(false);
    }
  };

  const dueText = formatDate(item.pkg.dueDate);

  let receivedText: string;
  let icon: React.ReactElement | null;
  if (isPending) {
    receivedText = formatReceivedDatetime(item.pkg.receivedDatetime, item.pkg.receivedDate);
    icon = (
      <span
        className={css.notReadyIcon}
        title="Not Ready — this package hasn't been linked to an RFQ Package yet"
        aria-label="Not Ready"
        role="img"
      >
        ⏳
      </span>
    );
  } else {
    receivedText = formatDate(item.pkg.dateReceived);
    const workCategory = categorizeWorkType(item.pkg.workType);
    icon = workCategory === "new" ? (
      <span className={css.workTypeIcon} title={`Work Type: ${item.pkg.workType}`} aria-label="New Build">✨</span>
    ) : workCategory === "engChange" ? (
      <span className={css.workTypeIcon} title={`Work Type: ${item.pkg.workType}`} aria-label="Engineering Change">🔄</span>
    ) : null;
  }

  return (
    <div
      className={`${css.card} ${priorityBorderClass} ${isSelected ? css.cardSelected : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(id, item.type)}
      onKeyDown={(e) => { if (e.key === "Enter") onSelect(id, item.type); }}
    >
      <div className={css.colSubject} title={title}>{title}</div>
      <div className={css.colCustomer} title={customerName ?? undefined}>{customerName ?? "—"}</div>
      <div className={css.colVehicle}>{buildVehicleLine(item.pkg.oem, item.pkg.platform, item.pkg.modelYear)}</div>
      <div className={css.colReceived}>{receivedText}</div>
      <div className={css.colDue}>{dueText}</div>
      <div className={css.colAssignee} title={assigneeName ?? undefined}>
        {mode !== "unassigned" ? assigneeName ?? item.assigneeId ?? "" : ""}
      </div>
      <div className={css.colIcons}>
        {downloadableAttachments.length > 0 && (
          <span
            ref={downloadRef}
            className={`${css.downloadIcon} ${isDownloading ? css.downloadIconDisabled : ""}`}
            title={isDownloading ? "Downloading…" : "Download all attachments as a .zip"}
            aria-label="Download all attachments as a .zip"
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); handleDownloadAll(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                e.preventDefault();
                handleDownloadAll();
              }
            }}
            onMouseEnter={() => setShowDownloadPopover(true)}
            onMouseLeave={() => setShowDownloadPopover(false)}
          >
            {isDownloading ? (
              "⏳"
            ) : (
              <svg className={css.downloadIconSvg} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
              </svg>
            )}
          </span>
        )}
        {showDownloadPopover && !isDownloading && (
          <FileListPopover
            fileNames={downloadableAttachments.map((att) => att.fileName ?? att.filepath ?? "Unnamed file")}
            triggerRef={downloadRef}
          />
        )}
        {icon}
      </div>
      <div
        ref={tagsRef}
        className={css.colTags}
        onMouseEnter={() => setShowTagsPopover(true)}
        onMouseLeave={() => setShowTagsPopover(false)}
      >
        {orderedTags.map((tag, i) => (
          <span key={i} className={`${css.tagBand} ${getTagBandClass(tag)}`} />
        ))}
        {showTagsPopover && orderedTags.length > 0 && (
          <TagsPopover tags={orderedTags} triggerRef={tagsRef} />
        )}
      </div>
    </div>
  );
}
