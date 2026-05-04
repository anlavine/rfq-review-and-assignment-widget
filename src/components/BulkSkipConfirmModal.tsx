import React, { useState } from "react";
import { PendingRfqPackage, skipPackageReview } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import css from "./BulkSkipConfirmModal.module.css";

interface BulkSkipConfirmModalProps {
  packageIds: string[];
  onClose: () => void;
  onSkipped: () => void;
}

function BulkSkipConfirmModal({
  packageIds,
  onClose,
  onSkipped,
}: BulkSkipConfirmModalProps): React.ReactElement {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);
    setProgress(0);

    try {
      // Skip packages sequentially to avoid overwhelming the server
      for (let i = 0; i < packageIds.length; i++) {
        const pkg = await client(PendingRfqPackage).fetchOne(packageIds[i]);
        await client(skipPackageReview).applyAction(
          { pending_rfq_package: pkg },
          { $returnEdits: true },
        );
        setProgress(i + 1);
      }
      onSkipped();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to skip one or more packages",
      );
      setLoading(false);
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className={css.overlay} onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className={css.modal} onClick={(e) => e.stopPropagation()}>
        <div className={css.header}>
          <span className={css.title}>Confirm Bulk Skip</span>
          <button className={css.closeButton} onClick={onClose} disabled={loading}>
            ×
          </button>
        </div>
        <div className={css.body}>
          <p className={css.message}>
            Are you sure you want to skip <strong>{packageIds.length}</strong>{" "}
            package{packageIds.length !== 1 ? "s" : ""}? They will be moved to
            the Skipped tab.
          </p>
          {loading && (
            <div className={css.progressBar}>
              <div
                className={css.progressFill}
                style={{ width: `${(progress / packageIds.length) * 100}%` }}
              />
              <span className={css.progressText}>
                {progress} / {packageIds.length} skipped
              </span>
            </div>
          )}
          {error && <p className={css.errorText}>{error}</p>}
        </div>
        <div className={css.actions}>
          <button
            className={css.cancelButton}
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            className={css.confirmButton}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? `Skipping (${progress}/${packageIds.length})…` : `Skip ${packageIds.length} Package${packageIds.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BulkSkipConfirmModal;
