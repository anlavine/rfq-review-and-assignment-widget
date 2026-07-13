import React, { useEffect, useState, useMemo, useRef } from "react";
import { PendingRfqPackage, RfqPackage } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import type { Osdk } from "@osdk/client";
import css from "./AssignmentPackageList.module.css";
import { formatReceivedDatetime } from "../utils/formatReceivedDatetime";
import { getPriorityColorClass } from "../utils/priorityColor";
import { usePriorityScores } from "../hooks/usePriorityScores";
import { useEligibleEstimators } from "../hooks/useEligibleEstimators";
import MultiSelectDropdown, { type MultiSelectOption } from "./MultiSelectDropdown";

const FETCH_PAGE_SIZE = 200;
/** Concurrency limit when resolving links / tool counts per package */
const LINK_BATCH_SIZE = 20;

export type AssignmentMode = "unassigned" | "assigned";

export type AssignmentItem =


  | { type: "pending"; pkg: Osdk.Instance<PendingRfqPackage>; priorityScore: number; toolCount: number | null; assigneeId: string | null }
  | { type: "rfq"; pkg: Osdk.Instance<RfqPackage>; priorityScore: number; toolCount: number | null; assigneeId: string | null };

interface AssignmentPackageListProps {
  selectedId: string | null;
  onSelect: (id: string, type: "pending" | "rfq") => void;
  /**
   * Which flavor of list to render:
   *   - "unassigned" — Active packages without an estimator (default)
   *   - "assigned"   — Active packages that already have an estimator
   */
  mode: AssignmentMode;
  /**
   * Set of package IDs to hide from the rendered list. Used to remove
   * packages that were just assigned in the current session without
   * having to refetch the full list from the ontology.
   */
  hiddenIds?: Set<string>;
  /**
   * Optional override map for `assigneeId`. When a package is reassigned
   * from the detail view, we update this map so the card reflects the
   * new assignee without a full refetch.
   */
  assigneeOverrides?: Record<string, string | null>;
  /** Bumping this value forces a full refetch */
  refreshToken?: number;
}

function formatDate(date: string | undefined): string {
  if (!date) return "—";
  try {
    const parts = date.split("T")[0].split("-");
    const local = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return local.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return date;
  }
}

