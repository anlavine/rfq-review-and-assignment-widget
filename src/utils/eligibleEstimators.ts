/**
 * Fixed allowlist of employees eligible to be assigned to a package.
 *
 * Used by both the Assign To modal and the Ingestion tab's "Assigned To"
 * filter so that only relevant employees show up in either UI.
 */
export const ELIGIBLE_ESTIMATOR_EMAILS = [
  "cgulisano@teamintegrity.com",
  "cparete@teamintegrity.com",
  "mrodriguez@teamintegrity.com",
  "mscipione@teamintegrity.com",
  "dbakker@teamintegrity.com",
  "rrodriguez@teamintegrity.com",
  "disley@teamintegrity.com",
  "bcollins@integritytn.com",
  "csorrells@integritytn.com",
  "agruening@teamintegrity.com",
  "dbondy@integritytn.com",
  "zwarner@integritytn.com",
  "jparker@integritytn.com",
  "bwatson@integritytn.com",
  "dreiss@integritytn.com",
  "skenley@integritytn.com",
];

export const ELIGIBLE_ESTIMATOR_EMAIL_SET = new Set(
  ELIGIBLE_ESTIMATOR_EMAILS.map((e) => e.toLowerCase()),
);
