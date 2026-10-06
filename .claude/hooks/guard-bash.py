#!/usr/bin/env python3
"""PreToolUse guard for Bash (D-165).

Every rule here is a paragraph in CLAUDE.md that was written after it cost a
session, and was then broken again by a session that had read it. The hook is
the same rule with the reading removed. It is a deny-list: it blocks only what
it names, and it never edits the command.

Claude Code runs this before each Bash tool call with the call's JSON on stdin
(https://code.claude.com/docs/en/hooks). A deny is JSON on stdout with the
reason; anything else is silence and exit 0.

Standard library only, so it runs wherever `python3` does. Tested by
`test-guard-bash.py` beside it.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

DRIFT_CMD = [
    "npx", "dotenv", "-e", ".env.test", "-e", ".env.local", "--",
    "npx", "prisma", "migrate", "diff",
    "--from-schema-datasource", "packages/db/prisma/schema.prisma",
    "--to-schema-datamodel", "packages/db/prisma/schema.prisma",
    "--exit-code",
]


def run_drift_check(project_dir: str) -> tuple[int, str]:
    """Returns (code, tail of output). prisma: 0 = in sync, 2 = drift, else error."""
    try:
        p = subprocess.run(
            DRIFT_CMD, cwd=project_dir, capture_output=True, text=True, timeout=75,
        )
    except FileNotFoundError as e:
        return 127, str(e)
    except subprocess.TimeoutExpired:
        return 124, "timed out after 75s"
    out = (p.stdout + p.stderr).strip().splitlines()
    return p.returncode, "\n".join(out[-8:])


def _has(pattern: str, command: str) -> bool:
    return re.search(pattern, command) is not None


def decide(command: str, project_dir: str, drift=run_drift_check) -> str | None:
    """Returns a denial reason, or None to allow."""
    c = command

    # 1. gh pr merge --squash  (CLAUDE.md "Pull requests": squash orphans every
    #    SHA PROGRESS.md recorded on the branch; cost B-218 and B-202 theirs.)
    if _has(r"\bgh\s+pr\s+merge\b", c) and _has(r"(^|\s)(--squash|-s)(\s|$)", c):
        return ("CLAUDE.md: merge with `gh pr merge --rebase`, never `--squash`. A squash "
                "collapses the branch into one new commit and orphans every SHA that "
                "PROGRESS.md recorded (it cost B-218 and B-202 theirs on 2026-08-29). "
                "Re-run with --rebase, then check PROGRESS.md against `git log main`.")

    # 2. gh pr merge --auto  (merges immediately when auto-merge is off; #19 went
    #    in with `verify` still running.)
    if _has(r"\bgh\s+pr\s+merge\b", c) and _has(r"(^|\s)--auto(\s|$)", c):
        return ("CLAUDE.md: `gh pr merge --auto` merges immediately on this repo because "
                "auto-merge is not enabled; PR #19 landed with `verify` still in progress. "
                "Wait for CI with `gh pr checks --watch`, then merge with --rebase.")

    # 3. pkill ... playwright not anchored to this project (killed the rental
    #    platform's runs twice on 2026-08-15).
    if _has(r"\bpkill\b[^\n;&|]*playwright", c) and not (
        "$PWD" in c or "${PWD}" in c or "storage business" in c
    ):
        return ("CLAUDE.md: a bare `pkill -f playwright` matches every project on the "
                "machine (it killed the rental platform's runs twice on 2026-08-15). "
                "Anchor it: `pkill -9 -f \"$PWD.*playwright\"`.")

    # 4. prisma migrate reset, anywhere (one keystroke from dropping a cloud
    #    branch; B-253).
    if _has(r"\bmigrate\s+reset\b", c):
        return ("CLAUDE.md (B-253): `prisma migrate reset` drops the schema the env file "
                "points at, and `.env.local` is the Neon dev branch. Never run it. For the "
                "test schema use `npm run db:reset-test`; for a stale migration checksum, "
                "UPDATE `_prisma_migrations` as the CLAUDE.md paragraph describes.")

    # 5. prisma migrate dev against anything but .env.test (`npm run db:migrate`
    #    is the sanctioned form and already carries .env.test).
    if _has(r"\bmigrate\s+dev\b", c) and ".env.test" not in c and not _has(
        r"\bnpm\s+run\s+db:migrate\b(?!:)", c
    ):
        return ("CLAUDE.md (B-253): `prisma migrate dev` authors against the LOCAL "
                "database only. Run `npm run db:migrate` (it loads .env.test); it is the "
                "only safe way to add a migration. `db:migrate:cloud` is the only script "
                "that writes to Neon, and it uses `migrate deploy`.")

    # 6. bare `playwright test` (B-130): global-setup silently returns because
    #    DATABASE_URL is unset; the green result is the trap.
    if _has(r"(^|[;&|(]\s*)(npx\s+|yarn\s+|pnpm\s+)?playwright\s+test\b", c) and not _has(
        r"\bnpm\s+run\s+test:e2e\b", c
    ):
        return ("CLAUDE.md (B-130): run e2e only through `npm run test:e2e -- <spec>`. A bare "
                "`playwright test` leaves DATABASE_URL unset in Playwright's own process, "
                "so e2e/global-setup.ts returns at its first line and stale locks, holds and "
                "lien notices are never cleared. Everything still passes, which is the trap.")

    # 7. git push: run the schema-drift check CI fails on (six red runs).
    if _has(r"\bgit\s+push\b", c):
        code, tail = drift(project_dir)
        if code == 0:
            return None
        if code == 2:
            return ("CLAUDE.md: the schema-drift check CI fails on reports drift, so this push "
                    "would go red. Either the model and the migrations disagree, or the new "
                    "migration is not applied to storage_test yet (`npm run db:migrate:test`). "
                    "Prisma said:\n" + tail)
        return ("CLAUDE.md: the schema-drift check could not run (exit %d), so this push is "
                "not known to be clean. Start local Postgres / fix the env, run the check, "
                "then push. Output:\n%s" % (code, tail))

    return None


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        return 0  # not our input shape; never block on a parse error
    if payload.get("tool_name") != "Bash":
        return 0
    command = (payload.get("tool_input") or {}).get("command") or ""
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd()
    reason = decide(command, project_dir)
    if reason is None:
        return 0
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
