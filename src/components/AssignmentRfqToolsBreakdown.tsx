import React, { useEffect, useState } from "react";
import { RfqPackage, RfqTool } from "@rfq-review-hub-widget-application/sdk";
import type { Osdk } from "@osdk/client";
import client from "../client";
import css from "./AssignmentToolsBreakdown.module.css";
import { compareToolNumber } from "../utils/sortTools";

interface AssignmentRfqToolsBreakdownProps {
  packageId: string;
  refreshToken?: number;
}

interface RfqToolRow {
  tool: Osdk.Instance<RfqTool>;
  imageBlobUrl: string | null;
}

/**
 * Loads the tool image attachment (if present) and returns a blob URL that
 * can be used as an <img> src. Returns `null` on failure or when no image
 * is available.
 */
async function loadToolImageUrl(tool: Osdk.Instance<RfqTool>): Promise<string | null> {
  try {
    const attachment = tool.toolImageAttachment;
    if (attachment) {
      const response = await attachment.fetchContents();
      if (response.ok) {
        const blob = await response.blob();
        return URL.createObjectURL(blob);
      }
    }
  } catch {
    // Fall through to imageUrl fallback
  }
  // Fallback to any raw image URL stored on the tool
  return tool.imageUrl ?? null;
}

/**
 * A table of the tools attached to an RFQ Package. Shows the same fields as
 * appear on the tool object plus a rendered image column.
 *
 * Tools are sorted using compareToolNumber (customer tool number is used as
 * the primary sort key, with the pool of related tool numbers as tiebreaker).
 */
function AssignmentRfqToolsBreakdown({
  packageId,
  refreshToken,
}: AssignmentRfqToolsBreakdownProps): React.ReactElement {
  const [rows, setRows] = useState<RfqToolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const createdBlobUrls: string[] = [];

    setRows([]);
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Fetch tools via the ontology link
        const toolPage = await client(RfqPackage)
          .where({ packageId: { $eq: packageId } })
          .pivotTo("rfqTool")
          .fetchPage({ $pageSize: 200 });

        const sorted = [...toolPage.data].sort((a, b) =>
          compareToolNumber(a.customerToolNumber, b.customerToolNumber, undefined, undefined),
        );

        // Resolve tool images in parallel
        const results = await Promise.all(
          sorted.map(async (tool): Promise<RfqToolRow> => {
            const imageBlobUrl = await loadToolImageUrl(tool);
            if (imageBlobUrl && imageBlobUrl.startsWith("blob:")) {
              createdBlobUrls.push(imageBlobUrl);
            }
            return { tool, imageBlobUrl };
          }),
        );

        if (cancelled) {
          // Release any blob URLs we allocated before the effect was cancelled
          for (const url of createdBlobUrls) URL.revokeObjectURL(url);
          return;
        }
        setRows(results);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load tools");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      for (const url of createdBlobUrls) URL.revokeObjectURL(url);
    };
  }, [packageId, refreshToken]);

  return (
    <section className={css.section}>
      <div className={css.sectionHeader}>
        <h3 className={css.sectionTitle}>Tools</h3>
        {!loading && !error && (
          <span className={css.countBadge}>{rows.length}</span>
        )}
      </div>

      {loading ? (
        <p className={css.loading}>Loading tools…</p>
      ) : error ? (
        <p className={css.emptyMessage}>Error loading tools: {error}</p>
      ) : rows.length === 0 ? (
        <p className={css.emptyMessage}>No tools found for this package.</p>
      ) : (
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead>
              <tr>
                <th>Image</th>
                <th>Customer Tool #</th>
                <th>Tool Status</th>
                <th>Won Status</th>
                <th>Commodity Category</th>
                <th>Commodity Type</th>
                <th>Mold Type</th>
                <th>Cavitation</th>
                <th>Est. Kick Off</th>
                <th>Est. T1</th>
                <th>Target Price</th>
                <th>Client Currency Price</th>
                <th>Client Currency</th>
                <th>Customer Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const t = row.tool;
                const renderCell = (v: string | number | null | undefined) =>
                  v == null || v === "" ? <span className={css.muted}>—</span> : String(v);

                return (
                  <tr key={String(t.$primaryKey)}>
                    <td>
                      {row.imageBlobUrl ? (
                        <img
                          src={row.imageBlobUrl}
                          alt={`Tool ${t.customerToolNumber ?? t.toolId ?? ""}`}
                          className={css.toolImage}
                          loading="lazy"
                        />
                      ) : (
                        <span className={css.muted}>—</span>
                      )}
                    </td>
                    <td>{renderCell(t.customerToolNumber)}</td>
                    <td>{renderCell(t.toolStatus)}</td>
                    <td>{renderCell(t.toolWonStatus)}</td>
                    <td>{renderCell(t.commodityCategory)}</td>
                    <td>{renderCell(t.commodityType)}</td>
                    <td>{renderCell(t.moldType)}</td>
                    <td>{renderCell(t.cavitation)}</td>
                    <td className={css.numeric}>{renderCell(t.estimatedKickOffDate)}</td>
                    <td className={css.numeric}>{renderCell(t.estimatedT1Date)}</td>
                    <td className={css.numeric}>{renderCell(t.targetPrice)}</td>
                    <td className={css.numeric}>{renderCell(t.clientCurrencyPrice)}</td>
                    <td>{renderCell(t.clientCurrency)}</td>
                    <td>{renderCell(t.customerNote)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default AssignmentRfqToolsBreakdown;
