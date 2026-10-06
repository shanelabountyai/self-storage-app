#!/usr/bin/env python3
"""Fixture tests for guard-bash.py. Run: python3 .claude/hooks/test-guard-bash.py"""
import importlib.util
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("guard", os.path.join(HERE, "guard-bash.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

clean = lambda _d: (0, "")
drift = lambda _d: (2, "[+] Added tables\n  - competitor_price")
broken = lambda _d: (1, "P1001: Can't reach database server")

CASES = [
    # (command, drift stub, expect_denied, label)
    ("gh pr merge 42 --squash", clean, True, "squash long flag"),
    ("gh pr merge -s 42", clean, True, "squash short flag"),
    ("gh pr merge 42 --rebase", clean, False, "rebase allowed"),
    ("gh pr merge 42 --rebase --auto", clean, True, "auto merge"),
    ("gh pr checks 42 --watch && gh pr merge 42 --rebase", clean, False, "watch then rebase"),
    ("pkill -f playwright", clean, True, "bare pkill"),
    ("pkill -9 -f playwright; lsof -ti :3000 | xargs -r kill -9", clean, True, "bare pkill in chain"),
    ('pkill -9 -f "$PWD.*playwright"', clean, False, "anchored pkill"),
    ("pkill -f 'storage business.*playwright'", clean, False, "anchored by path"),
    ("npx prisma migrate reset", clean, True, "migrate reset"),
    ("npx dotenv -e .env.test -- npx prisma migrate reset --force", clean, True, "migrate reset even on test"),
    ("npx dotenv -e .env.local -- prisma migrate dev --name x", clean, True, "migrate dev on .env.local"),
    ("npx prisma migrate dev --name x", clean, True, "migrate dev no env"),
    ("npm run db:migrate -- --name x", clean, False, "npm run db:migrate"),
    ("npm run db:migrate:test", clean, False, "db:migrate:test"),
    ("npx dotenv -e .env.test -e .env.local -- prisma migrate dev --create-only --name x", clean, False, "migrate dev on .env.test"),
    ("npx dotenv -e .env.local -- prisma migrate deploy", clean, False, "deploy is not dev"),
    ("npx playwright test e2e/smoke.spec.ts", clean, True, "bare playwright test"),
    ("cd apps && playwright test", clean, True, "bare playwright test after cd"),
    ("npm run test:e2e -- e2e/smoke.spec.ts", clean, False, "npm run test:e2e"),
    ("npx playwright install --with-deps chromium", clean, False, "playwright install"),
    ("npx playwright show-report", clean, False, "playwright show-report"),
    ("git push", clean, False, "push, no drift"),
    ("git commit -m x && git push -u origin HEAD", drift, True, "push with drift"),
    ("git push", broken, True, "push, check cannot run"),
    ("git pull --rebase", clean, False, "pull untouched"),
    ("npm test", clean, False, "ordinary command"),
    ("echo 'gh pr merge --squash is banned'", clean, True, "string mention still trips (documented, acceptable)"),
]

failures = 0
for cmd, stub, expect_denied, label in CASES:
    reason = guard.decide(cmd, HERE, drift=stub)
    denied = reason is not None
    ok = denied == expect_denied
    failures += 0 if ok else 1
    print(("PASS" if ok else "FAIL"), "|", label, "|", cmd, ("| " + reason.splitlines()[0][:70]) if reason and not ok else "")

# end-to-end through stdin, the way Claude Code calls it
payload = {"tool_name": "Bash", "tool_input": {"command": "gh pr merge 7 --squash"}, "cwd": HERE}
p = subprocess.run([sys.executable, os.path.join(HERE, "guard-bash.py")], input=json.dumps(payload),
                   capture_output=True, text=True)
out = json.loads(p.stdout)
e2e_ok = p.returncode == 0 and out["hookSpecificOutput"]["permissionDecision"] == "deny"
failures += 0 if e2e_ok else 1
print(("PASS" if e2e_ok else "FAIL"), "| stdin round trip denies squash")

payload = {"tool_name": "Read", "tool_input": {"file_path": "x"}}
p = subprocess.run([sys.executable, os.path.join(HERE, "guard-bash.py")], input=json.dumps(payload),
                   capture_output=True, text=True)
other_ok = p.returncode == 0 and p.stdout.strip() == ""
failures += 0 if other_ok else 1
print(("PASS" if other_ok else "FAIL"), "| non-Bash tool is ignored")

print("\n%d failure(s)" % failures)
sys.exit(1 if failures else 0)
