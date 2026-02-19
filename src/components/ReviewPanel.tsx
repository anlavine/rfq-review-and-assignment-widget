import React, { useEffect, useState } from "react";
import {
  PendingRfqPackage,
  PendingRfqAttachments,
  PendingRFQPackageTool,
} from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import type { Osdk } from "@osdk/client";
import css from "./ReviewPanel.module.css";

const ATTACHMENT_DATASET_RID =
  "ri.foundry.main.dataset.d44b35c2-98c1-4b35-8e9b-e4290dde5577";

interface ReviewPanelProps {
  packageId: string;
  refreshToken?: number;
}

/**
 * All displayable tool property API names (excluding the hidden ones),
 * in a stable order for consistent rendering.
 */
const TOOL_DISPLAY_PROPERTIES: {
  apiName: keyof Osdk.Instance<PendingRFQPackageTool>;
  label: string;
}[] = [
  { apiName: "toolNumber", label: "Tool Number" },
  { apiName: "partNumber", label: "Part Number" },
  { apiName: "commodityCategory", label: "Commodity Category" },
  { apiName: "commodityType", label: "Commodity Type" },
  { apiName: "cadfilename", label: "CAD Filename" },
  { apiName: "lengthX", label: "Length (X)" },
  { apiName: "widthY", label: "Width (Y)" },
  { apiName: "heightZ", label: "Height (Z)" },
  { apiName: "cavitations", label: "Cavitations" },
  { apiName: "cavitySurfaceFinish", label: "Cavity Surface Finish" },
  { apiName: "coreSurfaceFinish", label: "Core Surface Finish" },
  { apiName: "surfaceTreatmentType", label: "Surface Treatment Type" },
  { apiName: "textureType", label: "Texture Type" },
  { apiName: "textureSource", label: "Texture Source" },
  { apiName: "gateType", label: "Gate Type" },
  { apiName: "numberOfGates", label: "Number of Gates" },
  { apiName: "ejectionType", label: "Ejection Type" },
  { apiName: "manifoldType", label: "Manifold Type" },
  { apiName: "manifoldSupplier", label: "Manifold Supplier" },
  { apiName: "numberOfDrops", label: "Number of Drops" },
  { apiName: "pressSize", label: "Press Size" },
  { apiName: "numberOfTryouts", label: "Number of Tryouts" },
  { apiName: "shotsPerTryout", label: "Shots per Tryout" },
  { apiName: "delivery", label: "Delivery" },
  { apiName: "fob", label: "FOB" },
  { apiName: "reflexSource", label: "Reflex Source" },
  { apiName: "estKickoffDate", label: "Est. Kickoff Date" },
  { apiName: "estV1Date", label: "Est. V1 Date" },
];

function ReviewPanel({
  packageId,
  refreshToken,
}: ReviewPanelProps): React.ReactElement {
  const [attachments, setAttachments] = useState<
    Osdk.Instance<PendingRfqAttachments>[]
  >([]);
  const [tools, setTools] = useState<Osdk.Instance<PendingRFQPackageTool>[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);
    setAttachments([]);
    setTools([]);

    (async () => {
      try {
        // Fetch the package to get attachmentFileNames and emailId
        const pkg = await client(PendingRfqPackage).fetchOne(packageId);
        if (cancelled) return;

        const fileNames = pkg.attachmentFileNames ?? [];
        const emailId = pkg.emailId;

        // Fetch attachments: match on fileName ∈ attachmentFileNames AND emailId
        const attachmentPromise = (async () => {
          if (fileNames.length === 0 || !emailId) return [];
          try {
            const page = await client(PendingRfqAttachments)
              .where({
                $and: [
                  { fileName: { $in: fileNames } },
                  { emailId: { $eq: emailId } },
                ],
              })
              .fetchPage({ $pageSize: 200 });
            return page.data;
          } catch (e) {
            console.error("Failed to fetch attachments:", e);
            return [];
          }
        })();

        // Fetch tools via the ontology link, ordered by tool number
        const toolsPromise = (async () => {
          try {
            const page = await client(PendingRfqPackage)
              .where({ packageId: { $eq: packageId } })
              .pivotTo("pendingRfqPackageTools")
              .fetchPage({
                $pageSize: 200,
                $orderBy: { toolNumber: "asc" },
              });
            return page.data;
          } catch (e) {
            console.error("Failed to fetch tools:", e);
            return [];
          }
        })();

        const [resolvedAttachments, resolvedTools] = await Promise.all([
          attachmentPromise,
          toolsPromise,
        ]);

        if (cancelled) return;
        setAttachments(resolvedAttachments);
        setTools(resolvedTools);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : "Failed to load review panel data",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [packageId, refreshToken]);

  if (loading) {
    return (
      <div className={css.container}>
        <div className={css.loading}>Loading review data…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={css.container}>
        <div className={css.error}>Error: {error}</div>
      </div>
    );
  }

  return (
    <div className={css.container}>
      {/* ── Attachments Section ── */}
      <section className={css.section}>
        <h3 className={css.sectionTitle}>Attachments</h3>
        {attachments.length > 0 ? (
          <ul className={css.attachmentList}>
            {attachments.map((att) => (
              <li key={att.$primaryKey} className={css.attachmentItem}>
                <span className={css.attachmentIcon}>📎</span>
                <span className={css.attachmentName}>
                  {att.fileName ?? "Unnamed file"}
                </span>
                {att.filepath && (
                  <button
                    className={css.downloadButton}
                    disabled={downloadingId === att.$primaryKey}
                    onClick={() => {
                      setDownloadError(null);
                      setDownloadingId(String(att.$primaryKey));
                      const url = `https://integrity.palantirfoundry.com/foundry-data-proxy/api/web/dataproxy/datasets/${ATTACHMENT_DATASET_RID}/views/master/${att.filepath}`;
                      window.location.href = url;
                      // Reset button after a short delay since navigation may not leave the page
                      setTimeout(() => setDownloadingId(null), 2000);
                    }}
                  >
                    {downloadingId === att.$primaryKey ? "Downloading…" : "Download"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className={css.emptyMessage}>No attachments found.</p>
        )}
        {downloadError && (
          <p className={css.downloadError}>{downloadError}</p>
        )}
      </section>

      {/* ── Tools Section ── */}
      <section className={css.section}>
        <h3 className={css.sectionTitle}>
          Tools{" "}
          <span className={css.toolCountBadge}>{tools.length}</span>
        </h3>
        {tools.length > 0 ? (
          <div className={css.toolGrid}>
            {tools.map((tool) => (
              <div key={tool.$primaryKey} className={css.toolCard}>
                <div className={css.toolCardHeader}>
                  {tool.partName ?? "Unnamed Tool"}
                </div>
                <dl className={css.toolProps}>
                  {TOOL_DISPLAY_PROPERTIES.map(({ apiName, label }) => {
                    const value = tool[apiName];
                    if (value == null || value === "") return null;
                    const display =
                      value instanceof Date
                        ? value.toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })
                        : String(value);
                    return (
                      <div key={apiName} className={css.toolPropRow}>
                        <dt className={css.toolPropLabel}>{label}:</dt>
                        <dd className={css.toolPropValue}>{display}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            ))}
          </div>
        ) : (
          <p className={css.emptyMessage}>No tools found.</p>
        )}
      </section>
    </div>
  );
}

export default ReviewPanel;
