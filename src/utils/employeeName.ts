import { Employee } from "@rfq-review-hub-widget-application/sdk";
import type { Osdk } from "@osdk/client";

/** Display-friendly name for an Employee: displayName, else first+last name, else company email, else primary key. */
export function resolveEmployeeName(emp: Osdk.Instance<Employee>): string {
  if (emp.displayName && emp.displayName.trim() !== "") return emp.displayName;
  const combined = [emp.firstName, emp.lastName].filter(Boolean).join(" ").trim();
  if (combined !== "") return combined;
  return emp.companyEmail ?? String(emp.$primaryKey);
}
