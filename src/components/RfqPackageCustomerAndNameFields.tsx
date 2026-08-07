import React, { useRef } from "react";
import { RfqPackage } from "@rfq-review-hub-widget-application/sdk";
import type { Osdk } from "@osdk/client";
import css from "./PackageDetail.module.css";
import { getDueDateUrgency } from "../utils/dueDateUrgency";

/** Bundles the state/handlers needed to render an editable Due Date field. */
export interface DueDateEditing {
  onSave: (dateStr: string | null) => Promise<void> | void;
  editing: boolean;
  setEditing: (v: boolean) => void;
  saving: boolean;
}

interface RfqPackageCustomerAndNameFieldsProps {
  pkg: Osdk.Instance<RfqPackage>;
  /**
   * The display name for the RFQ package's customer, resolved from the
   * linked Source Customer Record. Pass `null` while loading or if the
   * customer could not be resolved.
   */
  customerName: string | null;
  /**
   * Layout of the two fields:
   *   - "stacked" (default): Customer on top, Package Name below (single column).
   *   - "row": Package Name on the left, Customer on the right (two columns).
   */
  layout?: "stacked" | "row";
  /**
   * When true (row layout only), render an additional "Created On" field
   * after the Customer field, using the RFQ Package's `dateCreated`.
   */
  showCreatedOn?: boolean;
  /**
   * When provided (row layout only), renders an editable Due Date field.
   * Assignment-tab-only — this component has no other consumers.
   */
  dueDateEditing?: DueDateEditing;
}

function formatDateOnly(date: string | undefined): string {
  if (!date) return "—";
  try {
    const parts = date.split("T")[0].split("-");
    const local = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return local.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return date;
  }
}

/**
 * Renders the Customer + Package Name field pair for an RFQ Package.
 *
 * Unlike the pending-package version, the customer here is resolved via the
 * `customer` link (Source Customer Record) and is NOT editable inline.
 */
function RfqPackageCustomerAndNameFields({
  pkg,
  customerName,
  layout = "stacked",
  showCreatedOn = false,
  dueDateEditing,
}: RfqPackageCustomerAndNameFieldsProps): React.ReactElement {
  const dateInputRef = useRef<HTMLInputElement | null>(null);

  const customerField = (
    <div className={css.field}>
      <span className={css.fieldLabel}>Customer</span>
      <span className={customerName ? css.fieldValue : css.fieldValueMuted}>
        {customerName ?? "—"}
      </span>
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

  const createdOnField = (
    <div className={css.field}>
      <span className={css.fieldLabel}>Created On</span>
      <span className={pkg.dateCreated ? css.fieldValue : css.fieldValueMuted}>
        {formatDateOnly(pkg.dateCreated)}
      </span>
    </div>
  );

  const urgency = getDueDateUrgency(pkg.dueDate, pkg.status);
  const dueDateField = dueDateEditing && (
    <div className={css.field}>
      <span className={css.fieldLabel}>Due Date</span>
      {!dueDateEditing.editing ? (
        <span className={`${pkg.dueDate ? css.fieldValue : css.fieldValueMuted} ${urgency === "overdue" ? css.dateOverdue : urgency === "dueSoon" ? css.dateDueSoon : ""}`}>
          {formatDateOnly(pkg.dueDate)}
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
  // Drive the grid column count from the number of fields we're actually
  // rendering — otherwise the default 2-column grid would push a field
  // onto its own row even when there's plenty of horizontal space.
  const colCount = layout === "row" ? 2 + (showCreatedOn ? 1 : 0) + (dueDateEditing ? 1 : 0) : undefined;
  const rowStyle = colCount != null
    ? ({ "--col-count": String(colCount) } as React.CSSProperties)
    : undefined;

  return (
    <div className={containerClass} style={rowStyle}>
      {layout === "row" ? (
        <>
          {packageNameField}
          {customerField}
          {showCreatedOn && createdOnField}
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

export default RfqPackageCustomerAndNameFields;
