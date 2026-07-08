import React from "react";
import css from "./PackageDetail.module.css";

interface PackageParsedCountsGridProps {
  toolCount: number | null;
  attachmentCount: number | null;
  parsedAttachmentCount: number;
}

/**
 * Renders the bottom-of-detail grid showing the number of parsed tools and
 * the number of parsed attachments for a Pending RFQ Package.
 */
function PackageParsedCountsGrid({
  toolCount,
  attachmentCount,
  parsedAttachmentCount,
}: PackageParsedCountsGridProps): React.ReactElement {
  return (
    <div className={css.bottomGrid}>
      <div className={css.box}>
        <span className={css.boxLabel}>Number of Parsed Tools</span>
        <div className={css.toolCount}>
          {toolCount != null ? (
            <span className={css.toolCountBadge}>{toolCount}</span>
          ) : (
            <span className={css.fieldValueMuted}>Loading…</span>
          )}
        </div>
      </div>

      <div className={css.box}>
        <span className={css.boxLabel}>Number of Parsed Attachments</span>
        <div className={css.toolCount}>
          <span className={css.toolCountBadge}>
            {attachmentCount == null
              ? "…"
              : Math.min(parsedAttachmentCount, attachmentCount)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default PackageParsedCountsGrid;
