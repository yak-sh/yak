// How a citation stands right now, derived and never stored.
//
// A citation is an edge — `A cites B` — carrying the commit it was last checked
// against (`revision{commit}`), the place in B it names (`lines`, or the whole
// file), and the `verified` mark somebody wrote when they checked it. A
// definition is cited by pointing at it: B is then a @yaks/code `symbol`
// entity, and the file is its module's. Whether it is still true is not a
// property: it is re-derived here, so a document can never claim a freshness
// the repository contradicts.
//
// For a file, the question is Git's: which commits after `revision.commit`
// touched the place the citation names. `git log <commit>..HEAD` answers it,
// narrowed by `-L :<symbol>:<path>` or `-L <start>,<end>:<path>` when the
// citation named a place, so a commit elsewhere in the same file is not
// reported. The commit is checked with `cat-file` first, because a commit this
// checkout does not have (rebased away, or from another clone) makes `log`
// fail the same way an empty range succeeds-empty would look, and that must
// read as unknown rather than current: a citation that reads fresh on an
// answer nothing could establish is worse than one that admits it cannot tell.
//
// For a citation of an entity rather than a file, the journal is the same
// question asked of the graph: what changed about B after `verified.at`. This
// module does not read the journal itself — a host that has one fills the
// `changed` seam (@yaks/journal `entries`), and one that does not gets
// `unknown`.
//
// Nothing here writes: `cites verify` (./tools.ts) is the only thing that
// writes the mark. It runs `git` as a subprocess, so like ./host.ts and
// ./land.ts it stays out of ./mod.ts, which type-checks with only the web
// platform in scope.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import { type Run, run as git } from './land.ts'

/** The relation tag on a citation: this entity refers to a place in that one. */
export let CITES = 'cites'

/** The component naming a file in a repository. (./tree.ts `FILE` is a tree
 * entry's mode, a different thing, which is why these names live here.) */
export let FILE = 'file'

/** The component naming the commit a citation was last checked against. */
export let REVISION = 'revision'

/** @yaks/code's component for an exported definition, named here because a
 * citation may point at one. */
export let SYMBOL = 'symbol'

/** The component naming the line range a citation points at. */
export let LINES = 'lines'

/** The component holding what the citing side quoted. */
export let QUOTE = 'quote'

/** @yaks/kernel's mark, named here because a citation carries one. Only the
 * act of checking writes it, so its absence means nobody has checked. */
export let VERIFIED = 'verified'

/**
 * Where a citation stands. `changes` names what moved under it — the commits
 * that touched the cited place, or the transactions that changed the cited
 * entity — so a reader can go look at them.
 */
export type Status =
  | { state: 'current' }
  | { state: 'moved'; changes: string[] }
  | { state: 'unverified' }
  | { state: 'unknown'; why: string }

/**
 * What changed about a cited entity after a moment, as lines a reader can act
 * on. A host fills this from @yaks/journal; without it a citation of an entity
 * reads unknown, because nothing else in a graph records what moved.
 */
export type Changed = (
  target: Eid,
  after: string,
) => string[] | Promise<string[]>

/** What deriving a status takes: the checkout to ask, how to run git (a test
 * answers without a repository), and the journal seam for entity targets. */
export type Ops = {
  cwd: string
  run?: Run
  changed?: Changed
}

let comp = (b: Bundle, name: string) => b[name] as Comp | undefined
let text = (v: unknown): string => typeof v == 'string' ? v.trim() : ''
let count = (v: unknown): number | undefined =>
  typeof v == 'number' && Number.isFinite(v) ? v : undefined

// The `-L` arguments narrowing the log to the place a citation names: the
// definition by name, else the line range, else nothing and the whole file is
// the place. A symbol is preferred over a range because it survives the file
// moving around it, which is the whole reason Git has the form.
let place = (cite: Bundle, to: Bundle, path: string): string[] => {
  let name = text(comp(to, SYMBOL)?.name)
  if (name) return ['-L', `:${name}:${path}`]
  let lines = comp(cite, LINES)
  let start = count(lines?.start)
  if (start == null) return []
  return ['-L', `${start},${count(lines?.end) ?? start}:${path}`]
}

let short = (commit: string) => commit.slice(0, 8)

let lines = (out: string) =>
  out.split('\n').map((l) => l.trim()).filter(Boolean)

// Git's complaint, first line only: `-L` naming a definition the file no
// longer has says so in one line, and the rest is a usage note.
let why = (err: string, fallback: string) =>
  err.trim().split('\n').find(Boolean) ?? fallback

/**
 * Derive how one citation stands. `cite` is the edge bundle and `to` the
 * bundle it points at — a `file` entity for a place in code, a `symbol` for a
 * definition (with `file`, its module, beside it), any entity otherwise.
 *
 * ```ts
 * await status(cite, file, { cwd: '/home/me/project' })
 * // { state: 'moved', changes: ['b8b0f89'] }
 * ```
 */
export let status = async (
  cite: Bundle,
  to: Bundle,
  ops: Ops,
  file: Bundle = to,
): Promise<Status> => {
  let mark = comp(cite, VERIFIED)
  if (!mark) return { state: 'unverified' }
  let path = text(comp(file, FILE)?.path)
  if (!path) return await moved(to, text(mark.at), ops)

  let commit = text(comp(cite, REVISION)?.commit)
  if (!commit) {
    return { state: 'unknown', why: 'verified against no commit' }
  }
  let ask = ops.run ?? git
  let known = await ask(['cat-file', '-e', `${commit}^{commit}`], ops.cwd)
  if (!known.ok) {
    return {
      state: 'unknown',
      why: `commit ${short(commit)} is not in this checkout`,
    }
  }
  // Two questions, coarse first: did anything touch the FILE, and only then
  // did anything touch the place in it. The order is not an optimization —
  // `git log -L` refuses an empty revision range ("No commit specified?"), and
  // a citation verified at HEAD has exactly that range, so asking `-L` first
  // would make every freshly verified citation read unknown.
  let touched = await ask(
    ['log', '--format=%h', `${commit}..HEAD`, '--', path],
    ops.cwd,
  )
  if (!touched.ok) {
    return { state: 'unknown', why: why(touched.err, 'git log failed') }
  }
  let commits = lines(touched.out)
  if (!commits.length) return { state: 'current' }
  let narrow = place(cite, to, path)
  if (!narrow.length) return { state: 'moved', changes: commits }
  // `-L` takes the path itself and refuses a pathspec beside it. A path that
  // is gone at HEAD makes it fail, which is unknown rather than current: a
  // deleted or renamed file is precisely what nobody can vouch for.
  let log = await ask(
    ['log', '-s', '--format=%h', ...narrow, `${commit}..HEAD`],
    ops.cwd,
  )
  if (!log.ok) return { state: 'unknown', why: why(log.err, 'git log failed') }
  let changes = lines(log.out)
  return changes.length ? { state: 'moved', changes } : { state: 'current' }
}

// A citation of an entity: the journal, asked what moved after the mark.
let moved = async (
  to: Bundle,
  at: string,
  ops: Ops,
): Promise<Status> => {
  if (!ops.changed) {
    return {
      state: 'unknown',
      why: 'this citation names an entity, and no journal was given to read',
    }
  }
  if (!at) return { state: 'unknown', why: 'verified with no time' }
  let changes = await ops.changed(to.entity.eid, at)
  return changes.length ? { state: 'moved', changes } : { state: 'current' }
}
