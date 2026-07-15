import React, { useRef } from "react";
import type { PendingRfqPackage } from "@rfq-review-hub-widget-application/sdk";
import type { Osdk } from "@osdk/client";
import css from "./PackageDetail.module.css";
import { getDueDateUrgency } from "../utils/dueDateUrgency";
import { formatReceivedDatetime } from "../utils/formatReceivedDatetime";
import { getConfidenceColor } from "../utils/confidenceColor";
import { getPriorityTier, getPriorityLabel } from "../utils/priorityColor";

interface PackageDetailHeaderProps {
  pkg: Osdk.Instance<PendingRfqPackage>;
  merged: boolean;
  attachmentCount: number | null;
  parsedAttachmentCount: number;
  hasPackageError: boolean;
  hasToolError: boolean;
  priorityScore: number | null;
  isNetNewCustomer: boolean;
  /**
   * Display name of the assigned estimator, if any. When provided,
   * renders an "Assigned to: <name>" line under the due date.
   */
  assignedEstimatorName?: string | null;

  /** Whether the priority tier badge should be rendered. Defaults to true. */
  showPriorityChip?: boolean;
  /** Whether the attachment parse-status chip should be rendered. Defaults to true. */
  showAttachmentChip?: boolean;
  /** Whether the ingestion-error chips (Package Error / Tool Error) should be rendered. Defaults to true. */
  showIngestionErrorChips?: boolean;
  /** Whether the overall-completion confidence chip should be rendered. Defaults to true. */
  showConfidenceChip?: boolean;

  /** Whether inline due-date editing is enabled. Defaults to true. */
  editableDueDate?: boolean;

  /** Called when the user saves a new due date (or clears it). */
  onSaveDueDate: (dateStr: string | null) => Promise<void> | void;

  editingDueDate: boolean;
  setEditingDueDate: (v: boolean) => void;
  savingDueDate: boolean;
}

function formatDate(date: string | undefined): string {
  if (!date) return "—";
  try {
    const parts = date.split("T")[0].split("-");
    const local = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return local.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return date;
  }
}

/**
 * Renders the two-column header at the top of a Pending RFQ Package detail view:
 * - Left: title + optional "Merged Package" badge
 * - Right: received/due dates, edit-due-date controls, auto-generated label,
 *   and a stack of togglable chips (priority, attachment parse status,
 *   ingestion errors, overall completion).
 */
function PackageDetailHeader({
  pkg,
  merged,
  attachmentCount,
  parsedAttachmentCount,
  hasPackageError,
  hasToolError,
  priorityScore,
  isNetNewCustomer,
  assignedEstimatorName,
  showPriorityChip = true,
  showAttachmentChip = true,
  showIngestionErrorChips = true,
  showConfidenceChip = true,
  editableDueDate = true,
  onSaveDueDate,
  editingDueDate,
  setEditingDueDate,
  savingDueDate,
}: PackageDetailHeaderProps): React.ReactElement {
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const urgency = getDueDateUrgency(pkg.dueDate, pkg.completionStatus);

  return (
    <div className={css.header}>
      <div className={css.headerLeft}>
        <h2 className={css.title}>
          {pkg.subject || pkg.packageName || "Untitled Package"}
        </h2>
        {merged && (
          <span className={css.mergedBadge}>
            <span className={css.mergedBadgeIcon}>⛙</span> Merged Package
          </span>
        )}
      </div>
      <div className={css.headerRight}>
        <span className={css.dateCompact}>
          Received: <strong>{formatReceivedDatetime(pkg.receivedDatetime, pkg.receivedDate)}</strong>
        </span>
        <span className={`${css.dateCompact} ${urgency === "overdue" ? css.dateOverdue : urgency === "dueSoon" ? css.dateDueSoon : ""}`}>
          Due: <strong>{formatDate(pkg.dueDate)}</strong>
          {editableDueDate && !editingDueDate && (
            <button
              className={css.editIcon}
              onClick={() => {
                setEditingDueDate(true);
                setTimeout(() => dateInputRef.current?.showPicker?.(), 50);
              }}
              title="Edit due date"
            >
              ✏️
            </button>
          )}
        </span>
        {pkg.automatedDueDate === "true" && (
          <span className={css.autoLabel} title="This due date was auto-generated">
            🤖 Auto-generated
          </span>
        )}
        {assignedEstimatorName && (
          <span className={css.dateCompact} title="Assigned estimator">
            Assigned to: <strong>{assignedEstimatorName}</strong>
          </span>
        )}
        {editableDueDate && editingDueDate && (
          <div className={css.dateEditRow}>
            <input
              ref={dateInputRef}
              type="date"
              className={css.dateInput}
              defaultValue={pkg.dueDate ? pkg.dueDate.split("T")[0] : ""}
              disabled={savingDueDate}
            />
            <button
              className={css.dateConfirm}
              disabled={savingDueDate}
              onClick={() => {
                const val = dateInputRef.current?.value;
                onSaveDueDate(val || null);
              }}
            >
              {savingDueDate ? "…" : "Save"}
            </button>
            <button
              className={css.dateCancel}
              disabled={savingDueDate}
              onClick={() => setEditingDueDate(false)}
            >
              Cancel
            </button>
          </div>
        )}
        {showPriorityChip && (() => {
          const tier = getPriorityTier(priorityScore);
          const chipClass =
            tier === "high" ? css.priorityChipHigh
              : tier === "medium" ? css.priorityChipMedium
                : css.priorityChipLow;
          const label = `${getPriorityLabel(tier)} Priority${isNetNewCustomer ? ": New Customer" : ""}`;
          return (
            <span
              className={`${css.priorityChip} ${chipClass}`}
              title={priorityScore != null ? `Priority score: ${priorityScore.toFixed(2)}` : undefined}
            >
              {label}
              {isNetNewCustomer && <span className={css.priorityChipStar}> ⭐</span>}
            </span>
          );
        })()}
        {showAttachmentChip && (() => {
          const totalCount = attachmentCount ?? 0;
          const parsedCount = parsedAttachmentCount;
          let chipClass: string;
          let chipLabel: string;
          if (totalCount === 0) {
            chipClass = css.attachmentChipBlue;
            chipLabel = "No files attached to email";
          } else if (parsedCount === 0) {
            chipClass = css.attachmentChipRed;
            chipLabel = "No parsable attachments";
          } else if (parsedCount < totalCount) {
            chipClass = css.attachmentChipOrange;
            chipLabel = "Some attachments parsed";
          } else {
            chipClass = css.attachmentChipGreen;
            chipLabel = "All attachments parsed";
          }
          return <span className={chipClass}>{chipLabel}</span>;
        })()}
        {showIngestionErrorChips && hasPackageError && (
          <span className={css.ingestionErrorChip}>⚠ Package Error</span>
        )}
        {showIngestionErrorChips && hasToolError && (
          <span className={css.ingestionErrorChip}>⚠ Tool Error</span>
        )}
        {showConfidenceChip && pkg.overallConfidenceScore != null && (
          <span className={css.confidenceChip}>
            Overall Completion:{" "}
            <strong style={{ color: getConfidenceColor(pkg.overallConfidenceScore) }}>
              {pkg.overallConfidenceScore}%
            </strong>
          </span>
        )}
      </div>
    </div>
  );
}

export default PackageDetailHeader;
