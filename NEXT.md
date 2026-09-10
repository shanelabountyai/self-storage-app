# Next

**The buildable queue has fifteen rows on it.** `3b1d751` added B-275; `5d60df1`
added B-276–B-291 from the review block over B-252–B-274. Fourteen of those
sixteen are buildable today; two are blocked on new open questions.

## Start here

**B-276 (`83ac`) — the auction lot can be sold at a venue the served notice
never named.** It leads the block on the same ground B-224, B-202 and B-137 led
theirs: it is the only finding that costs a wrongful-sale claim rather than
money. B-274 built `Facility.auctionSaleVenue` and did not build its drift
check — `auctionReadiness` reads the facility setting *as it stands today*,
while `Notice` snapshots the rendered address and the document hash and no sale
statement at all. Serve the notice, change the venue three weeks later, and
readiness stays green. The precedent is in the same file: `notice_names_another_unit`
already blocks for exactly this reason.

Then **B-277** (nothing sweeps for ledger/invoice skew) and **B-282** (three
customer money-path tables bypass `ScrollRegion`, SC 2.1.1 Level A). Read the
row before starting — several carry a `needs confirmation at build time` clause
that must not be quietly upgraded to verified.

## Two questions are the owner's

| Q | Blocks | The call |
|---|---|---|
| **D-133** | B-290 | Does the site OFFER Spanish to a browser that prefers it? There is no `Accept-Language` reader anywhere in the app, so thirteen items of Spanish work sit behind a button that wraps to a second row at 320px. The reviewer recommends a dismissible offer, not an auto-switch. Does not reverse D-122. |
| **D-134** | B-291 | Does `<title>` follow the reader on `/faq`, `/about`, `/contact`, `/accessibility` while `description`/`alternates` stay English? D-122/D-123's crawler argument covers the description and not the announced page name. |

## One thing that is not a row and is worth doing early

**`db:backfill:move-in-payments` has never been run against production.** Every
card move-in predating B-255 carries a phantom ledger balance, and at the
default `full_balance` setting that *prevents cure* — a tenant who has paid
stays overlocked and stays on the ladder. The script writes nothing without
`--apply`; run it dry and record the output. B-277 owns the detection, not the
repair.

## The blocked list is unchanged, plus the two new questions

| Row | Blocked on | Kind |
|---|---|---|
| **B-254** — `LAST_REVIEWED` never moves | **D-115** — a real VoiceOver/NVDA pass by a person | owner action |
| **B-290** | **D-133** | owner decision |
| **B-291** | **D-134** | owner decision |
| **B-275** — Neon dev branch baseline | nothing — **buildable, and authorised by D-132** | ready |
| **B-129** — auction marketplace driver | partner agreement | credentials |
| **B-243** — returned certified mail | a real provider key; D-63 forbids a simulator | credentials |
| **B-085** — first real gate-vendor driver | partner agreement | credentials |
| **B-133** — Google reviews / GBP sync | approved GBP application | credentials |
| **B-134** — authored size-page copy | a real portfolio tripping D-77's gate | a trigger that has not fired |

**B-254 grew a fourth coverage gap and is still not mine to do.** Three things
in this block resolve to "what does VoiceOver actually say", and the one the
reviewer most wants heard is not on any row: pressing the language toggle
re-renders the whole tree in the other language with no focus move and no
announcement, and a pre-mounted live region cannot fix it because the re-render
replaces the region too. That is beyond AA, and it is exactly what an axe pass
calls green and a screen-reader user calls broken.

## What this session learned

**The ordinal drifted and the range is the real name.** The numbering note
already called B-224–B-243 "the seventh review block" while `NEXT.md` called it
the sixth. Rather than silently write a second "seventh", the note now says the
ordinal has drifted and that **what identifies a block here is the range it
reviewed**. Do not renumber the old ones.

**A drifted schema is not an un-baselined one, and the difference decides the
fix.** `migrate resolve --applied` is the standard baseline move and it was
wrong here: the Neon dev branch carries three indexes no migration creates, so
there was no honest point in the recorded history to resolve it to. That is
D-132, and B-275 is the one authorised reset. A later `migrate reset` against
`.env.local` without a new D-number is still the thing B-253 forbids.

**Two lanes finding the same defect independently is worth more than either
report.** The operator and digital-experience reviewers both landed on
`payment.ts:388`'s `take: 1` with no `orderBy`, from opposite directions — one
counting money, one reading a receipt. It became one row, B-278, and the
agreement is recorded on it.
