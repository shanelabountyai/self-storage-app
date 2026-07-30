# Self-Storage Business Application

Multi-facility self-storage platform. Learning project, built to professional standards.

Product specs live in [docs/prds/](docs/prds/). Build order is
[docs/prds/06-backlog.md](docs/prds/06-backlog.md), top to bottom;
[docs/prds/07-decisions.md](docs/prds/07-decisions.md) overrides any conflicting PRD text.

## Layout

```
apps/web        Next.js App Router — public site, tenant portal, admin (role-gated routes)
packages/db     Prisma schema + generated client, shared by every surface
docs/prds       Product requirements, backlog, decision log
e2e             Playwright specs (smoke + axe accessibility)
tests           Vitest unit tests
```

`packages/core` (billing/lease domain logic, per master PRD §5) gets created when
there's domain logic to put in it — B-002 onward.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run db:generate
npm run dev                  # http://localhost:3000
```

Requires Node 22+ (developed on 26). If `npm install` warns about blocked install
scripts, the packages that legitimately need them are already listed under
`allowScripts` in `package.json` — run `npm approve-scripts --allow-scripts-pending`
to review anything new.

## Environment

Root `.env.local` is the single source of truth and is gitignored. Every npm script
injects it via `dotenv-cli`, so both Next.js and Prisma read the same file.
[.env.example](.env.example) documents the variable **names** only — never commit a
value. `npm run test` fails if a value ever lands in it.

Mirror the same variables into Vercel project settings before the first deploy.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server on :3000 |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint (next/core-web-vitals + TypeScript) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Playwright smoke + axe accessibility scan |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:studio` | Prisma Studio |

## Conventions

- Money is integer cents. Never a float.
- Timestamps are UTC in the database, displayed in facility-local time.
- Every table representing physical or financial reality carries `facilityId`,
  directly or through its parent (master PRD §7.6).
- WCAG 2.1 AA is an acceptance criterion on customer-facing work, not a cleanup
  task. CI runs axe and asserts a perfect Lighthouse accessibility score.
- Compliance defaults are Texas, built per-state configurable (D-10). All legal and
  notice text is draft-only and not legal advice.

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs lint, typecheck, unit
tests, build, Playwright + axe, and Lighthouse (LCP < 2.5 s, CLS < 0.1, per master
PRD §7.3). `npm audit` runs as a report only — the current advisories come from
version pins inside `next` and `eslint` that cannot be overridden without putting
the dependency tree in an invalid state.
