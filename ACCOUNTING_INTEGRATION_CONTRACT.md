# Accounting redesign integration contract

- Status: normative for the parallel accounting redesign
- Target branch: `redesign`
- Common base: `44a090d` (`Move Obsidian vault to project root`)
- Integration branch: `architecture/accounting-integration-contract`
- Date: 2026-07-19

## 1. Purpose and scope

This contract defines how the four accounting feature branches compose into one application. It assigns file and data ownership, freezes cross-slice behavior that other branches may rely on, and gives the parent workspace an ordered merge and verification procedure.

The feature implementations themselves are deliberately out of scope here. This document does not add routes, tables, actions, components, translations, seeds, or migrations.

Normative words (`MUST`, `MUST NOT`, `SHOULD`) describe merge requirements. If a slice cannot satisfy one of them, it must call that out in its parent handoff rather than silently introducing a second convention.

## 2. Participating slices

| Branch | Product responsibility | Owned route surface | Owned module surface |
| --- | --- | --- | --- |
| `feature/accounting-overview-bookings` | Accounting shell, overview, bookings/ledger UX | `/accounting`, `/accounting/bookings`; compatibility ownership for `/accounting/report` | Existing entry/category queries, actions, and ledger components; new `overview` and `bookings` code |
| `feature/invoices-documents` | Invoices, customers, and accounting documents/receipts | `/accounting/invoices/**`, `/accounting/customers`, `/accounting/documents/**` | Existing `invoice-*` code and invoice/customer components; new `documents` code |
| `feature/accounting-planning` | Planning vertical slice | `/accounting/planning/**` | `src/modules/accounting/planning/**` |
| `feature/funding-projects` | Funding-project control | `/accounting/funding/**` | `src/modules/accounting/funding/**` |
| `architecture/accounting-integration-contract` / parent integrator | Cross-slice convergence only | Shared route shell wiring after merges | Aggregators, generated migrations, global navigation, translation reconciliation, and cross-slice tests |

All four feature branches were created directly from `redesign`; none is downstream of another feature branch. A feature branch MUST NOT merge a sibling branch to obtain a dependency. Cross-slice requirements go through this contract and the parent integrator.

## 3. Stable route and navigation contract

The merged accounting navigation order is:

1. Overview — `/accounting`
2. Bookings — `/accounting/bookings`
3. Invoices — `/accounting/invoices`
4. Documents — `/accounting/documents`
5. Planning — `/accounting/planning`
6. Funding projects — `/accounting/funding`

`/accounting/customers`, invoice create/detail/print routes, and `/accounting/report` remain valid deep links. They need not be top-level accounting navigation items.

The overview/bookings slice owns the accounting-local shell and its visual conventions. Other slices MUST expose ordinary App Router pages at the routes above and MUST NOT create a second accounting tab bar, accounting header, or conflicting `src/app/(app)/accounting/layout.tsx`. They may include page-local secondary navigation.

The parent integrator adds the links for all completed slices to the shared shell. A slice route must remain directly reachable before that wiring is merged.

Route components follow the installed Next.js 16.2.10 conventions:

- `params` and `searchParams` are awaited promises.
- Reads happen in Server Components or server-only query modules by default.
- Interactive state is isolated in client components; a page is not made a client component merely to support one control.
- Mutations use authenticated Server Actions. Route Handlers are reserved for HTTP concerns such as file upload/download and CSV export.
- Every implementer must read the relevant guide under `node_modules/next/dist/docs/` before writing framework-facing code, as required by `AGENTS.md`. If dependencies are not installed, install them through the workspace's normal setup flow first.

## 4. File ownership and conflict policy

### 4.1 Slice-owned files

Within its owned surface, a slice may add and edit pages, components, query modules, actions, validation, library functions, and focused tests.

New slice tables MUST be declared in a slice-local schema file:

- Planning: `src/modules/accounting/planning/schema.ts`
- Funding: `src/modules/accounting/funding/schema.ts`
- Documents, if a table is needed: `src/modules/accounting/documents/schema.ts`

Slice code imports its own new tables from that local schema file. It does not require an early edit to the central schema aggregator.

### 4.2 Integration-owned files

The following files are collision points and are finalized by the parent integrator after slice merges:

- `src/db/schema.ts`
- `src/db/core-schema.ts`, including `attachmentEntityTypes`
- `src/modules/accounting/schema.ts`, except a narrowly scoped, pre-declared change to an existing owned table
- `src/modules/registry.ts`
- `src/components/app-sidebar.tsx`
- `src/app/(app)/accounting/layout.tsx`
- `messages/de.json` and `messages/en.json` conflict resolution
- `src/db/seed.ts`
- `drizzle/*.sql` and `drizzle/meta/**`
- `package.json` and `package-lock.json` conflict resolution
- Existing cross-slice E2E specs

