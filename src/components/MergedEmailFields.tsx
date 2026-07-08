import React from "react";
import css from "./PackageDetail.module.css";
import ContactList from "./ContactList";
import { parseFromContact, parseToContacts } from "../utils/emailContacts";

interface MergedEmailFieldsProps {
  fromSegments: string[];
  toSegments: string[];
  subjectSegments: string[];
}

/**
 * Renders the email-origin fields (From, To, Subject) for a merged package.
 * Each source email gets its own visually distinct card labelled "Email 1",
 * "Email 2", etc.
 */
function MergedEmailFields({
  fromSegments,
  toSegments,
  subjectSegments,
}: MergedEmailFieldsProps): React.ReactElement {
  const count = Math.max(fromSegments.length, toSegments.length, subjectSegments.length);

  return (
    <div className={css.mergedEmailStack}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={css.mergedEmailCard}>
          <div className={css.mergedEmailLabel}>Email {i + 1}</div>
          <div className={css.mergedEmailBody}>
            <div className={css.field}>
              <span className={css.fieldLabel}>From</span>
              <ContactList contacts={parseFromContact(fromSegments[i])} />
            </div>
            <div className={css.field}>
              <span className={css.fieldLabel}>To</span>
              <ContactList contacts={parseToContacts(toSegments[i])} />
            </div>
            <div className={css.field}>
              <span className={css.fieldLabel}>Subject</span>
              <span className={subjectSegments[i] ? css.fieldValue : css.fieldValueMuted}>
                {subjectSegments[i] ?? "—"}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default MergedEmailFields;
