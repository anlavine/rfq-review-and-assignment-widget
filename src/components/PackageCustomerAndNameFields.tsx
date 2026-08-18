import React, { useRef, useState } from "react";
import { PendingRfqPackage, changeCustomer } from "@rfq-review-hub-widget-application/sdk";
import type { Osdk } from "@osdk/client";
import client from "../client";
import css from "./PackageDetail.module.css";
import CustomerPicker from "./CustomerPicker";
import { trackUsage, INTERACTION_KEYS, type Workspace } from "../utils/trackUsage";
import { getDueDateUrgency } from "../utils/dueDateUrgency";

function formatDate(date: string | undefined): string {
  if (!date) return "—";
  try {
    const parts = date.split("T")[0].split("-");
    const local = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return local.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return date;
  }
}

/** Bundles the state/handlers needed to render an editable Due Date field. */
export interface DueDateEditing {
  onSave: (dateStr: string | null) => Promise<void> | void;
  editing: boolean;
  setEditing: (v: boolean) => void;
  saving: boolean;
  /**
   * Whether the due date has already been manually reviewed — controls the
   * "Mark due date reviewed" checkmark button, which only shows when this
   * is not `true` (i.e. still false, null, or undefined).
   */
  dueDateEdited?: boolean | null;
  /** Fire-and-forget handler for the "Mark due date reviewed" button. */
  onMarkReviewed?: () => void;
}

interface PackageCustomerAndNameFieldsProps {
  pkg: Osdk.Instance<PendingRfqPackage>;
  customerName: string | null;
  /** Called with the newly-selected customer's display name after the changeCustomer action succeeds. */
  onCustomerChanged?: (newCustomerName: string) => void;
  /** Whether to render the inline ✏️ edit button. Defaults to true. */
  editable?: boolean;
  /**
   * Layout of the two fields:
   *   - "stacked" (default): Customer on top, Package Name below (single column).
   *   - "row": Package Name on the left, Customer on the right (two columns).
   */
  layout?: "stacked" | "row";
  /** Workspace identifier passed to usage tracking on customer edits. */
  workspace?: Workspace | null;
  /**
   * When provided (in "row" layout), renders a fourth editable Due Date
   * field alongside Package Name/Customer. Assignment-tab-only — the
   * Ingestion detail view doesn't pass this, so its layout is unaffected.
   */
  dueDateEditing?: DueDateEditing;
}

/**
 * Renders the Customer + Package Name field pair used in both the ingestion
 * and assignment detail views. Includes optional inline customer editing.
 */
function PackageCustomerAndNameFields({
  pkg,
  customerName,
  onCustomerChanged,
  editable = true,
  layout = "stacked",
  workspace,
  dueDateEditing,
}: PackageCustomerAndNameFieldsProps): React.ReactElement {
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const dateInputRef = useRef<HTMLInputElement | null>(null);

  const packageId = String(pkg.$primaryKey);

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
      setEditingCustomer(false);
      trackUsage(INTERACTION_KEYS.PACKAGE_EDIT_CUSTOMER, workspace);
      onCustomerChanged?.(newCustomerName);
    } catch (e) {
      console.error("Failed to change customer:", e);
    } finally {
      setSavingCustomer(false);
    }
  };

  const customerField = (
    <div className={css.field}>
      <span className={css.fieldLabel}>Customer</span>
      {editable && editingCustomer ? (
        <CustomerPicker
          onSelect={(c) => handleCustomerSave(c.primaryKey, c.name)}
          onCancel={() => setEditingCustomer(false)}
        />
      ) : (
        <span className={customerName ? css.fieldValue : css.fieldValueMuted}>
          {savingCustomer ? "Saving…" : customerName ?? "—"}
          {editable && !savingCustomer && (
            <button
              className={css.editIcon}
              onClick={() => setEditingCustomer(true)}
              title="Change customer"
            >
              ✏️
            </button>
          )}
          {!savingCustomer && pkg.customerName && (
            <span className={css.customerNameRaw}> ({pkg.customerName})</span>
          )}
        </span>
      )}
    </div>
  );

  const packageNameField = (
    <div className={css.field}>
      <span className={css.fieldLabel}>Package Name</span>
      <span className={pkg.packageName ? css.fieldValue : css.fieldValueMuted}>
        {pkg.packageName ?? "—"}
      </span>
    </div>
  );

  const urgency = getDueDateUrgency(pkg.dueDate, pkg.completionStatus);
  const dueDateField = dueDateEditing && (
    <div className={css.field}>
      <span className={css.fieldLabel}>Due Date</span>
      {!dueDateEditing.editing ? (
        <span className={`${pkg.dueDate ? css.fieldValue : css.fieldValueMuted} ${urgency === "overdue" ? css.dateOverdue : urgency === "dueSoon" ? css.dateDueSoon : ""}`}>
          {formatDate(pkg.dueDate)}
          <button
            className={css.editIcon}
            onClick={() => {
              dueDateEditing.setEditing(true);
              setTimeout(() => dateInputRef.current?.showPicker?.(), 50);
            }}
            title="Edit due date"
          >
            ✏️
          </button>
          {!dueDateEditing.dueDateEdited && dueDateEditing.onMarkReviewed && (
            <button
              className={css.editIcon}
              onClick={dueDateEditing.onMarkReviewed}
              title="Mark due date reviewed"
            >
              ✔️
            </button>
          )}
          {pkg.automatedDueDate === "true" && (
            <span className={css.autoLabel} title="This due date was auto-generated">
              {" "}🤖 Auto-generated
            </span>
          )}
        </span>
      ) : (
        <div className={css.dateEditRow}>
          <input
            ref={dateInputRef}
            type="date"
            className={css.dateInput}
            defaultValue={pkg.dueDate ? pkg.dueDate.split("T")[0] : ""}
            disabled={dueDateEditing.saving}
          />
          <button
            className={css.dateConfirm}
            disabled={dueDateEditing.saving}
            onClick={() => dueDateEditing.onSave(dateInputRef.current?.value || null)}
          >
            {dueDateEditing.saving ? "…" : "Save"}
          </button>
          <button
            className={css.dateCancel}
            disabled={dueDateEditing.saving}
            onClick={() => dueDateEditing.setEditing(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );

  const containerClass = layout === "row" ? css.emailFieldsRow : css.emailFields;
  // Drive the grid column count from the number of fields actually
  // rendered, otherwise the default 2-column grid pushes a third field
  // (Due Date) onto its own row even when there's plenty of horizontal room.
  const colCount = layout === "row" ? (dueDateEditing ? 3 : 2) : undefined;
  const rowStyle = colCount != null
    ? ({ "--col-count": String(colCount) } as React.CSSProperties)
    : undefined;

  return (
    <div className={containerClass} style={rowStyle}>
      {layout === "row" ? (
        <>
          {packageNameField}
          {customerField}
          {dueDateField}
        </>
      ) : (
        <>
          {customerField}
          {packageNameField}
        </>
      )}
    </div>
  );
}

export default PackageCustomerAndNameFields;

