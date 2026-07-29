import { useEffect, useState } from "react";
import {
  PendingRfqPackage,
  PendingRfqAttachments,
  PendingRfqPriority,
  RfqIngestionErrors,
  Employee,
} from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import type { Osdk } from "@osdk/client";
import { isInlineImage } from "../utils/attachments";
import { resolvePriorityForRow, type PriorityFactors } from "./usePriorityScores";

export interface ConversationSibling {
  packageId: string;
  packageName: string | undefined;
  subject: string | undefined;
  completionStatus: string | undefined;
  receivedDate: string | undefined;
  receivedDatetime: string | undefined;
  toolCount: number | null;
}

export interface PendingPackageDetailState {
  pkg: Osdk.Instance<PendingRfqPackage> | null;
  customerName: string | null;
  toolCount: number | null;
  attachmentCount: number | null;
  conversationSiblings: ConversationSibling[];
  hasPackageError: boolean;
  hasToolError: boolean;
  priorityScore: number | null;
  isNetNewCustomer: boolean;
  /**
   * The six factors that inform the priority score for this package, or
   * `null` if there is no `PendingRfqPriority` row for the package.
   */
  priorityFactors: PriorityFactors | null;
  /**
   * Display name of the assigned estimator resolved via the
   * `assignedEstimator` foreign key on PendingRfqPackage. `null` when
   * no estimator is assigned or the lookup failed.
   */
  assignedEstimatorName: string | null;
  loading: boolean;
  error: string | null;
  /** Replace the loaded package instance in local state (e.g. after an action). */
  setPkg: (pkg: Osdk.Instance<PendingRfqPackage>) => void;
  /** Update the resolved customer name in local state (e.g. after an action). */
  setCustomerName: (name: string | null) => void;
}

/**
 * Loads all data required to render a full Pending RFQ Package detail view.
 *
 * The data is refetched whenever `packageId` or `refreshToken` changes.
 */