function buildVehicleLine(oem?: string, platform?: string, modelYear?: string): string {
  const parts = [oem, platform, modelYear].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

const PRIORITY_CLASSES = {
  orange: css.cardBorderOrange,
  yellow: css.cardBorderYellow,
  gray: css.cardBorderGray,
};

/** Sentinel for the "Unknown" / "no name resolved" assignee filter option */
const UNKNOWN_ASSIGNEE = "__unknown__";

/** Returns "New Build", "Eng Change", "Other", or null based on RfqPackage work type. */
function categorizeWorkType(workType: string | undefined): "new" | "engChange" | "other" | null {
  if (!workType) return null;
  const lower = workType.toLowerCase();
  if (lower.includes("new build") || lower.includes("new_build") || lower === "new") return "new";
  if (lower.includes("eng change") || lower.includes("engineering change") || lower.includes("eng_change")) return "engChange";
  return "other";
}


function AssignmentPackageList({ selectedId, onSelect, mode, hiddenIds, assigneeOverrides, refreshToken }: AssignmentPackageListProps): React.ReactElement {
  const [items, setItems] = useState<AssignmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const loadIdRef = useRef(0);
  const priorityMap = usePriorityScores();
  const { estimators } = useEligibleEstimators();

  // Reset the assignee filter whenever we switch modes — it isn't meaningful
  // on the "Unassigned" tab and could otherwise leak between tab switches.
  useEffect(() => {
    setAssigneeFilter([]);
  }, [mode]);

  useEffect(() => {
    const loadId = ++loadIdRef.current;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setItems([]);

      try {
        // ── Fetch active pending + rfq packages in parallel ──
        // For "assigned" mode we still filter by `assignedEstimator` / `assignedTo` on
        // the client because the OSDK filter set doesn't include a "$notNull" operator
        // for strings. We use the same server predicate ($isNull true/false) and
        // then filter locally to be safe against empty-string values.
        const wantsAssigned = mode === "assigned";

        const [pendingPages, rfqPages] = await Promise.all([
          // Active, unassigned PendingRfqPackages
          (async () => {
            const results: Osdk.Instance<PendingRfqPackage>[] = [];
            let token: string | undefined;
            do {
              const page = await client(PendingRfqPackage)
                .where({
                  $and: [
                    { completionStatus: { $eq: "Active" } },

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ] as any,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any)
                .fetchPage({ $pageSize: FETCH_PAGE_SIZE, ...(token ? { $nextPageToken: token } : {}) });
              // Defensive client-side filter — some rows may store empty
              // strings rather than null for the assignee field.
              for (const p of page.data) {


                const hasAssignee = !!p.assignedEstimator && p.assignedEstimator.trim() !== "";
                // Assigned tab also excludes anything already linked to an RFQ Package
                // (those are essentially "Reviewed" and shouldn't appear as work items).
                const hasRfqLink = !!p.rfqPackageId && p.rfqPackageId.trim() !== "";
                if (wantsAssigned) {
                  if (hasAssignee && !hasRfqLink) results.push(p);
                } else {
                  if (!hasAssignee) results.push(p);
                }
              }
              token = page.nextPageToken;
            } while (token && !cancelled);
            return results;
          })(),
          // Active, unassigned RfqPackages
          (async () => {
            const results: Osdk.Instance<RfqPackage>[] = [];
            let token: string | undefined;
            do {
              const page = await client(RfqPackage)
                .where({
                  $and: [
                    { status: { $eq: "Active" } },

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ] as any,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any)
                .fetchPage({ $pageSize: FETCH_PAGE_SIZE, ...(token ? { $nextPageToken: token } : {}) });
              for (const p of page.data) {


                const hasAssignee = !!p.assignedTo && p.assignedTo.trim() !== "";
                if (wantsAssigned) {
                  if (hasAssignee) results.push(p);
                } else {
                  if (!hasAssignee) results.push(p);
                }
              }
              token = page.nextPageToken;
            } while (token && !cancelled);
            return results;
          })(),
        ]);

        if (cancelled || loadId !== loadIdRef.current) return;

        // ── Resolve pending package items with tool counts in batches ──
        const pendingItems: AssignmentItem[] = [];
        for (let i = 0; i < pendingPages.length && !cancelled; i += LINK_BATCH_SIZE) {
          const batch = pendingPages.slice(i, i + LINK_BATCH_SIZE);
          const results = await Promise.all(
            batch.map(async (pkg): Promise<AssignmentItem> => {
              const pkId = String(pkg.$primaryKey);
              const priorityScore = priorityMap.get(pkId) ?? 0;
              let toolCount: number | null = null;
              try {
                const page = await pkg.$link.pendingRfqPackageTools.fetchPage({ $pageSize: 200 });
                toolCount = page.data.length;
              } catch { /* non-critical */ }

              const assigneeId = pkg.assignedEstimator && pkg.assignedEstimator.trim() !== ""
                ? pkg.assignedEstimator.trim()
                : null;
              return { type: "pending", pkg, priorityScore, toolCount, assigneeId };
            }),
          );
          pendingItems.push(...results);
        }
        if (cancelled || loadId !== loadIdRef.current) return;

        // ── Resolve RFQ package items: get linked pending package (for priority score)
        //    and tool count in one batch pass ──
        const rfqItems: AssignmentItem[] = [];
        for (let i = 0; i < rfqPages.length && !cancelled; i += LINK_BATCH_SIZE) {
          const batch = rfqPages.slice(i, i + LINK_BATCH_SIZE);
          const results = await Promise.all(
            batch.map(async (rfqPkg): Promise<AssignmentItem> => {
              // Resolve priority score via linked PendingRfqPackage
              let priorityScore = 0;
              try {
                const linked = await rfqPkg.$link.pendingRfqPackage.fetchOne();
                const pendingPackageId = String(linked.$primaryKey);
                priorityScore = priorityMap.get(pendingPackageId) ?? 0;
              } catch { /* no linked pending package — score stays 0 */ }

              // Resolve tool count via rfqTool link
              let toolCount: number | null = null;
              try {
                const page = await rfqPkg.$link.rfqTool.fetchPage({ $pageSize: 200 });
                toolCount = page.data.length;
              } catch { /* non-critical */ }


              const assigneeId = rfqPkg.assignedTo && rfqPkg.assignedTo.trim() !== ""
                ? rfqPkg.assignedTo.trim()
                : null;
              return { type: "rfq", pkg: rfqPkg, priorityScore, toolCount, assigneeId };
            }),
          );
          rfqItems.push(...results);
        }

        if (cancelled || loadId !== loadIdRef.current) return;

        // Build the interleaved list
        const combined: AssignmentItem[] = [...pendingItems, ...rfqItems];
        // Sort by priorityScore descending; nulls go to the bottom
        combined.sort((a, b) => b.priorityScore - a.priorityScore);
        setItems(combined);
      } catch (e) {
        if (!cancelled && loadId === loadIdRef.current) {
          setError(e instanceof Error ? e.message : "Failed to load packages");
        }
      } finally {
        if (!cancelled && loadId === loadIdRef.current) {
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };

  }, [priorityMap, mode, refreshToken]);

  // Resolve employee id -> display name
  const estimatorNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of estimators) map.set(e.id, e.name);
    return map;
  }, [estimators]);

  const resolveAssigneeName = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return estimatorNameById.get(id) ?? null;
  };

  const visibleItems = useMemo(() => {



    let filtered = items;

    // Apply session-local assignee overrides so reassigned packages reflect
    // their new assignee without a refetch.
    if (assigneeOverrides && Object.keys(assigneeOverrides).length > 0) {
      filtered = filtered.map((item) => {
      const id = String(item.pkg.$primaryKey);
        if (Object.prototype.hasOwnProperty.call(assigneeOverrides, id)) {
          return { ...item, assigneeId: assigneeOverrides[id] };
        }
        return item;
      });
    }

    if (hiddenIds && hiddenIds.size > 0) {
      filtered = filtered.filter((item) => !hiddenIds.has(String(item.pkg.$primaryKey)));
    }

    // Client-side assignee filter (only meaningful in "assigned" mode)
    if (mode === "assigned" && assigneeFilter.length > 0) {
      const wantsUnknown = assigneeFilter.includes(UNKNOWN_ASSIGNEE);
      const otherIds = new Set(assigneeFilter.filter((v) => v !== UNKNOWN_ASSIGNEE));
      filtered = filtered.filter((item) => {
        const id = item.assigneeId;
        if (!id) return false;
        if (otherIds.has(id)) return true;
        // "Unknown" bucket = has an id, but no display name resolved
        if (wantsUnknown && !estimatorNameById.has(id)) return true;
        return false;
      });
    }

    return filtered;
  }, [items, hiddenIds, assigneeOverrides, assigneeFilter, mode, estimatorNameById]);

  // Options for the assignee filter — built from the eligible estimator list
  // plus any assignee IDs currently on cards that don't resolve to a name.
  const assigneeFilterOptions = useMemo<MultiSelectOption[]>(() => {
    const opts: MultiSelectOption[] = estimators.map((e) => ({ value: e.id, label: e.name }));
    // If any card has an assigneeId that isn't in the eligible list, expose a
    // catch-all "Unknown" option so the user can still filter to it.
    const hasUnknown = items.some((item) => item.assigneeId && !estimatorNameById.has(item.assigneeId));
    if (hasUnknown) {
      opts.push({ value: UNKNOWN_ASSIGNEE, label: "Unknown assignee" });
    }
    return opts;
  }, [estimators, items, estimatorNameById]);

  const content = useMemo(() => {
    if (loading) return <div className={css.emptyCard}>Fetching packages…</div>;
    if (error) return <div className={`${css.emptyCard} ${css.emptyCardError}`}>Error: {error}</div>;
    if (visibleItems.length === 0) return <div className={css.emptyCard}>No active packages found.</div>;

    return visibleItems.map((item) => {
      const id = String(item.pkg.$primaryKey);
      const isSelected = id === selectedId;
      const priorityBorderClass = getPriorityColorClass(item.priorityScore, PRIORITY_CLASSES);
      const assigneeName = resolveAssigneeName(item.assigneeId);

      const toolChip = (
        <span className={css.toolChip} title="Tool count">
          <svg className={css.toolChipIcon} viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.92 1.08a3.5 3.5 0 0 0-4.56 4.03L2.04 10.4a1.5 1.5 0 0 0 0 2.12l1.42 1.42a1.5 1.5 0 0 0 2.12 0l5.3-5.32a3.5 3.5 0 0 0 4.03-4.56l-2.1 2.1-1.42-.01-.7-.7-.01-1.42 2.1-2.1Z" />
          </svg>
          {item.toolCount ?? "…"}
        </span>
      );

      // On the Assigned tab, the "Received" text on the right is replaced

      // with a badge showing the resolved assignee name (falling back to id).
      const rightSlot = mode === "assigned" ? (
        <>
          <span

            className={css.assigneeBadge}
            title={
              assigneeName
                ? `Assigned to ${assigneeName}`
                : item.assigneeId
                  ? `Assigned to ${item.assigneeId}`
                  : "Assigned"
            }
          >


            {assigneeName ?? item.assigneeId ?? "—"}
          </span>
          <span className={css.sep}>·</span>
          <span>Due: {formatDate(item.pkg.dueDate)}</span>
        </>
      ) : item.type === "pending" ? (
        <>
          <span>Received: {formatReceivedDatetime(item.pkg.receivedDatetime, item.pkg.receivedDate)}</span>
                <span className={css.sep}>·</span>
          <span>Due: {formatDate(item.pkg.dueDate)}</span>
        </>
      ) : (
        <>
          <span>Received: {formatDate(item.pkg.dateReceived)}</span>
          <span className={css.sep}>·</span>
          <span>Due: {formatDate(item.pkg.dueDate)}</span>
        </>
        );

      if (item.type === "pending") {
        const pkg = item.pkg;
        return (
          <div
            key={id}
            className={`${css.card} ${priorityBorderClass} ${isSelected ? css.cardSelected : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(id, "pending")}
            onKeyDown={(e) => { if (e.key === "Enter") onSelect(id, "pending"); }}
          >
            <div className={css.cardHeader}>
              <div className={css.cardTitle}>{pkg.subject ?? pkg.packageName ?? "[Unnamed Package]"}</div>
              <span className={css.notReadyBadge}>Not Ready</span>
              {toolChip}
            </div>
            <div className={css.cardMeta}>
              <span className={css.cardMetaLeft}>
                {buildVehicleLine(pkg.oem, pkg.platform, pkg.modelYear)}
              </span>
              <span className={css.cardMetaRight}>



                {rightSlot}
              </span>



      </div>
    </div>
  );
      } else {
        const pkg = item.pkg;
        const workCategory = categorizeWorkType(pkg.workType);
        const workIcon = workCategory === "new" ? (
          <span className={css.workTypeIcon} title={`Work Type: ${pkg.workType}`} aria-label="New Build">✨</span>
        ) : workCategory === "engChange" ? (
          <span className={css.workTypeIcon} title={`Work Type: ${pkg.workType}`} aria-label="Engineering Change">🔄</span>
        ) : null;

        return (
          <div
            key={id}
            className={`${css.card} ${priorityBorderClass} ${isSelected ? css.cardSelected : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(id, "rfq")}
            onKeyDown={(e) => { if (e.key === "Enter") onSelect(id, "rfq"); }}
          >
            <div className={css.cardHeader}>
              {workIcon}
              <div className={css.cardTitle}>{pkg.packageName ?? "[Unnamed Package]"}</div>
              {toolChip}
            </div>
            <div className={css.cardMeta}>
              <span className={css.cardMetaLeft}>
                {buildVehicleLine(pkg.oem, pkg.platform, pkg.modelYear)}
              </span>
              <span className={css.cardMetaRight}>



                {rightSlot}
              </span>
            </div>
          </div>
        );
      }
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems, selectedId, loading, error, onSelect, mode, estimatorNameById]);

  const title = mode === "assigned" ? "Assigned Packages" : "Unassigned Packages";

  return (
    <div className={css.container}>
      <div className={css.titleRow}>

        <h2 className={css.title}>{title}</h2>
        <span className={css.count}>{loading ? "" : `${visibleItems.length} active`}</span>
      </div>

      {mode === "assigned" && (
        <div className={css.filterRow}>
          <span className={css.filterLabel}>Filter by assignee:</span>
          <div className={css.filterControl}>
            <MultiSelectDropdown
              options={assigneeFilterOptions}
              selectedValues={assigneeFilter}
              onChange={setAssigneeFilter}
              placeholder="All assignees"
              searchable
            />
          </div>
        </div>
      )}

      <div className={css.cardGrid}>
        {content}
      </div>
    </div>
  );
}

export type { AssignmentPackageListProps };
export default AssignmentPackageList;

