import React from "react";
import css from "./PackageDetail.module.css";
import { useRfqPackageDetail } from "../hooks/useRfqPackageDetail";
import { splitMergedField, isMergedPackage } from "../utils/mergedFields";
import { getDueDateUrgency } from "../utils/dueDateUrgency";
import { formatReceivedDatetime } from "../utils/formatReceivedDatetime";
import PackageEmailAddressFields from "./PackageEmailAddressFields";
import PackageConversationSection from "./PackageConversationSection";
import PackageBodyContent from "./PackageBodyContent";
import RfqPackageCustomerAndNameFields from "./RfqPackageCustomerAndNameFields";
import AssignmentRfqToolsBreakdown from "./AssignmentRfqToolsBreakdown";

interface AssignmentRfqPackageDetailProps {
  packageId: string;
  refreshToken?: number;
  onSelectPackage?: (packageId: string, completionStatus?: string) => void;
}

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

/**
 * Detail view for an RFQ Package in the assignment tab.
 *
 * Layout:
 *   - Package Name (left) + Customer (right) — read-only, resolved via
 *     RfqPackage → Source Customer Record → CustomerV2.
 *   - Tools table showing all RFQ Tool fields plus a rendered tool image.
 *   - If the RFQ Package has a linked Pending RFQ Package, the email
 *     context (From, conversation, body) is shown identically to the
 *     pending-package view, except the due date shown is the RFQ
 *     Package's due date and is read-only.
 */
function AssignmentRfqPackageDetail({
  packageId,
  refreshToken,
  onSelectPackage,
}: AssignmentRfqPackageDetailProps): React.ReactElement {
  const {
    rfqPkg,
    customerName,
    pendingPkg,
    conversationSiblings,
    loading,
    error,
  } = useRfqPackageDetail(packageId, refreshToken);

  if (loading) {
    return (
      <div className={css.container}>
        <div className={css.loading}>Loading RFQ package details...</div>
      </div>
    );
  }

  if (error || !rfqPkg) {
    return (
      <div className={css.container}>
        <div className={css.error}>Error: {error ?? "RFQ package not found"}</div>
      </div>
    );
  }

  // The due date always comes from the RFQ Package (read-only).
  const rfqDueDate = rfqPkg.dueDate ?? undefined;
  const urgency = getDueDateUrgency(rfqDueDate, rfqPkg.status);

  const merged = pendingPkg
    ? isMergedPackage(pendingPkg.from, pendingPkg.to, pendingPkg.subject, pendingPkg.bodyContent)
    : false;
  const fromSegments = pendingPkg ? splitMergedField(pendingPkg.from) : [];
  const toSegments = pendingPkg ? splitMergedField(pendingPkg.to) : [];
  const subjectSegments = pendingPkg ? splitMergedField(pendingPkg.subject) : [];
  const bodySegments = pendingPkg ? splitMergedField(pendingPkg.bodyContent) : [];
  const emailIdSegments = pendingPkg ? splitMergedField(pendingPkg.emailId) : [];

  return (
    <div className={css.container}>
      <RfqPackageCustomerAndNameFields
        pkg={rfqPkg}
        customerName={customerName}
        layout="row"
        showCreatedOn
      />

      <AssignmentRfqToolsBreakdown packageId={packageId} refreshToken={refreshToken} />

      <div className={css.header}>
        <div className={css.headerLeft}>
          <h2 className={css.title}>
            {pendingPkg?.subject || rfqPkg.packageName || "Untitled RFQ Package"}
          </h2>
        </div>
        <div className={css.headerRight}>
          {pendingPkg && (
            <span className={css.dateCompact}>
              Received:{" "}
              <strong>
                {formatReceivedDatetime(pendingPkg.receivedDatetime, pendingPkg.receivedDate)}
              </strong>
            </span>
          )}
          <span
            className={`${css.dateCompact} ${
              urgency === "overdue"
                ? css.dateOverdue
                : urgency === "dueSoon"
                  ? css.dateDueSoon
                  : ""
            }`}
          >
            Due: <strong>{formatDate(rfqDueDate)}</strong>
          </span>
        </div>
      </div>

      {pendingPkg && (
        <>
          <PackageEmailAddressFields
            merged={merged}
            fromSegments={fromSegments}
            toSegments={toSegments}
            subjectSegments={subjectSegments}
            rawFrom={pendingPkg.from}
            rawTo={pendingPkg.to}
            showFrom
            showTo={false}
          />

          <PackageConversationSection
            siblings={conversationSiblings}
            onSelectPackage={onSelectPackage}
          />

          <PackageBodyContent
            merged={merged}
            bodySegments={bodySegments}
            emailIdSegments={emailIdSegments}
            rawBody={pendingPkg.bodyContent}
            rawEmailId={pendingPkg.emailId}
          />
        </>
      )}
    </div>
  );
}

export default AssignmentRfqPackageDetail;
