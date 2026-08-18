import { RfqTool } from "@rfq-review-hub-widget-application/sdk";
import type { Osdk } from "@osdk/client";
import client from "../client";

/** Batch size for `$in` queries — matches the convention in usePriorityScores.ts. */
const IN_CHUNK_SIZE = 50;
const FETCH_PAGE_SIZE = 500;

export interface DuplicatePackageInfo {
  count: number;
  packageIds: string[];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Resolves, for each given RFQ Package id, the set of *other* RFQ Package
 * ids that share at least one tool "related tool group" — i.e. packages
 * with duplicate/shared tooling.
 *
 * Uses the `RfqTool -> relatedRfqToolGroup -> relatedTools` link chain
 * (mirrors the Foundry Function equivalent's `searchAroundRelatedRfqToolGroup()
 * .searchAroundRelatedTools()`), pivoting from the requested packages' own
 * tools out to their tool group and back to every tool in that group —
 * which necessarily includes the requested packages' own tools too, so a
 * single query does double duty as both "which groups apply to my
 * packages" and "who else is in those groups". Batched via `$in` regardless
 * of how many package ids are passed, rather than querying per package.
 */
export async function resolveDuplicatePackages(
  packageIds: readonly string[],
): Promise<Map<string, DuplicatePackageInfo>> {
  const result = new Map<string, DuplicatePackageInfo>();
  const uniqueIds = Array.from(new Set(packageIds.filter((id) => id && id.trim() !== "")));
  if (uniqueIds.length === 0) return result;
  for (const id of uniqueIds) result.set(id, { count: 0, packageIds: [] });

  try {
    const uniqueIdSet = new Set(uniqueIds);
    const memberTools: Osdk.Instance<RfqTool>[] = [];

    for (const idChunk of chunk(uniqueIds, IN_CHUNK_SIZE)) {
      let token: string | undefined;
      do {
        const page = await client(RfqTool)
          .where({ packageId: { $in: idChunk } })
          .pivotTo("relatedRfqToolGroup")
          .pivotTo("relatedTools")
          .fetchPage({ $pageSize: FETCH_PAGE_SIZE, ...(token ? { $nextPageToken: token } : {}) });
        memberTools.push(...page.data);
        token = page.nextPageToken;
      } while (token);
    }

    // Two maps built from one result set: which groups apply to each of
    // *our* requested packages, and — across every package the pivot
    // reached, not just ours — who else belongs to each of those groups.
    const groupIdsByPackage = new Map<string, Set<string>>();
    const packagesByGroup = new Map<string, Set<string>>();
    for (const tool of memberTools) {
      const groupId = tool.relatedToolGroupId?.trim();
      const packageId = tool.packageId?.trim();
      if (!groupId || !packageId) continue;

      const groupMembers = packagesByGroup.get(groupId) ?? new Set<string>();
      groupMembers.add(packageId);
      packagesByGroup.set(groupId, groupMembers);

      if (uniqueIdSet.has(packageId)) {
        const groups = groupIdsByPackage.get(packageId) ?? new Set<string>();
        groups.add(groupId);
        groupIdsByPackage.set(packageId, groups);
      }
    }

    for (const id of uniqueIds) {
      const groupIds = groupIdsByPackage.get(id);
      if (!groupIds) continue;
      const others = new Set<string>();
      for (const groupId of groupIds) {
        for (const memberId of packagesByGroup.get(groupId) ?? []) {
          if (memberId !== id) others.add(memberId);
        }
      }
      result.set(id, { count: others.size, packageIds: Array.from(others).sort() });
    }
  } catch (e) {
    console.error("Failed to resolve duplicate packages:", e);
    // Non-critical — leave everything at the zero-duplicate default set above.
  }

  return result;
}
