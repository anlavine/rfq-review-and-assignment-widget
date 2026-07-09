import React, { useState, useCallback, useEffect, useRef } from "react";
import css from "./Home.module.css";
import PendingRfqPackageList from "./components/PendingRfqPackageList";
import type { TabKey, Filters, MergeStep, SplitStep, ExcludeFromAutoSelect, BulkSkipMode, PendingRfqPackageListHandle } from "./components/PendingRfqPackageList";
import BulkSkipConfirmModal from "./components/BulkSkipConfirmModal";
import MergeConfirmModal from "./components/MergeConfirmModal";
import SplitPackageModal from "./components/SplitPackageModal";
import LinkToRfqModal from "./components/LinkToRfqModal";
import FilterDropdown from "./components/FilterDropdown";
import PackageDetail from "./components/PackageDetail";
import { PendingRfqPackage, skipPackageReview, unskipPackageReview } from "@rfq-review-hub-widget-application/sdk";
import client from "./client";
import { compareToolNumber } from "./utils/sortTools";
import EditTagsModal from "./components/EditTagsModal";
import FeedbackModal from "./components/FeedbackModal";
import ReviewPanel from "./components/ReviewPanel";
import AssignmentPackageList from "./components/AssignmentPackageList";
import AssignmentPendingPackageDetail from "./components/AssignmentPendingPackageDetail";
import AssignmentRfqPackageDetail from "./components/AssignmentRfqPackageDetail";
import AssignToModal from "./components/AssignToModal";
import { useWorkshop, type WorkshopContext } from "./useWorkshop";
import { useTheme } from "./ThemeContext";
import { trackUsage, INTERACTION_KEYS } from "./utils/trackUsage";

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
  const [filters, setFilters] = useState<Filters>({ dueDateStart: "", dueDateEnd: "", subjectSearch: "", customerSearch: "", platformSearch: "", senderSearch: "", selectedTags: [], hasParsedTools: false });
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
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [selectedAssignmentType, setSelectedAssignmentType] = useState<"pending" | "rfq" | null>(null);
  const [showAssignTo, setShowAssignTo] = useState(false);
  /**
   * Session-local set of package IDs that were just assigned via the
   * Assign To modal. These are hidden from the AssignmentPackageList
   * without triggering a full refetch so users see the list update
   * instantly; they'll fall off naturally on the next real refresh.
   */
  const [assignedInSession, setAssignedInSession] = useState<Set<string>>(new Set());
  const { theme, toggleTheme } = useTheme();

  /** Ref to PendingRfqPackageList for optimistic updates */
  const listRef = useRef<PendingRfqPackageListHandle>(null);

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
      trackUsage(INTERACTION_KEYS.PACKAGE_SKIP);
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

  const handleUnskip = useCallback(async () => {
    if (!selectedPackageId || actionLoading) return;
    setActionLoading(true);
    try {
      const pkg = await client(PendingRfqPackage).fetchOne(selectedPackageId);
      await client(unskipPackageReview).applyAction(
        { pending_rfq_package: pkg },
        { $returnEdits: true },
      );
      trackUsage(INTERACTION_KEYS.PACKAGE_UNSKIP);
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
      trackUsage(INTERACTION_KEYS.PACKAGE_MARK_OUTSTANDING);
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
        trackUsage(INTERACTION_KEYS.PACKAGE_CREATE);
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
    trackUsage(INTERACTION_KEYS.PACKAGE_BULK_SKIP);
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
    trackUsage(INTERACTION_KEYS.PACKAGE_MERGE);
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
    trackUsage(INTERACTION_KEYS.PACKAGE_SPLIT);
    handleCancelSplit();
    setSelectedPackageId(null);
    setSelectedPackageStatus(null);
    setRefreshToken((t) => t + 1);
  }, [handleCancelSplit]);

  const showMergeConfirm = mergeSourceId !== null && mergeTargetId !== null;

  return (
    <div className={css.home}>
      {<div className={css.modeToggleBar}>
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
      </div>}

      {appMode === "assignment" ? (
        <div className={css.panels}>
          <div className={css.listPanel}>
            <AssignmentPackageList
              selectedId={selectedAssignmentId}
              onSelect={(id, type) => {
                setSelectedAssignmentId(id);
                setSelectedAssignmentType(type);
              }}
              hiddenIds={assignedInSession}
            />
          </div>
          <div className={css.detailColumn}>
            <div className={css.headerBar}>
              <button
                className={css.headerButton}
                disabled={!selectedAssignmentId}
                onClick={() => setShowAssignTo(true)}
              >
                Assign To
              </button>
            </div>
            <div className={css.detailPanel}>
              {selectedAssignmentId && selectedAssignmentType === "pending" ? (
                <AssignmentPendingPackageDetail
                  packageId={selectedAssignmentId}
                  refreshToken={refreshToken}
                  onDueDateChanged={() => setRefreshToken((t) => t + 1)}
                  onSelectPackage={(id) => setSelectedAssignmentId(id)}
                />
              ) : selectedAssignmentId && selectedAssignmentType === "rfq" ? (
                <AssignmentRfqPackageDetail
                  packageId={selectedAssignmentId}
                  refreshToken={refreshToken}
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
      ) : (
        <div className={css.panels}>
          {/* List panel — slides out when in review mode */}
          <div className={`${css.listPanel} ${reviewMode ? css.listPanelHidden : ""}`}>
            <PendingRfqPackageList
              ref={listRef}
              onSelectPackage={handleSelectPackage}
              onDeselectPackage={() => { setSelectedPackageId(null); setSelectedPackageStatus(null); }}
              selectedPackageId={selectedPackageId}
              onTabChange={setActiveTab}
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
                <button
                  className={css.feedbackButton}
                  disabled={!selectedPackageId}
                  onClick={() => setShowFeedback(true)}
                  title="Submit feedback"
                >
                  <svg className={css.feedbackIcon} viewBox="0 0 16 16" fill="currentColor">
                    <path d="M3.5 2A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5v2.5l3.5-2.5H12.5A1.5 1.5 0 0 0 14 9.5v-6A1.5 1.5 0 0 0 12.5 2h-9ZM5 5.5a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM8 4.75a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Zm2.5.75a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM5.5 7.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1Z" />
                  </svg>
                </button>
                <button
                  className={css.themeToggle}
                  onClick={() => { toggleTheme(); trackUsage(INTERACTION_KEYS.UI_TOGGLE_THEME); }}
                  title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                >
                  {theme === "dark" ? "☀️" : "🌙"}
                </button>
                <FilterDropdown filters={filters} onFiltersChange={setFilters} />
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
                    {(activeTab === "skipped" || (activeTab === "all" && selectedPackageStatus === "Skipped")) ? (
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
                      <button
                        className={css.headerButton}
                        disabled={!selectedPackageId || actionLoading}
                        onClick={handleSkip}
                      >
                        {actionLoading ? "Skipping…" : "Skip"}
                      </button>
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
                    packageId={selectedPackageId}
                    refreshToken={refreshToken}
                    onDueDateChanged={() => setRefreshToken((t) => t + 1)}
                    onSelectPackage={handleSelectPackage}
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

      )}

      {showEditTags && selectedPackageId && (
        <EditTagsModal
          packageId={selectedPackageId}
          onClose={() => setShowEditTags(false)}
          onSaved={(newTags) => {
            trackUsage(INTERACTION_KEYS.PACKAGE_EDIT_TAGS);
            setShowEditTags(false);
            // Optimistic update: update tags in local state
            listRef.current?.updatePackageTags(selectedPackageId, newTags);
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
            trackUsage(INTERACTION_KEYS.PACKAGE_LINK_TO_RFQ);
            setShowLinkToRfq(false);
            setRefreshToken((t) => t + 1);
          }}
        />
      )}

      {showFeedback && selectedPackageId && (
        <FeedbackModal
          packageId={selectedPackageId}
          onClose={() => setShowFeedback(false)}
          onSubmitted={() => { trackUsage(INTERACTION_KEYS.FEEDBACK_SUBMIT); setShowFeedback(false); }}
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
          onAssigned={() => {
            const assignedId = selectedAssignmentId;
            // Optimistically drop the assigned package from the list
            // without a full refetch.
            setAssignedInSession((prev) => {
              const next = new Set(prev);
              next.add(assignedId);
              return next;
            });
            setShowAssignTo(false);
            // Clear the current selection so the detail panel doesn't keep
            // showing a package that's no longer in the list.
            setSelectedAssignmentId(null);
            setSelectedAssignmentType(null);
            setRefreshToken((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}

export default Home;
