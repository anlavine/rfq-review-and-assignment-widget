/**
 * Workshop iframe widget configuration.
 *
 * Defines the variables and events that this app exposes to Workshop
 * when embedded as a Bidirectional Iframe widget.
 *
 * Variables:
 *   - selectedPackageId: The package ID of the currently selected Pending RFQ Package.
 *   - selectedToolIds: A list of tool IDs for the tools associated with the selected package.
 *
 * Events:
 *   - createPackageEvent: Fired when the user clicks "Create Package" in the review panel.
 *     Workshop can bind this to switch tabs, open overlays, trigger actions, etc.
 */
export const WORKSHOP_CONFIG = [
  {
    fieldId: "selectedPackageId",
    field: {
      type: "single",
      label: "Selected Package ID",
      helperText:
        "The package ID of the currently reviewed Pending RFQ Package.",
      fieldValue: {
        type: "inputOutput",
        variableType: {
          type: "string",
          defaultValue: undefined,
        },
      },
    },
  },
  {
    fieldId: "selectedToolIds",
    field: {
      type: "single",
      label: "Selected Tool IDs",
      helperText:
        "A list of tool IDs for the tools linked to the selected package.",
      fieldValue: {
        type: "inputOutput",
        variableType: {
          type: "string-list",
          defaultValue: undefined,
        },
      },
    },
  },
  {
    fieldId: "createPackageEvent",
    field: {
      type: "single",
      label: "Create Package Event",
      helperText:
        "Fired when the user clicks Create Package. Bind to a Workshop event to switch tabs.",
      fieldValue: {
        type: "event",
      },
    },
  },
] as const;
