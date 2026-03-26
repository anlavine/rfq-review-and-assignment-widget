import React, { useState } from "react";
import { PendingRfqPackage, mergePackages } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import css from "./MergeConfirmModal.module.css";

interface MergeConfirmModalProps {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  onClose: () => void;
  onMerged: () => void;
}

function MergeConfirmModal({
  sourceId,
  sourceName,
  targetId,
  targetName,
  onClose,
  onMerged,
}: MergeConfirmModalProps): React.ReactElement {
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMerge = async () => {
    if (merging) return;
    setMerging(true);
    setError(null);
    try {
      const sourcePkg = await client(PendingRfqPackage).fetchOne(sourceId);
      const targetPkg = await client(PendingRfqPackage).fetchOne(targetId);
      await client(mergePackages).applyAction(
        {
          "source-package": sourcePkg,
          "target-package": targetPkg,
        },
        { $returnEdits: true },
      );
      onMerged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to merge packages");
      setMerging(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !merging) {
      onClose();
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className={css.overlay} onClick={handleOverlayClick}>
      <div className={css.modal}>
        <h3 className={css.title}>Confirm Merge</h3>

        <div className={css.mergeFlow}>
          <div className={css.packageBox}>
            <span className={css.packageRole}>Source (will be deleted)</span>
            <span className={css.packageName}>{sourceName}</span>
          </div>
          <div className={css.arrow}>→</div>
          <div className={css.packageBox}>
            <span className={css.packageRole}>Target (will receive tools)</span>
            <span className={css.packageName}>{targetName}</span>
          </div>
        </div>

        <div className={css.warning}>
          ⚠️ This action will move all tools and attachments from the source
          package to the target package, then <strong>permanently delete</strong>{" "}
          the source package. This cannot be undone.
        </div>

        {error && <div className={css.error}>{error}</div>}

        <div className={css.footer}>
          <button
            className={css.cancelButton}
            onClick={onClose}
            disabled={merging}
          >
            Cancel
          </button>
          <button
            className={css.mergeButton}
            onClick={handleMerge}
            disabled={merging}
          >
            {merging ? "Merging…" : "Merge Packages"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MergeConfirmModal;
