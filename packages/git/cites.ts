// How a citation stands right now, derived and never stored.
//
// A citation is an edge — `A cites B` — carrying the commit it was last checked
// against (`revision{commit}`) and the `verified` mark somebody wrote when they
// checked it. What B is names the place: a @yaks/file `file` for a whole file,
// an entity wearing `lines{file, start, end}` for some lines of one (a place,
// holding the text the citer quoted as `content.body`), a @yaks/code `symbol`
// for a definition, whose file is its module, or any entity at all. Whether it
// is still true is not a property: it is re-derived here, so a document can
// never claim a freshness the repository contradicts.
//
// For a file of a repository, the question is Git's, asked in a checkout of
// that repository: which commits after `revision.commit` touched the place the
// citation names. `git log <commit>..HEAD` answers it, narrowed by
// `-L :<symbol>:<path>` or `-L <start>,<end>:<path>` when the citation named a
// place, so a commit elsewhere in the same file is not reported. The commit is
// checked with `cat-file` first, because a commit this checkout does not have
// (rebased away, or from another clone) makes `log` fail the same way an empty
// range succeeds-empty would look, and that must read as unknown rather than
// current: a citation that reads fresh on an answer nothing could establish is
// worse than one that admits it cannot tell.
//
// For anything else, a file on a volume and the lines of one included,
// @yaks/kernel compares the content hash kept when the citation was verified
// with the entity's content now.
//
// Nothing here writes: `cites verify` (./tools.ts) is the only thing that
// writes the mark. It runs `git` as a subprocess, so like ./host.ts and
// ./land.ts it stays out of ./mod.ts, which type-checks with only the web
// platform in scope.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import { CITES, type Status, status as entityStatus } from '@yaks/kernel'
import type { Vocab } from '@yaks/vocab'
import { type Run, run as git } from './land.ts'

export { CITES }

/** @yaks/file's component naming a file, a path in a root. (./tree.ts `FILE`
 * is a tree entry's mode, a different thing, which is why these names live
 * here.) */
export let FILE = 'file'

/** @yaks/file's component naming the lines of a file an entity sits at, which
 * a citation of some lines points at. */
export let LINES = 'lines'

/** The component a file's root wears when Git answers for its files. */
export let REPOSITORY = 'repository'

/** The component naming the commit a citation was last checked against. */
export let REVISION = 'revision'

/** @yaks/code's component for an exported definition, named here because a
 * citation may point at one. */
export let SYMBOL = 'symbol'

/** @yaks/kernel's mark, named here because a citation carries one. Only the
 * act of checking writes it, so its absence means nobody has checked. */
export let VERIFIED = 'verified'

/**
 * Where a citation stands. For a file, `changes` names the commits that
 * touched the cited place.
 */
export type { Status }

/** A checkout to ask Git in: its top directory, and the repository it is a
 * checkout of. A file is checked only in a checkout of its own root. */
export type Checkout = { cwd: string; repository: Eid }

/** The checkout for files, and the vocabulary for graph entities. */
export type Ops = {
  checkout?: Checkout
  run?: Run
  vocab: Vocab
}

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined
let text = (v: unknown): string => typeof v == 'string' ? v.trim() : ''
let count = (v: unknown): number | undefined =>
  typeof v == 'number' && Number.isFinite(v) ? v : undefined

/// within({ entity: { eid: 's' }, symbol: { module: 'f' } }) -> 'f'
/// within({ entity: { eid: 'p' }, lines: { file: 'f', start: 3 } }) -> 'f'
/// within({ entity: { eid: 'f' }, file: { path: 'a.ts' } }) -> undefined
/** The file a cited symbol or place is in, by id: a symbol's module, a place's
 * file. Nothing for a file itself, or for anything that sits in no file. */
export let within = (to: Bundle): Eid | undefined =>
  text(comp(to, SYMBOL)?.module) || text(comp(to, LINES)?.file) || undefined

/**
 * The file of a repository a citation of `to` is checked against in Git: `to`
 * itself when it is one, the module a symbol is in, or the file a place is in.
 * Nothing when that file is not in a repository (a file on a volume, the lines
 * of a transcript) or `to` is in no file at all: a citation of those holds to
 * the cited content. `get` answers the file and its root by id.
 */
export let tracked = (
  to: Bundle,
  get: (eid: Eid) => Bundle | undefined,
): Bundle | undefined => {
  let ref = within(to)
  let file = ref ? get(ref) : to
  let at = comp(file, FILE)
  return text(at?.path) && get(text(at?.root))?.[REPOSITORY] ? file : undefined
}

// The `-L` arguments narrowing the log to the place a citation names: the
// definition by name, else the lines, else nothing and the whole file is the
// place. A symbol is preferred over a range because it survives the file
// moving around it, which is the whole reason Git has the form.
let place = (to: Bundle, path: string): string[] => {
  let name = text(comp(to, SYMBOL)?.name)
  if (name) return ['-L', `:${name}:${path}`]
  let lines = comp(to, LINES)
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
 * Derive how one citation stands. `cite` is the edge bundle, `to` the bundle
 * it points at, and `file` the file of a repository it is checked against in
 * Git ({@link tracked}), absent for a citation of content. For one whose lines
 * a later commit touched,
 * `status(cite, place, { checkout: { cwd: '/home/me/project', repository }, vocab }, file)`
 * answers `{ state: 'moved', changes: ['b8b0f89'] }`.
 */
export let status = async (
  cite: Bundle,
  to: Bundle,
  ops: Ops,
  file?: Bundle,
): Promise<Status> => {
  let mark = comp(cite, VERIFIED)
  if (!mark) return { state: 'unverified' }
  if (!file && comp(to, SYMBOL)) {
    return { state: 'unknown', why: 'the cited symbol has no file to check' }
  }
  if (!file) return entityStatus(cite, to, ops.vocab)
  let at = ops.checkout
  if (!at) {
    return {
      state: 'unknown',
      why: 'this citation names a file, and no checkout was given',
    }
  }
  if (text(comp(file, FILE)?.root) != at.repository) {
    return {
      state: 'unknown',
      why: 'the cited file is in another repository than this checkout',
    }
  }
  let path = text(comp(file, FILE)?.path)

  let commit = text(comp(cite, REVISION)?.commit)
  if (!commit) {
    return { state: 'unknown', why: 'verified against no commit' }
  }
  let ask = ops.run ?? git
  let known = await ask(['cat-file', '-e', `${commit}^{commit}`], at.cwd)
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
    at.cwd,
  )
  if (!touched.ok) {
    return { state: 'unknown', why: why(touched.err, 'git log failed') }
  }
  let commits = lines(touched.out)
  if (!commits.length) return { state: 'current' }
  let narrow = place(to, path)
  if (!narrow.length) return { state: 'moved', changes: commits }
  // `-L` takes the path itself and refuses a pathspec beside it. A path that
  // is gone at HEAD makes it fail, which is unknown rather than current: a
  // deleted or renamed file is precisely what nobody can vouch for.
  let log = await ask(
    ['log', '-s', '--format=%h', ...narrow, `${commit}..HEAD`],
    at.cwd,
  )
  if (!log.ok) return { state: 'unknown', why: why(log.err, 'git log failed') }
  let changes = lines(log.out)
  return changes.length ? { state: 'moved', changes } : { state: 'current' }
}
