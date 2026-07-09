import React, { useState } from "react";
import { PendingRfqPackage, editDueDate } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import css from "./PackageDetail.module.css";
import { splitMergedField, isMergedPackage } from "../utils/mergedFields";
import { excludeInlineImages, isParsedAttachment } from "../utils/attachments";
import { trackUsage, INTERACTION_KEYS } from "../utils/trackUsage";
import { usePendingPackageDetail } from "../hooks/usePendingPackageDetail";
import PackageDetailHeader from "./PackageDetailHeader";
import PackageEmailAddressFields from "./PackageEmailAddressFields";
import PackageCustomerAndNameFields from "./PackageCustomerAndNameFields";
import PackageParsedCountsGrid from "./PackageParsedCountsGrid";
import PackageConversationSection from "./PackageConversationSection";
import PackageBodyContent from "./PackageBodyContent";

interface PackageDetailProps {
  packageId: string;
  refreshToken?: number;
  onDueDateChanged?: () => void;
  onSelectPackage?: (packageId: string, completionStatus?: string) => void;
}

function PackageDetail({
  packageId,
  refreshToken,
  onDueDateChanged,
  onSelectPackage,
}: PackageDetailProps): React.ReactElement {
  const {
    pkg,
    customerName,
    toolCount,
    attachmentCount,
    conversationSiblings,
    hasPackageError,
    hasToolError,
    priorityScore,
    isNetNewCustomer,
    assignedEstimatorName,
    loading,
    error,
    setPkg,
    setCustomerName,
  } = usePendingPackageDetail(packageId, refreshToken);

  const [editingDueDate, setEditingDueDate] = useState(false);
  const [savingDueDate, setSavingDueDate] = useState(false);

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

  const handleDueDateSave = async (dateStr: string | null) => {
    if (savingDueDate) return;
    setSavingDueDate(true);
    try {
      const freshPkg = await client(PendingRfqPackage).fetchOne(packageId);
      await client(editDueDate).applyAction(
        {
          pending_rfq_package: freshPkg,
          dueDate: dateStr === null ? null : dateStr,
        },
        { $returnEdits: true },
      );
      const updated = await client(PendingRfqPackage).fetchOne(packageId);
      setPkg(updated);
      setEditingDueDate(false);
      trackUsage(INTERACTION_KEYS.PACKAGE_EDIT_DUE_DATE);
      onDueDateChanged?.();
    } catch (e) {
      console.error("Failed to update due date:", e);
    } finally {
      setSavingDueDate(false);
    }
  };

  // parsedAttachmentFilenames is the authoritative list of attachments that were actually parsed
  const parsedAttachmentCount = pkg.receivedDatetime && pkg.receivedDatetime > "2026-06-05T15:35:06Z"
    ? (pkg.parsedAttachmentFilenames ?? []).length
    : excludeInlineImages(pkg.attachmentFileNames ?? []).filter(isParsedAttachment).length;

  const merged = isMergedPackage(pkg.from, pkg.to, pkg.subject, pkg.bodyContent);
  const fromSegments = splitMergedField(pkg.from);
  const toSegments = splitMergedField(pkg.to);
  const subjectSegments = splitMergedField(pkg.subject);
  const bodySegments = splitMergedField(pkg.bodyContent);
  const emailIdSegments = splitMergedField(pkg.emailId);

  return (
    <div className={css.container}>
      <PackageDetailHeader
        pkg={pkg}
        merged={merged}
        attachmentCount={attachmentCount}
        parsedAttachmentCount={parsedAttachmentCount}
        hasPackageError={hasPackageError}
        hasToolError={hasToolError}
        priorityScore={priorityScore}
        isNetNewCustomer={isNetNewCustomer}
        assignedEstimatorName={assignedEstimatorName}
        onSaveDueDate={handleDueDateSave}
        editingDueDate={editingDueDate}
        setEditingDueDate={setEditingDueDate}
        savingDueDate={savingDueDate}
      />

      <PackageEmailAddressFields
        merged={merged}
        fromSegments={fromSegments}
        toSegments={toSegments}
        subjectSegments={subjectSegments}
        rawFrom={pkg.from}
        rawTo={pkg.to}
      />

      <PackageCustomerAndNameFields
        pkg={pkg}
        customerName={customerName}
        onCustomerChanged={(newName) => {
          setCustomerName(newName);
          onDueDateChanged?.(); // re-use callback to trigger list refresh
        }}
      />

      <PackageParsedCountsGrid
        toolCount={toolCount}
        attachmentCount={attachmentCount}
        parsedAttachmentCount={parsedAttachmentCount}
      />

      <PackageConversationSection
        siblings={conversationSiblings}
        onSelectPackage={onSelectPackage}
      />

      <PackageBodyContent
        merged={merged}
        bodySegments={bodySegments}
        emailIdSegments={emailIdSegments}
        rawBody={pkg.bodyContent}
        rawEmailId={pkg.emailId}
      />
    </div>
  );
}

export default PackageDetail;
