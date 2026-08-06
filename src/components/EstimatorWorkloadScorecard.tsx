import React, { useState } from "react";
import ReactDOM from "react-dom";
import css from "./EstimatorWorkloadScorecard.module.css";
import { useEstimatorWorkload } from "../hooks/useEstimatorWorkload";

interface EstimatorWorkloadScorecardProps {
  /** Bumping this value refetches workload counts. */
  refreshToken?: number;
}

/**
 * Compact trigger that slides out a panel over the right side of the
 * Assignment tab (roughly where the detail view sits), ranking eligible
 * estimators by current workload — number of active packages assigned to
 * them, tiebroken by total tool count across those packages. Starts
 * collapsed; the panel overlays rather than pushing the list/detail layout
 * around, since it only needs a narrow width to show its content.
 *
 * Workload data is preloaded as soon as this mounts (i.e. as soon as the
 * Assignment tab is active), not deferred until the panel is first
 * expanded, so clicking the trigger shows an already-populated table
 * instead of a loading flash.
 */
function EstimatorWorkloadScorecard({ refreshToken }: EstimatorWorkloadScorecardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const { rows, loading, error } = useEstimatorWorkload(true, refreshToken);

  return (
    <>
      <button
        type="button"
        className={`${css.trigger} ${expanded ? css.triggerActive : ""}`}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className={css.triggerIcon} aria-hidden="true">📊</span>
        <span className={css.triggerLabel}>Estimator Workload</span>
        <span className={css.chevron} aria-hidden="true">{expanded ? "✕" : "›"}</span>
      </button>

      {ReactDOM.createPortal(
        <div className={`${css.panel} ${expanded ? css.panelOpen : ""}`}>
          <div className={css.panelHeader}>
            <span className={css.panelTitle}>Estimator Workload</span>
            {!loading && !error && (
              <span className={css.count}>{rows.length} estimators</span>
            )}
            <button
              type="button"
              className={css.closeButton}
              onClick={() => setExpanded(false)}
              aria-label="Close estimator workload panel"
            >
              ✕
            </button>
          </div>
          <div className={css.panelBody}>
            {loading ? (
              <div className={css.emptyState}>Loading workload…</div>
            ) : error ? (
              <div className={`${css.emptyState} ${css.emptyStateError}`}>Error: {error}</div>
            ) : rows.length === 0 ? (
              <div className={css.emptyState}>No eligible estimators found.</div>
            ) : (
              <div className={css.tableWrap}>
                <table className={css.table}>
                  <thead>
                    <tr>
                      <th className={css.rankCol}>#</th>
                      <th>Estimator</th>
                      <th className={css.numCol}>Packages</th>
                      <th className={css.numCol}>Tools</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={row.id}>
                        <td className={css.rankCol}>{i + 1}</td>
                        <td>{row.name}</td>
                        <td className={css.numCol}>{row.packageCount}</td>
                        <td className={css.numCol}>{row.toolCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export default EstimatorWorkloadScorecard;
