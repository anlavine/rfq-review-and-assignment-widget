import React from "react";
import css from "./PackageDetail.module.css";
import HtmlBodyContent from "./HtmlBodyContent";
import MergedBodyContent from "./MergedBodyContent";

interface PackageBodyContentProps {
  merged: boolean;
  bodySegments: string[];
  emailIdSegments: string[];
  rawBody: string | undefined;
  rawEmailId: string | undefined;
}

/**
 * Renders the "Body Content" section of a package detail view.
 * Handles merged vs. non-merged rendering.
 */
function PackageBodyContent({
  merged,
  bodySegments,
  emailIdSegments,
  rawBody,
  rawEmailId,
}: PackageBodyContentProps): React.ReactElement {
  return (
    <div className={css.bodySection}>
      <div className={css.field}>
        <span className={css.fieldLabel}>Body Content</span>
        {merged && bodySegments.length > 1 ? (
          <MergedBodyContent segments={bodySegments} emailIdSegments={emailIdSegments} />
        ) : rawBody ? (
          <HtmlBodyContent html={rawBody} emailId={rawEmailId} />
        ) : (
          <span className={css.fieldValueMuted}>No body content</span>
        )}
      </div>
    </div>
  );
}

export default PackageBodyContent;
