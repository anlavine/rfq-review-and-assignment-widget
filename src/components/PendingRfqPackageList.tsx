import React, { useEffect, useState, useCallback, useRef } from "react";
import { PendingRfqPackage } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import type { Osdk, PageResult } from "@osdk/client";
import css from "./PendingRfqPackageList.module.css";

const PAGE_SIZE = 50;
const MAX_VISIBLE_TAGS = 2;

interface PendingRfqPackageListProps {
  onSelectPackage: (packageId: string) => void;
  selectedPackageId: string | null;
}

function PendingRfqPackageList({ onSelectPackage, selectedPackageId }: PendingRfqPackageListProps): React.ReactElement {
  const [packages, setPackages] = useState<
    Osdk.Instance<PendingRfqPackage>[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [currentPage, setCurrentPage] = useState(0);

  const loadPage = useCallback(async (pageToken?: string) => {
    setLoading(true);
    setError(null);
    try {
      const page: PageResult<Osdk.Instance<PendingRfqPackage>> =
        await client(PendingRfqPackage)
          .where({
            completionStatus: { $eq: "Active" },
          })
          .fetchPage({
            $pageSize: PAGE_SIZE,
            ...(pageToken ? { $nextPageToken: pageToken } : {}),
            $orderBy: { receivedDate: "desc" },
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
    loadPage();
  }, [loadPage]);

  const handleNextPage = () => {
    if (nextPageToken) {
      setCurrentPage((p) => p + 1);
      loadPage(nextPageToken);
    }
  };

  const handleFirstPage = () => {
    setCurrentPage(0);
    loadPage();
  };

  if (loading) {
    return (
      <div className={css.container}>
        <h2 className={css.title}>Pending RFQ Packages</h2>
        <div className={css.loading}>Loading packages...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={css.container}>
        <h2 className={css.title}>Pending RFQ Packages</h2>
        <div className={css.error}>Error: {error}</div>
      </div>
    );
  }

  return (
    <div className={css.container}>
      <h2 className={css.title}>Pending RFQ Packages</h2>
      <p className={css.subtitle}>
        Showing packages with a &quot;Pending&quot; completion status, ordered
        by received date.
      </p>

      {packages.length === 0 ? (
        <div className={css.empty}>No pending packages found.</div>
      ) : (
        <>
          <div className={css.cardGrid}>
            {packages.map((pkg) => (
              <PackageCard
                key={pkg.$primaryKey}
                pkg={pkg}
                isSelected={String(pkg.$primaryKey) === selectedPackageId}
                onClick={() => onSelectPackage(String(pkg.$primaryKey))}
              />
            ))}
          </div>

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
        </>
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
  onClick: () => void;
}

function PackageCard({ pkg, isSelected, onClick }: PackageCardProps): React.ReactElement {
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

  return (
    <div className={`${css.card} ${isSelected ? css.cardSelected : ""}`} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}>
      <div className={css.cardHeader}>
        <div className={css.cardTitle}>{pkg.packageName || pkg.subject || "[Unnamed Package]"}</div>
        {tags.length > 0 && (
          <div className={css.tagsInline}>
            {visibleTags.map((tag, i) => (
              <span key={i} className={css.tag}>{tag}</span>
            ))}
            {overflowTags.length > 0 && (
              <div className={css.moreTagsWrapper}>
                <span className={css.moreTagsTrigger}>
                  +{overflowTags.length}
                </span>
                <div className={css.moreTagsPopover}>
                  {tags.map((tag, i) => (
                    <span key={i} className={css.popoverTag}>{tag}</span>
                  ))}
                </div>
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
        </span>
      </div>
    </div>
  );
}

export default PendingRfqPackageList;
