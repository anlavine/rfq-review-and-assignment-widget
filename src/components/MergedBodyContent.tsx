import React from "react";
import css from "./PackageDetail.module.css";
import HtmlBodyContent from "./HtmlBodyContent";

interface MergedBodyContentProps {
  segments: string[];
  emailIdSegments: string[];
}

/**
 * Renders body content for a merged package — one card per source email body.
 */
function MergedBodyContent({
  segments,
  emailIdSegments,
}: MergedBodyContentProps): React.ReactElement {
  return (
    <div className={css.mergedBodyStack}>
      {segments.map((segment, i) => (
        <div key={i} className={css.mergedBodyCard}>
          <div className={css.mergedBodyLabel}>Email {i + 1} — Body</div>
          <HtmlBodyContent html={segment} emailId={emailIdSegments[i]} />
        </div>
      ))}
    </div>
  );
}

export default MergedBodyContent;
