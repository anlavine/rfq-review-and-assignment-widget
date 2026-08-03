import React, { useEffect, useState } from "react";
import { RfqPackage, RfqTool, RfqToolPart } from "@rfq-review-hub-widget-application/sdk";
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
  partNames: string[];
}

/**
 * Loads the tool image (a media reference) and returns a blob URL that can
 * be used as an <img> src. Returns `null` when no image is available or
 * loading fails.
 */
async function loadToolImageUrl(tool: Osdk.Instance<RfqTool>): Promise<string | null> {
  try {
    const media = tool.toolImage;
    if (media) {
      const response = await media.fetchContents();
      if (response.ok) {
        const blob = await response.blob();
        return URL.createObjectURL(blob);
      }
    }
  } catch (e) {
    console.warn("Failed to fetch tool image", { toolId: tool.toolId }, e);
  }
  return null;
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

        // Resolve tool image and linked parts in parallel
        const results = await Promise.all(
          sorted.map(async (tool): Promise<RfqToolRow> => {
            const [imageBlobUrl, partNames] = await Promise.all([
              loadToolImageUrl(tool),
              (async (): Promise<string[]> => {
                try {
                  // Prefer the direct link on the tool
                  const linkPage = await tool.$link.rfqToolPart.fetchPage({ $pageSize: 200 });
                  const names = linkPage.data
                    .map((p: Osdk.Instance<RfqToolPart>) => (p.partName ?? "").trim())
                    .filter((n) => n.length > 0);
                  if (names.length > 0) return names;
                } catch (e) {
                  console.warn("Failed to fetch parts via $link.rfqToolPart", { toolId: tool.toolId }, e);
                }
                // Fallback: query RfqToolPart directly by tool_id.
                // Some data may not have the traversal link populated even
                // though the tool_id foreign key is present.
                try {
                  const toolId = tool.toolId;
                  if (!toolId) return [];
                  const page = await client(RfqToolPart)
                    .where({ toolId: { $eq: toolId } })
                    .fetchPage({ $pageSize: 200 });
                  return page.data
                    .map((p) => (p.partName ?? "").trim())
                    .filter((n) => n.length > 0);
      } catch (e) {
                  console.warn("Failed to fetch parts by tool_id", { toolId: tool.toolId }, e);
                  return [];
        }
              })(),
            ]);
            if (imageBlobUrl && imageBlobUrl.startsWith("blob:")) {
              createdBlobUrls.push(imageBlobUrl);
            }
            return { tool, imageBlobUrl, partNames };
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
          <table className={`${css.table} ${css.centeredTable}`}>
            <colgroup>
              <col style={{ width: "90px" }} />
              <col style={{ width: "14%" }} />
              <col />
              <col style={{ width: "18%" }} />
              <col style={{ width: "18%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Image</th>
                <th>Customer Tool #</th>
                <th>Part Name(s)</th>
                <th>Commodity Category</th>
                <th>Commodity Type</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const t = row.tool;
                const renderCell = (v: string | number | null | undefined) =>
                  v == null || v === "" ? <span className={css.muted}>—</span> : String(v);
                const partNames = row.partNames.length > 0
                  ? row.partNames.join(" | ")
                  : null;

                return (
                  <tr key={String(t.$primaryKey)}>
                    <td>
                      {row.imageBlobUrl ? (
                        <img
                          src={row.imageBlobUrl}
                          alt={`Tool ${t.customerToolNumber ?? t.toolId ?? ""}`}
                          className={css.toolImageLarge}
                          loading="lazy"
                        />
                      ) : (
                        <span className={css.muted}>—</span>
                      )}
                    </td>
                    <td>{renderCell(t.customerToolNumber)}</td>
                    <td>{partNames ?? <span className={css.muted}>—</span>}</td>
                    <td>{renderCell(t.commodityCategory)}</td>
                    <td>{renderCell(t.commodityType)}</td>
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

