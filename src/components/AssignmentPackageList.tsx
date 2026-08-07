import { useEffect, useState, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import { PendingRfqPackage, RfqPackage, PendingRfqAttachments } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import type { Osdk } from "@osdk/client";
import css from "./AssignmentPackageList.module.css";
import { fetchPriorityData } from "../hooks/usePriorityScores";
import { useEligibleEstimators } from "../hooks/useEligibleEstimators";
import { isInlineImage } from "../utils/attachments";
import { categorizeWorkType } from "../utils/workType";
import MultiSelectDropdown, { type MultiSelectOption } from "./MultiSelectDropdown";
import AssignmentPackageCard from "./AssignmentPackageCard";
import { type Filters, ASSIGNED_TO_UNASSIGNED } from "./PendingRfqPackageList";

const FETCH_PAGE_SIZE = 200;
/** Concurrency limit when resolving links / tool counts per package */
const LINK_BATCH_SIZE = 20;

export type AssignmentMode = "all" | "unassigned" | "assigned";

export type AssignmentItem =


  | { type: "pending"; pkg: Osdk.Instance<PendingRfqPackage>; priorityScore: number; toolCount: number | null; assigneeId: string | null; customerName: string | null; attachments: Osdk.Instance<PendingRfqAttachments>[] }
  | { type: "rfq"; pkg: Osdk.Instance<RfqPackage>; priorityScore: number; toolCount: number | null; assigneeId: string | null; customerName: string | null; attachments: Osdk.Instance<PendingRfqAttachments>[]; linkedFrom: string | null };

interface AssignmentPackageListProps {
  selectedId: string | null;
  onSelect: (id: string, type: "pending" | "rfq") => void;
  /**
   * Which flavor of list to render:
   *   - "all"        — Every active package, assigned or not
   *   - "unassigned" — Active packages without an estimator
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
  /** Same filter set as the Ingestion tab's FilterDropdown. */
  filters: Filters;
}

/** Sentinel for the "Unknown" / "no name resolved" assignee filter option */
const UNKNOWN_ASSIGNEE = "__unknown__";

/**
 * Tags for an item, with any session-local Edit Tags override applied. RFQ
 * items don't carry a `tags` field, so they always resolve to an empty list.
 */
function getEffectiveTags(item: AssignmentItem, tagOverrides: Record<string, string[]>): string[] {
  if (item.type !== "pending") return [];
  const id = String(item.pkg.$primaryKey);
  return tagOverrides[id] ?? item.pkg.tags ?? [];
}

/** Imperative handle exposed to the parent for optimistic tag updates. */
export interface AssignmentPackageListHandle {
  /**
   * Optimistically update a pending package's tags in local state so the
   * card reflects the change without a full refetch. No-op for RFQ items
   * (they don't render tags).
   */
  updatePackageTags: (packageId: string, newTags: string[]) => void;
}


const AssignmentPackageList = forwardRef<AssignmentPackageListHandle, AssignmentPackageListProps>(
  function AssignmentPackageList({ selectedId, onSelect, mode, hiddenIds, assigneeOverrides, refreshToken, filters }, ref) {
  const [items, setItems] = useState<AssignmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<"dueDate" | "priority">("priority");
  /**
   * Session-local overrides for a pending package's `tags` field. Applied
   * on top of the loaded package data so a save from the Edit Tags modal
   * reflects immediately in the card without a full refetch. Keyed by
   * pending package primary key.
   */
  const [tagOverrides, setTagOverrides] = useState<Record<string, string[]>>({});
  const loadIdRef = useRef(0);
  const { estimators } = useEligibleEstimators();

  // ── Expose imperative handle for optimistic updates ──
  useImperativeHandle(ref, () => ({
    updatePackageTags(packageId: string, newTags: string[]) {
      setTagOverrides((prev) => ({ ...prev, [packageId]: newTags }));
    },
  }));

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
                // Assigned tab (and All) exclude anything already linked to an RFQ
                // Package (those are essentially "Reviewed" and shouldn't appear as
                // work items).
                const hasRfqLink = !!p.rfqPackageId && p.rfqPackageId.trim() !== "";
                if (mode === "all") {
                  if (!(hasAssignee && hasRfqLink)) results.push(p);
                } else if (wantsAssigned) {
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
                if (mode === "all") {
                  results.push(p);
                } else if (wantsAssigned) {
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
        // We also resolve, per-RFQ-item, the linked PendingRfqPackage id
        // so we can then fetch priorities for all pending ids
        // (both direct and RFQ-linked) in a single scoped batch — much
        // faster than fetching every priority row in the ontology.
        interface PendingItemPartial {
          pkg: Osdk.Instance<PendingRfqPackage>;
          toolCount: number | null;
          assigneeId: string | null;
          customerName: string | null;
          attachments: Osdk.Instance<PendingRfqAttachments>[];
        }
        interface RfqItemPartial {
          pkg: Osdk.Instance<RfqPackage>;
          toolCount: number | null;
          assigneeId: string | null;
          customerName: string | null;
          attachments: Osdk.Instance<PendingRfqAttachments>[];
          /** id of the linked PendingRfqPackage, if any */
          pendingPackageId: string | null;
          /** `from` of the linked PendingRfqPackage — RfqPackage has no sender field of its own. */
          linkedFrom: string | null;
        }

        /** Resolves the attachment rows for an email (excluding inline images). */
        async function fetchAttachments(
          emailId: string | undefined,
          fileNamesRaw: string[] | undefined,
        ): Promise<Osdk.Instance<PendingRfqAttachments>[]> {
          const fileNames = (fileNamesRaw ?? []).filter((n) => !isInlineImage(n));
          if (!emailId || fileNames.length === 0) return [];
          try {
            const page = await client(PendingRfqAttachments)
              .where({
                $and: [
                  { fileName: { $in: fileNames } },
                  { emailId: { $eq: emailId } },
                ],
              })
              .fetchPage({ $pageSize: 200 });
            return page.data;
          } catch {
            return [];
          }
        }

        const pendingPartials: PendingItemPartial[] = [];
        for (let i = 0; i < pendingPages.length && !cancelled; i += LINK_BATCH_SIZE) {
          const batch = pendingPages.slice(i, i + LINK_BATCH_SIZE);
          const results = await Promise.all(
            batch.map(async (pkg): Promise<PendingItemPartial> => {
              let toolCount: number | null = null;
              try {
                const page = await pkg.$link.pendingRfqPackageTools.fetchPage({ $pageSize: 200 });
                toolCount = page.data.length;
              } catch { /* non-critical */ }

              // Pending packages show their raw (unlinked) customer name in
              // the assignment list rather than the resolved CustomerV2 link
              // — that's the value shown in parentheses on the detail view.
              const customerName = pkg.customerName ?? null;

              const attachments = await fetchAttachments(pkg.emailId, pkg.attachmentFileNames);

              const assigneeId = pkg.assignedEstimator && pkg.assignedEstimator.trim() !== ""
                ? pkg.assignedEstimator.trim()
                : null;
              return { pkg, toolCount, assigneeId, customerName, attachments };
            }),
          );
          pendingPartials.push(...results);
        }
        if (cancelled || loadId !== loadIdRef.current) return;

        const rfqPartials: RfqItemPartial[] = [];
        for (let i = 0; i < rfqPages.length && !cancelled; i += LINK_BATCH_SIZE) {
          const batch = rfqPages.slice(i, i + LINK_BATCH_SIZE);
          const results = await Promise.all(
            batch.map(async (rfqPkg): Promise<RfqItemPartial> => {
              // Resolve the linked PendingRfqPackage id (for priority lookup),
              // reusing the same fetch to resolve attachments — the linked
              // pending package carries the emailId/attachmentFileNames that
              // RfqPackage itself doesn't have.
              let pendingPackageId: string | null = null;
              let attachments: Osdk.Instance<PendingRfqAttachments>[] = [];
              let linkedFrom: string | null = null;
              try {
                const linked = await rfqPkg.$link.pendingRfqPackage.fetchOne();
                pendingPackageId = String(linked.$primaryKey);
                attachments = await fetchAttachments(linked.emailId, linked.attachmentFileNames);
                linkedFrom = linked.from ?? null;
              } catch { /* no linked pending package */ }

              // Resolve tool count via rfqTool link
              let toolCount: number | null = null;
              try {
                const page = await rfqPkg.$link.rfqTool.fetchPage({ $pageSize: 200 });
                toolCount = page.data.length;
              } catch { /* non-critical */ }

              // Resolve customer name via: RfqPackage → Customer → CustomerV2,
              // falling back to the Source Customer Record's company name.
              let customerName: string | null = null;
              try {
                const sourceCustomer = await rfqPkg.$link.customer.fetchOne();
                try {
                  const cv2Page = await sourceCustomer.$link.betaAdécustomers.fetchPage({ $pageSize: 1 });
                  customerName = cv2Page.data[0]?.customerName ?? sourceCustomer.companyName ?? null;
                } catch {
                  customerName = sourceCustomer.companyName ?? null;
                }
              } catch { /* non-critical */ }

              const assigneeId = rfqPkg.assignedTo && rfqPkg.assignedTo.trim() !== ""
                ? rfqPkg.assignedTo.trim()
                : null;
              return { pkg: rfqPkg, toolCount, assigneeId, customerName, attachments, pendingPackageId, linkedFrom };
            }),
          );
          rfqPartials.push(...results);
        }

        if (cancelled || loadId !== loadIdRef.current) return;

        // Collect every Pending package id we need a priority for, then
        // fetch them in a single scoped batch (chunked + parallel).
        const pendingIdsForPriority = new Set<string>();
        for (const it of pendingPartials) pendingIdsForPriority.add(String(it.pkg.$primaryKey));
        for (const it of rfqPartials) {
          if (it.pendingPackageId) pendingIdsForPriority.add(it.pendingPackageId);
        }
        const priorityData = await fetchPriorityData(Array.from(pendingIdsForPriority));

        if (cancelled || loadId !== loadIdRef.current) return;

        // Assemble the final items with their priority scores.
        const pendingItems: AssignmentItem[] = pendingPartials.map((p) => ({
          type: "pending",
          pkg: p.pkg,
          priorityScore: priorityData.scores.get(String(p.pkg.$primaryKey)) ?? 0,
          toolCount: p.toolCount,
          assigneeId: p.assigneeId,
          customerName: p.customerName,
          attachments: p.attachments,
        }));
        const rfqItems: AssignmentItem[] = rfqPartials.map((r) => ({
          type: "rfq",
          pkg: r.pkg,
          priorityScore: r.pendingPackageId
            ? priorityData.scores.get(r.pendingPackageId) ?? 0
            : 0,
          toolCount: r.toolCount,
          assigneeId: r.assigneeId,
          customerName: r.customerName,
          attachments: r.attachments,
          linkedFrom: r.linkedFrom,
        }));

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

  }, [mode, refreshToken]);

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



    // Exclude Rep/Eng Change work — applies across all three tabs.
    let filtered = items.filter((item) => categorizeWorkType(item.pkg.workType) !== "engChange");

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

    // Client-side assignee filter — meaningful on "assigned" and "all"
    // (every item on "unassigned" has no assignee, so it's a no-op there).
    if (mode !== "unassigned" && assigneeFilter.length > 0) {
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

    // Full filter panel — same fields as the Ingestion tab's FilterDropdown.
    // Subject/Sender resolve differently for RFQ items, which have no
    // subject/from field of their own: subject falls back to the RFQ
    // Package's name, sender falls back to the linked pending package's
    // `from`. Tags never match on RFQ items — they don't carry a tags field.
    const hasAnyFilter =
      filters.dueDateStart !== "" ||
      filters.dueDateEnd !== "" ||
      filters.subjectSearch !== "" ||
      filters.customerSearch !== "" ||
      filters.platformSearch !== "" ||
      filters.senderSearch !== "" ||
      filters.selectedTags.length > 0 ||
      filters.hasParsedTools ||
      filters.assignedToIds.length > 0;

    if (hasAnyFilter) {
      filtered = filtered.filter((item) => {
        const pkg = item.pkg;

        if (filters.dueDateStart && pkg.dueDate) {
          if (pkg.dueDate.split("T")[0] < filters.dueDateStart) return false;
        }
        if (filters.dueDateEnd && pkg.dueDate) {
          if (pkg.dueDate.split("T")[0] > filters.dueDateEnd) return false;
        }

        if (filters.subjectSearch) {
          const subject = item.type === "pending" ? item.pkg.subject : item.pkg.packageName;
          if (!subject?.toLowerCase().includes(filters.subjectSearch.toLowerCase())) return false;
        }

        if (filters.senderSearch) {
          const from = item.type === "pending" ? item.pkg.from : item.linkedFrom;
          if (!from?.toLowerCase().includes(filters.senderSearch.toLowerCase())) return false;
        }

        if (filters.customerSearch) {
          if (!item.customerName?.toLowerCase().includes(filters.customerSearch.toLowerCase())) return false;
        }

        if (filters.platformSearch) {
          if (!pkg.platform?.toLowerCase().includes(filters.platformSearch.toLowerCase())) return false;
        }

        if (filters.selectedTags.length > 0) {
          const tags = getEffectiveTags(item, tagOverrides);
          if (!filters.selectedTags.some((t) => tags.includes(t))) return false;
        }

        if (filters.hasParsedTools && !item.toolCount) return false;

        if (filters.assignedToIds.length > 0) {
          const wantsUnassigned = filters.assignedToIds.includes(ASSIGNED_TO_UNASSIGNED);
          const otherIds = filters.assignedToIds.filter((v) => v !== ASSIGNED_TO_UNASSIGNED);
          const assigneeId = item.assigneeId;
          const matchesUnassigned = wantsUnassigned && assigneeId === null;
          const matchesSelected = assigneeId !== null && otherIds.includes(assigneeId);
          if (!matchesUnassigned && !matchesSelected) return false;
        }

        return true;
      });
    }

    // Sort — Priority: score descending. Due Date: ascending, missing due
    // dates sort to the end. Applies identically across all three tabs.
    filtered = [...filtered].sort((a, b) => {
      if (sortMode === "priority") {
        return b.priorityScore - a.priorityScore;
      }
      const aDue = a.pkg.dueDate ?? "";
      const bDue = b.pkg.dueDate ?? "";
      if (aDue === bDue) return 0;
      if (!aDue) return 1;
      if (!bDue) return -1;
      return aDue < bDue ? -1 : 1;
    });

    return filtered;
  }, [items, hiddenIds, assigneeOverrides, assigneeFilter, mode, estimatorNameById, sortMode, filters, tagOverrides]);

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
      const assigneeName = resolveAssigneeName(item.assigneeId);
      const tags = getEffectiveTags(item, tagOverrides);

      return (
        <AssignmentPackageCard
          key={id}
          item={item}
          isSelected={isSelected}
          onSelect={onSelect}
          mode={mode}
          tags={tags}
          assigneeName={assigneeName}
          customerName={item.customerName}
        />
      );
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems, selectedId, loading, error, onSelect, mode, estimatorNameById, tagOverrides]);

  const title = mode === "all" ? "All Packages" : mode === "assigned" ? "Assigned Packages" : "Unassigned Packages";

  return (
    <div className={css.container}>
      <div className={css.titleRow}>

        <h2 className={css.title}>{title}</h2>
        <span className={css.count}>{loading ? "" : `${visibleItems.length} active`}</span>
      </div>

      <div className={css.sortToggleRow}>
        <span className={css.sortToggleLabel}>Sort by:</span>
        <div className={css.sortToggle} role="tablist" aria-label="Sort packages by">
          <button
            type="button"
            role="tab"
            aria-selected={sortMode === "priority"}
            className={`${css.sortToggleOption} ${sortMode === "priority" ? css.sortToggleActive : ""}`}
            onClick={() => setSortMode("priority")}
          >
            Priority
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sortMode === "dueDate"}
            className={`${css.sortToggleOption} ${sortMode === "dueDate" ? css.sortToggleActive : ""}`}
            onClick={() => setSortMode("dueDate")}
          >
            Due Date
          </button>
        </div>
      </div>

      {mode !== "unassigned" && (
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
});

export type { AssignmentPackageListProps };
export default AssignmentPackageList;

