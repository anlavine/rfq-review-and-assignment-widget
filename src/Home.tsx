import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import css from "./Home.module.css";
import PendingRfqPackageList from "./components/PendingRfqPackageList";
import { EMPTY_FILTERS } from "./components/packageFilters";
import type { TabKey, MergeStep, SplitStep, ExcludeFromAutoSelect, BulkSkipMode, PendingRfqPackageListHandle } from "./components/PendingRfqPackageList";
import type { Filters } from "./components/packageFilters";
import BulkSkipConfirmModal from "./components/BulkSkipConfirmModal";
import MergeConfirmModal from "./components/MergeConfirmModal";
import SplitPackageModal from "./components/SplitPackageModal";
import LinkToRfqModal from "./components/LinkToRfqModal";
import FilterDropdown from "./components/FilterDropdown";
import PackageDetail from "./components/PackageDetail";
import { PendingRfqPackage, RfqPackage, skipPackageReview, unskipPackageReview, markPackageForReview, reviewPackage, editRfqPackagePrivilegedFields } from "@rfq-review-hub-widget-application/sdk";
import client from "./client";
import { compareToolNumber } from "./utils/sortTools";
import EditTagsModal from "./components/EditTagsModal";
import FeedbackModal from "./components/FeedbackModal";
import ReviewPanel from "./components/ReviewPanel";
import AssignmentPackageList from "./components/AssignmentPackageList";
import type { AssignmentPackageListHandle } from "./components/AssignmentPackageList";
import CompletedPackageList from "./components/CompletedPackageList";
import type { CompletedPackageListHandle } from "./components/CompletedPackageList";
import AssignmentPendingPackageDetail from "./components/AssignmentPendingPackageDetail";
import AssignmentRfqPackageDetail from "./components/AssignmentRfqPackageDetail";
import AssignToModal from "./components/AssignToModal";
import EstimatorWorkloadScorecard from "./components/EstimatorWorkloadScorecard";
import type { EstimatorWorkloadScorecardHandle } from "./components/EstimatorWorkloadScorecard";
import { useWorkshop, type WorkshopContext } from "./useWorkshop";
import { useTheme } from "./ThemeContext";
import { trackUsage, INTERACTION_KEYS, WORKSPACES, type Workspace } from "./utils/trackUsage";

import { isAsyncValue_Loaded } from "@osdk/workshop-iframe-custom-widget";

