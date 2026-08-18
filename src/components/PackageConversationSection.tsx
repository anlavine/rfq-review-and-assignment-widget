import React from "react";
import css from "./PackageDetail.module.css";
import { formatReceivedDatetime } from "../utils/formatReceivedDatetime";
import type { ConversationSibling } from "../hooks/usePendingPackageDetail";

interface PackageConversationSectionProps {
  siblings: ConversationSibling[];
  onSelectPackage?: (packageId: string, completionStatus?: string) => void;
}

/**
 * Renders the "Other Pending Packages from Conversation" list.
 * Returns null when no siblings are present.
 */
function PackageConversationSection({
  siblings,
  onSelectPackage,
}: PackageConversationSectionProps): React.ReactElement | null {
  if (siblings.length === 0) return null;

  return (
    <div className={css.conversationSection}>
      <div className={css.conversationHeader}>
        <span className={css.conversationIcon}>💬</span>
        <span className={css.fieldLabel}>
          Other Pending Packages from Conversation ({siblings.length})
        </span>
      </div>
      <div className={css.conversationList}>
        {siblings.map((sibling) => (
          <div
            key={sibling.packageId}
            className={css.conversationItem}
            role="button"
            tabIndex={0}
            onClick={() => onSelectPackage?.(sibling.packageId, sibling.completionStatus)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSelectPackage?.(sibling.packageId, sibling.completionStatus);
            }}
          >
            <div className={css.conversationItemName}>
              {sibling.subject || sibling.packageName || "[Unnamed Package]"}
            </div>
            <div className={css.conversationItemMeta}>
              <span
                className={`${css.conversationStatus} ${
                  sibling.completionStatus === "Active"
                    ? css.statusActive
                    // "Under Review" is a Skip variant (via Skip and Review) —
                    // badge resolves the same as plain "Skipped".
                    : sibling.completionStatus === "Skipped" || sibling.completionStatus === "Under Review"
                      ? css.statusSkipped
                      : sibling.completionStatus === "Reviewed"
                        ? css.statusReviewed
                        : ""
                }`}
              >
                {sibling.completionStatus === "Under Review" ? "Skipped" : sibling.completionStatus ?? "—"}
              </span>
              <span className={css.conversationToolChip}>
                <svg className={css.conversationToolIcon} viewBox="0 0 16 16" fill="currentColor">
                  <path d="M11.92 1.08a3.5 3.5 0 0 0-4.56 4.03L2.04 10.4a1.5 1.5 0 0 0 0 2.12l1.42 1.42a1.5 1.5 0 0 0 2.12 0l5.3-5.32a3.5 3.5 0 0 0 4.03-4.56l-2.1 2.1-1.42-.01-.7-.7-.01-1.42 2.1-2.1Z" />
                </svg>
                {sibling.toolCount != null ? sibling.toolCount : "…"}
              </span>
              <span className={css.conversationDate}>
                Received: {formatReceivedDatetime(sibling.receivedDatetime, sibling.receivedDate)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default PackageConversationSection;
