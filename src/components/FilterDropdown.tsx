import React, { useState, useRef, useEffect } from "react";
import css from "./FilterDropdown.module.css";
import type { Filters } from "./PendingRfqPackageList";

interface FilterDropdownProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}

function FilterDropdown({ filters, onFiltersChange }: FilterDropdownProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [localFilters, setLocalFilters] = useState<Filters>(filters);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Sync local state when external filters change
  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const hasActiveFilters =
    filters.dueDateStart !== "" ||
    filters.dueDateEnd !== "" ||
    filters.customerSearch !== "" ||
    filters.hasParsedTools;

  const handleApply = () => {
    onFiltersChange(localFilters);
    setOpen(false);
  };

  const handleClear = () => {

    const cleared: Filters = { dueDateStart: "", dueDateEnd: "", customerSearch: "", hasParsedTools: false };
    setLocalFilters(cleared);
    onFiltersChange(cleared);
    setOpen(false);
  };

  return (
    <div className={css.wrapper} ref={dropdownRef}>
      <button
        className={`${css.trigger} ${hasActiveFilters ? css.triggerActive : ""}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        Filters{hasActiveFilters && " ●"}
      </button>

      {open && (
        <div className={css.dropdown}>
          <div className={css.section}>
            <label className={css.label} htmlFor="filter-due-start">Due Date — Start</label>
            <input
              id="filter-due-start"
              type="date"
              className={css.input}
              value={localFilters.dueDateStart}
              onChange={(e) => setLocalFilters((f) => ({ ...f, dueDateStart: e.target.value }))}
            />
          </div>

          <div className={css.section}>
            <label className={css.label} htmlFor="filter-due-end">Due Date — End</label>
            <input
              id="filter-due-end"
              type="date"
              className={css.input}
              value={localFilters.dueDateEnd}
              onChange={(e) => setLocalFilters((f) => ({ ...f, dueDateEnd: e.target.value }))}
            />
          </div>

          <div className={css.section}>
            <label className={css.label} htmlFor="filter-customer">Customer</label>
            <input
              id="filter-customer"
              type="text"
              className={css.input}
              placeholder="Search customer name…"
              value={localFilters.customerSearch}
              onChange={(e) => setLocalFilters((f) => ({ ...f, customerSearch: e.target.value }))}
            />
          </div>

          <div className={css.section}>
            <label className={css.checkboxLabel}>
              <input
                type="checkbox"
                checked={localFilters.hasParsedTools}
                onChange={(e) => setLocalFilters((f) => ({ ...f, hasParsedTools: e.target.checked }))}
              />
              Has Parsed Tools
            </label>
          </div>

          <div className={css.actions}>
            <button className={css.clearButton} onClick={handleClear}>
              Clear
            </button>
            <button className={css.applyButton} onClick={handleApply}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default FilterDropdown;
