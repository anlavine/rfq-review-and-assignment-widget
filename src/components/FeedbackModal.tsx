import React, { useState, useRef, useEffect } from "react";
import { createRfqPackageFeedback } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import css from "./FeedbackModal.module.css";

interface FeedbackModalProps {
  packageId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

function FeedbackModal({ packageId, onClose, onSubmitted }: FeedbackModalProps): React.ReactElement {
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (!feedback.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const feedbackId = crypto.randomUUID();
      await client(createRfqPackageFeedback).applyAction({
        pendingPackageId: packageId,
        actualPackageId: "",
        fieldName: "user_feedback",
        plaintextFeedback: feedback.trim(),
        pending_package_id_field_name: feedbackId,
      });
      onSubmitted();
    } catch (e) {
      console.error("Failed to submit feedback:", e);
      setError(e instanceof Error ? e.message : "Failed to submit feedback");
      setSubmitting(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !submitting) {
      onClose();
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className={css.overlay} onClick={handleOverlayClick}>
      <div className={css.modal}>
        <div className={css.header}>
          <span className={css.title}>Submit Feedback or a Bug</span>
          <button className={css.closeButton} onClick={onClose} disabled={submitting} title="Close">
            ×
          </button>
        </div>

        <div className={css.body}>
          <textarea
            ref={textareaRef}
            className={css.textarea}
            placeholder="Enter your feedback…"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            disabled={submitting}
            rows={5}
          />

          {error && <div className={css.errorText}>{error}</div>}

          <div className={css.actions}>
            <button
              className={css.cancelButton}
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              className={css.submitButton}
              onClick={handleSubmit}
              disabled={!feedback.trim() || submitting}
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FeedbackModal;
