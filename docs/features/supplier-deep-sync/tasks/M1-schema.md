# M1 — Schema migration

> Blocks all other modules. Ship first.

## Goal
Add `supplierProductDetails` table per design.md §2.1.

## Files
- `drizzle/0083_supplier_product_details.sql` (new)
- `drizzle/schema.ts` (extend with `supplierProductDetails` definition + type exports)

## Checklist
- [ ] Write migration SQL — match design.md §2.1 exactly (incl. all 5 detail kinds, parseStatus enum, ownerType enum, schemaVersion, indexes)
- [ ] Add `supplierProductDetails` table to `drizzle/schema.ts` with Drizzle ORM definition
- [ ] Export `SupplierProductDetail` + `InsertSupplierProductDetail` types
- [ ] Test up: `pnpm drizzle-kit push` against staging DB → verify table exists with all columns + indexes
- [ ] Test down (manual rollback drop): table can be dropped cleanly
- [ ] Vitest: nothing to test directly (schema only) but verify `drizzle/schema.ts` compiles with `pnpm tsc --noEmit`

## Done when
- Migration file exists
- Drizzle types compile
- Staging DB has table
