import React, { useRef, useState } from "react";
import type { PendingRfqPackage } from "@rfq-review-hub-widget-application/sdk";
import type { Osdk } from "@osdk/client";
import css from "./PackageDetail.module.css";
import { getDueDateUrgency } from "../utils/dueDateUrgency";
import { formatReceivedDatetime } from "../utils/formatReceivedDatetime";
import { getConfidenceColor } from "../utils/confidenceColor";
import { getPriorityTier, getPriorityLabel } from "../utils/priorityColor";
import {
  type PriorityFactors,
  PRIORITY_FACTOR_LABELS,
  getPresentPriorityFactors,
} from "../hooks/usePriorityScores";

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
   * The six factors that contributed to the priority score. When provided
   * and the priority chip is shown, hovering the chip reveals a tooltip
   * listing which factors are currently present.
   */
  priorityFactors?: PriorityFactors | null;
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
  /**
   * Whether the due date (and its edit control/auto-generated label) is
   * rendered here at all. Defaults to true. Set to false when the caller
   * renders due date elsewhere instead (e.g. the Assignment tab moves it
   * up next to Package Name/Customer).
   */
  showDueDate?: boolean;

  /** Called when the user saves a new due date (or clears it). */
  onSaveDueDate: (dateStr: string | null) => Promise<void> | void;

  editingDueDate: boolean;
  setEditingDueDate: (v: boolean) => void;
  savingDueDate: boolean;

  /**
   * Whether the due date has already been manually reviewed — controls the
   * "Mark due date reviewed" checkmark button, which only shows when this
   * is not `true` (i.e. still false, null, or undefined).
   */
  dueDateEdited?: boolean | null;
  /** Fire-and-forget handler for the "Mark due date reviewed" button. */
  onMarkDueDateReviewed?: () => void;
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
  priorityFactors,
  assignedEstimatorName,
  showPriorityChip = true,
  showAttachmentChip = true,
  showIngestionErrorChips = true,
  showConfidenceChip = true,
  editableDueDate = true,
  showDueDate = true,
  onSaveDueDate,
  editingDueDate,
  setEditingDueDate,
  savingDueDate,
  dueDateEdited,
  onMarkDueDateReviewed,
}: PackageDetailHeaderProps): React.ReactElement {
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const [showPriorityTooltip, setShowPriorityTooltip] = useState(false);
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
        {showDueDate && (
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
            {editableDueDate && !editingDueDate && !dueDateEdited && onMarkDueDateReviewed && (
              <button
                className={css.editIcon}
                onClick={onMarkDueDateReviewed}
                title="Mark due date reviewed"
              >
                ✔️
              </button>
            )}
          </span>
        )}
        {showDueDate && pkg.automatedDueDate === "true" && (
          <span className={css.autoLabel} title="This due date was auto-generated">
            🤖 Auto-generated
          </span>
        )}
        {assignedEstimatorName && (
          <span className={css.dateCompact} title="Assigned estimator">
            Assigned to: <strong>{assignedEstimatorName}</strong>
          </span>
        )}
        {showDueDate && editableDueDate && editingDueDate && (
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
          const presentFactors = getPresentPriorityFactors(priorityFactors);
          const tooltipTitle =
            priorityScore != null ? `Priority score: ${priorityScore.toFixed(2)}` : undefined;
          return (
            <span
              className={css.priorityChipWrapper}
              onMouseEnter={() => setShowPriorityTooltip(true)}
              onMouseLeave={() => setShowPriorityTooltip(false)}
              onFocus={() => setShowPriorityTooltip(true)}
              onBlur={() => setShowPriorityTooltip(false)}
            >
              <span
                className={`${css.priorityChip} ${chipClass}`}
                title={tooltipTitle}
              >
                {label}
                {isNetNewCustomer && <span className={css.priorityChipStar}> ⭐</span>}
              </span>
              {showPriorityTooltip && (
                <div
                  className={css.priorityFactorsTooltip}
                  role="tooltip"
                  aria-label="Priority factors"
                >
                  <div className={css.priorityFactorsHeader}>Priority factors</div>
                  {presentFactors.length === 0 ? (
                    <div className={css.priorityFactorsEmpty}>No factors apply</div>
                  ) : (
                    <ul className={css.priorityFactorsList}>
                      {presentFactors.map((key) => (
                        <li key={key}>{PRIORITY_FACTOR_LABELS[key]}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
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
