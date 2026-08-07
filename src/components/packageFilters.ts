/**
 * Shared filter types and constants used across the pending-package and
 * assignment views. Lives in its own module (rather than co-located with
 * PendingRfqPackageList) so that the component file only exports React
 * components — this keeps Vite's Fast Refresh working correctly. See the
 * `react-refresh/only-export-components` ESLint rule.
 */

export interface Filters {
  dueDateStart: string;
  dueDateEnd: string;
  subjectSearch: string;
  customerSearch: string;
  platformSearch: string;
  senderSearch: string;
  selectedTags: string[];
  hasParsedTools: boolean;
  /**
   * Employee primary keys (RfqPackage.assignedTo values). A package matches
   * the filter if the RFQ Package it's linked to has `assignedTo` in this set.
   * The special value `ASSIGNED_TO_UNASSIGNED` matches packages with no linked
   * RFQ Package or a linked RFQ Package with a null/empty `assignedTo`.
   */
  assignedToIds: string[];
}

/** Sentinel value inserted into `assignedToIds` to represent "unassigned". */
export const ASSIGNED_TO_UNASSIGNED = "__unassigned__";

/** An empty `Filters` value — every field cleared/unset. */
export const EMPTY_FILTERS: Filters = {
  dueDateStart: "",
  dueDateEnd: "",
  subjectSearch: "",
  customerSearch: "",
  platformSearch: "",
  senderSearch: "",
  selectedTags: [],
  hasParsedTools: false,
  assignedToIds: [],
};
