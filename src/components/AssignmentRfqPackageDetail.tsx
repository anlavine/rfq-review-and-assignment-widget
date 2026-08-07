import React, { useState } from "react";
import { RfqPackage, editRfqPackage } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import css from "./PackageDetail.module.css";
import { useRfqPackageDetail } from "../hooks/useRfqPackageDetail";
import { splitMergedField, isMergedPackage } from "../utils/mergedFields";
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
  /**
   * Called after a due-date edit is confirmed by the server, with the new
   * value. Lets the parent cache the change locally (e.g. so the list
   * reflects it immediately) without forcing a full refetch.
   */
  onDueDateSaved?: (packageId: string, newDueDate: string | null) => void;
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
  onDueDateSaved,
}: AssignmentRfqPackageDetailProps): React.ReactElement {
  const {
    rfqPkg,
    customerName,
    pendingPkg,
    conversationSiblings,
    loading,
    error,
    setRfqPkg,
  } = useRfqPackageDetail(packageId, refreshToken);

  const [editingDueDate, setEditingDueDate] = useState(false);
  const [savingDueDate, setSavingDueDate] = useState(false);

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

  const handleDueDateSave = async (dateStr: string | null) => {
    if (savingDueDate) return;
    setSavingDueDate(true);
    try {
      const freshPkg = await client(RfqPackage).fetchOne(packageId);
      await client(editRfqPackage).applyAction(
        {
          rfqPackage: freshPkg,
          dueDate: dateStr,
          // customerTerms/status/workType are required by this action even
          // though we're only changing the due date — resend the package's
          // current values unchanged so nothing else actually changes.
          customerTerms: freshPkg.customerTerms ?? "",
          status: freshPkg.status ?? "",
          workType: freshPkg.workType ?? "",
        },
        { $returnEdits: true },
      );
      const updated = await client(RfqPackage).fetchOne(packageId);
      setRfqPkg(updated);
      setEditingDueDate(false);
      onDueDateSaved?.(packageId, dateStr);
    } catch (e) {
      console.error("Failed to update RFQ package due date:", e);
    } finally {
      setSavingDueDate(false);
    }
  };

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
        dueDateEditing={{
          onSave: handleDueDateSave,
          editing: editingDueDate,
          setEditing: setEditingDueDate,
          saving: savingDueDate,
        }}
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
