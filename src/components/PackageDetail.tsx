import React, { useEffect, useState, useRef } from "react";
import { PendingRfqPackage, editDueDate, changeCustomer } from "@rfq-review-hub-widget-application/sdk";
import CustomerPicker from "./CustomerPicker";
import client from "../client";
import type { Osdk } from "@osdk/client";
import css from "./PackageDetail.module.css";
import { getDueDateUrgency } from "../utils/dueDateUrgency";
import { splitMergedField, isMergedPackage } from "../utils/mergedFields";
import LinkifiedText from "./LinkifiedText";

interface PackageDetailProps {
  packageId: string;
  refreshToken?: number;
  onDueDateChanged?: () => void;
}

function formatDate(date: string | undefined): string {
  if (!date) return "—";
  try {
    // Parse as local date to avoid UTC timezone shift (YYYY-MM-DD → local midnight)
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

interface Contact {
  address: string;
  name: string | null;
}

/**
 * Extracts a Contact from an emailAddress wrapper object.
 * Expected shape: { emailAddress: { name: "...", address: "..." } }
 */
function extractContact(entry: Record<string, unknown>): Contact {
  const emailObj = entry.emailAddress as Record<string, unknown> | undefined;
  if (emailObj && typeof emailObj === "object") {
    return {
      address: String(emailObj.address ?? ""),
      name: (emailObj.name as string) ?? null,
    };
  }
  // Fallback: try top-level address/name
  return {
    address: String(entry.address ?? ""),
    name: (entry.name as string) ?? null,
  };
}

/**
 * Parses a "to" field value.
 * Format: JSON array of { emailAddress: { name, address } } objects.
 * e.g. [{"emailAddress":{"name":"EC RFQ","address":"EC_RFQ@NYXINC.COM"}}]
 */
function parseToContacts(raw: string | undefined): Contact[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw.replace(/'/g, '"'));
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => extractContact(entry as Record<string, unknown>));
    }
  } catch {
    // Not valid JSON
  }
  return [{ address: raw, name: null }];
}

/**
 * Parses a "from" field value.
 * Format: a single JSON object { emailAddress: { name, address } }.
 * e.g. {"emailAddress":{"name":"Greg Dante","address":"gdante@team.com"}}
 */
function parseFromContact(raw: string | undefined): Contact[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw.replace(/'/g, '"'));
    if (typeof parsed === "object" && parsed !== null) {
      return [extractContact(parsed as Record<string, unknown>)];
    }
  } catch {
    // Not valid JSON
  }
  return [{ address: raw, name: null }];
}

