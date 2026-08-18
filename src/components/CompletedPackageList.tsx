import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { PendingRfqPackage, RfqPackage } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import type { Osdk } from "@osdk/client";
import shared from "./AssignmentPackageList.module.css";
import css from "./CompletedPackageList.module.css";
import type { AssignmentItem } from "./AssignmentPackageList";
import AssignmentPackageCard from "./AssignmentPackageCard";
import { useEligibleEstimators } from "../hooks/useEligibleEstimators";
import { useEmployeeNames } from "../hooks/useEmployeeNames";

const PAGE_SIZE = 25;
/** Concurrency limit when resolving a Completed RFQ's linked Pending package */
const LINK_BATCH_SIZE = 20;
/** Debounce delay before a search keystroke triggers a new server query */
const SEARCH_DEBOUNCE_MS = 400;
/**
 * Cap on the supplementary leads below (match by RFQ Package name, and
 * directly-tagged unlinked RFQ Packages) — each is a bounded, non-paginated
 * batch merged in once per search/load, not a fully paginated source of its
 * own. More matches than this cap could miss some very old ones.
 */
const SUPPLEMENTARY_LEAD_CAP = 100;

interface SearchTerms {
  subject: string;
  sender: string;
  customer: string;
}

const EMPTY_SEARCH: SearchTerms = { subject: "", sender: "", customer: "" };

function hasAnySearch(search: SearchTerms): boolean {
  return !!(search.subject || search.sender || search.customer);
}

interface Page<T> {
  items: T[];
  nextToken: string | undefined;
}

/** Resolves a Pending package's linked RfqPackage, if any and if Completed. */
async function resolveCompletedRfqForPending(pending: Osdk.Instance<PendingRfqPackage>): Promise<Osdk.Instance<RfqPackage> | null> {
  const rfqId = pending.rfqPackageId;
  if (!rfqId || rfqId.trim() === "") return null;
  try {
    const rfq = await client(RfqPackage).fetchOne(rfqId.trim());
    return rfq.status === "Completed" ? rfq : null;
  } catch {
    return null;
  }
}

/**
 * Fetches one page of Completed RfqPackages. With no search text active,
 * queries RfqPackage directly (catches packages with no linked Pending
 * package too). With search text active, subject/sender/customer only
 * exist on the linked Pending package, so the search itself queries
 * PendingRfqPackage (restricted to linked + text match) and each match is
 * then verified against its linked RfqPackage's status.
 */
