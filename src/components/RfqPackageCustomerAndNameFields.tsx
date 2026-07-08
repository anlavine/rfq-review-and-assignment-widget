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

export default RfqPackageCustomerAndNameFields;
