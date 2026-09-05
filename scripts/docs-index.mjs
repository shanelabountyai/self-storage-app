#!/usr/bin/env node
// Regenerates the two derived index files, and prints a single progress entry.
//
//   node scripts/docs-index.mjs index      → docs/PROGRESS.md, docs/prds/06-backlog-index.md
//   node scripts/docs-index.mjs entry B-137 → that entry's full text, and nothing else
//   node scripts/docs-index.mjs audit     → every recorded SHA still resolves
//
// Deliberately dependency-free and plain .mjs: this has to keep working on a
// checkout whose node_modules is mid-rebuild, which is exactly when somebody
// is reaching for the build record.
//
// SOURCES OF TRUTH, which this script only ever READS:
//   docs/progress/*.md   — the narrative entries, appended to by hand
//   docs/prds/06-backlog.md — the ordered work list, edited by hand
// The two index files are GENERATED. Editing them by hand loses the edit on the
// next run; edit the source and re-run `npm run docs:index`.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PARTS_DIR = join(ROOT, 'docs/progress')
const BACKLOG = join(ROOT, 'docs/prds/06-backlog.md')

const SHA = /^[0-9a-f]{7,40}$/

/** Parse every part file into ordered entries. */
function readParts() {
  const files = readdirSync(PARTS_DIR).filter((f) => /^\d+-.*\.md$/.test(f)).sort()
  const out = []
  for (const file of files) {
    const lines = readFileSync(join(PARTS_DIR, file), 'utf8').split('\n')
    let group = null
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) { group = lines[i].slice(3).trim(); continue }
      if (!lines[i].startsWith('### ')) continue
      const title = lines[i].slice(4).trim()
      let end = i + 1
      while (end < lines.length && !lines[end].startsWith('### ') && !lines[end].startsWith('## ')) end++
      const body = lines.slice(i + 1, end).join('\n')
      out.push({ file, group, title, body, key: keyOf(title), shas: shasFrom(title, body), anchor: slug(title) })
    }
  }
  return out
}

