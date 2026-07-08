import React, { useEffect, useState } from "react";
import {
  PendingRfqPackage,
  PendingRFQPackageTool,
  PendingRfqPackagePart,
} from "@rfq-review-hub-widget-application/sdk";
import type { Osdk } from "@osdk/client";
import client from "../client";
import css from "./AssignmentToolsBreakdown.module.css";
import { compareToolNumber } from "../utils/sortTools";

interface AssignmentToolsBreakdownProps {
  packageId: string;
  refreshToken?: number;
}

interface ToolRow {
  tool: Osdk.Instance<PendingRFQPackageTool>;
  partNames: string[];
}

/**
 * A compact table of the tools attached to a Pending RFQ Package, showing
 * only the fields needed at the assignment stage: Tool #, Customer Tool #,
 * Part Name(s), Commodity Category, Commodity Type.
 *
 * Removed tools are excluded. Tools are sorted using compareToolNumber.
 */
function AssignmentToolsBreakdown({
  packageId,
  refreshToken,
}: AssignmentToolsBreakdownProps): React.ReactElement {
  const [rows, setRows] = useState<ToolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setRows([]);
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Fetch tools via the ontology link
        const toolPage = await client(PendingRfqPackage)
          .where({ packageId: { $eq: packageId } })
          .pivotTo("pendingRfqPackageTools")
          .fetchPage({ $pageSize: 200 });

        // Exclude removed tools, then sort
        const activeTools = toolPage.data.filter((t) => !t.removed);
        const sorted = [...activeTools].sort((a, b) =>
          compareToolNumber(a.customerToolNumber, b.customerToolNumber, a.toolNumber, b.toolNumber),
        );

        // Fetch linked parts for each tool in parallel to collect part names
        const results = await Promise.all(
          sorted.map(async (tool): Promise<ToolRow> => {
            let parts: Osdk.Instance<PendingRfqPackagePart>[] = [];
            try {
              const page = await tool.$link.pendingRfqPackageParts.fetchPage({ $pageSize: 200 });
              parts = page.data;
            } catch {
              // ignore — parts are non-critical
            }
            const partNames = parts
              .map((p) => (p.partName ?? "").trim())
              .filter((n) => n.length > 0);
            return { tool, partNames };
          }),
        );

        if (cancelled) return;
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
                <th>Customer Tool #</th>
                <th>Part Name(s)</th>
                <th>Commodity Category</th>
                <th>Commodity Type</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const customerToolNumber = row.tool.customerToolNumber ?? "";
                const partNames = row.partNames.length > 0
                  ? row.partNames.join(" | ")
                  : null;
                const commodityCategory = row.tool.commodityCategory ?? null;
                const commodityType = row.tool.commodityType ?? null;

                return (
                  <tr key={String(row.tool.$primaryKey)}>
                    <td>
                      {customerToolNumber ? (
                        customerToolNumber
                      ) : (
                        <span className={css.muted}>—</span>
                      )}
                    </td>
                    <td>
                      {partNames ?? <span className={css.muted}>—</span>}
                    </td>
                    <td>
                      {commodityCategory ?? <span className={css.muted}>—</span>}
                    </td>
                    <td>
                      {commodityType ?? <span className={css.muted}>—</span>}
                    </td>
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

export default AssignmentToolsBreakdown;
