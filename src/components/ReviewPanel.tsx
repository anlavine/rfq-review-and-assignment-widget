import React, { useEffect, useState } from "react";
import {
  PendingRfqPackage,
  PendingRfqAttachments,
  PendingRFQPackageTool,
  PendingRfqPackagePart,
  PendingRfqPackageManifold,
} from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import type { Osdk } from "@osdk/client";
import css from "./ReviewPanel.module.css";
import { compareToolNumber } from "../utils/sortTools";

const ATTACHMENT_DATASET_RID =
  "ri.foundry.main.dataset.1be7ce80-f8d5-411c-94c3-6fe46371a15b";

interface ReviewPanelProps {
  packageId: string;
  refreshToken?: number;
}

/**
 * Tool properties to display (excluding emailId, packageId, subject, from, to, toolId,
 * and fields that moved to Part/Manifold).
 */
const TOOL_DISPLAY_PROPERTIES: {
  apiName: keyof Osdk.Instance<PendingRFQPackageTool>;
  label: string;
}[] = [
    { apiName: "commodityCategory", label: "Commodity Category" },
    { apiName: "commodityType", label: "Commodity Type" },
    { apiName: "cavitations", label: "Cavitations" },
    { apiName: "cavitySurfaceFinish", label: "Cavity Surface Finish" },
    { apiName: "cavityMaterial", label: "Cavity Material" },
    { apiName: "coreSurfaceFinish", label: "Core Surface Finish" },
    { apiName: "coreMaterial", label: "Core Material" },
    { apiName: "surfaceTreatmentType", label: "Surface Treatment Type" },
    { apiName: "textureType", label: "Texture Type" },
    { apiName: "textureSource", label: "Texture Source" },
    { apiName: "ejectionType", label: "Ejection Type" },
    { apiName: "pressSize", label: "Press Size" },
    { apiName: "numberOfTryouts", label: "Number of Tryouts" },
    { apiName: "shotsPerTryout", label: "Shots per Tryout" },
    { apiName: "cycleTime", label: "Cycle Time" },
    { apiName: "delivery", label: "Delivery" },
    { apiName: "fob", label: "FOB" },
    { apiName: "fobDdpDap", label: "FOB/DDP/DAP" },
    { apiName: "reflexSource", label: "Reflex Source" },
    { apiName: "moldflowSupplier", label: "Moldflow Supplier" },
    { apiName: "toolAttachment", label: "Tool Attachment" },
    { apiName: "estKickoffDate", label: "Est. Kickoff Date" },
    { apiName: "estV1Date", label: "Est. V1 Date" },
  ];

/** Part properties to display (excluding IDs) */
const PART_DISPLAY_PROPERTIES: {
  apiName: keyof Osdk.Instance<PendingRfqPackagePart>;
  label: string;
  suffix?: string;
}[] = [
    { apiName: "partName", label: "Part Name" },
    { apiName: "partNumber", label: "Part Number" },
    { apiName: "cadfilename", label: "CAD Filename" },
    { apiName: "lengthX", label: "Length (X)", suffix: " in" },
    { apiName: "widthY", label: "Width (Y)", suffix: " in" },
    { apiName: "heightZ", label: "Height (Z)", suffix: " in" },
    { apiName: "originalPartUnits", label: "Units Converted From" },
    { apiName: "expectedAnnualVolume", label: "Expected Annual Volume" },
    { apiName: "firstVolumeYear", label: "First Volume Year" },
  ];

/** Manifold properties to display (excluding IDs) */
const MANIFOLD_DISPLAY_PROPERTIES: {
  apiName: keyof Osdk.Instance<PendingRfqPackageManifold>;
  label: string;
}[] = [
    { apiName: "manifoldType", label: "Manifold Type" },
    { apiName: "manifoldSupplier", label: "Manifold Supplier" },
    { apiName: "gateType", label: "Gate Type" },
    { apiName: "numberOfDrops", label: "Number of Drops" },
  ];

