import React, { useEffect, useState } from "react";
import {
  PendingRfqPackage,
  PendingRFQPackageTool,
  splitPackage,
} from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import type { Osdk } from "@osdk/client";
import css from "./SplitPackageModal.module.css";
import { compareToolNumber } from "../utils/sortTools";

interface SplitPackageModalProps {
  packageId: string;
  packageName: string;
  onClose: () => void;
  onSplit: () => void;
}

function SplitPackageModal({
  packageId,
  packageName,
  onClose,
  onSplit,
}: SplitPackageModalProps): React.ReactElement {
  const [tools, setTools] = useState<Osdk.Instance<PendingRFQPackageTool>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(new Set());
  const [splitting, setSplitting] = useState(false);

  // Fetch tools for the package
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await client(PendingRfqPackage)
          .where({ packageId: { $eq: packageId } })
          .pivotTo("pendingRfqPackageTools")
          .fetchPage({ $pageSize: 200, $orderBy: { toolNumber: "asc" } });
        if (!cancelled) {
          setTools(
            [...page.data].sort((a, b) => compareToolNumber(a.toolNumber, b.toolNumber)),
          );
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load tools");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [packageId]);

  const handleToggle = (toolId: string) => {
    setSelectedToolIds((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedToolIds.size === tools.length) {
      setSelectedToolIds(new Set());
    } else {
      setSelectedToolIds(new Set(tools.map((t) => String(t.$primaryKey))));
    }
  };

  const handleSplit = async () => {
    if (splitting || selectedToolIds.size === 0) return;
    if (selectedToolIds.size === tools.length) {
      setError("You must leave at least one tool in the original package.");
      return;
    }
    setSplitting(true);
    setError(null);
    try {
      const sourcePkg = await client(PendingRfqPackage).fetchOne(packageId);

      // Fetch the full tool objects for the selected tools
      const selectedTools: Osdk.Instance<PendingRFQPackageTool>[] = [];
      for (const toolId of selectedToolIds) {
        const tool = await client(PendingRFQPackageTool).fetchOne(toolId);
        selectedTools.push(tool);
      }

      // Generate a new package ID
      const newPackageId = `${packageId}-split-${Date.now()}`;

      await client(splitPackage).applyAction(
        {
          "source-package": sourcePkg,
          "tools-to-move": selectedTools,
          "new-package-id": newPackageId,
        },
        { $returnEdits: true },
      );
      onSplit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to split package");
      setSplitting(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !splitting) {
      onClose();
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className={css.overlay} onClick={handleOverlayClick}>
      <div className={css.modal}>
        <h3 className={css.title}>Split Package</h3>
        <p className={css.subtitle}>
          Select tools to move from <strong>{packageName}</strong> into a new package.
        </p>

        {loading ? (
          <div className={css.loadingMsg}>Loading tools…</div>
        ) : tools.length === 0 ? (
          <div className={css.loadingMsg}>No tools found for this package.</div>
        ) : (
          <>
            <div className={css.selectAllRow}>
              <label className={css.toolOption}>
                <input
                  type="checkbox"
                  checked={selectedToolIds.size === tools.length}
                  onChange={handleSelectAll}
                  disabled={splitting}
                />
                <span className={css.selectAllLabel}>
                  Select All ({tools.length} tool{tools.length !== 1 ? "s" : ""})
                </span>
              </label>
              <span className={css.selectedCount}>
                {selectedToolIds.size} selected
              </span>
            </div>

            <div className={css.toolList}>
              {tools.map((tool) => {
                const toolId = String(tool.$primaryKey);
                return (
                  <label key={toolId} className={css.toolOption}>
                    <input
                      type="checkbox"
                      checked={selectedToolIds.has(toolId)}
                      onChange={() => handleToggle(toolId)}
                      disabled={splitting}
                    />
                    <div className={css.toolInfo}>
                      <span className={css.toolName}>
                        {tool.toolNumber ? `Tool #${tool.toolNumber}` : "Unnamed Tool"}
                      </span>
                      {tool.commodityType && (
                        <span className={css.toolDetail}>{tool.commodityType}</span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {error && <div className={css.error}>{error}</div>}

        <div className={css.footer}>
          <button
            className={css.cancelButton}
            onClick={onClose}
            disabled={splitting}
          >
            Cancel
          </button>
          <button
            className={css.splitButton}
            onClick={handleSplit}
            disabled={splitting || selectedToolIds.size === 0 || loading}
          >
            {splitting
              ? "Splitting…"
              : `Split ${selectedToolIds.size} Tool${selectedToolIds.size !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SplitPackageModal;
