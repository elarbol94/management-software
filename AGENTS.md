# Management Platform

Self-hosted management application for a small Austrian startup: accounting,
projects/tasks, calendar, personnel, research/wiki, and German/English UI.
Read `README.md` before non-trivial work and the relevant `docs/` file before
changing its subject area.

## Commands

Run commands from the repository root.

- Install: `npm install`; develop: `npm run dev` (http://localhost:3000)
- Type check: `npm run typecheck`; lint: `npm run lint`; unit tests: `npm run test`
- Standard validation: `npm run check`; production build: `npm run build`
- End-to-end tests: `npm run e2e`

The Playwright suite starts its own server on port 3100 and uses a throwaway
SQLite database. Stop the normal development server before running it.

## Project map

- `src/app/`: App Router routes; `(app)` is authenticated UI, `(auth)` sign-in,
  `api/` route handlers, and `print/` print pages.
- `src/modules/`: domain code, normally `schema.ts`, `queries.ts`, `actions.ts`,
  and `components/`.
- `src/db/`: SQLite, Drizzle schema/migrations, and seeds. `drizzle/` is the
  ordered generated migration history.
- `src/components/ui/`: shared UI primitives. `src/i18n/` and `messages/*.json`
  provide localisation. Unit tests live as `src/**/*.test.ts`; E2E is in `e2e/`.

## Architecture and conventions

- Use TypeScript strict mode and the `@/` alias. Follow existing module and
  component patterns; keep route pages/handlers thin and domain logic in the
  owning module's queries/actions.
- Validate mutation input with Zod, use `requireUserOrThrow`/`requireAdmin`, and
  revalidate affected paths only after successful mutations.
- Add German and English messages for every UI string. New top-level modules
  must be registered in `src/modules/registry.ts` and both message files.
- For schema changes: update the owning schema, re-export it from
  `src/db/schema.ts`, run `npm run db:generate`, review generated SQL, then use
  `npm run db:migrate`. Preserve user data; avoid destructive migrations.
- Keep accounting operations transactional and auditable: retain integer cents,
  VAT/invoice invariants, and gapless per-year invoice numbering.
- Use `src/lib/files.ts` and the existing file API for attachments; do not create
  another upload store or bypass its validation.

## Important operational constraints

- Never commit secrets, `.env.local`, databases, uploads, or local runtime data;
  use `.env.example` for configuration.
- `src/instrumentation.ts` runs migrations/seeding and starts the wiki PDF worker.
  OCR requires Poppler and Tesseract; preserve documented local/Docker behavior.
- Before writing Next.js code, read the relevant guide in
  `node_modules/next/dist/docs/`. The project uses Next.js 16.2.10.

## Focused documentation

- `README.md`: setup, deployment, backup, and adding a module.
- `ACCOUNTING_INTEGRATION_CONTRACT.md`: accounting/migration invariants.
- `docs/cloudflare-access.md`: Cloudflare Tunnel/Access deployment.
- `docs/graphics-sidecar.md`: wiki graphics sidecars and sync.

## Development and deployment workflow

- Develop and test locally on the laptop.
- Commit and push completed changes to Git.
- Deploy manually on the homeserver by pulling the target branch and restarting
  the application as needed.
- Do not SSH to, pull on, restart, or otherwise modify the homeserver unless
  explicitly asked.
- Before handoff, report the validation run and whether the change is ready to
  commit/push/deploy.