/** Linked parts and manifolds for each tool */
interface ToolLinkedData {
  parts: Osdk.Instance<PendingRfqPackagePart>[];
  manifolds: Osdk.Instance<PendingRfqPackageManifold>[];
}

function formatDate(date: string | undefined): string {
  if (!date) return "—";
  try {
    const parts = date.split("T")[0].split("-");
    const local = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return local.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return date;
  }
}

function ReviewPanel({
  packageId,
  refreshToken,
}: ReviewPanelProps): React.ReactElement {
  const [pkg, setPkg] = useState<Osdk.Instance<PendingRfqPackage> | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<
    Osdk.Instance<PendingRfqAttachments>[]
  >([]);
  const [tools, setTools] = useState<Osdk.Instance<PendingRFQPackageTool>[]>(
    [],
  );
  const [toolLinkedMap, setToolLinkedMap] = useState<
    Record<string, ToolLinkedData>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);
    setPkg(null);
    setCustomerName(null);
    setAttachments([]);
    setTools([]);
    setToolLinkedMap({});

    (async () => {
      try {
        // Fetch the package to get attachmentFileNames and emailId
        const fetchedPkg = await client(PendingRfqPackage).fetchOne(packageId);
        if (cancelled) return;
        setPkg(fetchedPkg);

        const conversationId = fetchedPkg.conversationId;

        // Resolve customer name via link
        const customerPromise = (async () => {
          try {
            const page = await client(PendingRfqPackage)
              .where({ packageId: { $eq: packageId } })
              .pivotTo("betaAdécustomer")
              .fetchPage({ $pageSize: 1 });
            return page.data[0]?.customerName ?? null;
          } catch {
            return null;
          }
        })();

        // Fetch attachments: match on fileName ∈ attachmentFileNames AND conversationId
        const fileNames = fetchedPkg.attachmentFileNames ?? []
        const attachmentPromise = (async () => {
          if (!conversationId) return [];
          try {
            const page = await client(PendingRfqAttachments)
              .where({
                $and: [
                  { fileName: { $in: fileNames } },
                  { conversationId: { $eq: conversationId } }
                ]
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

        const [resolvedAttachments, resolvedTools, resolvedCustomer] = await Promise.all([
          attachmentPromise,
          toolsPromise,
          customerPromise,
        ]);

        if (cancelled) return;
        setAttachments(resolvedAttachments);
        setTools(
          [...resolvedTools].sort((a, b) => compareToolNumber(a.toolNumber, b.toolNumber)),
        );
        setCustomerName(resolvedCustomer);

        // Fetch parts and manifolds for each tool in parallel
        const linkedEntries = await Promise.all(
          resolvedTools.map(async (tool) => {
            const toolId = String(tool.$primaryKey);
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
            return { toolId, parts, manifolds };
          }),
        );

        if (cancelled) return;

        const linked: Record<string, ToolLinkedData> = {};
        for (const entry of linkedEntries) {
          linked[entry.toolId] = { parts: entry.parts, manifolds: entry.manifolds };
        }
        setToolLinkedMap(linked);
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
                    disabled={downloadingId === String(att.$primaryKey)}
                    onClick={async () => {
                      const attId = String(att.$primaryKey);
                      const displayName = att.fileName ?? att.filepath ?? "download";
                      setDownloadError(null);
                      setDownloadingId(attId);
                      try {
                        const url = `https://integrity.palantirfoundry.com/foundry-data-proxy/api/web/dataproxy/datasets/${ATTACHMENT_DATASET_RID}/views/master/${att.filepath}`;
                        const response = await fetch(url, { credentials: "include" });
                        if (!response.ok) throw new Error(`Download failed (${response.status})`);
                        const blob = await response.blob();
                        const objectUrl = URL.createObjectURL(blob);
                        const anchor = document.createElement("a");
                        anchor.href = objectUrl;
                        anchor.download = displayName;
                        document.body.appendChild(anchor);
                        anchor.click();
                        document.body.removeChild(anchor);
                        URL.revokeObjectURL(objectUrl);
                      } catch (e) {
                        console.error("Download failed:", e);
                        setDownloadError(
                          e instanceof Error ? e.message : "Failed to download file",
                        );
                      } finally {
                        setDownloadingId(null);
                      }
                    }}
                  >
                    {downloadingId === String(att.$primaryKey) ? "Downloading…" : "Download"}
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

      {/* ── Package Info Section ── */}
      {pkg && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>Package Information</h3>
          <div className={css.packageInfoCard}>
            <dl className={css.toolProps}>
              {([
                { label: "Package Name", value: pkg.packageName },
                { label: "OEM", value: pkg.oem },
                { label: "Model Year", value: pkg.modelYear },
                { label: "Platform", value: pkg.platform },
                { label: "Customer", value: customerName },
                { label: "Terms", value: pkg.terms },
                { label: "SOP Date", value: formatDate(pkg.sopDate) },
                { label: "PPAP Date", value: pkg.ppapDate },
              ] as { label: string; value: string | null | undefined }[]).map(({ label, value }) => (
                <div key={label} className={css.toolPropRow}>
                  <dt className={css.toolPropLabel}>{label}:</dt>
                  <dd className={css.toolPropValue}>
                    {value && value !== "—" ? value : <span className={css.emptyValue}>—</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}

      {/* ── Tools Section ── */}
      <section className={css.section}>
        <h3 className={css.sectionTitle}>
          Tools{" "}
          <span className={css.toolCountBadge}>{tools.length}</span>
        </h3>
        {tools.length > 0 ? (
          <div className={css.toolGrid}>
            {tools.map((tool) => {
              const toolId = String(tool.$primaryKey);
              const linked = toolLinkedMap[toolId];
              const parts = linked?.parts ?? [];
              const manifolds = linked?.manifolds ?? [];

              return (
                <div key={tool.$primaryKey} className={css.toolCard}>
                  <div className={css.toolCardHeader}>
                    {tool.toolNumber
                      ? `Tool #${tool.toolNumber}`
                      : "Unnamed Tool"}
                  </div>

                  {/* Tool properties */}
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

                  {/* Parts sub-section */}
                  {parts.length > 0 && (
                    <div className={css.subSection}>
                      <div className={css.subSectionTitle}>
                        Parts ({parts.length})
                      </div>
                      {parts.map((part, partIdx) => (
                        <React.Fragment key={part.$primaryKey}>
                          {partIdx > 0 && <hr className={css.subItemDivider} />}
                          <dl className={css.toolProps}>
                            {PART_DISPLAY_PROPERTIES.map(({ apiName, label, suffix }) => {
                              const value = part[apiName];
                              if (value == null || value === "") return null;
                              return (
                                <div key={apiName} className={css.toolPropRow}>
                                  <dt className={css.toolPropLabel}>{label}:</dt>
                                  <dd className={css.toolPropValue}>{String(value)}{suffix ?? ""}</dd>
                                </div>
                              );
                            })}
                          </dl>
                        </React.Fragment>
                      ))}
                    </div>
                  )}

                  {/* Manifolds sub-section */}
                  {manifolds.length > 0 && (
                    <div className={css.subSection}>
                      <div className={css.subSectionTitle}>
                        Manifolds ({manifolds.length})
                      </div>
                      {manifolds.map((manifold, manIdx) => (
                        <React.Fragment key={manifold.$primaryKey}>
                          {manIdx > 0 && <hr className={css.subItemDivider} />}
                          <dl className={css.toolProps}>
                            {MANIFOLD_DISPLAY_PROPERTIES.map(({ apiName, label }) => {
                              const value = manifold[apiName];
                              if (value == null || value === "") return null;
                              return (
                                <div key={apiName} className={css.toolPropRow}>
                                  <dt className={css.toolPropLabel}>{label}:</dt>
                                  <dd className={css.toolPropValue}>{String(value)}</dd>
                                </div>
                              );
                            })}
                          </dl>
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className={css.emptyMessage}>No tools found.</p>
        )}
      </section>
    </div>
  );
}

export default ReviewPanel;
