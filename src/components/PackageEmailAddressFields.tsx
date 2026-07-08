import React from "react";
import css from "./PackageDetail.module.css";
import ContactList from "./ContactList";
import MergedEmailFields from "./MergedEmailFields";
import { parseFromContact, parseToContacts } from "../utils/emailContacts";

interface PackageEmailAddressFieldsProps {
  merged: boolean;
  fromSegments: string[];
  toSegments: string[];
  subjectSegments: string[];
  /** Raw `from` value used when not merged. */
  rawFrom: string | undefined;
  /** Raw `to` value used when not merged. */
  rawTo: string | undefined;
  /** Whether to render the "From" field. Defaults to true. */
  showFrom?: boolean;
  /** Whether to render the "To" field. Defaults to true. */
  showTo?: boolean;
}

/**
 * Renders the From/To/Subject block for the top of a package detail view.
 *
 * - For merged packages: one card per source email (From/To/Subject each).
 *   `showFrom` / `showTo` are ignored in merged mode.
 * - For non-merged packages: renders From and/or To depending on the flags.
 */
function PackageEmailAddressFields({
  merged,
  fromSegments,
  toSegments,
  subjectSegments,
  rawFrom,
  rawTo,
  showFrom = true,
  showTo = true,
}: PackageEmailAddressFieldsProps): React.ReactElement | null {
  if (merged) {
    return (
      <MergedEmailFields
        fromSegments={fromSegments}
        toSegments={toSegments}
        subjectSegments={subjectSegments}
      />
    );
  }

  if (!showFrom && !showTo) return null;

  return (
    <div className={css.emailFields}>
      {showFrom && (
        <div className={css.field}>
          <span className={css.fieldLabel}>From</span>
          <ContactList contacts={parseFromContact(rawFrom)} />
        </div>
      )}

      {showTo && (
        <div className={css.field}>
          <span className={css.fieldLabel}>To</span>
          <ContactList contacts={parseToContacts(rawTo)} />
        </div>
      )}
    </div>
  );
}

export default PackageEmailAddressFields;
