import React, { useEffect, useState, useCallback } from "react";
import { PendingRfqPackage } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import type { Osdk, PageResult } from "@osdk/client";
import css from "./PendingRfqPackageList.module.css";

const PAGE_SIZE = 20;

function PendingRfqPackageList(): React.ReactElement {
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
            completionStatus: { $eq: "Pending" },
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

  const getStatusClass = (status: string | undefined): string => {
    switch (status?.toLowerCase()) {
      case "pending":
        return css.statusPending;
      case "complete":
      case "completed":
        return css.statusComplete;
      case "skipped":
        return css.statusSkipped;
      default:
        return css.statusDefault;
    }
  };

  const formatDate = (date: string | undefined): string => {
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
        <div className={css.tableWrapper}>
          <table className={css.table}>
            <thead>
              <tr>
                <th>Package Name</th>
                <th>Customer</th>
                <th>OEM</th>
                <th>Platform</th>
                <th>Status</th>
                <th>Received</th>
                <th>Due Date</th>
                <th>Estimator</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((pkg) => (
                <tr key={pkg.$primaryKey}>
                  <td className={css.truncate}>
                    {pkg.packageName ?? "—"}
                  </td>
                  <td className={css.truncate}>
                    {pkg.customerName ?? "—"}
                  </td>
                  <td>{pkg.oem ?? "—"}</td>
                  <td>{pkg.platform ?? "—"}</td>
                  <td>
                    <span
                      className={`${css.statusBadge} ${getStatusClass(pkg.completionStatus)}`}
                    >
                      {pkg.completionStatus ?? "—"}
                    </span>
                  </td>
                  <td>{formatDate(pkg.receivedDate)}</td>
                  <td>{formatDate(pkg.dueDate)}</td>
                  <td className={css.truncate}>
                    {pkg.assignedEstimator ?? "—"}
                  </td>
                  <td>
                    {pkg.tags && pkg.tags.length > 0
                      ? pkg.tags.map((tag, i) => (
                          <span key={i} className={css.tag}>
                            {tag}
                          </span>
                        ))
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

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
        </div>
      )}
    </div>
  );
}

export default PendingRfqPackageList;