A slice may carry a minimal working edit to one of these files when local execution requires it, but its handoff MUST list that edit. The integrator resolves the intent; it does not accept the slice's textual version blindly.

### 4.3 Frozen existing declarations

During parallel work, the existing `categories`, `entries`, `customers`, `invoices`, and `invoiceItems` declarations are treated as frozen. A slice MUST NOT independently rename a table or column, change a status enum, or change foreign-key deletion behavior.

If a feature needs more data, prefer an additive slice-owned companion table with a foreign key to the existing record. A required change to an existing declaration is an integration decision and must be reported before handoff.

## 5. Shared accounting domain contract

### 5.1 Sources of truth

- `entries` is the only source of actual cash-basis income and expense.
- `categories` classifies actual entries. Archived categories remain readable for historical records.
- `invoices` plus `invoiceItems` is the source of invoice state and invoice totals.
- `attachments` is the source of stored-file metadata; the file bytes remain managed by `src/lib/files.ts`.
- Planning data is not actual accounting data and MUST NOT be inserted into `entries`.
- Funding allocations annotate actual entries; they MUST NOT copy an entry into a second ledger table.

No dashboard or slice maintains a second persisted total that can be derived from these records.

### 5.2 Money, quantities, dates, and signs

- Persisted money uses integer cents. Floating-point euro values MUST NOT be stored.
- Invoice quantities retain the existing integer-thousandths representation.
- Business dates use ISO `YYYY-MM-DD` text. They are not converted through UTC timestamps for grouping.
- Audit timestamps use `Date` / SQLite timestamp milliseconds, matching the existing schema.
- Persisted entry amounts remain positive. `entries.kind` determines income versus expense. Presentation code may display expense as negative.
- Aggregate calculations use the explicit persisted gross, net, and VAT cents on `entries`; they do not recompute historical VAT from gross.
- Planning and funding amounts follow the same cents convention. If an allocation represents a magnitude, it is stored as a non-negative integer and direction is obtained from the referenced entry.

### 5.3 Stable read APIs

The following existing exports are public inside the accounting module and must remain source-compatible through the redesign:

- From `src/modules/accounting/queries.ts`: `listEntries`, `entryTotals`, `listCategories`, `yearsWithEntries`, `monthlySummary`, `categorySummary`, `vatSummary`, and their exported row/filter types.
- From `src/modules/accounting/invoice-queries.ts`: `listCustomers`, `getCustomer`, `listInvoices`, `getInvoiceWithItems`, and `InvoiceListRow`.
- From `src/modules/accounting/lib/vat.ts`: the existing VAT validation and gross-breakdown behavior.
- From `src/modules/accounting/lib/invoice.ts`: the existing invoice total and numbering behavior.

An owning slice may add optional filter fields or new exports. It MUST NOT change existing required parameters, return meanings, money units, or sync/async behavior merely for a redesigned component. If a breaking shape is genuinely required, add a new named function and leave an adapter for the old export until integration is complete.

Planning consumes actuals through the public accounting queries, especially `monthlySummary` and `categorySummary`; it does not duplicate SQL over `entries`. Funding may join its own allocation table to entry IDs, but ledger row construction remains owned by the bookings query module.

### 5.4 Mutation and transaction boundaries

- Every mutation validates input with Zod and authenticates with `requireUserOrThrow()` or `requireAdmin()` as appropriate.
- Server Actions are UI entry points, not reusable domain services. Cross-slice code MUST NOT import and invoke another slice's Server Action.
- A workflow that updates tables from more than one slice must use one synchronous `db.transaction` in a server-only domain function, then revalidate every affected route.
- Mutation APIs return stable identifiers or an explicit result object; clients do not infer success from localized error text.
- Deleting an entity that owns attachments must remove both attachment rows and stored files through `deleteAttachmentsFor`.

The existing invoice transition remains normative:

`draft -> sent -> paid` or `draft/sent -> canceled`; paid and canceled are terminal.

Marking an invoice paid creates one income `entries` row per VAT-rate group, links each row by `entries.invoiceId`, and performs the invoice update and ledger inserts atomically. The invoices/documents slice owns this workflow. The overview/bookings slice must display those rows without special-case duplication. A redesign MUST preserve the one-time transition guard so repeated requests cannot book the invoice twice.

### 5.5 Funding-to-entry relationship

Funding projects attach to actuals through a funding-owned allocation table rather than an `entries` column. The logical contract is:

```ts
type FundingEntryAllocation = {
  id: string;
  fundingProjectId: string;
  entryId: string;
  amountCents: number; // positive allocation magnitude
  createdBy: string;
  createdAt: Date;
};
```

