import { useEffect, useState } from "react";
import {
  RfqPackage,
  PendingRfqPackage,
  PendingRfqAttachments,
  RfqIngestionErrors,
} from "@rfq-review-hub-widget-application/sdk";
import client from "../client";
import type { Osdk } from "@osdk/client";
import { isInlineImage } from "../utils/attachments";
import type { ConversationSibling } from "./usePendingPackageDetail";

export interface RfqPackageDetailState {
  rfqPkg: Osdk.Instance<RfqPackage> | null;
  /**
   * Display name resolved from the RfqPackage's linked Source Customer Record
   * (Customer → CustomerV2). This is `null` while loading or if the customer
   * could not be resolved.
   */
  customerName: string | null;
  /**
   * The linked Pending RFQ Package, if one exists. `null` when the RFQ
   * package has no pending-package link, e.g. when it was created directly
   * without going through the ingestion pipeline.
   */
  pendingPkg: Osdk.Instance<PendingRfqPackage> | null;
  /** Attachment count for the linked pending package, if any. */
  attachmentCount: number | null;
  /** Conversation siblings from the linked pending package's conversation, if any. */
  conversationSiblings: ConversationSibling[];
  hasPackageError: boolean;
  hasToolError: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * Loads all data required to render an RFQ Package detail view in the
 * assignment tab, including:
 *   - the RFQ Package itself
 *   - the linked Source Customer Record → CustomerV2 (for the display name)
 *   - the linked Pending RFQ Package (if any) so we can show the ingestion
 *     email context (from, body, conversation siblings, ingestion errors)
 */
export function useRfqPackageDetail(
  packageId: string,
  refreshToken?: number,
): RfqPackageDetailState {
  const [rfqPkg, setRfqPkg] = useState<Osdk.Instance<RfqPackage> | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [pendingPkg, setPendingPkg] = useState<Osdk.Instance<PendingRfqPackage> | null>(null);
  const [attachmentCount, setAttachmentCount] = useState<number | null>(null);
  const [conversationSiblings, setConversationSiblings] = useState<ConversationSibling[]>([]);
  const [hasPackageError, setHasPackageError] = useState(false);
  const [hasToolError, setHasToolError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setRfqPkg(null);
    setCustomerName(null);
    setPendingPkg(null);
    setAttachmentCount(null);
    setConversationSiblings([]);
    setHasPackageError(false);
    setHasToolError(false);
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const rfq = await client(RfqPackage).fetchOne(packageId);
        if (cancelled) return;
        setRfqPkg(rfq);

        // ── Resolve Customer name via: RfqPackage → Customer → CustomerV2 ──
        const customerPromise = (async (): Promise<string | null> => {
          try {
            const sourceCustomer = await rfq.$link.customer.fetchOne();
            // Follow the Source Customer Record → CustomerV2 link (many-to-many),
            // then take the first matching CustomerV2's customerName.
            try {
              const cv2Page = await sourceCustomer.$link.betaAdécustomers.fetchPage({
                $pageSize: 1,
              });
              const cv2 = cv2Page.data[0];
              if (cv2?.customerName) return cv2.customerName;
            } catch {
              /* Fall through to companyName */
            }
            // Fall back to the raw company name on the Source Customer Record.
            return sourceCustomer.companyName ?? null;
          } catch {
            return null;
          }
        })();

        // ── Load the linked Pending RFQ Package (if any) ──
        const pendingPromise = (async (): Promise<Osdk.Instance<PendingRfqPackage> | null> => {
          try {
            const linked = await rfq.$link.pendingRfqPackage.fetchOne();
            return linked;
          } catch {
            return null;
          }
        })();

        const [resolvedCustomer, resolvedPending] = await Promise.all([
          customerPromise,
          pendingPromise,
        ]);

        if (cancelled) return;
        setCustomerName(resolvedCustomer);
        setPendingPkg(resolvedPending);

        // ── If we have a linked pending package, hydrate its email context ──
        if (resolvedPending) {
          const pendingId = String(resolvedPending.$primaryKey);
          const pendingEmailId = resolvedPending.emailId;

          const attachmentPromise = (async (): Promise<number> => {
            const fileNames = (resolvedPending.attachmentFileNames ?? []).filter(
              (n) => !isInlineImage(n),
            );
            if (!pendingEmailId || fileNames.length === 0) return 0;
            try {
              const page = await client(PendingRfqAttachments)
                .where({
                  $and: [
                    { fileName: { $in: fileNames } },
                    { emailId: { $eq: pendingEmailId } },
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
            const convId = resolvedPending.conversationId;
            if (!convId) return [];
            try {
              const page = await client(PendingRfqPackage)
                .where({ conversationId: { $eq: convId } })
                .fetchPage({ $pageSize: 50, $orderBy: { receivedDate: "asc" } });
              const siblings = page.data.filter((p) => String(p.$primaryKey) !== pendingId);
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
                    // ignore
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
            if (!pendingEmailId) return { hasPackageError: false, hasToolError: false };
            try {
              const page = await client(RfqIngestionErrors)
                .where({ emailId: { $eq: pendingEmailId } })
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

          const [resolvedAttachments, resolvedSiblings, resolvedErrors] = await Promise.all([
            attachmentPromise,
            conversationPromise,
            errorsPromise,
          ]);

          if (cancelled) return;
          setAttachmentCount(resolvedAttachments);
          setConversationSiblings(resolvedSiblings);
          setHasPackageError(resolvedErrors.hasPackageError);
          setHasToolError(resolvedErrors.hasToolError);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load RFQ package details");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [packageId, refreshToken]);

  return {
    rfqPkg,
    customerName,
    pendingPkg,
    attachmentCount,
    conversationSiblings,
    hasPackageError,
    hasToolError,
    loading,
    error,
  };
}
