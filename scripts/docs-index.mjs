#!/usr/bin/env node
// Regenerates the three derived index files, and prints one entry, backlog row
// or decision on demand.
//
//   node scripts/docs-index.mjs index         → docs/PROGRESS.md, 06-backlog-index.md,
//                                               07-decisions-index.md
//   node scripts/docs-index.mjs entry B-137    → that entry's full text, and nothing else
//   node scripts/docs-index.mjs row B-137      → that backlog row, whole and verbatim
//   node scripts/docs-index.mjs decision D-122 → that decision row, whole and verbatim
//   node scripts/docs-index.mjs index --check → those three are up to date, writing
//                                               nothing
//   node scripts/docs-index.mjs audit         → every recorded SHA still resolves
//
// `row` and `decision` are the other half of the two index files: an index can
// only give an address, and the binding text still lives in a 493 KB and a
// 212 KB file. They print one row and nothing else, verbatim — no summarising,
// because in both files the row's own wording is what binds.
//
// Deliberately dependency-free and plain .mjs: this has to keep working on a
// checkout whose node_modules is mid-rebuild, which is exactly when somebody
// is reaching for the build record.
//
// SOURCES OF TRUTH, which this script only ever READS:
//   docs/progress/*.md   — the narrative entries, appended to by hand
//   docs/prds/06-backlog.md — the ordered work list, edited by hand
//   docs/prds/07-decisions.md — the decision log, edited by hand
// The three index files are GENERATED. Editing them by hand loses the edit on the
// next run; edit the source and re-run `npm run docs:index`.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PARTS_DIR = join(ROOT, 'docs/progress')
const BACKLOG = join(ROOT, 'docs/prds/06-backlog.md')
const DECISIONS = join(ROOT, 'docs/prds/07-decisions.md')

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

/**
 * Every row of a pipe table in `file` that `isRow` accepts, each carrying the
 * `| # | ... |` header line that governs it. Both source files repeat that
 * header per section (the backlog nine times), so it is tracked as the scan
 * goes rather than hard-coded — `row` and `decision` label their output with
 * the file's own column names, and a renamed column should follow.
 */
function readRows(file, isRow) {
  const rows = []
  let header = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^\|\s*#\s*\|/.test(line)) { header = cellsOf(line); continue }
    if (!isRow(line)) continue
    rows.push({ header, cells: cellsOf(line), line })
  }
  return rows
}

// The leading and trailing pipes bracket the row rather than separating cells.
// Neither file escapes an inner `|` (checked: zero occurrences), so a plain
// split is exact; if one ever appears it would break the table's rendering
// first, which is the louder failure.
const cellsOf = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((s) => s.trim())

/** Parse the backlog's item rows. */
function readBacklog() {
  return readRows(BACKLOG, (l) => /^\|\s*[0-9]+[a-z]*\s*\|\s*B-[0-9]/.test(l)).map((r) => {
    const [pos, idCell, item, prd, size, deps, phase] = r.cells
    return { ...r, pos, id: idCell.replace(/[✅\s]+$/, '').trim(), done: idCell.includes('✅'), item, prd, size: size ?? '', deps: deps ?? '', phase: phase ?? '' }
  })
}

/** Parse 07-decisions.md's rows: `| D-n | flag | decision | build impact |`. */
function readDecisions() {
  return readRows(DECISIONS, (l) => /^\|\s*D-[0-9]/.test(l)).map((r) => ({ ...r, id: r.cells[0], flag: r.cells[1] ?? '' }))
}

/**
 * One table row, printed whole: a heading naming where it came from, then every
 * remaining cell under its own column name. `fold` names the columns already in
 * the heading. Cell text is passed through untouched — this is a retrieval
 * command, and a summary of a backlog row or a decision is not the thing that
 * binds.
 */
