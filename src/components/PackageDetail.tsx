import React, { useEffect, useState, useRef } from "react";
import { PendingRfqPackage, editDueDate } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import type { Osdk } from "@osdk/client";
import css from "./PackageDetail.module.css";

interface PackageDetailProps {
  packageId: string;
  refreshToken?: number;
  onDueDateChanged?: () => void;
}

function formatDate(date: string | undefined): string {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleDateString("en-US", {
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

  const attachments = pkg.attachmentFileNames ?? [];
  const toContacts = parseToContacts(pkg.to);
  const fromContacts = parseFromContact(pkg.from);

  return (
    <div className={css.container}>
      {/* Header: title left, dates compact right */}
      <div className={css.header}>
        <div className={css.headerLeft}>
          <h2 className={css.title}>
            {pkg.packageName || pkg.subject || "Untitled Package"}
          </h2>
        </div>
        <div className={css.headerRight}>
          <span className={css.dateCompact}>
            Received: <strong>{formatDate(pkg.receivedDate)}</strong>
          </span>
          <span className={css.dateCompact}>
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
          {editingDueDate && (
            <div className={css.dateEditRow}>
              <input
                ref={dateInputRef}
                type="date"
                className={css.dateInput}
                defaultValue={pkg.dueDate ? new Date(pkg.dueDate).toISOString().split("T")[0] : ""}
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
        </div>
      </div>

      {/* Email fields — single column */}
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

        <div className={css.field}>
          <span className={css.fieldLabel}>Customer</span>
          <span className={customerName ? css.fieldValue : css.fieldValueMuted}>
            {customerName ?? "—"}
          </span>
        </div>
      </div>

      {/* Bottom boxes: Linked Tools + Attachments */}
      <div className={css.bottomGrid}>
        <div className={css.box}>
          <span className={css.boxLabel}>Linked Tools</span>
          <div className={css.toolCount}>
            {toolCount != null ? (
              <>
                <span className={css.toolCountBadge}>{toolCount}</span>
                <span>
                  Pending RFQ Tool{toolCount !== 1 ? "s" : ""}
                </span>
              </>
            ) : (
              <span className={css.fieldValueMuted}>Loading…</span>
            )}
          </div>
        </div>

        <div className={css.box}>
          <span className={css.boxLabel}>Attachments</span>
          {attachments.length > 0 ? (
            <ul className={css.attachmentList}>
              {attachments.map((name, i) => (
                <li key={i} className={css.attachmentChip}>
                  {name}
                </li>
              ))}
            </ul>
          ) : (
            <span className={css.fieldValueMuted}>None</span>
          )}
        </div>
      </div>

      {/* Body content */}
      <div className={css.bodySection}>
        <div className={css.field}>
          <span className={css.fieldLabel}>Body Content</span>
          {pkg.bodyContent ? (
            <div className={css.bodyContent}>{pkg.bodyContent}</div>
          ) : (
            <span className={css.fieldValueMuted}>No body content</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default PackageDetail;
