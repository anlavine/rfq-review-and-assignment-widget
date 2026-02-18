import React, { useEffect, useState, useCallback, useRef } from "react";
import ReactDOM from "react-dom";
import { PendingRfqPackage } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import type { Osdk, PageResult } from "@osdk/client";
import css from "./PendingRfqPackageList.module.css";

const PAGE_SIZE = 50;
const MAX_VISIBLE_TAGS = 2;

export type TabKey = "all" | "outstanding" | "skipped" | "reviewed";

const TABS: { key: TabKey; label: string; status: string | null }[] = [
  { key: "all", label: "All", status: null },
  { key: "outstanding", label: "Outstanding", status: "Active" },
  { key: "skipped", label: "Skipped", status: "Skipped" },
  { key: "reviewed", label: "Reviewed", status: "Reviewed" },
];

interface PendingRfqPackageListProps {
  onSelectPackage: (packageId: string, completionStatus?: string) => void;
  onDeselectPackage: () => void;
  selectedPackageId: string | null;
  onTabChange?: (tab: TabKey) => void;
  refreshToken?: number;
}

function PendingRfqPackageList({ onSelectPackage, onDeselectPackage, selectedPackageId, onTabChange, refreshToken }: PendingRfqPackageListProps): React.ReactElement {
  const [packages, setPackages] = useState<
    Osdk.Instance<PendingRfqPackage>[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [currentPage, setCurrentPage] = useState(0);
  const [activeTab, setActiveTab] = useState<TabKey>("all");

  const activeStatus = TABS.find((t) => t.key === activeTab)?.status ?? null;

  const loadPage = useCallback(async (pageToken?: string, status?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const objectSet = status
        ? client(PendingRfqPackage).where({ completionStatus: { $eq: status } })
        : client(PendingRfqPackage);

      const page: PageResult<Osdk.Instance<PendingRfqPackage>> =
        await objectSet.fetchPage({
          $pageSize: PAGE_SIZE,
          ...(pageToken ? { $nextPageToken: pageToken } : {}),
          $orderBy: { dueDate: "asc" },
        });

      setPackages(page.data);
      setNextPageToken(page.nextPageToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load packages");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setCurrentPage(0);
    loadPage(undefined, activeStatus);
  }, [loadPage, activeStatus, refreshToken]);

  const handleNextPage = () => {
    if (nextPageToken) {
      setCurrentPage((p) => p + 1);
      loadPage(nextPageToken, activeStatus);
    }
  };

  const handleFirstPage = () => {
    setCurrentPage(0);
    loadPage(undefined, activeStatus);
  };

  const handleTabChange = (tab: TabKey) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    onTabChange?.(tab);
    // Deselect if the selected package won't be in the new tab
    if (selectedPackageId) {
      const newStatus = TABS.find((t) => t.key === tab)?.status ?? null;
      if (newStatus !== null) {
        const selectedPkg = packages.find(
          (p) => String(p.$primaryKey) === selectedPackageId,
        );
        if (!selectedPkg || selectedPkg.completionStatus !== newStatus) {
          onDeselectPackage();
        }
      }
    }
  };

  const tabBar = (
    <div className={css.tabBar}>
      {TABS.map((tab) => (
        <button
          key={tab.key}
          className={`${css.tab} ${activeTab === tab.key ? css.tabActive : ""}`}
          onClick={() => handleTabChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className={css.container}>
      <h2 className={css.title}>Pending RFQ Packages</h2>
      {tabBar}

      <div className={css.cardGrid}>
        {loading ? (
          <div className={css.emptyCard}>Loading packages...</div>
        ) : error ? (
          <div className={`${css.emptyCard} ${css.emptyCardError}`}>Error: {error}</div>
        ) : packages.length === 0 ? (
          <div className={css.emptyCard}>No packages found.</div>
        ) : (
          packages.map((pkg) => (
            <PackageCard
              key={pkg.$primaryKey}
              pkg={pkg}
              isSelected={String(pkg.$primaryKey) === selectedPackageId}
              showStatus={activeTab === "all"}
              onClick={() => onSelectPackage(String(pkg.$primaryKey), pkg.completionStatus ?? undefined)}
            />
          ))
        )}
      </div>

      {!loading && !error && packages.length > 0 && (
        <div className={css.paginationBar}>
          <span>
            Page {currentPage + 1} &middot; {packages.length} results
          </span>
          <div>
            {currentPage > 0 && (
              <button
                className={css.paginationButton}
                onClick={handleFirstPage}
                style={{ marginRight: 8 }}
              >
                First Page
              </button>
            )}
            <button
              className={css.paginationButton}
              onClick={handleNextPage}
              disabled={!nextPageToken}
            >
              Next Page
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(date: string | undefined): string {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return date;
  }
}

function getStatusClass(status: string): string {
  switch (status) {
    case "Active":
      return css.statusActive;
    case "Skipped":
      return css.statusSkipped;
    case "Reviewed":
      return css.statusReviewed;
    default:
      return css.statusDefault;
  }
}

function getTagClass(tag: string): string {
  switch (tag) {
    case "Targets":
      return css.tagTargets;
    case "Waiting for Data":
      return css.tagWaitingForData;
    case "Repeat Request":
      return css.tagRepeatRequest;
    case "Duplicate":
      return css.tagDuplicate;
    case "Update Quote":
      return css.tagUpdateQuote;
    default:
      return "";
  }
}

function TagsPopover({
  tags,
  triggerRef,
}: {
  tags: string[];
  triggerRef: React.RefObject<HTMLElement | null>;
}): React.ReactElement | null {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({
        top: rect.top - 4,
        left: rect.left + rect.width / 2,
      });
    }
  }, [triggerRef]);

  if (!pos) return null;

  return ReactDOM.createPortal(
    <div
      className={css.moreTagsPopover}
      style={{ top: pos.top, left: pos.left, transform: "translate(-50%, -100%)" }}
    >
      {tags.map((tag, i) => (
        <span key={i} className={css.popoverTag}>{tag}</span>
      ))}
    </div>,
    document.body,
  );
}

/** Builds a combined "OEM · Platform · Model Year" string, skipping missing parts */
function buildVehicleLine(
  oem: string | undefined,
  platform: string | undefined,
  modelYear: string | undefined,
): string {
  const parts = [oem, platform, modelYear].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

interface PackageCardProps {
  pkg: Osdk.Instance<PendingRfqPackage>;
  isSelected: boolean;
  showStatus: boolean;
  onClick: () => void;
}

function PackageCard({ pkg, isSelected, showStatus, onClick }: PackageCardProps): React.ReactElement {
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [customerLoading, setCustomerLoading] = useState(true);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const pkId = String(pkg.$primaryKey);
        const customerPage = await client(PendingRfqPackage)
          .where({ packageId: { $eq: pkId } })
          .pivotTo("betaAdécustomer")
          .fetchPage({ $pageSize: 1 });
        if (!cancelled) {
          setCustomerName(customerPage.data[0]?.customerName ?? null);
        }
      } catch {
        // linked customer may not exist
        if (!cancelled) {
          setCustomerName(null);
        }
      } finally {
        if (!cancelled) {
          setCustomerLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pkg]);

  const tags = pkg.tags ?? [];
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const overflowTags = tags.slice(MAX_VISIBLE_TAGS);
  const [showPopover, setShowPopover] = useState(false);
  const moreRef = useRef<HTMLSpanElement | null>(null);

  return (
    <div className={`${css.card} ${isSelected ? css.cardSelected : ""}`} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}>
      <div className={css.cardHeader}>
        <div className={css.cardTitle}>{pkg.packageName || pkg.subject || "[Unnamed Package]"}</div>
        {tags.length > 0 && (
          <div className={css.tagsInline}>
            {visibleTags.map((tag, i) => (
              <span key={i} className={`${css.tag} ${getTagClass(tag)}`}>{tag}</span>
            ))}
            {overflowTags.length > 0 && (
              <div className={css.moreTagsWrapper}>
                <span
                  ref={moreRef}
                  className={css.moreTagsTrigger}
                  onMouseEnter={() => setShowPopover(true)}
                  onMouseLeave={() => setShowPopover(false)}
                >
                  +{overflowTags.length}
                </span>
                {showPopover && <TagsPopover tags={tags} triggerRef={moreRef} />}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={css.cardRow}>
        <span className={css.cardLabel}>Customer:</span>
        <span className={customerLoading ? css.cardValueMuted : css.cardValue}>
          {customerLoading ? "Loading…" : customerName ?? "—"}
        </span>
      </div>

      <div className={css.cardRow}>
        <span className={css.cardLabel}>Program:</span>
        <span className={css.cardValue}>
          {buildVehicleLine(pkg.oem, pkg.platform, pkg.modelYear)}
        </span>
      </div>

      <div className={css.cardRow}>
        <span className={css.cardLabel}>Due Date:</span>
        <span className={css.cardValue}>
          {formatDate(pkg.dueDate)}
          {pkg.automatedDueDate === "true" && (
            <span className={css.autoIcon} title="Auto-generated due date">🤖</span>
          )}
        </span>
      </div>

      {showStatus && pkg.completionStatus && (
        <div className={css.cardRow}>
          <span className={css.cardLabel}>Status:</span>
          <span className={`${css.statusBadge} ${getStatusClass(pkg.completionStatus)}`}>
            {pkg.completionStatus}
          </span>
        </div>
      )}
    </div>
  );
}

export default PendingRfqPackageList;