function ContactList({ contacts }: { contacts: Contact[] }): React.ReactElement {
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

/**
 * Renders the email-origin fields (From, To, Subject) for a merged package.
 * Each source email gets its own visually distinct card labelled "Email 1", "Email 2", etc.
 */
function MergedEmailFields({
  fromSegments,
  toSegments,
  subjectSegments,
}: {
  fromSegments: string[];
  toSegments: string[];
  subjectSegments: string[];
}): React.ReactElement {
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

/**
 * Renders body content for a merged package — one card per source email body.
 */
function MergedBodyContent({
  segments,
}: {
  segments: string[];
}): React.ReactElement {
  return (
    <div className={css.mergedBodyStack}>
      {segments.map((segment, i) => (
        <div key={i} className={css.mergedBodyCard}>
          <div className={css.mergedBodyLabel}>Email {i + 1} — Body</div>
          <div className={css.bodyContent}><LinkifiedText text={segment} /></div>
        </div>
      ))}
    </div>
  );
}

function PackageDetail({
  packageId,
  refreshToken,
  onDueDateChanged,
}: PackageDetailProps): React.ReactElement {
  const [pkg, setPkg] = useState<Osdk.Instance<PendingRfqPackage> | null>(
    null,
  );
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [savingDueDate, setSavingDueDate] = useState(false);
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setPkg(null);
    setCustomerName(null);
    setToolCount(null);
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const obj = await client(PendingRfqPackage).fetchOne(packageId);
        if (cancelled) return;
        setPkg(obj);

        const customerPromise = (async () => {
          try {
            const customerPage = await client(PendingRfqPackage)
              .where({ packageId: { $eq: packageId } })
              .pivotTo("betaAdécustomer")
              .fetchPage({ $pageSize: 1 });
            return customerPage.data[0]?.customerName ?? null;
          } catch {
            return null;
          }
        })();

        const toolCountPromise = (async () => {
          try {
            const toolPage = await client(PendingRfqPackage)
              .where({ packageId: { $eq: packageId } })
              .pivotTo("pendingRfqPackageTools")
              .fetchPage({ $pageSize: 200 });
            return toolPage.data.length;
          } catch {
            return 0;
          }
        })();

        const [resolvedCustomer, resolvedToolCount] = await Promise.all([
          customerPromise,
          toolCountPromise,
        ]);

        if (cancelled) return;
        setCustomerName(resolvedCustomer);
        setToolCount(resolvedToolCount);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Failed to load package details",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [packageId, refreshToken]);

  if (loading) {
    return (
      <div className={css.container}>
        <div className={css.loading}>Loading package details...</div>
      </div>
    );
  }

  if (error || !pkg) {
    return (
      <div className={css.container}>
        <div className={css.error}>Error: {error ?? "Package not found"}</div>
      </div>
    );
  }

  const handleDueDateSave = async (dateStr: string) => {
    if (!dateStr || savingDueDate) return;
    setSavingDueDate(true);
    try {
      const freshPkg = await client(PendingRfqPackage).fetchOne(packageId);
      await client(editDueDate).applyAction(
        {
          pending_rfq_package: freshPkg,
          dueDate: dateStr,
        },
        { $returnEdits: true },
      );
      // Re-fetch the package to get the updated due date
      const updated = await client(PendingRfqPackage).fetchOne(packageId);
      setPkg(updated);
      setEditingDueDate(false);
      onDueDateChanged?.();
    } catch (e) {
      console.error("Failed to update due date:", e);
    } finally {
      setSavingDueDate(false);
    }
  };

  const handleCustomerSave = async (customerPrimaryKey: string, newCustomerName: string) => {
    if (savingCustomer) return;
    setSavingCustomer(true);
    try {
      const freshPkg = await client(PendingRfqPackage).fetchOne(packageId);
      await client(changeCustomer).applyAction(
        {
          pending_rfq_package: freshPkg,
          customerPrimaryKey: customerPrimaryKey,
        },
        { $returnEdits: true },
      );
      setCustomerName(newCustomerName);
      setEditingCustomer(false);
      onDueDateChanged?.(); // re-use callback to trigger list refresh
    } catch (e) {
      console.error("Failed to change customer:", e);
    } finally {
      setSavingCustomer(false);
    }
  };

  const PARSED_EXTENSIONS = [".pdf", ".xlsx", ".xls", ".xlsb", ".xlsm"];
  const attachments = (pkg.attachmentFileNames ?? []).filter((name) => {
    const lower = name.toLowerCase();
    return PARSED_EXTENSIONS.some((ext) => lower.endsWith(ext));
  });
  const urgency = getDueDateUrgency(pkg.dueDate, pkg.completionStatus);

  // Detect merged packages
  const merged = isMergedPackage(pkg.from, pkg.to, pkg.subject, pkg.bodyContent);

  // Pre-split fields (single-element arrays for non-merged packages)
  const fromSegments = splitMergedField(pkg.from);
  const toSegments = splitMergedField(pkg.to);
  const subjectSegments = splitMergedField(pkg.subject);
  const bodySegments = splitMergedField(pkg.bodyContent);

  // For non-merged display, keep the existing parsed contact logic
  const toContacts = merged ? [] : parseToContacts(pkg.to);
  const fromContacts = merged ? [] : parseFromContact(pkg.from);

  return (
    <div className={css.container}>
      {/* Header: title left, dates compact right */}
      <div className={css.header}>
        <div className={css.headerLeft}>
          <h2 className={css.title}>
            {pkg.packageName || pkg.subject || "Untitled Package"}
          </h2>
          {merged && (
            <span className={css.mergedBadge}>
              <span className={css.mergedBadgeIcon}>⛙</span> Merged Package
            </span>
          )}
        </div>
        <div className={css.headerRight}>
          <span className={css.dateCompact}>
            Received: <strong>{formatDate(pkg.receivedDate)}</strong>
          </span>
          <span className={`${css.dateCompact} ${urgency === "overdue" ? css.dateOverdue : urgency === "dueSoon" ? css.dateDueSoon : ""}`}>
            Due: <strong>{formatDate(pkg.dueDate)}</strong>
            {!editingDueDate && (
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
          {editingDueDate && (
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
                  if (val) handleDueDateSave(val);
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
          {(() => {
            const allFileNames = pkg.attachmentFileNames ?? [];
            const totalCount = allFileNames.length;
            const parsedCount = attachments.length;
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
        </div>
      </div>

      {/* Email fields — merged vs. normal layout */}
      {merged ? (
        <MergedEmailFields
          fromSegments={fromSegments}
          toSegments={toSegments}
          subjectSegments={subjectSegments}
        />
      ) : (
        <div className={css.emailFields}>
          <div className={css.field}>
            <span className={css.fieldLabel}>From</span>
            <ContactList contacts={fromContacts} />
          </div>

          <div className={css.field}>
            <span className={css.fieldLabel}>To</span>
            <ContactList contacts={toContacts} />
          </div>

          <div className={css.field}>
            <span className={css.fieldLabel}>Subject</span>
            <span className={pkg.subject ? css.fieldValue : css.fieldValueMuted}>
              {pkg.subject ?? "—"}
            </span>
          </div>
        </div>
      )}

      {/* Customer field — always shown outside the merged cards */}
      <div className={css.emailFields}>
        <div className={css.field}>
          <span className={css.fieldLabel}>Customer</span>
          {editingCustomer ? (
            <CustomerPicker
              onSelect={(c) => handleCustomerSave(c.primaryKey, c.name)}
              onCancel={() => setEditingCustomer(false)}
            />
          ) : (
            <span className={customerName ? css.fieldValue : css.fieldValueMuted}>
              {savingCustomer ? "Saving…" : customerName ?? "—"}
              {!savingCustomer && (
                <button
                  className={css.editIcon}
                  onClick={() => setEditingCustomer(true)}
                  title="Change customer"
                >
                  ✏️
                </button>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Bottom boxes: Linked Tools + Attachments */}
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
            <span className={css.toolCountBadge}>{attachments.length}</span>
          </div>
        </div>
      </div>

      {/* Body content — merged vs. normal */}
      <div className={css.bodySection}>
        <div className={css.field}>
          <span className={css.fieldLabel}>Body Content</span>
          {merged && bodySegments.length > 1 ? (
            <MergedBodyContent segments={bodySegments} />
          ) : pkg.bodyContent ? (
            <div className={css.bodyContent}><LinkifiedText text={pkg.bodyContent} /></div>
          ) : (
            <span className={css.fieldValueMuted}>No body content</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default PackageDetail;
