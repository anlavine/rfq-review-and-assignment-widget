import React, { useState, useCallback } from "react";
import css from "./Home.module.css";
import PendingRfqPackageList from "./components/PendingRfqPackageList";
import type { TabKey } from "./components/PendingRfqPackageList";
import PackageDetail from "./components/PackageDetail";
import { PendingRfqPackage, skipPackageReview, unskipPackageReview } from "@rfq-review-hub-widget-application/sdk";
import client from "./client";
import EditTagsModal from "./components/EditTagsModal";
import ReviewPanel from "./components/ReviewPanel";

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

  return (
    <div className={css.home}>
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
              className={css.headerButton}
              disabled={!selectedPackageId}
              onClick={() => setShowEditTags(true)}
            >
              Edit Tags
            </button>
          </div>
        </div>
      ) : (
        <div className={css.headerBar}>
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
            onClick={() => setReviewMode(true)}
          >
            Review Package
          </button>
          <button
            className={css.headerButton}
            disabled={!selectedPackageId}
            onClick={() => setShowEditTags(true)}
          >
            Edit Tags
          </button>
      </div>
      )}

      <div className={css.panels}>
        {/* List panel — slides out when in review mode */}
        <div className={`${css.listPanel} ${reviewMode ? css.listPanelHidden : ""}`}>
          <PendingRfqPackageList
            onSelectPackage={handleSelectPackage}
            onDeselectPackage={() => { setSelectedPackageId(null); setSelectedPackageStatus(null); }}
            selectedPackageId={selectedPackageId}
            onTabChange={setActiveTab}
            refreshToken={refreshToken}
          />
        </div>

        {/* Detail panel — always visible */}
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