function printRow(heading, source, row, fold) {
  console.log(`### ${heading}\n`)
  console.log(`_Verbatim from ${source}, which is the source of truth. ${source.includes('07-') ? 'This text overrides any conflicting PRD.' : 'The index drops the reasoning; this is the row that carries it.'}_\n`)
  for (let i = 0; i < row.cells.length; i++) {
    const name = row.header[i] ?? `column ${i + 1}`
    if (fold.includes(name)) continue
    console.log(`**${name}**\n`)
    console.log(`${row.cells[i] || '—'}\n`)
  }
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
  out.push('`06-backlog.md` is the source of truth and stays that way; it is also ~490 KB of wide table rows, which is more than a session should spend to answer "what is next". This is the same rows with the long description, the PRD reference and the dependency prose dropped.', '')
  out.push('**Then read the row itself before building the item** — `npm run docs:row -- B-262` prints that one row whole and verbatim, about 2 KB against the file\'s 490. The columns dropped here are the ones that say what to build.', '')
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

function buildDecisionsIndex(rows) {
  const out = []
  out.push('# 07 — Decision index', '')
  out.push('**This file is generated. Do not edit it by hand** — edit [`07-decisions.md`](07-decisions.md) and run `npm run docs:index`.', '')
  out.push('`07-decisions.md` amends the PRDs: where a PRD conflicts with a decision, the decision wins. It is also 212 KB, which is more than a session should spend to answer "is there a decision about X".', '')
  out.push('**This index carries each row\'s D-number and its topic column, and NOT the decision or the build-impact columns.** A decision that overrides a PRD has to be read in full before it is relied on: its wording is what binds, and several rows carry later corrections inside their own text — D-7 is the clearest, stating a policy and then recording that the policy was wrong on both halves. Reproducing the verdict here would invite deciding from the summary, which is the one failure this file exists to prevent.', '')
  out.push('`npm run docs:decision -- D-122` prints one row whole and verbatim, which is the cheap way to do that — a few KB rather than 212.', '')
  out.push('One caveat, because it is visible below rather than hidden: the topic column changed style over time. Early rows name a conflict to resolve ("Kiosk mode (master P2 vs PRD 03 P3)"); later ones state the decision outright ("Attaching a lease to a business account does not move the autopay mandate"). Where the source does that, so does this index — it is quoting, not summarising. Either way the binding text is the row in [`07-decisions.md`](07-decisions.md), not the line here.', '')
  out.push(`**${rows.length} decisions.**`, '')
  out.push('| # | Topic |', '|---|---|')
  for (const r of rows) out.push(`| ${r.id} | ${esc(r.flag)} |`)
  out.push('')
  return out.join('\n')
}

const [cmd, arg] = process.argv.slice(2)

if (cmd === 'entry') {
  if (!arg) { console.error('usage: docs-index.mjs entry <B-number or heading prefix>'); process.exit(2) }
  const hits = readParts().filter((e) => e.key === arg || e.title.startsWith(arg))
  if (!hits.length) { console.error(`no entry matching "${arg}"`); process.exit(1) }
  for (const e of hits) console.log(`### ${e.title}\n${e.body.replace(/\n*-{3,}\n*$/, '')}\n`)
} else if (cmd === 'row') {
  if (!arg) { console.error('usage: docs-index.mjs row <B-number or backlog position>'); process.exit(2) }
  const hits = readBacklog().filter((r) => r.id === arg || r.pos === arg)
  if (!hits.length) { console.error(`no backlog row matching "${arg}" — see docs/prds/06-backlog-index.md`); process.exit(1) }
  for (const r of hits) {
    printRow(`${r.id} — backlog row ${r.pos}${r.done ? ' ✅' : ''}`, 'docs/prds/06-backlog.md', r, ['#', 'ID'])
  }
} else if (cmd === 'decision') {
  if (!arg) { console.error('usage: docs-index.mjs decision <D-number>'); process.exit(2) }
  const hits = readDecisions().filter((r) => r.id === arg)
  if (!hits.length) { console.error(`no decision matching "${arg}" — see docs/prds/07-decisions-index.md`); process.exit(1) }
  for (const r of hits) printRow(`${r.id}`, 'docs/prds/07-decisions.md', r, ['#'])
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
  const decisions = readDecisions()
  const files = [
    ['docs/PROGRESS.md', buildProgressIndex(entries, backlog), `${entries.length} entries`],
    ['docs/prds/06-backlog-index.md', buildBacklogIndex(backlog), `${backlog.length} rows, ${backlog.filter((r) => !r.done).length} open`],
    ['docs/prds/07-decisions-index.md', buildDecisionsIndex(decisions), `${decisions.length} decisions`],
  ]
  // `--check` writes nothing and fails if any generated file is out of date.
  // Editing a source without regenerating is silent otherwise, and CI cannot
  // be relied on to catch it: `paths-ignore` skips both lanes for `docs/**`,
  // so the pull request that changes only the backlog runs nothing at all.
  if (arg === '--check') {
    const stale = files.filter(([path, body]) => {
      let current = null
      try { current = readFileSync(join(ROOT, path), 'utf8') } catch { /* missing counts as stale */ }
      return current !== body
    })
    for (const [path] of stale) console.log(`STALE  ${path}`)
    console.log(stale.length === 0
      ? 'the three generated index files match their sources'
      : `${stale.length} generated file(s) are out of date — run \`npm run docs:index\``)
    process.exit(stale.length === 0 ? 0 : 1)
  }
  for (const [path, body, summary] of files) {
    writeFileSync(join(ROOT, path), body)
    console.log(`${path.padEnd(31)} ${summary}`)
  }
} else {
  console.error(`unknown command "${cmd}" — expected "index", "entry", "row", "decision" or "audit"`); process.exit(2)
}