Required constraints:

- foreign keys reference the funding project and `entries.id`;
- entry deletion cascades allocations;
- a project/entry pair is unique unless the product explicitly models independently named budget lines;
- the sum of allocations for an entry cannot exceed `abs(entry.grossAmountCents)`;
- allocation create/update/delete and the over-allocation check occur in one transaction;
- deleting or archiving a funding project must not delete ledger entries.

This keeps the ledger independently usable and permits a later split across multiple funding projects.

### 5.6 Planning relationship to actuals

Planning owns forecast assumptions and planned rows. It reads actuals but never mutates actual entries, invoice state, or funding allocations. A plan-to-actual comparison uses calendar month keys (`YYYY-MM`) and integer cents.

If planning links a planned row to a category or funding project, the foreign key is nullable and deletion uses `set null` or an equivalent explicit preservation rule. Historical plan rows must not disappear because a category or project is archived.

## 6. Documents and attachments contract

Existing attachment entity types are `entry`, `invoice`, `task`, and `wikiPage`. No slice may silently add an arbitrary string because `src/lib/files.ts` and `/api/files` validate against the shared enum.

Reserved additions, only when required by the implemented feature, are:

- `document` for a first-class accounting document record;
- `fundingProject` for project-level evidence;
- `planningItem` for planning evidence.

The parent integrator appends the union of required values to `attachmentEntityTypes` once. A feature handoff must state which values it needs. Files already attached to an `entry` or `invoice` stay attached there; a slice MUST NOT duplicate the physical file merely to show it in a documents view.

All upload/download/delete behavior continues through `/api/files` and `src/lib/files.ts`. The allowed MIME types, 20 MB limit, authentication, hashing, and sharded storage naming remain global invariants. A documents page is an index over metadata and owning records, not a second file store.

## 7. Localization and UI composition

Both `de` and `en` messages are required for every user-visible string. To make the shared JSON conflict mechanically resolvable, slices use distinct top-level namespaces:

- `accountingShell`, `accountingOverview`, `accountingBookings`
- `accountingInvoices`, `accountingDocuments`
- `accountingPlanning`
- `accountingFunding`

Existing message keys may remain as compatibility aliases during the merge. The integrator removes duplication only after every consumer has moved.

Shared UI primitives in `src/components/ui/**` are reusable but not slice-owned. A slice should compose an existing primitive or add a narrowly named new primitive; it must not restyle an existing primitive globally for a page-specific need. Global CSS changes require an explicit handoff note.

The accounting shell owns responsive page width, heading rhythm, and primary sub-navigation. Slice pages own their empty, loading, error, and local action states.

## 8. Cache invalidation contract

Until the application adopts an explicit tag strategy, mutations use path invalidation. At minimum:

| Mutation | Paths to revalidate |
| --- | --- |
| Entry create/update/delete | `/accounting`, `/accounting/bookings`, `/accounting/report`, `/accounting/planning`, `/accounting/funding` |
| Invoice/customer/status mutation | `/accounting`, `/accounting/invoices`, affected invoice detail, `/accounting/customers`; paid transition also all entry paths above |
| Document/attachment mutation | Owning record path and `/accounting/documents`; if attached to an entry or invoice, its list/detail path too |
| Plan mutation | `/accounting/planning` and affected planning detail path |
| Funding project/allocation mutation | `/accounting/funding`, affected funding detail path, and any overview that displays funding state |

Revalidation is performed only after a successful transaction. A slice may revalidate additional paths.

## 9. Database migration policy

Parallel feature branches MUST NOT contribute committed Drizzle migration numbers or edit `drizzle/meta/_journal.json`. Those files are linear generated state and cannot be safely composed by accepting conflict markers from multiple branches.

Each slice:

1. Defines new tables in its slice-local schema file.
2. Imports those tables directly in its own queries/actions.
3. May generate or push a local development schema, but discards generated `drizzle/**` artifacts before handoff.
4. Lists its new tables, indexes, foreign keys, enum values, and data/backfill needs in the handoff.

After all feature branches are merged, the parent integrator:

1. Adds the slice schema re-exports to `src/db/schema.ts` in one edit.
2. Reconciles any approved additions to existing schemas and attachment types.
3. Runs `npm run db:generate` exactly once from the fully merged schema.
4. Reviews the generated SQL for destructive operations, accidental table recreation, missing indexes, and foreign-key behavior.
5. Commits the single next migration and its matching Drizzle snapshot/journal state.
6. Verifies both a fresh database and an upgrade from the pre-redesign migration set.

Seed changes follow the same pattern: slices report desired defaults; the integrator makes `src/db/seed.ts` idempotent across the combined model.

## 10. Ordered merge plan

