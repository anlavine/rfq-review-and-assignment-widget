export interface Contact {
  address: string;
  name: string | null;
}

/**
 * Extracts a Contact from an emailAddress wrapper object.
 * Expected shape: { emailAddress: { name: "...", address: "..." } }
 */
function extractContact(entry: Record<string, unknown>): Contact {
  const emailObj = entry.emailAddress as Record<string, unknown> | undefined;
  if (emailObj && typeof emailObj === "object") {
    return {
      address: String(emailObj.address ?? ""),
      name: (emailObj.name as string) ?? null,
    };
  }
  return {
    address: String(entry.address ?? ""),
    name: (entry.name as string) ?? null,
  };
}

/**
 * Parses a "to" field value.
 * Format: JSON array of { emailAddress: { name, address } } objects.
 * e.g. [{"emailAddress":{"name":"EC RFQ","address":"EC_RFQ@NYXINC.COM"}}]
 */
export function parseToContacts(raw: string | undefined): Contact[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw.replace(/'/g, '"'));
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => extractContact(entry as Record<string, unknown>));
    }
  } catch {
    // Not valid JSON
  }
  return [{ address: raw, name: null }];
}

/**
 * Parses a "from" field value.
 * Format: a single JSON object { emailAddress: { name, address } }.
 * e.g. {"emailAddress":{"name":"Greg Dante","address":"gdante@team.com"}}
 */
export function parseFromContact(raw: string | undefined): Contact[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw.replace(/'/g, '"'));
    if (typeof parsed === "object" && parsed !== null) {
      return [extractContact(parsed as Record<string, unknown>)];
    }
  } catch {
    // Not valid JSON
  }
  return [{ address: raw, name: null }];
}
