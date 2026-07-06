import React, { useEffect, useState, useMemo, useRef } from "react";
import { PendingRfqPackage, RfqPackage } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import type { Osdk } from "@osdk/client";
import css from "./AssignmentPackageList.module.css";
import { formatReceivedDatetime } from "../utils/formatReceivedDatetime";
import { getPriorityColorClass } from "../utils/priorityColor";
import { usePriorityScores } from "../hooks/usePriorityScores";

const FETCH_PAGE_SIZE = 200;
/** Concurrency limit when resolving links / tool counts per package */
const LINK_BATCH_SIZE = 20;

export type AssignmentItem =
  | { type: "pending"; pkg: Osdk.Instance<PendingRfqPackage>; priorityScore: number; toolCount: number | null }
  | { type: "rfq"; pkg: Osdk.Instance<RfqPackage>; priorityScore: number; toolCount: number | null };

interface AssignmentPackageListProps {
  selectedId: string | null;
  onSelect: (id: string, type: "pending" | "rfq") => void;
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

/** Returns "New Build", "Eng Change", "Other", or null based on RfqPackage work type. */
function categorizeWorkType(workType: string | undefined): "new" | "engChange" | "other" | null {
  if (!workType) return null;
  const lower = workType.toLowerCase();
  if (lower.includes("new build") || lower.includes("new_build") || lower === "new") return "new";
  if (lower.includes("eng change") || lower.includes("engineering change") || lower.includes("eng_change")) return "engChange";
  return "other";
}

function AssignmentPackageList({ selectedId, onSelect }: AssignmentPackageListProps): React.ReactElement {
  const [items, setItems] = useState<AssignmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadIdRef = useRef(0);
  const priorityMap = usePriorityScores();

  useEffect(() => {
    const loadId = ++loadIdRef.current;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setItems([]);

      try {
        // ── Fetch active pending + rfq packages in parallel ──
        const [pendingPages, rfqPages] = await Promise.all([
          // Active PendingRfqPackages
          (async () => {
            const results: Osdk.Instance<PendingRfqPackage>[] = [];
            let token: string | undefined;
            do {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const page = await client(PendingRfqPackage).where({ completionStatus: { $eq: "Active" } } as any)
                .fetchPage({ $pageSize: FETCH_PAGE_SIZE, ...(token ? { $nextPageToken: token } : {}) });
              results.push(...page.data);
              token = page.nextPageToken;
            } while (token && !cancelled);
            return results;
          })(),
          // Active RfqPackages
          (async () => {
            const results: Osdk.Instance<RfqPackage>[] = [];
            let token: string | undefined;
            do {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const page = await client(RfqPackage).where({ status: { $eq: "Active" } } as any)
                .fetchPage({ $pageSize: FETCH_PAGE_SIZE, ...(token ? { $nextPageToken: token } : {}) });
              results.push(...page.data);
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
              return { type: "pending", pkg, priorityScore, toolCount };
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

              return { type: "rfq", pkg: rfqPkg, priorityScore, toolCount };
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
  }, [priorityMap]);

  const content = useMemo(() => {
    if (loading) return <div className={css.emptyCard}>Fetching packages…</div>;
    if (error) return <div className={`${css.emptyCard} ${css.emptyCardError}`}>Error: {error}</div>;
    if (items.length === 0) return <div className={css.emptyCard}>No active packages found.</div>;

    return items.map((item) => {
      const id = String(item.pkg.$primaryKey);
      const isSelected = id === selectedId;
      const priorityBorderClass = getPriorityColorClass(item.priorityScore, PRIORITY_CLASSES);

      const toolChip = (
        <span className={css.toolChip} title="Tool count">
          <svg className={css.toolChipIcon} viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.92 1.08a3.5 3.5 0 0 0-4.56 4.03L2.04 10.4a1.5 1.5 0 0 0 0 2.12l1.42 1.42a1.5 1.5 0 0 0 2.12 0l5.3-5.32a3.5 3.5 0 0 0 4.03-4.56l-2.1 2.1-1.42-.01-.7-.7-.01-1.42 2.1-2.1Z" />
          </svg>
          {item.toolCount ?? "…"}
        </span>
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
                <span>Received: {formatReceivedDatetime(pkg.receivedDatetime, pkg.receivedDate)}</span>
                <span className={css.sep}>·</span>
                <span>Due: {formatDate(pkg.dueDate)}</span>
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
                <span>Received: {formatDate(pkg.dateReceived)}</span>
                <span className={css.sep}>·</span>
                <span>Due: {formatDate(pkg.dueDate)}</span>
              </span>
            </div>
          </div>
        );
      }
    });
  }, [items, selectedId, loading, error, onSelect]);

  return (
    <div className={css.container}>
      <div className={css.titleRow}>
        <h2 className={css.title}>Packages</h2>
        <span className={css.count}>{loading ? "" : `${items.length} active`}</span>
      </div>
      <div className={css.cardGrid}>
        {content}
      </div>
    </div>
  );
}

export type { AssignmentPackageListProps };
export default AssignmentPackageList;

