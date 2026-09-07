import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// `scripts/docs-index.mjs` is the only way this repo's three big documents are
// read cheaply: `06-backlog.md` is 493 KB, `07-decisions.md` 212 KB, and the
// build record 1.6 MB across `docs/progress/`. The index files answer "where",
// and `row`/`decision` answer "what does it actually say" without opening the
// file — which is the whole point, because both of those files BIND. The
// backlog row is what the session builds from; the decision row overrides the
// PRDs.
//
// So the contract under test is narrow and worth pinning: **the commands
// retrieve, they never summarise.** Every cell of the row comes out whole. A
// well-meant later edit that truncated a long `Item` cell to keep the output
// tidy would be indistinguishable from working software, and would quietly
// hand the next session an abridged version of its own instructions.
//
// No database and no app code — this runs anywhere `node` does, deliberately,
// since the script's own reason for being dependency-free is that it is wanted
// on a checkout whose node_modules is mid-rebuild.
const root = fileURLToPath(new URL('..', import.meta.url))
const script = fileURLToPath(new URL('../scripts/docs-index.mjs', import.meta.url))

const run = (...args: string[]) =>
  // stderr is captured rather than inherited: the miss cases below expect a
  // usage line, and inheriting would print four of them into every clean run.
  execFileSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

/** The cells of a pipe-table row, exactly as the script splits them. */
const cellsOf = (line: string) =>
  line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((s) => s.trim())

const rowsOf = (path: string, test: RegExp) => read(path).split('\n').filter((l) => test.test(l))

// Sampled rather than exhaustive, and sampled from the FILE rather than
// hard-coded: 266 backlog rows would be 266 process spawns, and a literal
// `B-262` here would rot the first time the backlog is renumbered. First, last
// and longest between them cover the empty trailing cell, the newest row, and
// the one most likely to tempt somebody into truncating.
function sample(lines: string[]) {
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a))
  return [...new Set([lines[0], lines[lines.length - 1], longest])]
}

const backlogRows = rowsOf('../docs/prds/06-backlog.md', /^\|\s*[0-9]+[a-z]*\s*\|\s*B-[0-9]/)
const decisionRows = rowsOf('../docs/prds/07-decisions.md', /^\|\s*D-[0-9]/)

describe('docs:row', () => {
  it('prints every cell of the row verbatim', () => {
    for (const line of sample(backlogRows)) {
      const cells = cellsOf(line)
      const id = cells[1].replace(/[✅\s]+$/, '').trim()
      const out = run('row', id)
      expect(out.startsWith(`### ${id} — backlog row ${cells[0]}`), `heading for ${id}`).toBe(true)
      // The identifying columns are folded into the heading; everything else
      // has to appear as its own block, whole. `\n<cell>\n` and not `includes`,
      // so a truncated cell cannot pass on its own prefix.
      for (const cell of cells.slice(2)) {
        expect(out, `${id}: cell not reproduced whole`).toContain(`\n${cell || '—'}\n`)
      }
    }
  })

  it('finds a row by its backlog position as well as its B-number', () => {
    const cells = cellsOf(backlogRows[backlogRows.length - 1])
    // Positions carry letter suffixes (`90n`) because B-numbers are not in
    // build order — the index leads with the position, so lookups will use it.
    expect(run('row', cells[0])).toBe(run('row', cells[1].replace(/[✅\s]+$/, '').trim()))
  })
})

describe('docs:decision', () => {
  it('prints every cell of the row verbatim, corrections included', () => {
    for (const line of sample(decisionRows)) {
      const cells = cellsOf(line)
      const out = run('decision', cells[0])
      expect(out.startsWith(`### ${cells[0]}`), `heading for ${cells[0]}`).toBe(true)
      for (const cell of cells.slice(1)) {
        expect(out, `${cells[0]}: cell not reproduced whole`).toContain(`\n${cell || '—'}\n`)
      }
    }
  })

  it('carries D-7 through with the sentence that reverses it', () => {
    // The row states a hold policy and then records, further down its own
    // build-impact cell, that the policy was wrong on both halves. It is the
    // concrete case for why this command may not summarise: a one-line
    // rendering of D-7 is the opposite of what D-7 settles.
    const out = run('decision', 'D-7')
    expect(out).toContain('Free hold, no card.')
    expect(out).toContain('wrong on both halves')
  })
})

describe('the generated index files', () => {
  it('are up to date with their sources', () => {
    // Nothing else catches a source edited without `npm run docs:index`: CI
    // skips both lanes for `docs/**` and `**.md`, so the pull request that only
    // touches the backlog runs no checks at all. `--check` writes nothing.
    expect(() => run('index', '--check')).not.toThrow()
  })
})

// B-269. `docs:audit` is the ONE thing that catches a merge rewriting a SHA
// an entry recorded hours earlier — CLAUDE.md says so, because `docs:index`
// regenerates the index without verifying that a single SHA it names exists.
// It reads those SHAs out of the entry with the same helper the index does,
// and that helper only ever understood a bare `` `sha` `` line. From B-258 the
// entries started spelling it `**Commit:** `sha``, and for thirteen entries in
// a row the audit read nothing, said nothing, and reported "every recorded SHA
// resolves" — while the index printed an em dash in their commit column and
// nobody read it as a fault.
//
// This is the guard, and it is deliberately about the OUTPUT rather than about
// the regex: any future way of writing that line is fine as long as the SHA
// still comes out the other end.
describe('the SHA of every recorded entry', () => {
  it('survives into the generated index, however the entry spells the line', () => {
    // Read rather than regenerated: `run('index')` here would WRITE the three
    // index files mid-suite and quietly repair a source somebody edited without
    // running it, which is the exact staleness the neighbouring `--check` test
    // exists to fail on. That test is what makes reading the file enough.
    const rows = rowsOf('../docs/PROGRESS.md', /^\|\s*B-[0-9]/)
    expect(rows.length, 'no entry rows parsed — did the index table change shape?').toBeGreaterThan(250)

    const missing = rows.filter((line) => cellsOf(line)[1] === '—').map((line) => cellsOf(line)[0])
    expect(
      missing,
      'these entries record a SHA that `shasFrom` in scripts/docs-index.mjs cannot read, so `npm run docs:audit` silently skips them',
    ).toEqual([])
  })
})

describe('a lookup that misses', () => {
  it('fails rather than printing the wrong row', () => {
    // Silence or a neighbouring row would be worse than an error here: the
    // caller is about to build from whatever comes back.
    for (const args of [['row', 'B-999999'], ['decision', 'D-999999'], ['row'], ['decision']]) {
      expect(() => run(...args), args.join(' ')).toThrow()
    }
  })
})