export function usePendingPackageDetail(
  packageId: string,
  refreshToken?: number,
): PendingPackageDetailState {
  const [pkg, setPkg] = useState<Osdk.Instance<PendingRfqPackage> | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [attachmentCount, setAttachmentCount] = useState<number | null>(null);
  const [conversationSiblings, setConversationSiblings] = useState<ConversationSibling[]>([]);
  const [hasPackageError, setHasPackageError] = useState(false);
  const [hasToolError, setHasToolError] = useState(false);
  const [priorityScore, setPriorityScore] = useState<number | null>(null);
  const [isNetNewCustomer, setIsNetNewCustomer] = useState<boolean>(false);
  const [priorityFactors, setPriorityFactors] = useState<PriorityFactors | null>(null);
  const [assignedEstimatorName, setAssignedEstimatorName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setPkg(null);
    setCustomerName(null);
    setToolCount(null);
    setAttachmentCount(null);
    setConversationSiblings([]);
    setHasPackageError(false);
    setHasToolError(false);
    setPriorityScore(null);
    setIsNetNewCustomer(false);
    setPriorityFactors(null);
    setAssignedEstimatorName(null);
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const obj = await client(PendingRfqPackage).fetchOne(packageId);
        if (cancelled) return;
        setPkg(obj);

        const customerPromise = (async () => {
          try {
            const customerPage = await client(PendingRfqPackage)
              .where({ packageId: { $eq: packageId } })
              .pivotTo("betaAdécustomer")
              .fetchPage({ $pageSize: 1 });
            return customerPage.data[0]?.customerName ?? null;
          } catch {
            return null;
          }
        })();

        const toolCountPromise = (async () => {
          try {
            const toolPage = await client(PendingRfqPackage)
              .where({ packageId: { $eq: packageId } })
              .pivotTo("pendingRfqPackageTools")
              .fetchPage({ $pageSize: 200 });
            return toolPage.data.length;
          } catch {
            return 0;
          }
        })();

        const attachmentCountPromise = (async () => {
          const emailId = obj.emailId;
          const fileNames = (obj.attachmentFileNames ?? []).filter((n) => !isInlineImage(n));
          if (!emailId || fileNames.length === 0) return 0;
          try {
            const page = await client(PendingRfqAttachments)
              .where({
                $and: [
                  { fileName: { $in: fileNames } },
                  { emailId: { $eq: emailId } },
                ],
              })
              .fetchPage({ $pageSize: 200 });
            const seen = new Set<string>();
            for (const att of page.data) {
              if (att.fileName) seen.add(att.fileName);
            }
            return seen.size;
          } catch {
            return 0;
          }
        })();

        const conversationPromise = (async (): Promise<ConversationSibling[]> => {
          const convId = obj.conversationId;
          if (!convId) return [];
          try {
            const page = await client(PendingRfqPackage)
              .where({ conversationId: { $eq: convId } })
              .fetchPage({ $pageSize: 50, $orderBy: { receivedDate: "asc" } });
            const siblings = page.data.filter((p) => String(p.$primaryKey) !== packageId);
            const siblingResults = await Promise.all(
              siblings.map(async (p) => {
                let sibToolCount: number | null = null;
                try {
                  const toolPage = await client(PendingRfqPackage)
                    .where({ packageId: { $eq: String(p.$primaryKey) } })
                    .pivotTo("pendingRfqPackageTools")
                    .fetchPage({ $pageSize: 200 });
                  sibToolCount = toolPage.data.length;
                } catch {
                  // leave as null
                }
                return {
                  packageId: String(p.$primaryKey),
                  packageName: p.packageName,
                  subject: p.subject,
                  completionStatus: p.completionStatus,
                  receivedDate: p.receivedDate,
                  receivedDatetime: p.receivedDatetime,
                  toolCount: sibToolCount,
                };
              }),
            );
            return siblingResults;
          } catch {
            return [];
          }
        })();

        const errorsPromise = (async () => {
          const emailId = obj.emailId;
          if (!emailId) return { hasPackageError: false, hasToolError: false };
          try {
            const page = await client(RfqIngestionErrors)
              .where({ emailId: { $eq: emailId } })
              .fetchPage({ $pageSize: 200 });
            let pkgErr = false;
            let toolErr = false;
            for (const err of page.data) {
              if (err.agentId?.toLowerCase().includes("package")) {
                pkgErr = true;
              } else {
                toolErr = true;
              }
              if (pkgErr && toolErr) break;
            }
            return { hasPackageError: pkgErr, hasToolError: toolErr };
          } catch {
            return { hasPackageError: false, hasToolError: false };
          }
        })();

        const assignedEstimatorPromise = (async (): Promise<string | null> => {
          const estimatorId = obj.assignedEstimator;
          if (!estimatorId || estimatorId.trim() === "") return null;
          try {
            const emp = await client(Employee).fetchOne(estimatorId);
            const fromDisplay = emp.displayName;
            if (fromDisplay && fromDisplay.trim() !== "") return fromDisplay;
            const fromParts = [emp.firstName, emp.lastName]
              .filter(Boolean)
              .join(" ")
              .trim();
            return fromParts !== "" ? fromParts : null;
          } catch {
            return null;
          }
        })();

        const priorityPromise = (async (): Promise<{
          priorityScore: number | null;
          isNetNewCustomer: boolean;
          priorityFactors: PriorityFactors | null;
        }> => {
          try {
            // `packageId1` — not `packageId` — is the join key back to the
            // `PendingRfqPackage.$primaryKey`. The row's own `packageId`
            // is a combined pending+rfq id and would not match the bare
            // pending id passed in here.
            const page = await client(PendingRfqPriority)
              .where({ packageId1: { $eq: packageId } })
              .fetchPage({ $pageSize: 1 });
            const row = page.data[0];
            if (!row) {
              return { priorityScore: null, isNetNewCustomer: false, priorityFactors: null };
            }
            // `resolvePriorityForRow` picks the pending-vs-rfq variant based
            // on whether the row is linked to an RFQ Package (strict — no
            // fallback between variants).
            const resolved = resolvePriorityForRow(row);
            return {
              priorityScore: resolved.score,
              isNetNewCustomer: resolved.isNetNewCustomer,
              priorityFactors: resolved.factors,
            };
          } catch {
            return { priorityScore: null, isNetNewCustomer: false, priorityFactors: null };
          }
        })();

        const [
          resolvedCustomer,
          resolvedToolCount,
          resolvedAttachmentCount,
          resolvedSiblings,
          resolvedErrors,
          resolvedPriority,
          resolvedEstimatorName,
        ] = await Promise.all([
          customerPromise,
          toolCountPromise,
          attachmentCountPromise,
          conversationPromise,
          errorsPromise,
          priorityPromise,
          assignedEstimatorPromise,
        ]);

        if (cancelled) return;
        setCustomerName(resolvedCustomer);
        setToolCount(resolvedToolCount);
        setAttachmentCount(resolvedAttachmentCount);
        setConversationSiblings(resolvedSiblings);
        setHasPackageError(resolvedErrors.hasPackageError);
        setHasToolError(resolvedErrors.hasToolError);
        setPriorityScore(resolvedPriority.priorityScore);
        setIsNetNewCustomer(resolvedPriority.isNetNewCustomer);
        setPriorityFactors(resolvedPriority.priorityFactors);
        setAssignedEstimatorName(resolvedEstimatorName);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load package details");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [packageId, refreshToken]);

  return {
    pkg,
    customerName,
    toolCount,
    attachmentCount,
    conversationSiblings,
    hasPackageError,
    hasToolError,
    priorityScore,
    isNetNewCustomer,
    priorityFactors,
    assignedEstimatorName,
    loading,
    error,
    setPkg,
    setCustomerName,
  };
}
