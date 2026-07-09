import React, { useEffect, useMemo, useState } from "react";
import {
  Employee,
  PendingRfqPackage,
  RfqPackage,
  assignEstimator,
  editRfqPackagePrivilegedFields,
} from "@rfq-review-hub-widget-application/sdk";
import type { Osdk } from "@osdk/client";
import client from "../client";
import css from "./AssignToModal.module.css";

/**
 * Fixed allowlist of employees eligible to be assigned to a package.
 *
 * The Employee list rendered in the modal is limited to Active employees
 * whose company email is in this set (case-insensitive match).
 */
const ELIGIBLE_EMAILS = [
  "cgulisano@teamintegrity.com",
  "cparete@teamintegrity.com",
  "mrodriguez@teamintegrity.com",
  "mscipione@teamintegrity.com",
  "dbakker@teamintegrity.com",
  "rrodriguez@teamintegrity.com",
  "disley@teamintegrity.com",
  "bcollins@integritytn.com",
  "csorrells@integritytn.com",
  "agruening@teamintegrity.com",
  "dbondy@integritytn.com",
  "zwarner@integritytn.com",
  "jparker@integritytn.com",
  "bwatson@integritytn.com",
  "dreiss@integritytn.com",
  "skenley@integritytn.com",
];
const ELIGIBLE_EMAIL_SET = new Set(ELIGIBLE_EMAILS.map((e) => e.toLowerCase()));

interface AssignToModalProps {
  packageId: string;
  packageType: "pending" | "rfq";
  onClose: () => void;
  onAssigned: () => void;
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
  const [employees, setEmployees] = useState<Osdk.Instance<Employee>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const page = await client(Employee)
          .where({
            $and: [
              { active: { $eq: true } },
              { companyEmail: { $in: ELIGIBLE_EMAILS } },
            ],
          })
          .fetchPage({ $pageSize: 100 });
        if (cancelled) return;
        // Client-side filter as a safety net in case of case-mismatch
        const filtered = page.data.filter((e) =>
          e.companyEmail && ELIGIBLE_EMAIL_SET.has(e.companyEmail.toLowerCase()),
        );
        // Sort by display name (fallback to first/last name)
        filtered.sort((a, b) => {
          const an = (a.displayName ?? `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim()).toLowerCase();
          const bn = (b.displayName ?? `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim()).toLowerCase();
          return an.localeCompare(bn);
        });
        setEmployees(filtered);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load employees");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter((e) => {
      const name = (e.displayName ?? `${e.firstName ?? ""} ${e.lastName ?? ""}`).toLowerCase();
      const email = (e.companyEmail ?? "").toLowerCase();
      return name.includes(term) || email.includes(term);
    });
  }, [employees, search]);

  const handleSubmit = async () => {
    if (!selectedId || saving) return;
    const selectedEmployee = employees.find((e) => String(e.$primaryKey) === selectedId);
    if (!selectedEmployee) return;

    setSaving(true);
    setError(null);
    try {
      if (packageType === "pending") {
        const pendingPkg = await client(PendingRfqPackage).fetchOne(packageId);
        await client(assignEstimator).applyAction(
          {
            pending_rfq_package: pendingPkg,
            assignedEstimator: String(selectedEmployee.$primaryKey),
          },
          { $returnEdits: true },
        );
      } else {
        const rfqPkg = await client(RfqPackage).fetchOne(packageId);
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
      onAssigned();
    } catch (e) {
      console.error("Failed to assign package:", e);
      setError(e instanceof Error ? e.message : "Failed to assign package");
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
          ) : filteredEmployees.length === 0 ? (
            <div className={css.emptyMessage}>No matching employees found.</div>
          ) : (
            <div className={css.list}>
              {filteredEmployees.map((emp) => {
                const id = String(emp.$primaryKey);
                const name =
                  emp.displayName ??
                  `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim() ??
                  "Unknown";
                return (
                  <button
                    key={id}
                    className={`${css.item} ${selectedId === id ? css.itemSelected : ""}`}
                    onClick={() => setSelectedId(id)}
                  >
                    <span className={css.itemName}>{name}</span>
                    <span className={css.itemMeta}>
                      {emp.companyEmail ?? "—"}
                      {emp.jobTitle ? ` · ${emp.jobTitle}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {error && <div className={css.errorText}>{error}</div>}
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
