# Next

**Pick up B-274.** It is the only buildable row and it did not exist yesterday.
([06-backlog.md](docs/prds/06-backlog.md), row `83aa`)

The 2026-09-09 session found the queue empty and asked; the owner answered
**master PRD §8 OQ-9 — the auction channel — as online, with the manner of sale
a per-facility setting (D-131)**. No code shipped. What the answer produced is
one row, and it needs no credentials, no partner and no decision.

## B-274 — nothing in the product says where a unit will be sold

`EXAMPLE_SALE_STATEMENTS` in `packages/core/notices/templates.ts` hedges the
whole consequence to *"the property may be advertised and sold to satisfy the
lien... governed by state law"*, and **no field in the schema carries a sale
venue**. Correct about the law, useless to the person receiving it: a tenant who
wants to attend, bid, or send a relative to buy their own property back cannot
learn from anything this product mails them whether the sale is at the facility
on a Saturday or on a website — and if a website, which one.

**Build:** `Facility.auctionSaleManner` (`online` | `live_onsite`, seeded
`online`) plus a venue string the `online` value requires, with its control on
`/admin/settings/delinquency` beside `auctionSaleTerms` — same page, same item,
because a column that configures behaviour ships with its form field. Two
consumers, both silent today: the pre-lien and lien `saleStatement`, and the lot
sheet (`/admin/auctions/lots.csv`).

**Three things the row must not do**, and they are in the row text:

1. **No marketplace driver.** B-129 stays open on the partner agreement, D-63
   stands, advertising stays `AuctionAdvertisement` rows a person types.
2. **`live_onsite` is not a degraded branch.** D-131 kept it first-class; a
   single-facility operator running their own sale is a supported answer.
3. **A null venue on an `online` facility is a refusal, not a blank.** A notice
   naming no site is worse than the hedge it replaces, so `auctionReadiness`
   gains the check and `/admin/auctions` names the facility — the same way it
   already names every other dropped-lot blocker.

Every word of the new statement is draft legal text under D-10 and keeps the
attorney-review caveat.

## The blocked list is five now, not six

B-129 lost one of its two blockers and kept the harder one. Still not a build
session's to start:

| Row | Blocked on | Kind |
|---|---|---|
| **B-254** — `LAST_REVIEWED` never moves | **D-115** — a real VoiceOver/NVDA pass by a person | owner action |
| **B-129** — auction marketplace driver | partner agreement (OQ-9 no longer) | credentials |
| **B-243** — returned certified mail | a real provider key; D-63 forbids a simulator | credentials |
| **B-085** — first real gate-vendor driver | partner agreement | credentials |
| **B-133** — Google reviews / GBP sync | approved GBP application | credentials |
| **B-134** — authored size-page copy | a real portfolio tripping D-77's gate | a trigger that has not fired |

**B-254 is still the most valuable thing on this list and still not mine to do.**
A person runs a screen reader through move-in and payment; no agent may tick it.

After B-274 the queue is empty again. **A seventh review pass is the only thing
that produces buildable rows** — the last was 2026-08-25 (B-187–B-196), and
everything from B-197 on came from a reviewer report or a previous item's
left-behind note.

## What answering OQ-9 learned

**An open question can hide a gap that has nothing to do with the question.**
OQ-9 asked which channel; the product's actual defect was that it names no
channel at all, to anybody, ever. Three items (B-062, B-083, B-129) built
around that question and none of them noticed the notice was silent, because
each was checking whether it could answer OQ-9 rather than what OQ-9's absence
was costing. **The row a decision unblocks is not always the row it was blocking.**

**B-129's own row cited the wrong PRD section for two weeks.** It said "master
PRD §11 OQ-9"; the open questions are §8 and there is no §11. Corrected in the
row and in the numbering note. Nobody followed the reference, which is the
point — a citation that is never checked is a citation that can be wrong.