All merges target `redesign`. Use merge commits or cherry-picks consistently; do not squash away a handoff note until its integration decisions have been applied.

### Stage 0 — establish the contract

Merge `architecture/accounting-integration-contract` first and send this document to all four slice owners. Any already-started slice audits its work against Sections 3–9 before handoff.

### Stage 1 — overview and bookings

Merge `feature/accounting-overview-bookings` first because it establishes the shared accounting layout and route composition. Resolve `/accounting` from ledger-only page to overview while preserving a direct bookings route and existing report/export behavior.

Checkpoint: authentication, `/accounting`, `/accounting/bookings`, `/accounting/report`, and `/api/accounting/export` work; stable query exports remain available.

### Stage 2 — invoices and documents

Merge `feature/invoices-documents` next. Keep the shell from Stage 1 and integrate invoice/document links into it. Preserve customer routes, print routes, gapless invoice numbering, terminal statuses, and atomic paid-invoice ledger booking.

Checkpoint: existing invoice flows still work and newly paid invoices appear exactly once in bookings and overview totals; document metadata resolves to the original attachment.

### Stage 3 — funding projects

Merge `feature/funding-projects` after actual-entry and document behavior is stable. Resolve funding references through the allocation contract in Section 5.5. Do not accept a duplicate ledger or physical document store.

Checkpoint: project totals are derived from allocations plus entries; allocation limits and deletion behavior are covered by tests.

### Stage 4 — planning

Merge `feature/accounting-planning` after the actuals API is stable. Planning remains a consumer of actuals and may optionally read funding projections through a funding-owned public query; it never imports funding UI or actions.

Checkpoint: plan/actual month comparisons use the same cents and calendar-date semantics as bookings.

### Stage 5 — convergence commit

The parent integrator makes one explicit convergence commit that:

- wires schema re-exports;
- generates the combined migration;
- merges navigation and translation namespaces;
- reconciles attachment entity types and seeds;
- removes temporary compatibility adapters only when no consumer remains;
- adds cross-slice integration tests.

Do not generate the combined migration before all approved schema code is present.

## 11. Required handoff from every feature branch

Each branch sends the parent:

```text
Branch and commit:
Owned routes added/changed:
Owned module files added/changed:
Shared files touched and why:
Schema additions (tables/columns/indexes/FKs):
Attachment entity types required:
New translation namespaces:
Public exports added or changed:
Paths revalidated by each mutation:
Commands/tests run and results:
Known integration work or deviations from contract:
```

A branch is not merge-ready if it changes shared behavior but omits it from this handoff.

## 12. Integration verification gates

### 12.1 Before each slice merge

- Confirm the branch is based on or cleanly merges with current `redesign`.
- Inspect `git diff --name-only` against the ownership matrix.
- Reject committed migration-number or Drizzle journal collisions.
- Run the slice's focused unit/component tests and typecheck/lint for touched code.
- Confirm both locale namespaces exist.

### 12.2 After the convergence commit

Run, in order:

```powershell
npm run db:generate
npm run typecheck
npm run lint
npm run test
npm run build
npm run e2e
```

The parent must approve CPU-intensive full-suite/build commands under the DevSwarm coordination protocol before they are started.

Use a fresh test database for the full E2E run. Separately test migration of a copy of a database at migration `0004`; do not point destructive migration checks at the user's working database.

### 12.3 Cross-slice scenarios that must pass

1. Create an expense booking with an attachment; it appears in bookings, overview totals, documents, planning actuals, and funding allocation selection without duplicated records or files.
2. Create and send an invoice, mark it paid, and observe exactly one ledger booking per VAT group plus correct overview and planning actuals.
3. Allocate part of an actual expense to a funding project, prevent over-allocation, and preserve the ledger entry when the funding project is archived.
4. Compare plan and actual values across a year boundary without timezone-induced month changes.
5. Switch German/English on every accounting route without missing-message errors.
6. Open all legacy deep links and CSV/print/file endpoints after the new shell is merged.
7. Start from a pre-redesign database, migrate, and retain invoice numbering, statuses, ledger totals, and attachment downloads.

## 13. Conflict-resolution rules

When Git and domain ownership disagree, domain ownership wins:

- Keep the overview branch's accounting shell structure, then add other slice links.
- Keep the owning slice's page/module implementation within its route surface.
- Rebuild central schema exports, migrations, journal, navigation, and translation files from the semantic union; never choose `ours` or `theirs` wholesale.
- Preserve existing public exports through adapters until every merged consumer is updated.
- Preserve user data over implementation convenience; no destructive migration is accepted without an explicit reviewed backfill and rollback plan.

If two slices need to mutate the same record in one workflow, stop textual conflict resolution and define one server-only transaction boundary first.
