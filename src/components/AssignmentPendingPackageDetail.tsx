import React, { useState } from "react";
import { PendingRfqPackage, editDueDate } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import css from "./PackageDetail.module.css";
import { splitMergedField, isMergedPackage } from "../utils/mergedFields";
import { excludeInlineImages, excludeZipArchives, isParsedAttachment } from "../utils/attachments";
import { trackUsage, INTERACTION_KEYS, type Workspace } from "../utils/trackUsage";
import { usePendingPackageDetail } from "../hooks/usePendingPackageDetail";
import PackageDetailHeader from "./PackageDetailHeader";
import PackageEmailAddressFields from "./PackageEmailAddressFields";
import PackageCustomerAndNameFields from "./PackageCustomerAndNameFields";
import PackageConversationSection from "./PackageConversationSection";
import PackageBodyContent from "./PackageBodyContent";
import AssignmentToolsBreakdown from "./AssignmentToolsBreakdown";
import AttachmentPreviewModal from "./AttachmentPreviewModal";

interface AssignmentPendingPackageDetailProps {
  packageId: string;
  refreshToken?: number;
  onDueDateChanged?: () => void;
  /**
   * Called after a due-date edit is confirmed by the server, with the new
   * value. Lets the parent cache the change locally (e.g. so the list
   * reflects it immediately) without forcing a full refetch.
   */
  onDueDateSaved?: (packageId: string, newDueDate: string | null) => void;
  onSelectPackage?: (packageId: string, completionStatus?: string) => void;
  /** Workspace identifier for usage tracking inside the detail view. */
  workspace?: Workspace | null;
}

/**
 * Detail view for a Pending RFQ Package in the assignment tab.
 *
 * Compared to the ingestion `PackageDetail` view:
 *   - Adds an `AssignmentToolsBreakdown` table at the top listing every active tool
 *     with its Tool #, Customer Tool #, Part Name(s), Commodity Category, and
 *     Commodity Type.
 *   - Shows only the "From" field (hides the "To" field).
 *   - Hides the Number of Parsed Tools / Attachments grid.
 *   - Hides the priority, attachment-parse-status, ingestion-error, and
 *     overall-completion chips in the header.
 *   - Keeps the merged badge, editable due date, editable customer, and body
 *     content section.
 */
function AssignmentPendingPackageDetail({
  packageId,
  refreshToken,
  onDueDateChanged,
  onDueDateSaved,
  onSelectPackage,
  workspace,
}: AssignmentPendingPackageDetailProps): React.ReactElement {
  const {
    pkg,
    customerName,
    attachmentCount,
    attachments,
    conversationSiblings,
    hasPackageError,
    hasToolError,
    priorityScore,
    isNetNewCustomer,
    loading,
    error,
    setPkg,
    setCustomerName,
  } = usePendingPackageDetail(packageId, refreshToken);

  const [editingDueDate, setEditingDueDate] = useState(false);
  const [savingDueDate, setSavingDueDate] = useState(false);
  const [showAttachmentPreview, setShowAttachmentPreview] = useState(false);

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
      trackUsage(INTERACTION_KEYS.PACKAGE_EDIT_DUE_DATE, workspace);
      onDueDateSaved?.(packageId, dateStr);
    } catch (e) {
      console.error("Failed to update due date:", e);
    } finally {
      setSavingDueDate(false);
    }
  };

  const parsedAttachmentCount = pkg.receivedDatetime && pkg.receivedDatetime > "2026-06-05T15:35:06Z"
    ? (pkg.parsedAttachmentFilenames ?? []).length
    : excludeInlineImages(pkg.attachmentFileNames ?? []).filter(isParsedAttachment).length;

  const previewableAttachments = excludeZipArchives(attachments);

  const merged = isMergedPackage(pkg.from, pkg.to, pkg.subject, pkg.bodyContent);
  const fromSegments = splitMergedField(pkg.from);
  const toSegments = splitMergedField(pkg.to);
  const subjectSegments = splitMergedField(pkg.subject);
  const bodySegments = splitMergedField(pkg.bodyContent);
  const emailIdSegments = splitMergedField(pkg.emailId);

  return (
    <div className={css.container}>

       <PackageCustomerAndNameFields
        pkg={pkg}
        customerName={customerName}
        layout="row"
        workspace={workspace}
        onCustomerChanged={(newName) => {
          setCustomerName(newName);
          onDueDateChanged?.();
        }}
        dueDateEditing={{
          onSave: handleDueDateSave,
          editing: editingDueDate,
          setEditing: setEditingDueDate,
          saving: savingDueDate,
        }}
      />

      {previewableAttachments.length > 0 && (
        <div className={css.previewAttachmentsRow}>
          <button
            className={css.previewAttachmentsButton}
            onClick={() => setShowAttachmentPreview(true)}
          >
            Preview Attachments
          </button>
        </div>
      )}

      {showAttachmentPreview && (
        <AttachmentPreviewModal
          packageName={pkg.subject ?? pkg.packageName ?? "Package"}
          attachments={previewableAttachments}
          onClose={() => setShowAttachmentPreview(false)}
        />
      )}

      <AssignmentToolsBreakdown packageId={packageId} refreshToken={refreshToken} />

      <PackageDetailHeader
        pkg={pkg}
        merged={merged}
        attachmentCount={attachmentCount}
        parsedAttachmentCount={parsedAttachmentCount}
        hasPackageError={hasPackageError}
        hasToolError={hasToolError}
        priorityScore={priorityScore}
        isNetNewCustomer={isNetNewCustomer}
        showPriorityChip={false}
        showAttachmentChip={false}
        showIngestionErrorChips={false}
        showConfidenceChip={false}
        showDueDate={false}
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
        rawBody={pkg.bodyContent}
        rawEmailId={pkg.emailId}
      />
    </div>
  );
}

export default AssignmentPendingPackageDetail;
