# Next

**The buildable queue is EMPTY. Every open row is blocked on you, not on code,
and this file no longer carries an unowned gap.**
([06-backlog.md](docs/prds/06-backlog.md))

B-273 shipped on 2026-09-09 (`53d425f`). It took the one buildable thing this
file named — `keyedFieldError` announcing a count instead of the refusal on a
one-field form. **That gap is closed and nothing replaced it.**

**Six rows remain and not one of them is a build session's to start:**

| Row | Blocked on | Kind |
|---|---|---|
| **B-254** — `LAST_REVIEWED` never moves | **D-115** — a real VoiceOver/NVDA pass by a person | owner action |
| **B-129** — auction marketplace listing | Master PRD §11 **OQ-9, open** | owner decision |
| **B-243** — returned certified mail | a real provider key; D-63 forbids a simulator | credentials |
| **B-085** — first real gate-vendor driver | partner agreement | credentials |
| **B-133** — Google reviews / GBP sync | approved GBP application | credentials |
| **B-134** — authored size-page copy | a real portfolio tripping D-77's gate | a trigger that has not fired |

**The cheapest one to unblock is B-129**, because OQ-9 is a decision you can make
at a desk. **The most valuable is B-254**, which is not a decision at all: it is a
person running a screen reader through move-in and payment, and it converts the
largest unverified claim in this codebase into a verified one. **No agent may
tick it.**

**There is nothing for a fresh session to pick up.** A seventh review pass is the
only thing that would produce buildable rows — the last one was 2026-08-25
(B-187–B-196), and everything from B-197 onward has come from a reviewer report
or from a previous item's own left-behind note. Say so if you want one.

## What B-273 learned

**A comment that describes a defect accurately is not a fix, and two of them are
a signal that nobody read them together.** B-266 and B-270 each hit this helper,
each wrote a paragraph saying it would trade 3.3.3 for a field count, and each
wrote the shape out by hand instead. `/accessibility` even carries B-270's note
saying the e2e suite caught it. Nobody noticed the helper was still wrong for
every OTHER caller — including the lead form beside the one B-270 fixed, which
has passed it exactly one field since B-264. **Two independent workarounds with
the same explanation means fix the thing being worked around.** The fix was
smaller than either workaround.

**A weak assertion can keep a defect green for months.** `smoke.spec.ts:1730`
asserted `expectAnnounced(status, /problem/)` on the English lead form's
refusal. It was matching the word inside "There is a **problem** with one
field." — so the spec that exists to prove the refusal is announced was passing
on a string containing no suggestion at all. **A regex loose enough to match the
bug is a regex that will match the bug.** It asserts the sentence now.

**`NEXT.md` said three call sites route around it; the count was not the point
but it was wrong again.** Two route around this specific defect
(`waitlist-actions.ts`, `checkout/actions.ts`); the two others that mention the
"one field" summary — `portal/access/actions.ts` and `admin/impersonation/actions.ts`
— route around something else entirely (attaching a message to a hidden input),
were unaffected, and stayed as they were. **Third item running where a carried
note's number did not survive a grep.**