async function fetchCompletedRfqPage(token: string | undefined, search: SearchTerms): Promise<Page<Osdk.Instance<RfqPackage>>> {
  if (!hasAnySearch(search)) {
    const page = await client(RfqPackage)
      .where({ status: { $eq: "Completed" } })
      .fetchPage({ $pageSize: PAGE_SIZE, $orderBy: { dateCompleted: "desc" }, ...(token ? { $nextPageToken: token } : {}) });
    return { items: page.data, nextToken: page.nextPageToken };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orClauses: any[] = [];
  if (search.subject) orClauses.push({ subject: { $containsAnyTerm: search.subject } });
  if (search.sender) orClauses.push({ from: { $containsAnyTerm: search.sender } });
  if (search.customer) orClauses.push({ customerName: { $containsAnyTerm: search.customer } });

  const page = await client(PendingRfqPackage)
    .where({
      $and: [
        { rfqPackageId: { $isNull: false } },
        { $or: orClauses },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
    })
    .fetchPage({ $pageSize: PAGE_SIZE, $orderBy: { receivedDatetime: "desc" }, ...(token ? { $nextPageToken: token } : {}) });

  const resolved = await Promise.all(page.data.map(resolveCompletedRfqForPending));
  const items = resolved.filter((r): r is Osdk.Instance<RfqPackage> => r !== null);
  return { items, nextToken: page.nextPageToken };
}

/**
 * Supplementary lead for "Completed RFQ Packages": the subject search box
 * also matches RfqPackage's own `packageName` directly, since an RFQ
 * Package's name can differ from its linked Pending package's subject. A
 * bounded (not "Load More"-paginated) batch, merged into the primary
 * PendingRfqPackage-based lead and deduplicated by packageId — consistent
 * with the existing search semantics, where subject/sender/customer are
 * already OR'd together rather than required to all match.
 */
async function fetchCompletedRfqByPackageName(search: SearchTerms): Promise<Osdk.Instance<RfqPackage>[]> {
  if (!search.subject) return [];
  const page = await client(RfqPackage)
    .where({
      $and: [
        { status: { $eq: "Completed" } },
        { packageName: { $containsAnyTerm: search.subject } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
    })
    .fetchPage({ $pageSize: SUPPLEMENTARY_LEAD_CAP, $orderBy: { dateCompleted: "desc" } });
  return page.data;
}

/** Merges the package-name lead into the primary lead, newest-completed first, deduplicated by packageId. */
function mergeCompletedRfq(primary: Osdk.Instance<RfqPackage>[], byName: Osdk.Instance<RfqPackage>[]): Osdk.Instance<RfqPackage>[] {
  const seen = new Set(primary.map((r) => r.packageId));
  const merged = [...primary, ...byName.filter((r) => !seen.has(r.packageId))];
  return merged.sort((a, b) => (b.dateCompleted ?? "").localeCompare(a.dateCompleted ?? ""));
}

/**
 * Fetches one page of the unified "No Quote" bucket. The query starts from
 * PendingRfqPackage (that's where the "No Quote" tag and subject/sender/
 * customer search fields live), but a match that's already linked to an
 * RFQ Package is represented by that RFQ Package instead — once linked,
 * the RFQ Package is the "real" work item, matching the convention used
 * everywhere else in this app. Matches whose linked RFQ Package is already
 * "Completed" are excluded — those show up in "Completed RFQ Packages"
 * instead, so a package is never listed in both sections.
 */
async function fetchNoQuotePage(token: string | undefined, search: SearchTerms): Promise<Page<AssignmentItem>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clauses: any[] = [{ tags: { $contains: "No Quote" } }];
  if (search.subject) clauses.push({ subject: { $containsAnyTerm: search.subject } });
  if (search.sender) clauses.push({ from: { $containsAnyTerm: search.sender } });
  if (search.customer) clauses.push({ customerName: { $containsAnyTerm: search.customer } });

  const page = await client(PendingRfqPackage)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where({ $and: clauses } as any)
    .fetchPage({ $pageSize: PAGE_SIZE, $orderBy: { receivedDatetime: "desc" }, ...(token ? { $nextPageToken: token } : {}) });

  const resolved = await Promise.all(page.data.map(async (p): Promise<AssignmentItem | null> => {
    const rfqId = p.rfqPackageId?.trim();
    if (!rfqId) return buildPendingItem(p);
    try {
      const rfq = await client(RfqPackage).fetchOne(rfqId);
      if (rfq.status === "Completed") return null;
      return await buildRfqItem(rfq);
    } catch {
      // Linked but the RFQ Package couldn't be resolved — fall back to the
      // Pending package rather than dropping the row silently.
      return buildPendingItem(p);
    }
  }));

  const items = resolved.filter((r): r is AssignmentItem => r !== null);
  return { items, nextToken: page.nextPageToken };
}

/**
 * Supplementary lead for the "No Quote" bucket, mirroring
 * fetchCompletedRfqByPackageName above: also matches RfqPackage's own
 * `packageName` against the subject search box. RfqPackage has its own
 * `tags` field, but it's only authoritative when there's no linked Pending
 * package (see fetchNoQuoteRfqDirect below) — a linked RFQ Package's tags
 * are edited via its Pending package, so each name match here is verified
 * against the linked package's tags instead, same as the primary lead. Also
 * excluded if its RFQ Package is already "Completed" (shown in the other
 * section instead). A bounded, non-paginated batch merged in once per
 * search rather than a fully paginated source.
 */
async function fetchNoQuoteByPackageName(search: SearchTerms): Promise<AssignmentItem[]> {
  if (!search.subject) return [];
  const page = await client(RfqPackage)
    .where({ packageName: { $containsAnyTerm: search.subject } })
    .fetchPage({ $pageSize: SUPPLEMENTARY_LEAD_CAP, $orderBy: { dateReceived: "desc" } });

  const resolved = await Promise.all(page.data.map(async (rfq): Promise<AssignmentItem | null> => {
    if (rfq.status === "Completed") return null;
    try {
      const linked = await rfq.$link.pendingRfqPackage.fetchOne();
      if (!(linked.tags ?? []).includes("No Quote")) return null;
      return await buildRfqItem(rfq);
    } catch {
      // No linked Pending package to verify the tag against — can't confirm
      // it belongs in "No Quote", so skip rather than risk a false positive.
      return null;
    }
  }));

  return resolved.filter((r): r is AssignmentItem => r !== null);
}

/**
 * Third lead for the "No Quote" bucket: RfqPackage objects tagged "No
 * Quote" directly on their own `tags` field with no linked Pending package
 * at all. These are invisible to the two leads above, since both start from
 * PendingRfqPackage (or verify against a linked one) — an unlinked RFQ
 * Package can only be discovered by querying RfqPackage directly. Excluded
 * if already "Completed" (shown in the other section instead), same as
 * every other lead here. A bounded, non-paginated batch merged in once per
 * search/load — "No Quote"-tagged unlinked RFQ Packages should be rare
 * enough that a full "Load More" stream of their own isn't warranted.
 *
 * Sender/customer search terms are skipped entirely here rather than
 * ignored: RfqPackage has no `from` field and no directly-queryable
 * customer name, so there's no server-side way to honor those filters, and
 * showing unfiltered results would silently violate the search.
 */
async function fetchNoQuoteRfqDirect(search: SearchTerms): Promise<AssignmentItem[]> {
  if (search.sender || search.customer) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clauses: any[] = [{ tags: { $contains: "No Quote" } }, { status: { $ne: "Completed" } }];
  if (search.subject) clauses.push({ packageName: { $containsAnyTerm: search.subject } });

  const page = await client(RfqPackage)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where({ $and: clauses } as any)
    .fetchPage({ $pageSize: SUPPLEMENTARY_LEAD_CAP, $orderBy: { dateReceived: "desc" } });

  const items = await Promise.all(page.data.map(buildRfqItem));
  // Only unlinked matches close the gap here — a linked one's tags are
  // edited via its Pending package (authoritative there), so it's already
  // covered by the primary lead or fetchNoQuoteByPackageName above.
  return items.filter((item) => item.type === "rfq" && item.linkedPendingId === null);
}

/** Stable dedup key for an AssignmentItem — "pending" and "rfq" ids live in separate spaces, so the type is part of the key. */
function itemKey(item: AssignmentItem): string {
  return `${item.type}:${String(item.pkg.$primaryKey)}`;
}

/** The "received" timestamp for an AssignmentItem, regardless of which underlying object type backs it. */
function itemReceivedTimestamp(item: AssignmentItem): string {
  return item.type === "pending" ? (item.pkg.receivedDatetime ?? "") : (item.pkg.dateReceived ?? "");
}

/** Merges the supplementary leads into the primary "No Quote" lead, newest-received first, deduplicated. */
function mergeNoQuoteItems(primary: AssignmentItem[], ...supplements: AssignmentItem[][]): AssignmentItem[] {
  const seen = new Set(primary.map(itemKey));
  const merged = [...primary];
  for (const supplement of supplements) {
    for (const item of supplement) {
      const key = itemKey(item);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }
  }
  return merged.sort((a, b) => itemReceivedTimestamp(b).localeCompare(itemReceivedTimestamp(a)));
}

/**
 * Resolves an RfqPackage's customer name via RfqPackage → Customer →
 * CustomerV2, falling back to the Source Customer Record's company name.
 * Same chain used for RFQ items in AssignmentPackageList.tsx — RfqPackage
 * has no raw customer-name field of its own, so this link traversal is the
 * only way to get one (the linked Pending package's raw `customerName` is
 * frequently empty and isn't a reliable substitute).
 */
async function resolveRfqCustomerName(rfqPkg: Osdk.Instance<RfqPackage>): Promise<string | null> {
  try {
    const sourceCustomer = await rfqPkg.$link.customer.fetchOne();
    try {
      const cv2Page = await sourceCustomer.$link.betaAdécustomers.fetchPage({ $pageSize: 1 });
      return cv2Page.data[0]?.customerName ?? sourceCustomer.companyName ?? null;
    } catch {
      return sourceCustomer.companyName ?? null;
    }
  } catch {
    return null;
  }
}

/** Builds the lightweight AssignmentItem used to render a Completed RFQ row. */
async function buildRfqItem(rfqPkg: Osdk.Instance<RfqPackage>): Promise<AssignmentItem> {
  const [linked, customerName] = await Promise.all([
    (async (): Promise<Osdk.Instance<PendingRfqPackage> | null> => {
      try {
        return await rfqPkg.$link.pendingRfqPackage.fetchOne();
      } catch {
        return null;
      }
    })(),
    resolveRfqCustomerName(rfqPkg),
  ]);

  const assigneeId = rfqPkg.assignedTo && rfqPkg.assignedTo.trim() !== "" ? rfqPkg.assignedTo.trim() : null;

  return {
    type: "rfq",
    pkg: rfqPkg,
    // Priority/tool-count/attachments are intentionally not resolved here —
    // this tab can have a lot of rows, and that context is still fully
    // available by opening the detail panel.
    priorityScore: 0,
    toolCount: null,
    assigneeId,
    customerName,
    attachments: [],
    linkedFrom: linked?.from ?? null,
    dueDate: rfqPkg.dueDate ?? null,
    linkedPendingId: linked ? String(linked.$primaryKey) : null,
    linkedTags: linked?.tags ?? [],
  };
}

/** Builds the lightweight AssignmentItem used to render a No Quote Pending row. */
function buildPendingItem(pkg: Osdk.Instance<PendingRfqPackage>): AssignmentItem {
  const assigneeId = pkg.assignedEstimator && pkg.assignedEstimator.trim() !== "" ? pkg.assignedEstimator.trim() : null;
  return {
    type: "pending",
    pkg,
    priorityScore: 0,
    toolCount: null,
    assigneeId,
    customerName: pkg.customerName ?? null,
    attachments: [],
    dueDate: pkg.dueDate ?? null,
  };
}

/**
 * Tags to display for a row: a Pending package's own tags, an RFQ item's
 * linked Pending package's tags (authoritative when linked, edited via
 * `editTags`), or — when there's no linked Pending package — the RFQ
 * Package's own `tags` field directly (edited via `editTagsRfqPackage`).
 * Mirrors `getEffectiveTags` in AssignmentPackageList.tsx.
 */
function displayTags(item: AssignmentItem): string[] {
  if (item.type === "pending") return item.pkg.tags ?? [];
  if (item.linkedPendingId) return item.linkedTags;
  return item.pkg.tags ?? [];
}

interface CompletedPackageListProps {
  selectedId: string | null;
  onSelect: (id: string, type: "pending" | "rfq", linkedPendingId?: string | null) => void;
  assigneeOverrides?: Record<string, string | null>;
  dueDateOverrides?: Record<string, string | null>;
  refreshToken?: number;
}

export interface CompletedPackageListHandle {
  /**
   * Optimistically drops a row from the "No Quote" section if its tags no
   * longer include "No Quote" (e.g. after an Edit Tags save) — `packageId`
   * is the Pending package's id for a Pending row or a linked RFQ row
   * (matched via `linkedPendingId`), or the RFQ Package's own id for an
   * unlinked RFQ row edited directly. No-op if the package isn't currently
   * loaded.
   */
  updatePackageTags: (packageId: string, newTags: string[]) => void;
}

interface SectionState {
  items: AssignmentItem[];
  nextToken: string | undefined;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
}

const EMPTY_SECTION: SectionState = { items: [], nextToken: undefined, hasMore: true, loading: false, loadingMore: false };

/**
 * "Completed" tab for the Assignment view — Completed RFQ Packages, and a
 * unified "No Quote" section covering "No Quote"-tagged work regardless of
 * whether an RFQ Package has been created for it, whether it's since been
 * linked to one, or — now that RfqPackage carries its own `tags` field —
 * whether it was tagged directly on a standalone RFQ Package with no
 * linked Pending package at all (edited via `editTagsRfqPackage`; see
 * fetchNoQuoteRfqDirect). Otherwise this work would be invisible
 * everywhere: excluded from the main Assignment tabs for the tag, and from
 * "Completed RFQ Packages" since its status isn't Completed. Unlike the
 * other Assignment tabs, this one doesn't load everything up front: both
 * sections are paginated ("Load More"), and subject/sender/customer search
 * is applied server-side so filtering stays fast even with a large backlog
 * of completed work.
 */
const CompletedPackageList = forwardRef<CompletedPackageListHandle, CompletedPackageListProps>(
  function CompletedPackageList({ selectedId, onSelect, assigneeOverrides, dueDateOverrides, refreshToken }, ref) {
    const [rfqSection, setRfqSection] = useState<SectionState>(EMPTY_SECTION);
    const [noQuoteSection, setNoQuoteSection] = useState<SectionState>(EMPTY_SECTION);
    const [error, setError] = useState<string | null>(null);

    // Assignee name resolution — same two-tier approach as AssignmentPackageList:
    // the eligible-estimator list first (fast, cached), falling back to a
    // direct Employee lookup for anyone assigned but no longer (or never)
    // eligible for new assignments, so a real name still renders instead of
    // a raw id.
    const { estimators } = useEligibleEstimators();
    const estimatorNameById = useMemo(() => {
      const map = new Map<string, string>();
      for (const e of estimators) map.set(e.id, e.name);
      return map;
    }, [estimators]);
    const unresolvedAssigneeIds = useMemo(
      () => [...rfqSection.items, ...noQuoteSection.items]
        .map((item) => item.assigneeId)
        .filter((id) => id && !estimatorNameById.has(id)),
      [rfqSection.items, noQuoteSection.items, estimatorNameById],
    );
    const fallbackNameById = useEmployeeNames(unresolvedAssigneeIds);
    const resolveAssigneeName = (id: string | null | undefined): string | null => {
      if (!id) return null;
      return estimatorNameById.get(id) ?? fallbackNameById.get(id) ?? null;
    };

    const [subjectInput, setSubjectInput] = useState("");
    const [senderInput, setSenderInput] = useState("");
    const [customerInput, setCustomerInput] = useState("");
    const [search, setSearch] = useState<SearchTerms>(EMPTY_SEARCH);

    const loadIdRef = useRef(0);

    useImperativeHandle(ref, () => ({
      updatePackageTags(packageId: string, newTags: string[]) {
        if (newTags.includes("No Quote")) return;
        // Items in this section can be a Pending package itself (keyed by
        // its own id), an RFQ Package linked to a Pending package (keyed by
        // `linkedPendingId`), or an unlinked RFQ Package edited directly
        // via editTagsRfqPackage (keyed by its own id) — check whichever
        // applies.
        setNoQuoteSection((prev) => ({
          ...prev,
          items: prev.items.filter((item) => {
            const ownId = String(item.pkg.$primaryKey);
            const matches = item.type === "pending"
              ? ownId === packageId
              : item.linkedPendingId
                ? item.linkedPendingId === packageId
                : ownId === packageId;
            return !matches;
          }),
        }));
      },
    }));

    // Debounce search input before it triggers a new server query.
    useEffect(() => {
      const t = setTimeout(() => {
        setSearch({ subject: subjectInput.trim(), sender: senderInput.trim(), customer: customerInput.trim() });
      }, SEARCH_DEBOUNCE_MS);
      return () => clearTimeout(t);
    }, [subjectInput, senderInput, customerInput]);

    // Initial load (and reload on search/refresh) — reset both sections
    // and fetch page 1 of each in parallel.
    useEffect(() => {
      const loadId = ++loadIdRef.current;
      let cancelled = false;

      setError(null);
      setRfqSection({ ...EMPTY_SECTION, loading: true });
      setNoQuoteSection({ ...EMPTY_SECTION, loading: true });

      (async () => {
        try {
          const [rfqPage, noQuotePage, rfqByName, noQuoteByName, noQuoteRfqDirect] = await Promise.all([
            fetchCompletedRfqPage(undefined, search),
            fetchNoQuotePage(undefined, search),
            fetchCompletedRfqByPackageName(search),
            fetchNoQuoteByPackageName(search),
            fetchNoQuoteRfqDirect(search),
          ]);
          if (cancelled || loadId !== loadIdRef.current) return;

          const mergedRfq = mergeCompletedRfq(rfqPage.items, rfqByName);
          const rfqItems: AssignmentItem[] = [];
          for (let i = 0; i < mergedRfq.length; i += LINK_BATCH_SIZE) {
            const batch = mergedRfq.slice(i, i + LINK_BATCH_SIZE);
            rfqItems.push(...await Promise.all(batch.map(buildRfqItem)));
          }
          if (cancelled || loadId !== loadIdRef.current) return;

          setRfqSection({
            items: rfqItems,
            nextToken: rfqPage.nextToken,
            hasMore: !!rfqPage.nextToken,
            loading: false,
            loadingMore: false,
          });
          setNoQuoteSection({
            items: mergeNoQuoteItems(noQuotePage.items, noQuoteByName, noQuoteRfqDirect),
            nextToken: noQuotePage.nextToken,
            hasMore: !!noQuotePage.nextToken,
            loading: false,
            loadingMore: false,
          });
        } catch (e) {
          if (!cancelled && loadId === loadIdRef.current) {
            setError(e instanceof Error ? e.message : "Failed to load completed packages");
            setRfqSection({ ...EMPTY_SECTION, loading: false });
            setNoQuoteSection({ ...EMPTY_SECTION, loading: false });
          }
        }
      })();

      return () => { cancelled = true; };
    }, [search, refreshToken]);

    const handleLoadMoreRfq = async () => {
      if (rfqSection.loadingMore || !rfqSection.hasMore) return;
      setRfqSection((prev) => ({ ...prev, loadingMore: true }));
      try {
        const page = await fetchCompletedRfqPage(rfqSection.nextToken, search);
        const newItems: AssignmentItem[] = [];
        for (let i = 0; i < page.items.length; i += LINK_BATCH_SIZE) {
          const batch = page.items.slice(i, i + LINK_BATCH_SIZE);
          newItems.push(...await Promise.all(batch.map(buildRfqItem)));
        }
        setRfqSection((prev) => {
          // A later primary page can reach a package already surfaced by
          // the package-name lead merged in on load — drop repeats.
          const seen = new Set(prev.items.map(itemKey));
          const deduped = newItems.filter((i) => !seen.has(itemKey(i)));
          return {
            items: [...prev.items, ...deduped],
            nextToken: page.nextToken,
            hasMore: !!page.nextToken,
            loading: false,
            loadingMore: false,
          };
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load more completed packages");
        setRfqSection((prev) => ({ ...prev, loadingMore: false }));
      }
    };

    const handleLoadMoreNoQuote = async () => {
      if (noQuoteSection.loadingMore || !noQuoteSection.hasMore) return;
      setNoQuoteSection((prev) => ({ ...prev, loadingMore: true }));
      try {
        const page = await fetchNoQuotePage(noQuoteSection.nextToken, search);
        setNoQuoteSection((prev) => {
          const seen = new Set(prev.items.map(itemKey));
          const deduped = page.items.filter((i) => !seen.has(itemKey(i)));
          return {
            items: [...prev.items, ...deduped],
            nextToken: page.nextToken,
            hasMore: !!page.nextToken,
            loading: false,
            loadingMore: false,
          };
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load more No Quote packages");
        setNoQuoteSection((prev) => ({ ...prev, loadingMore: false }));
      }
    };

    const applyOverrides = (item: AssignmentItem): AssignmentItem => {
      const id = String(item.pkg.$primaryKey);
      let next = item;
      if (assigneeOverrides && Object.prototype.hasOwnProperty.call(assigneeOverrides, id)) {
        next = { ...next, assigneeId: assigneeOverrides[id] };
      }
      if (dueDateOverrides && Object.prototype.hasOwnProperty.call(dueDateOverrides, id)) {
        next = { ...next, dueDate: dueDateOverrides[id] };
      }
      return next;
    };

    const renderSection = (title: string, section: SectionState, onLoadMore: () => void, tagsFor: (item: AssignmentItem) => string[]) => (
      <div className={css.section}>
        <div className={shared.sectionDivider}>
          <span className={shared.sectionDividerLabel}>{title} ({section.items.length}{section.hasMore ? "+" : ""})</span>
        </div>
        {section.loading ? (
          <div className={shared.emptyCard}>Loading…</div>
        ) : section.items.length === 0 ? (
          <div className={shared.emptyCard}>None found.</div>
        ) : (
          <div className={shared.cardGrid}>
            {section.items.map((rawItem) => {
              const item = applyOverrides(rawItem);
              const id = String(item.pkg.$primaryKey);
              return (
                <AssignmentPackageCard
                  key={id}
                  item={item}
                  isSelected={id === selectedId}
                  onSelect={onSelect}
                  mode="all"
                  tags={tagsFor(item)}
                  assigneeName={resolveAssigneeName(item.assigneeId)}
                  customerName={item.customerName}
                />
              );
            })}
          </div>
        )}
        {!section.loading && section.hasMore && (
          <button className={css.loadMoreButton} onClick={onLoadMore} disabled={section.loadingMore}>
            {section.loadingMore ? "Loading…" : "Load More"}
          </button>
        )}
      </div>
    );

    return (
      <div className={shared.container}>
        <div className={shared.titleRow}>
          <h2 className={shared.title}>Completed</h2>
        </div>

        <div className={css.searchRow}>
          <input
            className={css.searchInput}
            type="text"
            placeholder="Search subject or package name…"
            value={subjectInput}
            onChange={(e) => setSubjectInput(e.target.value)}
          />
          <input
            className={css.searchInput}
            type="text"
            placeholder="Search sender…"
            value={senderInput}
            onChange={(e) => setSenderInput(e.target.value)}
          />
          <input
            className={css.searchInput}
            type="text"
            placeholder="Search customer…"
            value={customerInput}
            onChange={(e) => setCustomerInput(e.target.value)}
          />
        </div>

        {error && <div className={css.error}>Error: {error}</div>}

        <div className={shared.columnHeaderRow}>
          <span className={shared.columnHeaderCell}>Subject</span>
          <span className={shared.columnHeaderCell}>Customer</span>
          <span className={shared.columnHeaderCell}>Program</span>
          <span className={shared.columnHeaderCell}>Received</span>
          <span className={shared.columnHeaderCell}>Due</span>
          <span className={shared.columnHeaderCell}>Assignee</span>
          <span className={shared.columnHeaderCell} />
          <span className={shared.columnHeaderCell} />
        </div>

        {renderSection("Completed RFQ Packages", rfqSection, handleLoadMoreRfq, displayTags)}
        {renderSection("No Quote", noQuoteSection, handleLoadMoreNoQuote, displayTags)}
      </div>
    );
  },
);

export default CompletedPackageList;
