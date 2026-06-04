/**
 * Phase 3.2: consent capture for the CA B&P §17550 disclosures.
 *
 * The booking form's consent checkbox was client-only — it gated the submit
 * button but was never persisted, so a chargeback had no "the customer affirmed
 * the disclosures + cancellation policy at this time" evidence. This records it.
 *
 * `DISCLOSURE_VERSION` stamps WHICH version of the disclosure text the customer
 * accepted. Bump it whenever the §17550 / cancellation-policy wording changes,
 * so an old consent record always points at the text that was actually shown.
 */
export const DISCLOSURE_VERSION = "2026-06-cst-v1";

export function consentFields(
  accepted: boolean | undefined,
  now: Date,
): { disclaimerAcceptedAt: Date | null; disclaimerVersion: string | null } {
  return accepted
    ? { disclaimerAcceptedAt: now, disclaimerVersion: DISCLOSURE_VERSION }
    : { disclaimerAcceptedAt: null, disclaimerVersion: null };
}
