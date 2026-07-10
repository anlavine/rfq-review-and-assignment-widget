import React, { useEffect, useRef, useState } from "react";
import css from "./MultiSelectDropdown.module.css";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectDropdownProps {
  options: MultiSelectOption[];
  selectedValues: string[];
  onChange: (nextValues: string[]) => void;
  placeholder?: string;
  emptyMessage?: string;
  /** Optional search box shown at the top of the panel */
  searchable?: boolean;
  disabled?: boolean;
  /** Optional short summary to render inline (e.g. "3 selected") — overrides default */
  summaryOverride?: string;
}

/**
 * Compact, self-contained multi-select dropdown suitable for use inside another
 * dropdown/popover (like the FilterDropdown). Renders in-line so the parent
 * popover keeps its own outside-click / focus semantics.
 */
function MultiSelectDropdown({
  options,
  selectedValues,
  onChange,
  placeholder = "Select…",
  emptyMessage = "No options",
  searchable = false,
  disabled = false,
  summaryOverride,
}: MultiSelectDropdownProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const selectedSet = new Set(selectedValues);
  const filteredOptions = searchable && search.trim() !== ""
    ? options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  const toggleValue = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selectedValues.filter((v) => v !== value));
    } else {
      onChange([...selectedValues, value]);
    }
  };

  const summary = (() => {
    if (summaryOverride !== undefined) return summaryOverride;
    if (selectedValues.length === 0) return placeholder;
    if (selectedValues.length === 1) {
      const opt = options.find((o) => o.value === selectedValues[0]);
      return opt?.label ?? selectedValues[0];
    }
    return `${selectedValues.length} selected`;
  })();

  return (
    <div className={css.wrapper} ref={wrapperRef}>
      <button
        type="button"
        className={`${css.trigger} ${selectedValues.length > 0 ? css.triggerActive : ""}`}
        onClick={() => !disabled && setOpen((p) => !p)}
        disabled={disabled}
      >
        <span className={css.triggerLabel}>{summary}</span>
        <span className={css.triggerCaret}>▾</span>
      </button>
      {open && (
        <div className={css.panel}>
          {searchable && (
            <input
              type="text"
              className={css.search}
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          )}
          <div className={css.list}>
            {filteredOptions.length === 0 ? (
              <div className={css.empty}>{emptyMessage}</div>
            ) : (
              filteredOptions.map((opt) => (
                <label key={opt.value} className={css.option}>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(opt.value)}
                    onChange={() => toggleValue(opt.value)}
                  />
                  <span className={css.optionLabel}>{opt.label}</span>
                </label>
              ))
            )}
          </div>
          {selectedValues.length > 0 && (
            <div className={css.footer}>
              <button
                type="button"
                className={css.clearAll}
                onClick={() => onChange([])}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default MultiSelectDropdown;
