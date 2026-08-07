import React, { useState, useRef, useEffect, useMemo } from "react";
import css from "./FilterDropdown.module.css";
import { type Filters, ASSIGNED_TO_UNASSIGNED, EMPTY_FILTERS } from "./packageFilters";
import { trackUsage, INTERACTION_KEYS, type Workspace } from "../utils/trackUsage";
import MultiSelectDropdown, { type MultiSelectOption } from "./MultiSelectDropdown";
import { useEligibleEstimators } from "../hooks/useEligibleEstimators";

const AVAILABLE_TAGS = [
  "Targets",
  "Waiting for Data",
  "Repeat Request",
  "Duplicate",
  "Update Quote",
  "No Quote",
];

const TAG_OPTIONS: MultiSelectOption[] = AVAILABLE_TAGS.map((t) => ({ value: t, label: t }));

interface FilterDropdownProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  /** Workspace identifier for usage tracking on filter application. */
  workspace?: Workspace | null;
}

function FilterDropdown({ filters, onFiltersChange, workspace }: FilterDropdownProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [localFilters, setLocalFilters] = useState<Filters>(filters);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const { estimators, loading: estimatorsLoading } = useEligibleEstimators();

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
    filters.subjectSearch !== "" ||
    filters.customerSearch !== "" ||
    filters.platformSearch !== "" ||
    filters.senderSearch !== "" ||
    filters.selectedTags.length > 0 ||
    filters.hasParsedTools ||
    filters.assignedToIds.length > 0;

  const assignedToOptions = useMemo<MultiSelectOption[]>(() => {
    const opts: MultiSelectOption[] = [
      { value: ASSIGNED_TO_UNASSIGNED, label: "Unassigned" },
      ...estimators.map((e) => ({ value: e.id, label: e.name })),
    ];
    return opts;
  }, [estimators]);

  const handleApply = () => {
    onFiltersChange(localFilters);
    // Track which filters were applied
    if (localFilters.dueDateStart || localFilters.dueDateEnd) trackUsage(INTERACTION_KEYS.FILTER_DUE_DATE, workspace);
    if (localFilters.subjectSearch) trackUsage(INTERACTION_KEYS.FILTER_SUBJECT, workspace);
    if (localFilters.customerSearch) trackUsage(INTERACTION_KEYS.FILTER_CUSTOMER, workspace);
    if (localFilters.platformSearch) trackUsage(INTERACTION_KEYS.FILTER_PLATFORM, workspace);
    if (localFilters.senderSearch) trackUsage(INTERACTION_KEYS.FILTER_SENDER, workspace);
    if (localFilters.selectedTags.length > 0) trackUsage(INTERACTION_KEYS.FILTER_TAGS, workspace);
    if (localFilters.hasParsedTools) trackUsage(INTERACTION_KEYS.FILTER_HAS_PARSED_TOOLS, workspace);
    if (localFilters.assignedToIds.length > 0) trackUsage(INTERACTION_KEYS.FILTER_ASSIGNED_TO, workspace);
    setOpen(false);
  };

  const handleClear = () => {
    setLocalFilters(EMPTY_FILTERS);
    onFiltersChange(EMPTY_FILTERS);
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
          <div className={css.sections}>
            <div className={css.section}>
              <label className={css.label} htmlFor="filter-subject">Subject Keyword</label>
              <input
                id="filter-subject"
                type="text"
                className={css.input}
                placeholder="Search subject…"
                value={localFilters.subjectSearch}
                onChange={(e) => setLocalFilters((f) => ({ ...f, subjectSearch: e.target.value }))}
              />
            </div>

            <div className={css.section}>
              <label className={css.label} htmlFor="filter-sender">Sender</label>
              <input
                id="filter-sender"
                type="text"
                className={css.input}
                placeholder="Search name or email…"
                value={localFilters.senderSearch}
                onChange={(e) => setLocalFilters((f) => ({ ...f, senderSearch: e.target.value }))}
              />
            </div>

            <div className={css.section}>
              <span className={css.label}>Tags</span>
              <MultiSelectDropdown
                options={TAG_OPTIONS}
                selectedValues={localFilters.selectedTags}
                onChange={(next) => setLocalFilters((f) => ({ ...f, selectedTags: next }))}
                placeholder="Any tag"
              />
            </div>

            <div className={css.section}>
              <span className={css.label}>Assigned To</span>
              <MultiSelectDropdown
                options={assignedToOptions}
                selectedValues={localFilters.assignedToIds}
                onChange={(next) => setLocalFilters((f) => ({ ...f, assignedToIds: next }))}
                placeholder={estimatorsLoading ? "Loading…" : "Any assignee"}
                searchable
                disabled={estimatorsLoading && assignedToOptions.length === 1}
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
              <label className={css.label} htmlFor="filter-platform">Platform</label>
              <input
                id="filter-platform"
                type="text"
                className={css.input}
                placeholder="Search platform…"
                value={localFilters.platformSearch}
                onChange={(e) => setLocalFilters((f) => ({ ...f, platformSearch: e.target.value }))}
              />
            </div>

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
              <label className={css.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={localFilters.hasParsedTools}
                  onChange={(e) => setLocalFilters((f) => ({ ...f, hasParsedTools: e.target.checked }))}
                />
                Has Parsed Tools
              </label>
            </div>
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
