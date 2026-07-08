import React from "react";
import css from "./PackageDetail.module.css";
import type { Contact } from "../utils/emailContacts";

interface ContactListProps {
  contacts: Contact[];
}

function ContactList({ contacts }: ContactListProps): React.ReactElement {
  if (contacts.length === 0) {
    return <span className={css.fieldValueMuted}>—</span>;
  }
  return (
    <div className={css.contactList}>
      {contacts.map((c, i) => (
        <div key={i} className={css.contactRow}>
          {c.address}
          {c.name && <span className={css.contactName}> — [{c.name}]</span>}
        </div>
      ))}
    </div>
  );
}

export default ContactList;
