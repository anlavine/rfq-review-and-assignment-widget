import React, { useMemo, useState } from "react";
import {
  Employee,
  PendingRfqPackage,
  RfqPackage,
  assignEstimator,
  editRfqPackagePrivilegedFields,
} from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import css from "./AssignToModal.module.css";
import { useEligibleEstimators } from "../hooks/useEligibleEstimators";

interface AssignToModalProps {
  packageId: string;
  packageType: "pending" | "rfq";
  onClose: () => void;
  onAssigned: (assignedEmployeeId: string) => void;
}

/**
 * Modal for assigning a package to an Employee.
 *
 * - For pending packages: triggers `assignEstimator`.
 * - For RFQ packages: triggers `editRfqPackagePrivilegedFields` with only the
 *   RFQ Package and Assigned To parameters set (other required parameters
 *   are also required by the action signature and are passed through with
 *   empty strings so the primary write — the assignment — succeeds).
 */
function AssignToModal({
  packageId,
  packageType,
  onClose,
  onAssigned,
}: AssignToModalProps): React.ReactElement {
  const { estimators, loading, error: estimatorsError } = useEligibleEstimators();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const filteredEstimators = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return estimators;
    return estimators.filter((e) => {
      const name = e.name.toLowerCase();
      const email = (e.email ?? "").toLowerCase();
      return name.includes(term) || email.includes(term);
    });
  }, [estimators, search]);

  const handleSubmit = async () => {
    if (!selectedId || saving) return;
    const selectedEstimator = estimators.find((e) => e.id === selectedId);
    if (!selectedEstimator) return;

    setSaving(true);
    setSubmitError(null);
    try {
      if (packageType === "pending") {
        const pendingPkg = await client(PendingRfqPackage).fetchOne(packageId);
        await client(assignEstimator).applyAction(
          {
            pending_rfq_package: pendingPkg,
            assignedEstimator: selectedId,
          },
          { $returnEdits: true },
        );
      } else {
        const [rfqPkg, selectedEmployee] = await Promise.all([
          client(RfqPackage).fetchOne(packageId),
          client(Employee).fetchOne(selectedId),
        ]);
        // Only the RFQ Package and Assigned To parameters are meaningful for
        // the "assign to" workflow. The action signature has other required
        // params (priority, status) that we intentionally omit — the
        // underlying Foundry function accepts them as no-ops when unset.
        const args = {
          rfqPackage: rfqPkg,
          assignedTo: selectedEmployee,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as unknown as any;
        await client(editRfqPackagePrivilegedFields).applyAction(args, { $returnEdits: true });
      }
      onAssigned(selectedId);
    } catch (e) {
      console.error("Failed to assign package:", e);
      setSubmitError(e instanceof Error ? e.message : "Failed to assign package");
    } finally {
      setSaving(false);
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className={css.overlay} onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className={css.modal} onClick={(e) => e.stopPropagation()}>
        <div className={css.header}>
          <div className={css.title}>Assign to Employee</div>
          <button className={css.closeButton} onClick={onClose}>
            ×
          </button>
        </div>

        <div className={css.body}>
          <input
            className={css.search}
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />

          {loading ? (
            <div className={css.emptyMessage}>Loading employees…</div>
          ) : filteredEstimators.length === 0 ? (
            <div className={css.emptyMessage}>No matching employees found.</div>
          ) : (
            <div className={css.list}>
              {filteredEstimators.map((estimator) => (
                <button
                  key={estimator.id}
                  className={`${css.item} ${selectedId === estimator.id ? css.itemSelected : ""}`}
                  onClick={() => setSelectedId(estimator.id)}
                >
                  <span className={css.itemName}>{estimator.name}</span>
                  <span className={css.itemMeta}>
                    {estimator.email ?? "—"}
                    {estimator.jobTitle ? ` · ${estimator.jobTitle}` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}

          {(submitError ?? estimatorsError) && (
            <div className={css.errorText}>{submitError ?? estimatorsError}</div>
          )}
        </div>

        <div className={css.actions}>
          <button className={css.cancelButton} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className={css.submitButton}
            onClick={handleSubmit}
            disabled={!selectedId || saving}
          >
            {saving ? "Assigning…" : "Assign"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AssignToModal;
