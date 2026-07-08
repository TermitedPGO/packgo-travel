/**
 * guestNoiseGate — the ONE noise gate applied verbatim on every guest surface
 * (list / badge / search / recentContacts). v802 (2026-07-07).
 *
 * Three canonical fixtures the monitor requires (each behaves the same on every
 * surface, because every surface calls THIS function):
 *   - Ann   (inbound-only, real personal domain, latest inbound not spam) → SHOWN
 *   - noise (known-noise sender domain / localpart)                       → HIDDEN
 *   - spam  (latest inbound is effective spam)                            → HIDDEN
 * Plus the exemptions that keep the gate scoped to genuine inbound-only noise:
 *   - registered account (userId set)                     → never gated
 *   - content-qualified guest (manual/inquiry/escalation) → never gated
 *   - no-inbound profile (booking-only, reached by search) → never gated
 * `latestInboundIsSpam` already folds the rescue convention upstream
 * (classification='spam' AND spamVerdict != 'rescued'), so a rescued inbound
 * arrives here as false and is not gated.
 */

import { describe, it, expect } from "vitest";
import { isNoiseOnlyGuest } from "./guestNoiseGate";

const ANN = {
  userId: null,
  email: "ayuan@axt.com",
  qualifiesViaContent: false,
  hasInbound: true,
  latestInboundIsSpam: false,
};

describe("isNoiseOnlyGuest — three fixtures", () => {
  it("Ann (inbound-only, real personal domain, not spam) is NOT gated → shown", () => {
    expect(isNoiseOnlyGuest(ANN)).toBe(false);
  });

  it("known-noise senders ARE gated → hidden", () => {
    expect(isNoiseOnlyGuest({ ...ANN, email: "hi@substack.com" })).toBe(true); // domain
    expect(isNoiseOnlyGuest({ ...ANN, email: "alerts@chase.com" })).toBe(true); // localpart prefix
    expect(isNoiseOnlyGuest({ ...ANN, email: "no-reply@united.com" })).toBe(true); // noreply-class
    expect(isNoiseOnlyGuest({ ...ANN, email: "newsletter@brand.io" })).toBe(true); // newsletter@
  });

  it("latest inbound is effective spam IS gated → hidden (even on a clean domain)", () => {
    expect(
      isNoiseOnlyGuest({ ...ANN, email: "customer@example.com", latestInboundIsSpam: true }),
    ).toBe(true);
  });
});

describe("isNoiseOnlyGuest — exemptions keep the gate scoped to inbound-only noise", () => {
  it("a registered account (userId set) is NEVER gated, even noise + spam", () => {
    expect(
      isNoiseOnlyGuest({
        userId: 42,
        email: "alerts@chase.com",
        qualifiesViaContent: false,
        hasInbound: true,
        latestInboundIsSpam: true,
      }),
    ).toBe(false);
  });

  it("a content-qualified guest (manual/inquiry/escalation) is NEVER gated, even noise + spam", () => {
    expect(
      isNoiseOnlyGuest({
        userId: null,
        email: "alerts@chase.com",
        qualifiesViaContent: true,
        hasInbound: true,
        latestInboundIsSpam: true,
      }),
    ).toBe(false);
  });

  it("a NO-INBOUND profile (booking-only, reached by search) is NEVER gated, even on a noise domain", () => {
    // This is the globalSearch over-reach guard: the gate must not hide a real
    // customer who has no inbound mail just because their email pattern matches.
    expect(
      isNoiseOnlyGuest({
        userId: null,
        email: "alerts@chase.com",
        qualifiesViaContent: false,
        hasInbound: false,
        latestInboundIsSpam: false,
      }),
    ).toBe(false);
  });

  it("a rescued spam inbound (latestInboundIsSpam already false) is NOT gated on a clean domain", () => {
    expect(
      isNoiseOnlyGuest({
        userId: null,
        email: "customer@example.com",
        qualifiesViaContent: false,
        hasInbound: true,
        latestInboundIsSpam: false,
      }),
    ).toBe(false);
  });

  it("a null-email inbound-only guest is not gated by isKnownNoise (empty string never matches a domain)", () => {
    expect(
      isNoiseOnlyGuest({
        userId: null,
        email: null,
        qualifiesViaContent: false,
        hasInbound: true,
        latestInboundIsSpam: false,
      }),
    ).toBe(false);
  });
});