function Home(): React.ReactElement {
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<TabKey>("outstanding");
  const [actionLoading, setActionLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedPackageStatus, setSelectedPackageStatus] = useState<string | null>(null);
  const [showEditTags, setShowEditTags] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [createPackageLoading, setCreatePackageLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [assignmentFilters, setAssignmentFilters] = useState<Filters>(EMPTY_FILTERS);
  const [mergeStep, setMergeStep] = useState<MergeStep>(null);
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  const [mergeSourceName, setMergeSourceName] = useState<string>("");
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [mergeTargetName, setMergeTargetName] = useState<string>("");
  const [splitStep, setSplitStep] = useState<SplitStep>(null);
  const [splitPackageId, setSplitPackageId] = useState<string | null>(null);
  const [splitPackageName, setSplitPackageName] = useState<string>("");
  const [showLinkToRfq, setShowLinkToRfq] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [excludeFromAutoSelect, setExcludeFromAutoSelect] = useState<ExcludeFromAutoSelect>([]);
  const [bulkSkipMode, setBulkSkipMode] = useState<BulkSkipMode>(false);
  const [bulkSkipSelected, setBulkSkipSelected] = useState<string[]>([]);
  const [showBulkSkipConfirm, setShowBulkSkipConfirm] = useState(false);
  const [appMode, setAppMode] = useState<"ingestion" | "assignment">("ingestion");
  const showAssignmentTab = true;
  /**
   * Current sort mode of the Outstanding tab in the Ingestion list. Kept in
   * sync with the child `PendingRfqPackageList` via its
   * `onOutstandingSortChange` callback so we can pass the correct
   * `workspace` value to usage-tracking calls made from the Ingestion view.
   * Defaults to "priority" to match the child's default.
   */
  const [outstandingSort, setOutstandingSort] = useState<"dueDate" | "priority">("priority");
  const [assignmentTab, setAssignmentTab] = useState<"all" | "unassigned" | "assigned" | "completed">("all");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [selectedAssignmentType, setSelectedAssignmentType] = useState<"pending" | "rfq" | null>(null);
  /**
   * For an RFQ selection, the id of its linked Pending package (or `null`
   * if there isn't one). Lets Edit Tags work on an RFQ selection by editing
   * the tags of the underlying Pending package instead. Always `null` for
   * a Pending selection (Edit Tags then just uses `selectedAssignmentId` directly).
   */
  const [selectedAssignmentLinkedPendingId, setSelectedAssignmentLinkedPendingId] = useState<string | null>(null);
  const [showAssignTo, setShowAssignTo] = useState(false);
  /**
   * Session-local set of package IDs that were just assigned via the
   * Assign To modal from the Unassigned tab. Hides them from the
   * Unassigned list without a full refetch.
   */
  const [assignedInSession, setAssignedInSession] = useState<Set<string>>(new Set());
  /**
   * Session-local set of package/RFQ Package IDs marked done via "Mark as
   * Done". A done item no longer matches any Assignment tab's Active-only
   * query, so it's hidden from all three (all/unassigned/assigned) without
   * a full refetch.
   */
  const [doneInSession, setDoneInSession] = useState<Set<string>>(new Set());
  /**
   * Session-local overrides for `assigneeId` on the Assigned tab.
   * When a package is reassigned it should stay in the list but reflect
   * the new assignee. Keyed by package primary key.
   */
  const [assigneeOverrides, setAssigneeOverrides] = useState<Record<string, string | null>>({});
  /**
   * Session-local overrides for `dueDate` in the Assignment tab. When a due
   * date is saved from the detail view, we update this map so the list
   * reflects it immediately without a full refetch.
   */
  const [dueDateOverrides, setDueDateOverrides] = useState<Record<string, string | null>>({});
  /**
   * Session-local overrides for `dueDateEdited` in the Assignment tab —
   * always set to `true` alongside a due-date save, so the item re-buckets
   * out of "Due Date Pending" immediately without a full refetch.
   */
  const [dueDateEditedOverrides, setDueDateEditedOverrides] = useState<Record<string, boolean>>({});
  const handleAssignmentDueDateSaved = useCallback((packageId: string, newDueDate: string | null) => {
    setDueDateOverrides((prev) => ({ ...prev, [packageId]: newDueDate }));
    setDueDateEditedOverrides((prev) => ({ ...prev, [packageId]: true }));
  }, []);
  /** Fire-and-forget "Mark due date reviewed" — sets only `dueDateEdited`, leaving `dueDate` untouched. */
  const handleAssignmentDueDateReviewed = useCallback((packageId: string) => {
    setDueDateEditedOverrides((prev) => ({ ...prev, [packageId]: true }));
  }, []);
  const handleAssignmentDueDateReviewFailed = useCallback((packageId: string, message: string) => {
    setDueDateEditedOverrides((prev) => {
      if (!(packageId in prev)) return prev;
      const next = { ...prev };
      delete next[packageId];
      return next;
    });
    setErrorToastMessage(message);
  }, []);

  /**
   * "Mark as Done" — fire-and-forget: a Pending package moves to
   * "Reviewed" (via reviewPackage), an RFQ Package moves to "Completed"
   * (via editRfqPackagePrivilegedFields). Either way it no longer matches
   * any Assignment tab's Active-only query, so it's hidden immediately
   * rather than waiting on the action call. On failure the optimistic hide
   * is undone and the failure is surfaced via the error toast, since the
   * selection may already be gone by the time it resolves.
   */
  const handleMarkAsDone = useCallback((packageId: string, packageType: "pending" | "rfq") => {
    setDoneInSession((prev) => new Set(prev).add(packageId));
    setSelectedAssignmentId(null);
    setSelectedAssignmentType(null);
    setSelectedAssignmentLinkedPendingId(null);
    trackUsage(INTERACTION_KEYS.PACKAGE_MARK_AS_DONE, workspaceRef.current);

    (async () => {
      try {
        if (packageType === "pending") {
          const pkg = await client(PendingRfqPackage).fetchOne(packageId);
          await client(reviewPackage).applyAction(
            { pending_rfq_package: pkg, rfq_package_id: null },
            { $returnEdits: true },
          );
        } else {
          const rfqPkg = await client(RfqPackage).fetchOne(packageId);
          await client(editRfqPackagePrivilegedFields).applyAction(
            // assignedTo/priority are required by the action signature but
            // irrelevant here — the underlying Foundry function accepts
            // them as no-ops when unset (same pattern as AssignToModal.tsx).
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { rfqPackage: rfqPkg, status: "Completed" } as unknown as any,
            { $returnEdits: true },
          );
          // Needs fresh (post-write) data to build the row, so this happens
          // after the action confirms rather than optimistically alongside
          // `doneInSession` above.
          completedListRef.current?.markRfqCompleted(packageId);
        }
      } catch (e) {
        console.error("Failed to mark package as done:", e);
        setDoneInSession((prev) => {
          const next = new Set(prev);
          next.delete(packageId);
          return next;
        });
        setErrorToastMessage(e instanceof Error ? e.message : "Failed to mark package as done");
      }
    })();
  }, []);
  const { theme, toggleTheme } = useTheme();

  /** Ref to PendingRfqPackageList for optimistic updates */
  const listRef = useRef<PendingRfqPackageListHandle>(null);

  /** Ref to AssignmentPackageList for optimistic tag updates */
  const assignmentListRef = useRef<AssignmentPackageListHandle>(null);

  /** Ref to CompletedPackageList for optimistic tag updates */
  const completedListRef = useRef<CompletedPackageListHandle>(null);

  /** Ref to EstimatorWorkloadScorecard for cache-based workload-count updates after an assignment, instead of a full refetch */
  const estimatorWorkloadRef = useRef<EstimatorWorkloadScorecardHandle>(null);

  /**
   * Set when a fire-and-forget background action fails after its optimistic
   * UI update has already been applied (assignment via AssignToModal, or
   * marking a due date reviewed) — surfaces the failure and lets the caller
   * revert its own optimistic state.
   */
  const [errorToastMessage, setErrorToastMessage] = useState<string | null>(null);

  /**
   * Workspace identifier for usage tracking. Ingestion view value depends on
   * the currently-active sort tab of the Outstanding list; assignment view is
   * a fixed value. Any interaction — whether initiated from the list, the
   * header buttons, or the package detail — inherits whichever value is
   * current at the moment `trackUsage` runs.
   *
   * A ref is kept in sync so `useCallback`-wrapped handlers can read the
   * latest value without needing `currentWorkspace` in their dependency
   * arrays.
   */
  const currentWorkspace: Workspace =
    appMode === "assignment"
      ? WORKSPACES.ASSIGNMENT
      : outstandingSort === "dueDate"
        ? WORKSPACES.INGESTION_DATE
        : WORKSPACES.INGESTION_PRIORITY;
  /**
   * The package Edit Tags should actually operate on for the current
   * Assignment selection: the selection itself when it's a Pending
   * package; its linked Pending package when it's an RFQ package that has
   * one; or the RFQ package itself (via `editTagsRfqPackage`) when it has
   * no linked Pending package. `null` when nothing is selected.
   */
  const assignmentEditTagsTarget: { packageId: string; packageType: "pending" | "rfq" } | null =
    selectedAssignmentType === "pending" && selectedAssignmentId
      ? { packageId: selectedAssignmentId, packageType: "pending" }
      : selectedAssignmentType === "rfq" && selectedAssignmentId
        ? selectedAssignmentLinkedPendingId
          ? { packageId: selectedAssignmentLinkedPendingId, packageType: "pending" }
          : { packageId: selectedAssignmentId, packageType: "rfq" }
        : null;
  /**
   * Ids to hide from the Assignment list — items marked done (all three
   * tabs) plus, on the Unassigned tab only, items assigned this session.
   */
  const assignmentHiddenIds = useMemo(() => {
    if (assignmentTab === "unassigned") {
      return new Set([...assignedInSession, ...doneInSession]);
    }
    return doneInSession;
  }, [assignmentTab, assignedInSession, doneInSession]);
  const workspaceRef = useRef<Workspace>(currentWorkspace);
  useEffect(() => {
    workspaceRef.current = currentWorkspace;
  }, [currentWorkspace]);

  // Workshop integration — hook is always called, but context is only
  // meaningful when the app is embedded as a Bidirectional Iframe widget.
  const workshopContextAsync = useWorkshop();
  const workshopContext: WorkshopContext | null =
    isAsyncValue_Loaded(workshopContextAsync)
      ? workshopContextAsync.value
      : null;

  // On mount (or when Workshop context becomes available), restore the
  // selectedPackageId from the Workshop variable so that navigating back
  // to this iframe tab re-selects the previously chosen package.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !workshopContext) return;
    const fieldValue = workshopContext.selectedPackageId.fieldValue;
    if (isAsyncValue_Loaded(fieldValue) && fieldValue.value) {
      restoredRef.current = true;
      setSelectedPackageId(fieldValue.value);
    }
  }, [workshopContext]);

  const handleFirstPackageReady = useCallback((packageId: string, completionStatus?: string) => {
    // Auto-select the first package in the list when no package is selected.
    // Skip if Workshop already restored a selection.
    if (restoredRef.current) return;
    setSelectedPackageId(packageId);
    setSelectedPackageStatus(completionStatus ?? null);
    // Clear exclude list once a new selection has been made
    setExcludeFromAutoSelect([]);
  }, []);

  const handleSelectPackage = useCallback((packageId: string, completionStatus?: string) => {
    setSelectedPackageId((prev) => {
      if (prev === packageId) {
        setSelectedPackageStatus(null);
        return null;
      }
      setSelectedPackageStatus(completionStatus ?? null);
      return packageId;
    });
  }, []);

  const handleSkip = useCallback(async () => {
    if (!selectedPackageId || actionLoading) return;
    setActionLoading(true);
    try {
      const skippedId = selectedPackageId;
      const pkg = await client(PendingRfqPackage).fetchOne(skippedId);
      await client(skipPackageReview).applyAction(
        { pending_rfq_package: pkg },
        { $returnEdits: true },
      );
      trackUsage(INTERACTION_KEYS.PACKAGE_SKIP, workspaceRef.current);
      // Optimistic update: move package to "Skipped" in local state
      listRef.current?.updatePackageStatus(skippedId, "Skipped");
      setExcludeFromAutoSelect((prev) => [...prev, skippedId]);
      setSelectedPackageId(null);
    } catch (e) {
      console.error("Failed to skip package:", e);
    } finally {
      setActionLoading(false);
    }
  }, [selectedPackageId, actionLoading]);

  /**
   * "Skip and Review" — fire-and-forget: the package leaves Outstanding the
   * instant this is clicked (optimistic status update + deselect), rather
   * than waiting on the action call. The actual markPackageForReview call
   * runs in the background; on failure the optimistic status is reverted
   * back to "Active" (the only status this button is ever shown for) and
   * the failure is surfaced via the error toast, since the package may
   * already be out of view by the time it resolves.
   */
  const handleSkipAndReview = useCallback((packageId: string) => {
    listRef.current?.updatePackageStatus(packageId, "Under Review");
    setExcludeFromAutoSelect((prev) => [...prev, packageId]);
    setSelectedPackageId(null);
    trackUsage(INTERACTION_KEYS.PACKAGE_SKIP_AND_REVIEW, workspaceRef.current);

    (async () => {
      try {
        const pkg = await client(PendingRfqPackage).fetchOne(packageId);
        await client(markPackageForReview).applyAction(
          { pending_rfq_package: pkg },
          { $returnEdits: true },
        );
      } catch (e) {
        console.error("Failed to mark package for review:", e);
        listRef.current?.updatePackageStatus(packageId, "Active");
        setErrorToastMessage(e instanceof Error ? e.message : "Failed to mark package for review");
      }
    })();
  }, []);

  const handleUnskip = useCallback(async () => {
    if (!selectedPackageId || actionLoading) return;
    setActionLoading(true);
    try {
      const pkg = await client(PendingRfqPackage).fetchOne(selectedPackageId);
      await client(unskipPackageReview).applyAction(
        { pending_rfq_package: pkg },
        { $returnEdits: true },
      );
      trackUsage(INTERACTION_KEYS.PACKAGE_UNSKIP, workspaceRef.current);
      // Optimistic update: move package to "Active" in local state
      listRef.current?.updatePackageStatus(selectedPackageId, "Active");
      setSelectedPackageId(null);
    } catch (e) {
      console.error("Failed to unskip package:", e);
    } finally {
      setActionLoading(false);
    }
  }, [selectedPackageId, actionLoading]);

  const handleMarkOutstanding = useCallback(async () => {
    if (!selectedPackageId || actionLoading) return;
    setActionLoading(true);
    try {
      const pkg = await client(PendingRfqPackage).fetchOne(selectedPackageId);
      await client(unskipPackageReview).applyAction(
        { pending_rfq_package: pkg },
        { $returnEdits: true },
      );
      trackUsage(INTERACTION_KEYS.PACKAGE_MARK_OUTSTANDING, workspaceRef.current);
      // Optimistic update: move package to "Active" in local state
      listRef.current?.updatePackageStatus(selectedPackageId, "Active");
      setSelectedPackageId(null);
    } catch (e) {
      console.error("Failed to mark package as outstanding:", e);
    } finally {
      setActionLoading(false);
    }
  }, [selectedPackageId, actionLoading]);

  /**
   * "Create Package" handler:
   * 1. Fetches the linked tool IDs, part IDs, and manifold IDs for the selected package.
   * 2. Sets Workshop variables (selectedPackageId, selectedToolIds, selectedPartIds, selectedManifoldIds).
   * 3. Fires the createPackageEvent so Workshop can react (e.g., switch tabs).
   */
  const handleCreatePackage = useCallback(async () => {
    if (!selectedPackageId) return;
    setCreatePackageLoading(true);
    try {
      // Fetch tools for this package, sorted by customerToolNumber
      const toolPage = await client(PendingRfqPackage)
        .where({ packageId: { $eq: selectedPackageId } })
        .pivotTo("pendingRfqPackageTools")
        .fetchPage({ $pageSize: 200 });
      const tools = [...toolPage.data].sort((a, b) =>
        compareToolNumber(a.customerToolNumber, b.customerToolNumber, a.toolNumber, b.toolNumber),
      );
      // Exclude removed tools
      const activeTools = tools.filter((t) => !t.removed);
      const toolIds = activeTools
        .map((t) => t.toolId)
        .filter((id): id is string => id != null);

      // Fetch parts and manifolds for all active tools in parallel
      const linkedResults = await Promise.all(
        activeTools.map(async (tool) => {
          const [parts, manifolds] = await Promise.all([
            (async () => {
              try {
                const page = await tool.$link.pendingRfqPackageParts.fetchPage({ $pageSize: 200 });
                return page.data;
              } catch {
                return [];
              }
            })(),
            (async () => {
              try {
                const page = await tool.$link.pendingRfqPackageManifolds.fetchPage({ $pageSize: 200 });
                return page.data;
              } catch {
                return [];
              }
            })(),
          ]);
          return { parts, manifolds };
        }),
      );

      const partIds = linkedResults
        .flatMap((r) => r.parts)
        .map((p) => p.partId)
        .filter((id): id is string => id != null);
      const manifoldIds = linkedResults
        .flatMap((r) => r.manifolds)
        .map((m) => m.manifoldId)
        .filter((id): id is string => id != null);

      if (workshopContext) {
        // Set Workshop variables
        workshopContext.selectedPackageId.setLoadedValue(selectedPackageId);
        workshopContext.selectedToolIds.setLoadedValue(toolIds);
        workshopContext.selectedPartIds.setLoadedValue(partIds);
        workshopContext.selectedManifoldIds.setLoadedValue(manifoldIds);
        // Fire the Workshop event
        workshopContext.createPackageEvent.executeEvent(undefined);
        trackUsage(INTERACTION_KEYS.PACKAGE_CREATE, workspaceRef.current);
      } else {
        // Not inside Workshop — log for debugging
        console.log("Create Package (standalone mode):", {
          packageId: selectedPackageId,
          toolIds,
          partIds,
          manifoldIds,
        });
      }
    } catch (e) {
      console.error("Failed to create package:", e);
    } finally {
      setCreatePackageLoading(false);
    }
  }, [selectedPackageId, workshopContext]);

  const handleStartBulkSkip = useCallback(() => {
    setBulkSkipMode(true);
    setBulkSkipSelected([]);
  }, []);

  const handleCancelBulkSkip = useCallback(() => {
    setBulkSkipMode(false);
    setBulkSkipSelected([]);
  }, []);

  const handleBulkSkipToggle = useCallback((packageId: string) => {
    setBulkSkipSelected((prev) =>
      prev.includes(packageId)
        ? prev.filter((id) => id !== packageId)
        : [...prev, packageId],
    );
  }, []);

  const handleBulkSkipSelectAll = useCallback((ids: string[]) => {
    setBulkSkipSelected(ids);
  }, []);

  const handleBulkSkipDeselectAll = useCallback(() => {
    setBulkSkipSelected([]);
  }, []);

  const handleBulkSkipComplete = useCallback(() => {
    setShowBulkSkipConfirm(false);
    trackUsage(INTERACTION_KEYS.PACKAGE_BULK_SKIP, workspaceRef.current);
    // Optimistic update: mark all selected packages as "Skipped"
    for (const pkgId of bulkSkipSelected) {
      listRef.current?.updatePackageStatus(pkgId, "Skipped");
    }
    setExcludeFromAutoSelect((prev) => [...prev, ...bulkSkipSelected]);
    setBulkSkipMode(false);
    setBulkSkipSelected([]);
    setSelectedPackageId(null);
  }, [bulkSkipSelected]);

  const handleStartMerge = useCallback(() => {
    setMergeStep("selectSource");
    setMergeSourceId(null);
    setMergeSourceName("");
    setMergeTargetId(null);
    setMergeTargetName("");
  }, []);

  const handleCancelMerge = useCallback(() => {
    setMergeStep(null);
    setMergeSourceId(null);
    setMergeSourceName("");
    setMergeTargetId(null);
    setMergeTargetName("");
  }, []);

  const handleMergeSelect = useCallback((packageId: string, packageName: string) => {
    if (mergeStep === "selectSource") {
      setMergeSourceId(packageId);
      setMergeSourceName(packageName);
      setMergeStep("selectTarget");
    } else if (mergeStep === "selectTarget") {
      setMergeTargetId(packageId);
      setMergeTargetName(packageName);
      // Both selected — modal will show via state
    }
  }, [mergeStep]);

  const handleMergeComplete = useCallback(() => {
    trackUsage(INTERACTION_KEYS.PACKAGE_MERGE, workspaceRef.current);
    handleCancelMerge();
    setSelectedPackageId(null);
    setSelectedPackageStatus(null);
    setRefreshToken((t) => t + 1);
  }, [handleCancelMerge]);

  const handleStartSplit = useCallback(async () => {
    if (selectedPackageId) {
      // A package is already selected — use it directly
      try {
        const pkg = await client(PendingRfqPackage).fetchOne(selectedPackageId);
        const name = pkg.packageName ?? pkg.subject ?? "Unnamed Package";
        setSplitPackageId(selectedPackageId);
        setSplitPackageName(name);
      } catch {
        // Fallback: let the user pick manually
        setSplitStep("selectPackage");
        setSplitPackageId(null);
        setSplitPackageName("");
      }
    } else {
      setSplitStep("selectPackage");
      setSplitPackageId(null);
      setSplitPackageName("");
    }
  }, [selectedPackageId]);

  const handleCancelSplit = useCallback(() => {
    setSplitStep(null);
    setSplitPackageId(null);
    setSplitPackageName("");
  }, []);

  const handleSplitSelect = useCallback((packageId: string, packageName: string) => {
    setSplitPackageId(packageId);
    setSplitPackageName(packageName);
    // Modal will show via splitPackageId being set
  }, []);

  const handleSplitComplete = useCallback(() => {
    trackUsage(INTERACTION_KEYS.PACKAGE_SPLIT, workspaceRef.current);
    handleCancelSplit();
    setSelectedPackageId(null);
    setSelectedPackageStatus(null);
    setRefreshToken((t) => t + 1);
  }, [handleCancelSplit]);

  const showMergeConfirm = mergeSourceId !== null && mergeTargetId !== null;

  return (
      <div className={css.home}>
      {showAssignmentTab ?
      <div className={css.modeToggleBar}>
        <div className={css.modeToggleSpacer} />
        <div className={css.modeToggle}>
          <button
            className={`${css.modeToggleOption} ${appMode === "ingestion" ? css.modeToggleActive : ""}`}
            onClick={() => setAppMode("ingestion")}
          >
            Ingestion
          </button>
          <button
            className={`${css.modeToggleOption} ${appMode === "assignment" ? css.modeToggleActive : ""}`}
            onClick={() => setAppMode("assignment")}
          >
            Assignment
          </button>
        </div>
        <div className={css.globalActions}>
          <button
            className={css.feedbackButton}
            disabled={!(appMode === "assignment" ? selectedAssignmentId : selectedPackageId)}
            onClick={() => setShowFeedback(true)}
            title="Submit feedback"
          >
            <svg className={css.feedbackIcon} viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.5 2A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5v2.5l3.5-2.5H12.5A1.5 1.5 0 0 0 14 9.5v-6A1.5 1.5 0 0 0 12.5 2h-9ZM5 5.5a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM8 4.75a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Zm2.5.75a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM5.5 7.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1Z" />
            </svg>
          </button>
          <button
            className={css.themeToggle}
            onClick={() => { toggleTheme(); trackUsage(INTERACTION_KEYS.UI_TOGGLE_THEME, workspaceRef.current); }}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </div> : null}
      {/*
        Both view trees below (Assignment and Ingestion) always stay
        mounted, toggled via `display: none` rather than a ternary that
        would mount/unmount them — switching `appMode` back and forth would
        otherwise re-fetch everything from scratch every time (lost
        `allPackages`/`items` state, restarted Ingestion's background poll,
        etc.). Only one is ever interactive/visible at a time.
      */}
      <div className={css.panels} style={appMode === "assignment" ? undefined : { display: "none" }}>
          <div className={`${css.listPanel} ${css.listPanelWide}`}>
            <div className={css.assignmentTabBar}>
              <button
                className={`${css.assignmentTab} ${assignmentTab === "all" ? css.assignmentTabActive : ""}`}
                onClick={() => {
                  if (assignmentTab === "all") return;
                  setAssignmentTab("all");
                  setSelectedAssignmentId(null);
                  setSelectedAssignmentLinkedPendingId(null);
                  setSelectedAssignmentType(null);
                }}
              >
                All
              </button>
              <button
                className={`${css.assignmentTab} ${assignmentTab === "unassigned" ? css.assignmentTabActive : ""}`}
                onClick={() => {
                  if (assignmentTab === "unassigned") return;
                  setAssignmentTab("unassigned");
                  setSelectedAssignmentId(null);
                  setSelectedAssignmentLinkedPendingId(null);
                  setSelectedAssignmentType(null);
                }}
              >
                Unassigned
              </button>
              <button
                className={`${css.assignmentTab} ${assignmentTab === "assigned" ? css.assignmentTabActive : ""}`}
                onClick={() => {
                  if (assignmentTab === "assigned") return;
                  setAssignmentTab("assigned");
                  setSelectedAssignmentId(null);
                  setSelectedAssignmentLinkedPendingId(null);
                  setSelectedAssignmentType(null);
                }}
              >
                Assigned
              </button>
              <button
                className={`${css.assignmentTab} ${assignmentTab === "completed" ? css.assignmentTabActive : ""}`}
                onClick={() => {
                  if (assignmentTab === "completed") return;
                  setAssignmentTab("completed");
                  setSelectedAssignmentId(null);
                  setSelectedAssignmentLinkedPendingId(null);
                  setSelectedAssignmentType(null);
                }}
              >
                Completed
              </button>
            </div>
            {/*
              Both stay mounted (toggled via `display: none`) rather than a
              ternary, for the same reason as the Ingestion/Assignment split
              above — switching to/from the Completed tab would otherwise
              re-fetch and re-paginate everything from scratch every time,
              losing the Completed tab's search text and loaded pages.
            */}
            <div style={assignmentTab === "completed" ? undefined : { display: "none" }}>
              <CompletedPackageList
                ref={completedListRef}
                selectedId={selectedAssignmentId}
                onSelect={(id, type, linkedPendingId) => {
                  setSelectedAssignmentId(id);
                  setSelectedAssignmentType(type);
                  setSelectedAssignmentLinkedPendingId(linkedPendingId ?? null);
                }}
                assigneeOverrides={assigneeOverrides}
                dueDateOverrides={dueDateOverrides}
                refreshToken={refreshToken}
              />
            </div>
            <div style={assignmentTab === "completed" ? { display: "none" } : undefined}>
              <AssignmentPackageList
                ref={assignmentListRef}
                mode={assignmentTab === "completed" ? "all" : assignmentTab}
                selectedId={selectedAssignmentId}
                onSelect={(id, type, linkedPendingId) => {
                  setSelectedAssignmentId(id);
                  setSelectedAssignmentType(type);
                  setSelectedAssignmentLinkedPendingId(linkedPendingId ?? null);
                }}
                hiddenIds={assignmentHiddenIds}
                assigneeOverrides={assignmentTab !== "unassigned" ? assigneeOverrides : undefined}
                dueDateOverrides={dueDateOverrides}
                dueDateEditedOverrides={dueDateEditedOverrides}
                refreshToken={refreshToken}
                filters={assignmentFilters}
              />
            </div>
          </div>
          <div className={css.detailColumn}>
            <div className={css.headerBar}>
              <FilterDropdown filters={assignmentFilters} onFiltersChange={setAssignmentFilters} workspace={currentWorkspace} />
              <button
                className={css.headerButton}
                disabled={!assignmentEditTagsTarget}
                onClick={() => setShowEditTags(true)}
                title={
                  selectedAssignmentType === "pending"
                    ? "Edit tags on the selected package"
                    : selectedAssignmentType === "rfq" && selectedAssignmentLinkedPendingId
                      ? "Edit tags on the linked Pending package"
                      : selectedAssignmentType === "rfq"
                        ? "Edit tags on the RFQ Package"
                        : "Edit Tags requires a package selection"
                }
              >
                Edit Tags
              </button>
              <button
                className={css.headerButton}
                disabled={!selectedAssignmentId}
                onClick={() => setShowAssignTo(true)}
              >
                {assignmentTab === "assigned" ? "Reassign" : "Assign To"}
              </button>
              <button
                className={css.headerButton}
                disabled={!selectedAssignmentId || !selectedAssignmentType}
                onClick={() => selectedAssignmentId && selectedAssignmentType && handleMarkAsDone(selectedAssignmentId, selectedAssignmentType)}
                title={
                  selectedAssignmentType === "pending"
                    ? "Move this Pending package to Reviewed"
                    : selectedAssignmentType === "rfq"
                      ? "Mark this RFQ Package as Completed"
                      : "Mark as Done requires a package selection"
                }
              >
                Mark as Done
              </button>
              <EstimatorWorkloadScorecard ref={estimatorWorkloadRef} refreshToken={refreshToken} />
            </div>
            <div className={css.detailPanel}>
              {selectedAssignmentId && selectedAssignmentType === "pending" ? (
                <AssignmentPendingPackageDetail
                  key={selectedAssignmentId}
                  packageId={selectedAssignmentId}
                  refreshToken={refreshToken}
                  onDueDateChanged={() => setRefreshToken((t) => t + 1)}
                  onDueDateSaved={handleAssignmentDueDateSaved}
                  onDueDateReviewed={handleAssignmentDueDateReviewed}
                  onDueDateReviewFailed={handleAssignmentDueDateReviewFailed}
                  onSelectPackage={(id) => setSelectedAssignmentId(id)}
                  workspace={WORKSPACES.ASSIGNMENT}
                />
              ) : selectedAssignmentId && selectedAssignmentType === "rfq" ? (
                <AssignmentRfqPackageDetail
                  key={selectedAssignmentId}
                  packageId={selectedAssignmentId}
                  refreshToken={refreshToken}
                  onDueDateSaved={handleAssignmentDueDateSaved}
                  onSelectPackage={(id) => {
                    // Switching to a pending package sibling from the
                    // conversation section — flip both selection fields.
                    setSelectedAssignmentId(id);
                    setSelectedAssignmentType("pending");
                  }}
                />
              ) : (
                <div className={css.emptyDetail}>
                  Select a package from the list to view its details.
                </div>
              )}
            </div>
          </div>
        </div>
      <div className={css.panels} style={appMode === "assignment" ? { display: "none" } : undefined}>
          {/* List panel — slides out when in review mode */}
          <div className={`${css.listPanel} ${reviewMode ? css.listPanelHidden : ""}`}>
            <PendingRfqPackageList
              ref={listRef}
              onSelectPackage={handleSelectPackage}
              onDeselectPackage={() => { setSelectedPackageId(null); setSelectedPackageStatus(null); }}
              selectedPackageId={selectedPackageId}
              onTabChange={setActiveTab}
              onOutstandingSortChange={setOutstandingSort}
              refreshToken={refreshToken}
              filters={filters}
              mergeStep={mergeStep}
              mergeSourceId={mergeSourceId}
              onMergeSelect={handleMergeSelect}
              splitStep={splitStep}
              onSplitSelect={handleSplitSelect}
              onFirstPackageReady={handleFirstPackageReady}
              excludeFromAutoSelect={excludeFromAutoSelect}
              bulkSkipMode={bulkSkipMode}
              bulkSkipSelected={bulkSkipSelected}
              onBulkSkipToggle={handleBulkSkipToggle}
              onBulkSkipSelectAll={handleBulkSkipSelectAll}
              onBulkSkipDeselectAll={handleBulkSkipDeselectAll}
              onNewDataAvailable={() => setRefreshToken((t) => t + 1)}
            />
          </div>

          {/* Detail + review column */}
          <div className={css.detailColumn}>
            {/* Header — switches between normal and review mode */}
            {reviewMode ? (
              <div className={css.headerBarReview}>
                <div className={css.headerLeft}>
                  <button className={css.backButton} onClick={() => setReviewMode(false)}>
                    &larr; Back to list
                  </button>
                </div>
                <div className={css.headerRight}>
                  <button
                    className={css.createPackageButton}
                    disabled={!selectedPackageId || createPackageLoading}
                    onClick={handleCreatePackage}
                  >
                    {createPackageLoading ? "Creating…" : "Create Package"}
                  </button>
                </div>
              </div>
            ) : (
              <div className={css.headerBar}>
                {mergeStep && (
                  <div className={css.modeBanner}>
                    {mergeStep === "selectSource"
                      ? "Select the SOURCE package (will be deleted)"
                      : "Select the TARGET package (will receive tools)"}
                  </div>
                )}
                {splitStep && (
                  <div className={css.modeBanner}>
                    Select a package to split
                  </div>
                )}
                {bulkSkipMode && (
                  <div className={css.modeBanner}>
                    Select packages to skip
                  </div>
                )}
                <FilterDropdown filters={filters} onFiltersChange={setFilters} workspace={currentWorkspace} />
                {mergeStep ? (
                  <button
                    className={css.headerButton}
                    onClick={handleCancelMerge}
                  >
                    Cancel Merge
                  </button>
                ) : splitStep ? (
                  <button
                    className={css.headerButton}
                    onClick={handleCancelSplit}
                  >
                    Cancel Split
                  </button>
                ) : bulkSkipMode ? (
                  <>
                    <button
                      className={css.createPackageButton}
                      disabled={bulkSkipSelected.length === 0}
                      onClick={() => setShowBulkSkipConfirm(true)}
                    >
                      Skip Selected ({bulkSkipSelected.length})
                    </button>
                    <button
                      className={css.headerButton}
                      onClick={handleCancelBulkSkip}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    {(activeTab === "skipped" || (activeTab === "all" && (selectedPackageStatus === "Skipped" || selectedPackageStatus === "Under Review"))) ? (
                      <button
                        className={css.headerButton}
                        disabled={!selectedPackageId || actionLoading}
                        onClick={handleUnskip}
                      >
                        {actionLoading ? "Unskipping…" : "Unskip"}
                      </button>
                    ) : (activeTab === "reviewed" || (activeTab === "all" && selectedPackageStatus === "Reviewed")) ? (
                      <button
                        className={css.headerButton}
                        disabled={!selectedPackageId || actionLoading}
                        onClick={handleMarkOutstanding}
                      >
                        {actionLoading ? "Marking…" : "Mark Outstanding"}
                      </button>
                    ) : (
                      <>
                        <button
                          className={css.headerButton}
                          disabled={!selectedPackageId || actionLoading}
                          onClick={handleSkip}
                        >
                          {actionLoading ? "Skipping…" : "Skip"}
                        </button>
                        <button
                          className={css.headerButton}
                          disabled={!selectedPackageId || actionLoading}
                          onClick={() => selectedPackageId && handleSkipAndReview(selectedPackageId)}
                        >
                          Skip and Review
                        </button>
                      </>
                    )}
                    {(activeTab === "outstanding" || activeTab === "all") && (
                      <button
                        className={css.headerButton}
                        onClick={handleStartBulkSkip}
                      >
                        Bulk Skip
                      </button>
                    )}
                    <button
                      className={css.headerButton}
                      disabled={!selectedPackageId}
                      onClick={() => setShowEditTags(true)}
                    >
                      Edit Tags
                    </button>
                    <button
                      className={css.headerButtonWithInfo}
                      onClick={handleStartMerge}
                    >
                      Merge
                      <span className={css.infoIconWrap}>
                        <svg className={css.infoIcon} viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm.75 10.5h-1.5v-4h1.5v4Zm0-5.5h-1.5V4.5h1.5V6Z" />
                        </svg>
                        <span className={css.infoTooltip}>
                          Combine two packages into one by moving all tools from a source package into a target package. The source package will be deleted.
                        </span>
                      </span>
                    </button>
                    <button
                      className={css.headerButtonWithInfo}
                      onClick={handleStartSplit}
                    >
                      Split
                      <span className={css.infoIconWrap}>
                        <svg className={css.infoIcon} viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm.75 10.5h-1.5v-4h1.5v4Zm0-5.5h-1.5V4.5h1.5V6Z" />
                        </svg>
                        <span className={css.infoTooltip}>
                          Split a package by selecting specific tools to move into a new package. The original package keeps the remaining tools.
                        </span>
                      </span>
                    </button>
                    <button
                      className={css.headerButton}
                      disabled={!selectedPackageId}
                      onClick={() => setShowLinkToRfq(true)}
                    >
                      Update RFQ Link
                    </button>
                    <button
                      className={css.createPackageButton}
                      disabled={!selectedPackageId}
                      onClick={() => setReviewMode(true)}
                    >
                      Review Package
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Detail + Review panels side by side */}
            <div className={css.detailAndReview}>
              <div className={css.detailPanel}>
                {selectedPackageId ? (
                  <PackageDetail
                    key={selectedPackageId}
                    packageId={selectedPackageId}
                    refreshToken={refreshToken}
                    onDueDateChanged={() => setRefreshToken((t) => t + 1)}
                    onDueDateSaved={(id, newDueDate) => listRef.current?.updatePackageDueDate(id, newDueDate)}
                    onDueDateReviewed={(id) => listRef.current?.markDueDateReviewed(id)}
                    onDueDateReviewFailed={(id, message) => {
                      listRef.current?.revertDueDateReviewed(id);
                      setErrorToastMessage(message);
                    }}
                    onSelectPackage={handleSelectPackage}
                    workspace={currentWorkspace}
                  />
                ) : (
                  <div className={css.emptyDetail}>
                    Select a package from the list to view its details.
                  </div>
                )}
              </div>

              {/* Review panel — slides in from right */}
              <div className={`${css.reviewPanel} ${reviewMode ? css.reviewPanelVisible : ""}`}>
                {reviewMode && selectedPackageId ? (
                  <ReviewPanel
                    packageId={selectedPackageId}
                    refreshToken={refreshToken}
                    workspace={currentWorkspace}
                  />
                ) : (
                  <div className={css.reviewPanelContent}>
                    Review panel
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

      {/*
        The Edit Tags modal is shared between Ingestion and Assignment views.
        In Ingestion it always operates on `selectedPackageId` (a Pending
        package) and drives an optimistic update on `listRef` (the
        PendingRfqPackageList). In Assignment, `assignmentEditTagsTarget`
        resolves to the Pending package (selected directly, or via an RFQ
        item's link) or, when an RFQ item has no linked Pending package, the
        RFQ Package itself — either way it drives an optimistic update on
        `assignmentListRef` instead. Only one is rendered at a time based on
        the current `appMode`.
      */}
      {showEditTags && appMode === "assignment" && assignmentEditTagsTarget && (
        <EditTagsModal
          packageId={assignmentEditTagsTarget.packageId}
          packageType={assignmentEditTagsTarget.packageType}
          onClose={() => setShowEditTags(false)}
          onSaved={(newTags) => {
            trackUsage(INTERACTION_KEYS.PACKAGE_EDIT_TAGS, workspaceRef.current);
            setShowEditTags(false);
            assignmentListRef.current?.updatePackageTags(assignmentEditTagsTarget.packageId, newTags);
            completedListRef.current?.updatePackageTags(assignmentEditTagsTarget.packageId, assignmentEditTagsTarget.packageType, newTags);
          }}
        />
      )}
      {showEditTags && appMode !== "assignment" && selectedPackageId && (
        <EditTagsModal
          packageId={selectedPackageId}
          packageType="pending"
          onClose={() => setShowEditTags(false)}
          onSaved={(newTags) => {
            trackUsage(INTERACTION_KEYS.PACKAGE_EDIT_TAGS, workspaceRef.current);
            setShowEditTags(false);
            // Optimistic update: update tags in local state
            listRef.current?.updatePackageTags(selectedPackageId, newTags);
            completedListRef.current?.updatePackageTags(selectedPackageId, "pending", newTags);
          }}
        />
      )}

      {showMergeConfirm && mergeSourceId && mergeTargetId && (
        <MergeConfirmModal
          sourceId={mergeSourceId}
          sourceName={mergeSourceName}
          targetId={mergeTargetId}
          targetName={mergeTargetName}
          onClose={handleCancelMerge}
          onMerged={handleMergeComplete}
        />
      )}

      {splitPackageId && (
        <SplitPackageModal
          packageId={splitPackageId}
          packageName={splitPackageName}
          onClose={handleCancelSplit}
          onSplit={handleSplitComplete}
        />
      )}

      {showLinkToRfq && selectedPackageId && (
        <LinkToRfqModal
          pendingPackageId={selectedPackageId}
          onClose={() => setShowLinkToRfq(false)}
          onLinked={() => {
            trackUsage(INTERACTION_KEYS.PACKAGE_LINK_TO_RFQ, workspaceRef.current);
            setShowLinkToRfq(false);
            setRefreshToken((t) => t + 1);
          }}
        />
      )}

      {showFeedback && (appMode === "assignment" ? selectedAssignmentId : selectedPackageId) && (
        <FeedbackModal
          packageId={(appMode === "assignment" ? selectedAssignmentId : selectedPackageId) as string}
          onClose={() => setShowFeedback(false)}
          onSubmitted={() => { trackUsage(INTERACTION_KEYS.FEEDBACK_SUBMIT, workspaceRef.current); setShowFeedback(false); }}
        />
      )}

      {showBulkSkipConfirm && bulkSkipSelected.length > 0 && (
        <BulkSkipConfirmModal
          packageIds={bulkSkipSelected}
          onClose={() => setShowBulkSkipConfirm(false)}
          onSkipped={handleBulkSkipComplete}
        />
      )}

      {showAssignTo && selectedAssignmentId && selectedAssignmentType && (
        <AssignToModal
          packageId={selectedAssignmentId}
          packageType={selectedAssignmentType}
          onClose={() => setShowAssignTo(false)}
          onAssigned={(assignedEmployeeId) => {
            const assignedId = selectedAssignmentId;
            if (assignmentTab === "unassigned") {
              // First-time assignment: hide the package from the Unassigned
              // list without a full refetch.
              setAssignedInSession((prev) => {
                const next = new Set(prev);
                next.add(assignedId);
                return next;
              });
              setSelectedAssignmentId(null);
              setSelectedAssignmentLinkedPendingId(null);
              setSelectedAssignmentType(null);
            } else {
              // Reassignment: keep the package in the Assigned list but
              // reflect the new assignee optimistically.
              setAssigneeOverrides((prev) => ({
                ...prev,
                [assignedId]: assignedEmployeeId,
              }));
            }
            // The actual action call happens in the background (fire-and-
            // forget) — no refetch here; onAssignConfirmed/onAssignFailed
            // below settle the workload scorecard and error recovery once
            // it resolves.
            setShowAssignTo(false);
          }}
          onAssignConfirmed={(_packageId, newAssigneeId, toolCount, previousAssigneeId) => {
            estimatorWorkloadRef.current?.applyAssignmentDelta(newAssigneeId, toolCount, previousAssigneeId);
          }}
          onAssignFailed={(packageId, message) => {
            // The modal has already closed by the time this fires — undo
            // the optimistic list update made in onAssigned and surface the
            // failure via a standalone toast instead.
            setAssignedInSession((prev) => {
              if (!prev.has(packageId)) return prev;
              const next = new Set(prev);
              next.delete(packageId);
              return next;
            });
            setAssigneeOverrides((prev) => {
              if (!(packageId in prev)) return prev;
              const next = { ...prev };
              delete next[packageId];
              return next;
            });
            setErrorToastMessage(message);
          }}
        />
      )}

      {errorToastMessage && (
        <div className={css.errorToast} role="alert">
          <span>{errorToastMessage}</span>
          <button
            className={css.errorToastDismiss}
            onClick={() => setErrorToastMessage(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export default Home;
