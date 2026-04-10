import React, { useState, useCallback } from "react";
import css from "./Home.module.css";
import PendingRfqPackageList from "./components/PendingRfqPackageList";
import type { TabKey, Filters, MergeStep, SplitStep } from "./components/PendingRfqPackageList";
import MergeConfirmModal from "./components/MergeConfirmModal";
import SplitPackageModal from "./components/SplitPackageModal";
import FilterDropdown from "./components/FilterDropdown";
import PackageDetail from "./components/PackageDetail";
import { PendingRfqPackage, skipPackageReview, unskipPackageReview } from "@rfq-review-hub-widget-application/sdk";
import client from "./client";
import EditTagsModal from "./components/EditTagsModal";
import ReviewPanel from "./components/ReviewPanel";
import { useWorkshop, type WorkshopContext } from "./useWorkshop";

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
  const [filters, setFilters] = useState<Filters>({ dueDateStart: "", dueDateEnd: "", customerSearch: "", hasParsedTools: false });
  const [mergeStep, setMergeStep] = useState<MergeStep>(null);
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  const [mergeSourceName, setMergeSourceName] = useState<string>("");
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [mergeTargetName, setMergeTargetName] = useState<string>("");
  const [splitStep, setSplitStep] = useState<SplitStep>(null);
  const [splitPackageId, setSplitPackageId] = useState<string | null>(null);
  const [splitPackageName, setSplitPackageName] = useState<string>("");

  // Workshop integration — hook is always called, but context is only
  // meaningful when the app is embedded as a Bidirectional Iframe widget.
  const workshopContextAsync = useWorkshop();
  const workshopContext: WorkshopContext | null =
    isAsyncValue_Loaded(workshopContextAsync)
      ? workshopContextAsync.value
      : null;

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
      const pkg = await client(PendingRfqPackage).fetchOne(selectedPackageId);
      await client(skipPackageReview).applyAction(
        { pending_rfq_package: pkg },
        { $returnEdits: true },
      );
      setSelectedPackageId(null);
      setRefreshToken((t) => t + 1);
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
      setSelectedPackageId(null);
      setRefreshToken((t) => t + 1);
    } catch (e) {
      console.error("Failed to unskip package:", e);
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
      // Fetch tools for this package
      const toolPage = await client(PendingRfqPackage)
        .where({ packageId: { $eq: selectedPackageId } })
        .pivotTo("pendingRfqPackageTools")
        .fetchPage({ $pageSize: 200, $orderBy: { toolNumber: "asc" } });
      const tools = toolPage.data;
      const toolIds = tools
        .map((t) => t.toolId)
        .filter((id): id is string => id != null);

      // Fetch parts and manifolds for all tools in parallel
      const linkedResults = await Promise.all(
        tools.map(async (tool) => {
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
    handleCancelMerge();
    setSelectedPackageId(null);
    setSelectedPackageStatus(null);
    setRefreshToken((t) => t + 1);
  }, [handleCancelMerge]);

  const handleStartSplit = useCallback(() => {
    setSplitStep("selectPackage");
    setSplitPackageId(null);
    setSplitPackageName("");
  }, []);

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
    handleCancelSplit();
    setSelectedPackageId(null);
    setSelectedPackageStatus(null);
    setRefreshToken((t) => t + 1);
  }, [handleCancelSplit]);

  const showMergeConfirm = mergeSourceId !== null && mergeTargetId !== null;

  return (
    <div className={css.home}>
      <div className={css.panels}>
        {/* List panel — slides out when in review mode */}
        <div className={`${css.listPanel} ${reviewMode ? css.listPanelHidden : ""}`}>
          <PendingRfqPackageList
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
                  ) : (
                    <button
                      className={css.headerButton}
                      disabled={!selectedPackageId || actionLoading}
                      onClick={handleSkip}
                    >
                      {actionLoading ? "Skipping…" : "Skip"}
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
                    className={css.headerButton}
                    onClick={handleStartMerge}
                    title="Combine two packages into one by moving all tools from a source package into a target package. The source package will be deleted."
                  >
                    Merge
                  </button>
                  <button
                    className={css.headerButton}
                    onClick={handleStartSplit}
                    title="Split a package by selecting specific tools to move into a new package. The original package keeps the remaining tools."
                  >
                    Split
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

      {showEditTags && selectedPackageId && (
        <EditTagsModal
          packageId={selectedPackageId}
          onClose={() => setShowEditTags(false)}
          onSaved={() => {
            setShowEditTags(false);
            setRefreshToken((t) => t + 1);
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
    </div>
  );
}

export default Home;
