import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import css from "./AssignmentPackageCard.module.css";
import { getPriorityColorClass } from "../utils/priorityColor";
import { getDueDateUrgency } from "../utils/dueDateUrgency";
import { formatReceivedDatetime } from "../utils/formatReceivedDatetime";
import { excludeZipArchives } from "../utils/attachments";
import { downloadAttachmentsAsZip } from "../utils/attachmentDownload";
import type { AssignmentItem, AssignmentMode } from "./AssignmentPackageList";

function formatDate(date: string | null | undefined): string {
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

/** Color-codes the "Location" (quotedFor) column by matching well-known site names anywhere in the string. */
function getLocationColorClass(location: string): string {
  const lower = location.toLowerCase();
  if (lower.includes("mexico")) return css.locationMexico;
  if (lower.includes("windsor")) return css.locationWindsor;
  if (lower.includes("tennessee")) return css.locationTennessee;
  return "";
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
  "Duplicate Request",
  "Update Quote",
  "No Quote",
] as const;

/** Map a tag string to its color band class — mirrors the ingestion view's badge colors. */
function getTagBandClass(tag: string): string {
  switch (tag) {
    case "Targets": return css.tagBandTargets;
    case "Waiting for Data": return css.tagBandWaitingForData;
    case "Repeat Request": return css.tagBandRepeatRequest;
    case "Duplicate Request": return css.tagBandDuplicate;
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
  /**
   * `linkedPendingId` is the id of the linked Pending package for an RFQ
   * item (or `null`/`undefined` otherwise) — lets the parent know whether
   * Edit Tags is available for the current selection, and which package to
   * apply the edit to.
   */
  onSelect: (id: string, type: "pending" | "rfq", linkedPendingId?: string | null) => void;
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

  const dueText = formatDate(item.dueDate);
  // automatedDueDate only exists on PendingRfqPackage — RFQ packages have no
  // equivalent concept, their due date is always manually set.
  const isAutomatedDueDate = item.type === "pending" && item.pkg.automatedDueDate === "true";
  // "Active" status lives under a different field name per package type —
  // completionStatus for Pending, status for RFQ. Overdue emphasis only
  // applies to still-active work (matches the Ingestion view's convention),
  // so a Completed/Skipped/Reviewed package's stale due date isn't flagged.
  const effectiveStatus = isPending ? item.pkg.completionStatus : item.pkg.status;
  const dueUrgency = getDueDateUrgency(item.dueDate ?? undefined, effectiveStatus ?? undefined);

  // Both only resolve for an actual RFQ Package — a Pending package (even
  // one already linked to an RFQ Package) has neither field of its own.
  const rfqPackageId = item.type === "rfq" ? String(item.pkg.$primaryKey) : "";
  const location = item.type === "rfq" ? item.pkg.quotedFor ?? "" : "";

  const receivedText = isPending
    ? formatReceivedDatetime(item.pkg.receivedDatetime, item.pkg.receivedDate)
    : formatDate(item.pkg.dateReceived);

  // "In the system" — this package has an RFQ Package Id in Foundry: either
  // it IS an RFQ package, or (for a pending package) it's already linked to
  // one via `rfqPackageId`.
  const isInSystem = item.type === "rfq"
    || (!!item.pkg.rfqPackageId && item.pkg.rfqPackageId.trim() !== "");
  const icon = isInSystem ? (
    <span
      className={css.inSystemIcon}
      title="In Foundry"
      aria-label="In the system"
      role="img"
    >
      <svg className={css.inSystemIconSvg} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
      </svg>
    </span>
  ) : null;

  return (
    <div
      className={`${css.card} ${priorityBorderClass} ${isSelected ? css.cardSelected : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(id, item.type, item.type === "rfq" ? item.linkedPendingId : null)}
      onKeyDown={(e) => { if (e.key === "Enter") onSelect(id, item.type, item.type === "rfq" ? item.linkedPendingId : null); }}
    >
      <div className={css.colSubject} title={title}>{title}</div>
      <div className={css.colRfqId} title={rfqPackageId || undefined}>{rfqPackageId}</div>
      <div className={css.colCustomer} title={customerName ?? undefined}>{customerName ?? "—"}</div>
      <div className={css.colVehicle}>{buildVehicleLine(item.pkg.oem, item.pkg.platform, item.pkg.modelYear)}</div>
      <div className={css.colReceived}>{receivedText}</div>
      <div className={`${css.colDue} ${dueUrgency === "overdue" ? css.dueOverdue : ""}`}>
        {dueText}
        {isAutomatedDueDate && (
          <span className={css.autoIcon} title="This due date was auto-generated" aria-label="Auto-generated" role="img">
            🤖
          </span>
        )}
      </div>
      <div className={`${css.colLocation} ${getLocationColorClass(location)}`} title={location || undefined}>{location}</div>
      <div className={css.colAssignee} title={assigneeName ?? undefined}>
        {mode !== "unassigned" ? assigneeName ?? item.assigneeId ?? "" : ""}
      </div>
      <div className={css.colIcons}>
        <span className={css.iconSlot}>
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
        </span>
        <span className={css.iconSlot}>{icon}</span>
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
