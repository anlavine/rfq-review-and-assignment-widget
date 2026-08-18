import React, { useState } from "react";
import { PendingRfqPackage, editDueDate, reviewDueDate } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import css from "./PackageDetail.module.css";
import { splitMergedField, isMergedPackage } from "../utils/mergedFields";
import { excludeInlineImages, isParsedAttachment } from "../utils/attachments";
import { trackUsage, INTERACTION_KEYS, type Workspace } from "../utils/trackUsage";
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
  /**
   * Called after a due-date edit is confirmed by the server, with the new
   * value. Lets the parent cache the change locally (e.g. so the list
   * reflects it immediately, including re-bucketing by due date) without
   * forcing a full refetch.
   */
  onDueDateSaved?: (packageId: string, newDueDate: string | null) => void;
  /** Called immediately (fire-and-forget) when "Mark due date reviewed" is clicked. */
  onDueDateReviewed?: (packageId: string) => void;
  /** Called if the background reviewDueDate action fails, so the parent can revert its optimistic update. */
  onDueDateReviewFailed?: (packageId: string, message: string) => void;
  onSelectPackage?: (packageId: string, completionStatus?: string) => void;
  /**
   * Workspace identifier for usage tracking. Interactions inside the detail
   * view (edit due date, edit customer, etc.) will be logged under this
   * workspace. When omitted, tracking calls omit the workspace field.
   */
  workspace?: Workspace | null;
}

function PackageDetail({
  packageId,
  refreshToken,
  onDueDateChanged,
  onDueDateSaved,
  onDueDateReviewed,
  onDueDateReviewFailed,
  onSelectPackage,
  workspace,
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
    priorityFactors,
    assignedEstimatorName,
    loading,
    error,
    setPkg,
    setCustomerName,
  } = usePendingPackageDetail(packageId, refreshToken);

  const [editingDueDate, setEditingDueDate] = useState(false);
  const [savingDueDate, setSavingDueDate] = useState(false);
  const [dueDateReviewedOverride, setDueDateReviewedOverride] = useState(false);

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
          dueDateEdited: true,
        },
        { $returnEdits: true },
      );
      const updated = await client(PendingRfqPackage).fetchOne(packageId);
      setPkg(updated);
      setEditingDueDate(false);
      trackUsage(INTERACTION_KEYS.PACKAGE_EDIT_DUE_DATE, workspace);
      onDueDateSaved?.(packageId, dateStr);
    } catch (e) {
      console.error("Failed to update due date:", e);
    } finally {
      setSavingDueDate(false);
    }
  };

  /**
   * Fire-and-forget: the checkmark disappears the instant it's clicked
   * (via the optimistic override) rather than waiting on the action call.
   * If the action fails, the override is rolled back and the failure is
   * surfaced via `onDueDateReviewFailed` — by which point the user may have
   * navigated elsewhere, so this component can't just show its own error.
   */
  const handleMarkDueDateReviewed = () => {
    if (dueDateReviewedOverride || pkg.dueDateEdited) return;
    setDueDateReviewedOverride(true);
    trackUsage(INTERACTION_KEYS.PACKAGE_MARK_DUE_DATE_REVIEWED, workspace);
    onDueDateReviewed?.(packageId);

    (async () => {
      try {
        const freshPkg = await client(PendingRfqPackage).fetchOne(packageId);
        await client(reviewDueDate).applyAction(
          { pendingRfqPackage: freshPkg },
          { $returnEdits: true },
        );
      } catch (e) {
        console.error("Failed to mark due date reviewed:", e);
        setDueDateReviewedOverride(false);
        onDueDateReviewFailed?.(packageId, e instanceof Error ? e.message : "Failed to mark due date reviewed");
      }
    })();
  };

  const effectiveDueDateEdited = dueDateReviewedOverride || pkg.dueDateEdited;

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
        priorityFactors={priorityFactors}
        assignedEstimatorName={assignedEstimatorName}
        onSaveDueDate={handleDueDateSave}
        editingDueDate={editingDueDate}
        setEditingDueDate={setEditingDueDate}
        savingDueDate={savingDueDate}
        dueDateEdited={effectiveDueDateEdited}
        onMarkDueDateReviewed={handleMarkDueDateReviewed}
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
        workspace={workspace}
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
