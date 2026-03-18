import React, { useState, useCallback } from "react";
import css from "./Home.module.css";
import PendingRfqPackageList from "./components/PendingRfqPackageList";
import type { TabKey, Filters } from "./components/PendingRfqPackageList";
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
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [actionLoading, setActionLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedPackageStatus, setSelectedPackageStatus] = useState<string | null>(null);
  const [showEditTags, setShowEditTags] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [createPackageLoading, setCreatePackageLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>({ dueDateStart: "", dueDateEnd: "", customerSearch: "", hasParsedTools: false });

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
   * 1. Fetches the linked tool IDs for the selected package.
   * 2. Sets two Workshop variables (selectedPackageId, selectedToolIds).
   * 3. Fires the createPackageEvent so Workshop can react (e.g., switch tabs).
   */
  const handleCreatePackage = useCallback(async () => {
    if (!selectedPackageId) return;
    setCreatePackageLoading(true);
    try {
      // Fetch tool IDs for this package
      const toolPage = await client(PendingRfqPackage)
        .where({ packageId: { $eq: selectedPackageId } })
        .pivotTo("pendingRfqPackageTools")
        .fetchPage({ $pageSize: 200, $orderBy: { toolNumber: "asc" } });
      const toolIds = toolPage.data
        .map((t) => t.toolId)
        .filter((id): id is string => id != null);

      if (workshopContext) {
        // Set Workshop variables
        workshopContext.selectedPackageId.setLoadedValue(selectedPackageId);
        workshopContext.selectedToolIds.setLoadedValue(toolIds);
        // Fire the Workshop event
        workshopContext.createPackageEvent.executeEvent(undefined);
      } else {
        // Not inside Workshop — log for debugging
        console.log("Create Package (standalone mode):", {
          packageId: selectedPackageId,
          toolIds,
        });
      }
    } catch (e) {
      console.error("Failed to create package:", e);
    } finally {
      setCreatePackageLoading(false);
    }
  }, [selectedPackageId, workshopContext]);

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
              <FilterDropdown filters={filters} onFiltersChange={setFilters} />
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
                disabled={!selectedPackageId}
                onClick={() => setReviewMode(true)}
              >
                Review Package
              </button>
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
    </div>
  );
}

export default Home;
