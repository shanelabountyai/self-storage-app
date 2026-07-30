# Project Setup Guide — From Zero to First Claude Code Session

Everything to set up before building backlog item B-001. Written for a Mac, using the stack from the master PRD (Next.js + TypeScript, Postgres + Prisma, Stripe, Vercel). Each step notes whether it's needed **now** (before Milestone 1) or **later** (before a specific milestone).

## 1. Local machine setup (now)

- [ ] **Homebrew** — Mac package manager. Check with `brew --version`; install from https://brew.sh if missing.
- [ ] **Node.js LTS** — `brew install node@22` (or use `nvm` if you want multiple versions). Verify: `node --version`.
- [ ] **Git** — ships with macOS Xcode tools; verify with `git --version` (accept the install prompt if it appears). Set identity once:
  ```bash
  git config --global user.name "Shane LaBounty"
  git config --global user.email "shanelabountyai@gmail.com"
  ```
- [ ] **Claude Code** — `npm install -g @anthropic-ai/claude-code`, then run `claude` once in any folder to log in with your Claude account.
- [ ] **GitHub CLI** (recommended, makes repo creation one command) — `brew install gh`, then `gh auth login`.
- [ ] Optional but nice: **VS Code** (`brew install --cask visual-studio-code`) for reading code alongside Claude Code sessions, and **TablePlus** or **Postico** for looking at the database.

## 2. Project folder + repo (now)

- [ ] Create the folder:
  ```bash
  mkdir -p ~/Projects/self-storage-app && cd ~/Projects/self-storage-app
  ```
- [ ] Initialize git: `git init -b main`
- [ ] Create the GitHub repo (private) and link it:
  ```bash
  gh repo create self-storage-app --private --source=. --remote=origin
  ```
  (Without `gh`: create it at github.com/new, then `git remote add origin <url>`.)
- [ ] Copy the PRD package into the repo — this is what makes Claude Code sessions effective:
  ```
  self-storage-app/
  ├── docs/prds/          ← all 9 files: 00-master … 08-setup
  ├── CLAUDE.md           ← see step 3
  └── (app code will go here — B-001 scaffolds it)
  ```
- [ ] `.gitignore` — B-001's Next.js scaffold generates a good one; until then just make sure `.env*` is ignored before you ever commit secrets.
- [ ] First commit: `git add -A && git commit -m "PRDs and project docs" && git push -u origin main`

## 3. CLAUDE.md (now)

Create a `CLAUDE.md` at the repo root — Claude Code reads it automatically every session. Suggested starting content:

```markdown
# Self-Storage Business Application

Multi-facility self-storage platform. Learning project, built to professional standards.

## How to work in this repo
- Product source of truth: docs/prds/. Build order: docs/prds/06-backlog.md, top to bottom.
- docs/prds/07-decisions.md OVERRIDES any conflicting PRD text.
- Stack: Next.js (App Router) + TypeScript, Postgres + Prisma, Stripe (ledger-driven
  PaymentIntents — NOT Stripe Billing), Tailwind, deployed on Vercel.
- Data model: use the canonical entity names in 00-master-prd.md §7.
- Money is integer cents. All times UTC in the DB, facility-local for display.
- Compliance defaults are Texas, built per-state configurable (D-10). Legal text is
  draft-only, not legal advice.
- After each backlog item: run tests, update the item's status in docs/prds/06-backlog.md.
```

## 4. Database (now — needed by B-002)

Pick one; both are free at this scale:

- [ ] **Hosted Postgres (recommended): Neon** (neon.tech) or **Supabase** — free tier, nothing to install, same DB works for deployed previews. Create a project, copy the connection string.
- [ ] *Or local:* `brew install postgresql@16 && brew services start postgresql@16`. Simpler to reason about, but you'll add a hosted DB anyway when you deploy.

## 5. Accounts & API keys — now vs later

| Service | Needed by | Notes |
|---|---|---|
| **GitHub** | now | Repo + later CI. Free. |
| **Stripe** | Milestone 2 (B-024) | Free; **test mode only** — no business verification needed to use test keys. Grab publishable + secret test keys. |
| **Vercel** | Milestone 2 (first deploy) | Free hobby tier; connect the GitHub repo, auto-deploys on push. |
| **Resend** (email) | Milestone 2 (B-029, move-in emails) | Free tier ~3k emails/mo. Domain verification can wait — its test address works for development. |
| **Twilio** (SMS) | Phase 2 (B-074, live SMS) | Don't create yet. A2P 10DLC business registration takes days–weeks and costs monthly fees; the comms PRD keeps SMS behind a simulated channel until then. |
| **Domain name** | whenever | Only needed for real email deliverability + production deploy. ~$12/yr. |
| Google Business Profile, gate-hardware vendor accounts | Phase 2–3 | Operational, not build blockers. |

## 6. Environment variables (pattern from B-001 on)

- [ ] `.env.local` (gitignored) holds secrets: `DATABASE_URL`, `STRIPE_SECRET_KEY`, `RESEND_API_KEY`, etc.
- [ ] Commit a `.env.example` with the variable *names* only, so every session (and future-you) knows what's required.
- [ ] Mirror the same variables into Vercel's project settings when you first deploy.

## 7. First Claude Code session (the payoff)

```bash
cd ~/Projects/self-storage-app
claude
```

Then prompt something like:

> Read CLAUDE.md, docs/prds/00-master-prd.md, and docs/prds/06-backlog.md. Build backlog item B-001 exactly as scoped. Stop when its acceptance criteria are met and show me how to verify.

Work top to bottom, one backlog item (or the small clusters the backlog notes) per session. Commit after every green item: `git add -A && git commit -m "B-001: scaffold"` — small commits are your undo button.

## Setup checklist (condensed)

Now: Homebrew → Node → git identity → Claude Code → gh → folder → git init → GitHub repo → copy PRDs into docs/prds/ → CLAUDE.md → Neon DB → first commit.
Before Milestone 2: Stripe test keys, Vercel, Resend.
Phase 2: Twilio + 10DLC, domain, Google Business Profile.
Phase 3: gate-hardware vendor conversations.
