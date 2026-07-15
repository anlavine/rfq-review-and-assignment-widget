import React from "react";
import { RfqPackage } from "@rfq-review-hub-widget-application/sdk";
import type { Osdk } from "@osdk/client";
import css from "./PackageDetail.module.css";

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
}

function formatCreatedDate(date: string | undefined): string {
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
}: RfqPackageCustomerAndNameFieldsProps): React.ReactElement {
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
        {formatCreatedDate(pkg.dateCreated)}
      </span>
    </div>
  );

  const containerClass = layout === "row" ? css.emailFieldsRow : css.emailFields;
  // Drive the grid column count from the number of fields we're actually
  // rendering — otherwise the default 2-column grid would push the third
  // field onto its own row even when there's plenty of horizontal space.
  const colCount = layout === "row" ? (showCreatedOn ? 3 : 2) : undefined;
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
