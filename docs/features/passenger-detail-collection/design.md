# 乘客證件資料收集（供應商履約必備）— design

> Status: DESIGN. 2026-06-03. Decision: **Option A** — collect the FULL
> per-traveler document detail at booking time (in the wizard, REQUIRED, before
> payment), so Jeff always has what the supplier (UV / Lion) needs to place the
> order. Without it: a customer can pay but we lack passport data → cannot
> fulfill.

## Requirement (from the supplier booking form Jeff must fill)

Per traveler the supplier needs:
- 證件姓名 (surname + given name)
- 證件類型 (passport / ID card / ...)
- 證件號碼 (passport number)
- 證件過期日期 (passport expiry)
- 國籍 (nationality)
- 出生日期 (DOB)
- 性別 (gender)
- 成人/兒童 (adult/child)
- 聯繫電話 + Email (per traveler on the supplier form)
- 其他姓名 (alias — optional)
Supplier form also has 下載範本 + Excel 導入 (bulk).

## Current state

`bookingParticipants` already stores: firstName, lastName, gender, dateOfBirth,
**passportNumber (AES-encrypted at rest)**, passportExpiry, nationality,
participantType (adult/child/infant), dietaryRequirements, specialNeeds.

`bookings.saveParticipants` (v77) collects these POST-booking and all are
`.optional()`. So today they are optional + after payment → the fulfillment gap.

**Field gaps vs supplier:** `documentType`, per-traveler `contactPhone` /
`contactEmail`, optional `otherName`.

## Build (Option A)

1. **Schema migration** — add to `bookingParticipants`:
   - `documentType` mysqlEnum(`passport`,`id_card`,`other`) (default passport)
   - `contactPhone` varchar, `contactEmail` varchar
   - `otherFirstName` / `otherLastName` varchar nullable (alias, optional)
   Keep `passportNumber` going through `passportEncryption` (db.replaceBooking
   Participants already encrypts — do NOT bypass).
2. **Wizard step 3 (填寫資訊)** — render N passenger cards (N = adults+children
   from step 2). Each card = the full field set, **all required except alias**.
   Lead traveler (遊客代表) flag. Validations:
   - passportExpiry must be ≥ trip return date (+ optional 6-month buffer; many
     countries require 6mo passport validity — make the buffer a per-tour/global
     config, warn not hard-block unless Jeff wants).
   - DOB consistent with participantType (child age range) — soft warn.
   - nationality from a country list (reuse existing country i18n list).
3. **Gate payment on completeness** — the `create` booking proc REQUIRES the full
   participant array (promote the saveParticipants fields from optional →
   required in the create path). Checkout cannot start until every traveler is
   complete. (This is the core of Option A.)
4. **Excel import + 下載範本** (groups) — a template (xlsx) matching our columns
   + an importer that parses it into the passenger cards. Mirrors the supplier's
   own bulk flow. Reuse the existing Excel parsing from InquiryAgent attachment
   work (task #62) if shapes align.
5. **Fulfillment helper (closes the loop)** — admin booking detail → **「匯出供應商
   Excel」**: export this booking's passengers in UV / Lion's template format so
   Jeff uploads it to the supplier in one shot. Turns step-7 manual fulfillment
   into download → upload. (Confirm each supplier's exact template columns.)

## Privacy / compliance

- `passportNumber` stays AES-256-GCM encrypted (passportEncryption + tokenCrypto)
  — already wired through `db.replaceBookingParticipants` / `getBookingParticipants`.
  Never write/return plaintext.
- New `contactPhone` / `contactEmail` are PII — same care; do not log.
- Collecting passport at booking = more PII earlier; ensure the privacy policy +
  consent checkbox cover it.

## Test

- Wizard blocks payment until all travelers complete (required validation).
- Expired-passport / expiry-before-trip is caught.
- Round-trip: save → reload booking → all fields present, passport decrypts for
  the admin/ops view only.
- Excel import fills N cards correctly; export produces a supplier-shaped xlsx.
- Vitest: the participant validation (required + expiry rule) as pure functions.

## Rollback

Revert the wizard to lead-contact-only + `create` to not require participants
(saveParticipants stays as the optional post-booking path). Schema columns are
additive (nullable) so they can stay.

## Open questions for Jeff

- 6-month passport-validity buffer: hard-block, warn, or off?
- Do UV and Lion accept the SAME passenger Excel template, or different columns?
  (Determines the export format(s).)
- Guest checkout vs login-required still applies (separate decision).
