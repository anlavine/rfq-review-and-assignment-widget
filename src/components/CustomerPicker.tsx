import React, { useState, useEffect, useRef } from "react";
import { CustomerV2 } from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import type { Osdk } from "@osdk/client";
import css from "./CustomerPicker.module.css";

interface CustomerPickerProps {
  onSelect: (customer: { primaryKey: string; name: string }) => void;
  onCancel: () => void;
}

function CustomerPicker({ onSelect, onCancel }: CustomerPickerProps): React.ReactElement {
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<Osdk.Instance<CustomerV2>[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fetch customers matching the search term
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!search.trim()) {
      setCustomers([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const term = search.trim().toLowerCase();
      try {
        // Use startsWith for partial/prefix matching
        const page = await client(CustomerV2)
          .where({
            customerName: { $startsWith: term },
          })
          .fetchPage({
            $pageSize: 50,
            $orderBy: { customerName: "asc" },
          });

        // Also fetch contains matches to catch mid-string hits
        const containsPage = await client(CustomerV2)
          .where({
            customerName: { $containsAnyTerm: term },
          })
          .fetchPage({
            $pageSize: 50,
            $orderBy: { customerName: "asc" },
          });

        // Merge results: startsWith first, then contains (deduped)
        const seen = new Set<string>();
        const merged: Osdk.Instance<CustomerV2>[] = [];
        for (const c of [...page.data, ...containsPage.data]) {
          const key = String(c.$primaryKey);
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(c);
          }
        }

        // Sort: names starting with the search term first, then alphabetical
        merged.sort((a, b) => {
          const aName = (a.customerName ?? "").toLowerCase();
          const bName = (b.customerName ?? "").toLowerCase();
          const aStarts = aName.startsWith(term) ? 0 : 1;
          const bStarts = bName.startsWith(term) ? 0 : 1;
          if (aStarts !== bStarts) return aStarts - bStarts;
          return aName.localeCompare(bName);
        });

        setCustomers(merged.slice(0, 20));
      } catch (e) {
        console.error("Failed to search customers:", e);
        setCustomers([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onCancel]);

  const showDropdown = focused && search.trim().length > 0;

  return (
    <div className={css.wrapper} ref={wrapperRef}>
      <input
        ref={inputRef}
        type="text"
        className={css.input}
        placeholder="Search customers…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => setFocused(true)}
      />
      <button className={css.cancelButton} onClick={onCancel}>
        Cancel
      </button>
      {showDropdown && (
        <div className={css.dropdown}>
          {loading ? (
            <div className={css.dropdownItem}>Searching…</div>
          ) : customers.length === 0 ? (
            <div className={css.dropdownItem}>No customers found</div>
          ) : (
            customers.map((c) => (
              <button
                key={c.$primaryKey}
                className={css.dropdownOption}
                onClick={() =>
                  onSelect({
                    primaryKey: String(c.$primaryKey),
                    name: c.customerName ?? "Unknown",
                  })
                }
              >
                {c.customerName ?? "Unknown"}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default CustomerPicker;
