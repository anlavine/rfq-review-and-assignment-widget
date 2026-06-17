import { createRfqIngestionUsageMetric } from "@rfq-review-hub-widget-application/sdk";
import { Users } from "@osdk/foundry.admin";
import client from "../client";

/** Interaction keys for usage tracking */
export const INTERACTION_KEYS = {
  // Filters
  FILTER_DUE_DATE: "filter.dueDate",
  FILTER_SUBJECT: "filter.subject",
  FILTER_CUSTOMER: "filter.customer",
  FILTER_PLATFORM: "filter.platform",
  FILTER_TAGS: "filter.tags",
  FILTER_HAS_PARSED_TOOLS: "filter.hasParsedTools",
  FILTER_SENDER: "filter.sender",
  // Package actions
  PACKAGE_SKIP: "package.skip",
  PACKAGE_UNSKIP: "package.unskip",
  PACKAGE_EDIT_TAGS: "package.editTags",
  PACKAGE_BULK_SKIP: "package.bulkSkip",
  PACKAGE_MERGE: "package.merge",
  PACKAGE_SPLIT: "package.split",
  PACKAGE_LINK_TO_RFQ: "package.linkToRfq",
  PACKAGE_EDIT_DUE_DATE: "package.editDueDate",
  PACKAGE_EDIT_CUSTOMER: "package.editCustomer",
  PACKAGE_MARK_OUTSTANDING: "package.markOutstanding",
  PACKAGE_CREATE: "package.create",
  // Tool actions
  TOOL_REMOVE: "tool.remove",
  TOOL_UNREMOVE: "tool.unremove",
  // Other
  ATTACHMENT_DOWNLOAD: "attachment.download",
  FEEDBACK_SUBMIT: "feedback.submit",
  UI_TOGGLE_THEME: "ui.toggleTheme",
} as const;

export type InteractionKey = (typeof INTERACTION_KEYS)[keyof typeof INTERACTION_KEYS];

/** Cached user ID — fetched once on first usage */
let cachedUserId: string | null = null;
let userIdPromise: Promise<string | null> | null = null;

async function getCurrentUserId(): Promise<string | null> {
  if (cachedUserId) return cachedUserId;
  if (userIdPromise) return userIdPromise;

  userIdPromise = (async () => {
    try {
      const user = await Users.getCurrent(client);
      cachedUserId = user.id;
      return cachedUserId;
    } catch (e) {
      console.error("Failed to fetch current user:", e);
      return null;
    }
  })();

  return userIdPromise;
}

/**
 * Logs a usage metric. Fire-and-forget — errors are silently swallowed.
 */
export function trackUsage(interactionKey: InteractionKey): void {
  (async () => {
    try {
      const userId = await getCurrentUserId();

      await client(createRfqIngestionUsageMetric).applyAction({
        interactionKey,
        interactionTimestamp: new Date().toISOString(),
        usageMinutes: null,
        userId: userId ?? null,
      });
    } catch {
      // Silently swallow — tracking should never block the user
    }
  })();
}
