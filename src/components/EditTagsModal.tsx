import React, { useState, useEffect } from "react";
import { PendingRfqPackage, RfqPackage, editTags, editRfqPackage, unskipPackageReview } from "@rfq-review-hub-widget-application/sdk";
import type { Osdk } from "@osdk/client";
import client from "../client";
import css from "./EditTagsModal.module.css";

const AVAILABLE_TAGS = [
  "Targets",
  "Waiting for Data",
  "Repeat Request",
  "Duplicate Request",
  "Update Quote",
  "No Quote",
] as const;

interface EditTagsModalProps {
  packageId: string;
  onClose: () => void;
  onSaved: (newTags: string[]) => void;
}

function EditTagsModal({
  packageId,
  onClose,
  onSaved,
}: EditTagsModalProps): React.ReactElement {
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load current tags from the package
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pkg = await client(PendingRfqPackage).fetchOne(packageId);
        if (!cancelled) {
          setSelectedTags(new Set(pkg.tags ?? []));
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load current tags");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [packageId]);

  const handleToggle = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  /**
   * When "No Quote" is removed, bring the underlying work back to Active —
   * reactivate the linked RFQ Package if one exists and isn't already
   * Active, otherwise unskip the Pending package if it had been Skipped.
   * Best-effort: a failure here shouldn't make the tag save itself look
   * like it failed, so errors are logged rather than surfaced.
   */
  const reactivateIfNoQuoteRemoved = async (pkg: Osdk.Instance<PendingRfqPackage>, newTags: string[]) => {
    const hadNoQuote = (pkg.tags ?? []).includes("No Quote");
    if (!hadNoQuote || newTags.includes("No Quote")) return;

    const rfqId = pkg.rfqPackageId?.trim();
    if (rfqId) {
      try {
        const rfqPkg = await client(RfqPackage).fetchOne(rfqId);
        if (rfqPkg.status !== "Active") {
          await client(editRfqPackage).applyAction(
            {
              rfqPackage: rfqPkg,
              status: "Active",
              customerTerms: rfqPkg.customerTerms ?? "",
              workType: rfqPkg.workType ?? "",
              dueDate: rfqPkg.dueDate ?? null,
            },
            { $returnEdits: true },
          );
        }
      } catch (e) {
        console.error("Failed to reactivate linked RFQ Package:", e);
      }
    } else if (pkg.completionStatus === "Skipped") {
      try {
        await client(unskipPackageReview).applyAction(
          { pending_rfq_package: pkg },
          { $returnEdits: true },
        );
      } catch (e) {
        console.error("Failed to reactivate skipped Pending package:", e);
      }
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const pkg = await client(PendingRfqPackage).fetchOne(packageId);
      const newTags = Array.from(selectedTags);
      await client(editTags).applyAction(
        {
          pending_rfq_package: pkg,
          tags: newTags,
        },
        { $returnEdits: true },
      );
      await reactivateIfNoQuoteRemoved(pkg, newTags);
      onSaved(newTags);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save tags");
      setSaving(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className={css.overlay} onClick={handleOverlayClick}>
      <div className={css.modal}>
        <h3 className={css.title}>Edit Tags</h3>

        {loading ? (
          <div>Loading current tags...</div>
        ) : (
          <div className={css.tagList}>
            {AVAILABLE_TAGS.map((tag) => (
              <label key={tag} className={css.tagOption}>
                <input
                  type="checkbox"
                  checked={selectedTags.has(tag)}
                  onChange={() => handleToggle(tag)}
                  disabled={saving}
                />
                {tag}
              </label>
            ))}
          </div>
        )}

        {error && <div className={css.error}>{error}</div>}

        <div className={css.footer}>
          <button
            className={css.cancelButton}
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className={css.saveButton}
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EditTagsModal;
