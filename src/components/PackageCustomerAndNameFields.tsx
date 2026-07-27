import React, { useState } from "react";
import { PendingRfqPackage, changeCustomer } from "@rfq-review-hub-widget-application/sdk";
import type { Osdk } from "@osdk/client";
import client from "../client";
import css from "./PackageDetail.module.css";
import CustomerPicker from "./CustomerPicker";
import { trackUsage, INTERACTION_KEYS, type Workspace } from "../utils/trackUsage";

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
}: PackageCustomerAndNameFieldsProps): React.ReactElement {
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);

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

  const containerClass = layout === "row" ? css.emailFieldsRow : css.emailFields;

  return (
    <div className={containerClass}>
      {layout === "row" ? (
        <>
          {packageNameField}
          {customerField}
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

