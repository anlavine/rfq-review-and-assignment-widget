import React, { useState, useEffect } from "react";
import { PendingRfqPackage, editTags } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import css from "./EditTagsModal.module.css";

const AVAILABLE_TAGS = [
  "Targets",
  "Waiting for Data",
  "Repeat Request",
  "Duplicate",
  "Update Quote",
  "No Quote",
] as const;

interface EditTagsModalProps {
  packageId: string;
  onClose: () => void;
  onSaved: () => void;
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

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const pkg = await client(PendingRfqPackage).fetchOne(packageId);
      await client(editTags).applyAction(
        {
          pending_rfq_package: pkg,
          tags: Array.from(selectedTags),
        },
        { $returnEdits: true },
      );
      onSaved();
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
