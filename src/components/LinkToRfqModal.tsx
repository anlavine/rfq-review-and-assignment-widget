import React, { useState, useEffect, useRef } from "react";
import { RfqPackage, PendingRfqPackage, linkToRfqPackage } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import type { Osdk } from "@osdk/client";
import css from "./LinkToRfqModal.module.css";

interface LinkToRfqModalProps {
  /** The Pending RFQ Package to update */
  pendingPackageId: string;
  onClose: () => void;
  onLinked: () => void;
}

function LinkToRfqModal({ pendingPackageId, onClose, onLinked }: LinkToRfqModalProps): React.ReactElement {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Osdk.Instance<RfqPackage>[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!search.trim()) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      const term = search.trim().toLowerCase();
      try {
        // Search across multiple fields in parallel
        const [byName, byId, byOem, byPlatform] = await Promise.all([
          client(RfqPackage)
            .where({ packageName: { $containsAnyTerm: term } })
            .fetchPage({ $pageSize: 20, $orderBy: { packageName: "asc" } })
            .catch(() => ({ data: [] as Osdk.Instance<RfqPackage>[] })),
          client(RfqPackage)
            .where({ packageId: { $startsWith: term } })
            .fetchPage({ $pageSize: 20 })
            .catch(() => ({ data: [] as Osdk.Instance<RfqPackage>[] })),
          client(RfqPackage)
            .where({ oem: { $containsAnyTerm: term } })
            .fetchPage({ $pageSize: 20, $orderBy: { packageName: "asc" } })
            .catch(() => ({ data: [] as Osdk.Instance<RfqPackage>[] })),
          client(RfqPackage)
            .where({ platform: { $containsAnyTerm: term } })
            .fetchPage({ $pageSize: 20, $orderBy: { packageName: "asc" } })
            .catch(() => ({ data: [] as Osdk.Instance<RfqPackage>[] })),
        ]);

        // Merge and deduplicate
        const seen = new Set<string>();
        const merged: Osdk.Instance<RfqPackage>[] = [];
        for (const item of [...byName.data, ...byId.data, ...byOem.data, ...byPlatform.data]) {
          const key = String(item.$primaryKey);
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(item);
          }
        }

        // Sort: names starting with the search term first, then alphabetical
        merged.sort((a, b) => {
          const aName = (a.packageName ?? "").toLowerCase();
          const bName = (b.packageName ?? "").toLowerCase();
          const aStarts = aName.startsWith(term) ? 0 : 1;
          const bStarts = bName.startsWith(term) ? 0 : 1;
          if (aStarts !== bStarts) return aStarts - bStarts;
          return aName.localeCompare(bName);
        });

        setResults(merged.slice(0, 25));
      } catch (e) {
        console.error("Failed to search RFQ packages:", e);
        setError("Failed to search RFQ packages");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const handleSelect = async (rfqPkg: Osdk.Instance<RfqPackage>) => {
    if (applying) return;
    setApplying(true);
    setError(null);
    try {
      const pendingPkg = await client(PendingRfqPackage).fetchOne(pendingPackageId);
      await client(linkToRfqPackage).applyAction(
        {
          pending_rfq_package: pendingPkg,
          rfqPackageId: String(rfqPkg.$primaryKey),
        },
        { $returnEdits: true },
      );
      onLinked();
    } catch (e) {
      console.error("Failed to link to RFQ package:", e);
      setError(e instanceof Error ? e.message : "Failed to link to RFQ package");
      setApplying(false);
    }
  };

  /** Build a meta line from OEM, Platform, and Status */
  const buildMeta = (pkg: Osdk.Instance<RfqPackage>): string => {
    const parts = [pkg.oem, pkg.platform, pkg.status].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "";
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !applying) {
      onClose();
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className={css.overlay} onClick={handleOverlayClick}>
      <div className={css.modal}>
        <div className={css.header}>
          <span className={css.title}>Link to RFQ Package</span>
          <button className={css.closeButton} onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <div className={css.body}>
          <input
            ref={inputRef}
            type="text"
            className={css.searchInput}
            placeholder="Search by name, ID, OEM, or platform…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={applying}
          />

          {error && <div className={css.errorText}>{error}</div>}

          {applying ? (
            <div className={css.applyingOverlay}>Linking…</div>
          ) : loading ? (
            <div className={css.statusText}>Searching…</div>
          ) : search.trim() && results.length === 0 ? (
            <div className={css.statusText}>No RFQ packages found</div>
          ) : results.length > 0 ? (
            <div className={css.resultsList}>
              {results.map((pkg) => {
                const meta = buildMeta(pkg);
                return (
                  <button
                    key={pkg.$primaryKey}
                    className={css.resultRow}
                    onClick={() => handleSelect(pkg)}
                  >
                    <span className={css.resultName}>
                      {pkg.packageName ?? "[Unnamed Package]"}
                    </span>
                    {meta && <span className={css.resultMeta}>{meta}</span>}
                    <span className={css.resultId}>{String(pkg.$primaryKey)}</span>
                  </button>
                );
              })}
            </div>
          ) : !search.trim() ? (
            <div className={css.statusText}>Type to search for an RFQ package</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default LinkToRfqModal;
