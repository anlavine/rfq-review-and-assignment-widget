/**
 * Thin wrapper around the Workshop iframe custom widget hook.
 *
 * Exports the typed context so that components can read/write Workshop
 * variables and fire Workshop events without repeating boilerplate.
 */
import {
  useWorkshopContext,
  type IWorkshopContext,
  type IAsyncValue,
} from "@osdk/workshop-iframe-custom-widget";
import { WORKSHOP_CONFIG } from "./workshopConfig";

export type WorkshopContext = IWorkshopContext<typeof WORKSHOP_CONFIG>;

export function useWorkshop(): IAsyncValue<WorkshopContext> {
  return useWorkshopContext<typeof WORKSHOP_CONFIG>(WORKSHOP_CONFIG);
}