function keyOf(title) {
  const m = title.match(/^(B-\d+[a-z]?)/)
  return m ? m[1] : title.split(/\s+[—-]\s+/)[0].replace(/[`*]/g, '').trim()
}

function shasFrom(title, body) {
  const out = []
  for (const m of title.matchAll(/`([^`]+)`/g)) if (SHA.test(m[1])) out.push(m[1])
  // The recorded SHAs are the LEADING backticked run of the first non-empty
  // body line. Read only that prefix: a corrected entry carries prose after it
  // naming the pre-merge SHA the merge rewrote ("it was `40ee469` on the
  // branch"), and that commit no longer exists — indexing it would put a dead
  // SHA in the index and light up `docs:audit` for every entry ever corrected.
  const first = body.split('\n').find((l) => l.trim() !== '')
  const lead = first && first.match(/^((?:\s*`[^`]+`\s*,?)+)/)
  if (lead) for (const m of lead[1].matchAll(/`([^`]+)`/g)) if (SHA.test(m[1])) out.push(m[1])
  return [...new Set(out)]
}

// Milestone-era headings carry their own trailing "✅ `sha`". The SHA has its
// own column here, so drop the duplicate — but keep any other status marker,
// because "⏳ PARTIAL — catch-up only" is the entry's whole meaning.
function displayTitle(title) {
  return title.replace(/\s*`[0-9a-f]{7,40}`\s*$/, '').replace(/\s*✅\s*$/, '').trim()
}

function slug(heading) {
  return heading.toLowerCase().replace(/`/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')
}

/** Parse the backlog's item rows. */
function readBacklog() {
  const rows = []
  for (const line of readFileSync(BACKLOG, 'utf8').split('\n')) {
    if (!/^\|\s*[0-9]+[a-z]*\s*\|\s*B-[0-9]/.test(line)) continue
    const c = line.split('|').map((s) => s.trim())
    // c[0] is the empty string before the leading pipe
    const [, pos, idCell, item, prd, size, deps, phase] = c
    rows.push({ pos, id: idCell.replace(/[✅\s]+$/, '').trim(), done: idCell.includes('✅'), item, prd, size: size ?? '', deps: deps ?? '', phase: phase ?? '' })
  }
  return rows
}

/** The bolded lead, or the first clause — whichever this row actually has. */
function shortItem(item) {
  const bold = item.match(/^\*\*(.+?)\*\*/)
  let s = bold ? bold[1] : item.split(/(?<=[.:])\s/)[0]
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > 100 ? s.slice(0, 99).replace(/[\s,;]+\S*$/, '') + '…' : s
}

const esc = (s) => s.replace(/\|/g, '\\|')

function buildProgressIndex(entries, backlog) {
  const done = backlog.filter((r) => r.done).length
  const latest = entries[entries.length - 1]
  const out = []
  out.push('# Build Progress', '')
  out.push('**This file is generated. Do not edit it by hand** — run `npm run docs:index` after appending an entry.', '')
  out.push('It is the index over the narrative build record. The entries themselves live in [`docs/progress/`](progress/), one part file per ~90 KB of build order; this index exists so that a session can see the whole history for a few thousand tokens instead of the 300,000 the entries themselves cost.', '')
  out.push('It complements rather than duplicates:', '')
  out.push('- [`docs/prds/06-backlog.md`](prds/06-backlog.md) — the ordered work list and ✅ markers ([index](prds/06-backlog-index.md))')
  out.push('- [`docs/prds/07-decisions.md`](prds/07-decisions.md) — settled decisions that override PRD text')
  out.push('- `git log` — the change-by-change record')
  out.push('- `README.md` — how the built thing works today', '')
  out.push(`**Status:** ${done} of ${backlog.length} backlog items complete. Latest entry: ${latest.key}${latest.shas.length ? ` (\`${latest.shas[0]}\`)` : ''}.`)
  out.push(`**Entries:** ${entries.length} across ${new Set(entries.map((e) => e.file)).size} part files.`, '')
  out.push('## Reading one entry', '')
  out.push('Do not read a whole part file to find one item. Either of these prints just the entry:', '')
  out.push('```bash')
  out.push('npm run docs:entry -- B-137')
  out.push("awk '/^### B-137 /{f=1;print;next} f&&/^#{2,3} /{exit} f' docs/progress/*.md")
  out.push('```', '')
  out.push('## Adding one', '')
  out.push('Append the entry as a `### ` heading at the end of the **highest-numbered** file in `docs/progress/`, with its SHA on the line below the heading. Start a new part file once the current one passes ~90 KB. Then run `npm run docs:index`.', '')
  out.push('## Index', '')

  let group = null
  for (const e of entries) {
    if (e.group !== group) {
      group = e.group
      out.push('', `### ${group}`, '')
      out.push('| Item | SHA | Detail |', '|---|---|---|')
    }
    const shas = e.shas.length ? e.shas.map((s) => `\`${s}\``).join(' ') : '—'
    out.push(`| ${esc(displayTitle(e.title))} | ${shas} | [${e.file.replace(/\.md$/, '')}](progress/${e.file}#${e.anchor}) |`)
  }
  out.push('')
  return out.join('\n')
}

function buildBacklogIndex(rows) {
  const remaining = rows.filter((r) => !r.done)
  const out = []
  out.push('# 06 — Backlog index', '')
  out.push('**This file is generated. Do not edit it by hand** — edit [`06-backlog.md`](06-backlog.md) and run `npm run docs:index`.', '')
  out.push('`06-backlog.md` is the source of truth and stays that way; it is also ~350 KB of wide table rows, which is more than a session should spend to answer "what is next". This is the same rows with the long description, the PRD reference and the dependency prose dropped.', '')
  out.push(`**${rows.length} items — ${rows.length - remaining.length} complete, ${remaining.length} open.**`, '')
  out.push('## Open, in build order', '')
  out.push('| # | ID | Item | Size | Depends on |', '|---|---|---|---|---|')
  for (const r of remaining) out.push(`| ${r.pos} | ${r.id} | ${esc(shortItem(r.item))} | ${r.size} | ${esc(r.deps)} |`)
  out.push('')
  out.push('> An item stays open until every part of it is done — several above are partly built, and their parts are recorded in [`../PROGRESS.md`](../PROGRESS.md).', '')
  out.push('## All items', '')
  out.push('| # | ID | ✅ | Item | Size | Phase |', '|---|---|---|---|---|---|')
  for (const r of rows) out.push(`| ${r.pos} | ${r.id} | ${r.done ? '✅' : ''} | ${esc(shortItem(r.item))} | ${r.size} | ${r.phase} |`)
  out.push('')
  return out.join('\n')
}

const [cmd, arg] = process.argv.slice(2)

if (cmd === 'entry') {
  if (!arg) { console.error('usage: docs-index.mjs entry <B-number or heading prefix>'); process.exit(2) }
  const hits = readParts().filter((e) => e.key === arg || e.title.startsWith(arg))
  if (!hits.length) { console.error(`no entry matching "${arg}"`); process.exit(1) }
  for (const e of hits) console.log(`### ${e.title}\n${e.body.replace(/\n*-{3,}\n*$/, '')}\n`)
} else if (cmd === 'audit') {
  // Regenerating the index does not check that anything it names exists.
  // A `--rebase` or `--squash` merge rewrites the SHAs an entry recorded
  // hours earlier, so this is the check that has to run after a merge.
  const { execSync } = await import('node:child_process')
  let missing = 0
  const unmerged = []
  for (const e of readParts()) {
    for (const sha of e.shas) {
      try { execSync(`git cat-file -e ${sha}^{commit}`, { stdio: 'ignore' }) } catch {
        console.log(`MISSING     ${sha}  ${e.title}`); missing++; continue
      }
      // Existing but not on main is the NORMAL state of the entry you just
      // wrote on a feature branch, so it is a note and never a failure. Only a
      // commit that resolves to nothing at all means a merge rewrote the SHA
      // and the entry now names something unreachable.
      try { execSync(`git merge-base --is-ancestor ${sha} origin/main`, { stdio: 'ignore' }) } catch {
        unmerged.push(`${sha}  ${e.title}`)
      }
    }
  }
  for (const u of unmerged) console.log(`not yet on main  ${u}`)
  console.log(missing === 0
    ? `every recorded SHA resolves${unmerged.length ? ` (${unmerged.length} not yet merged, which is fine on a branch)` : ' and is reachable from origin/main'}`
    : `${missing} recorded SHA(s) name a commit that does not exist — a merge rewrote them; correct the entry and name the pre-merge SHA`)
  process.exit(missing === 0 ? 0 : 1)
} else if (cmd === 'index' || cmd === undefined) {
  const entries = readParts()
  const backlog = readBacklog()
  writeFileSync(join(ROOT, 'docs/PROGRESS.md'), buildProgressIndex(entries, backlog))
  writeFileSync(join(ROOT, 'docs/prds/06-backlog-index.md'), buildBacklogIndex(backlog))
  console.log(`docs/PROGRESS.md               ${entries.length} entries`)
  console.log(`docs/prds/06-backlog-index.md  ${backlog.length} rows, ${backlog.filter((r) => !r.done).length} open`)
} else {
  console.error(`unknown command "${cmd}" — expected "index", "entry" or "audit"`); process.exit(2)
}
