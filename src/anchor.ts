// The git-anchor aspect (D-18378): the revision an entity was verified against,
// and whether the code has moved out from under it since. The `anchor {paths,
// sha}` component (types.ts) records the promise — "this prose was true as of
// this commit"; this module is the audit that keeps the promise honest. The sha
// is caller-set (they verified against it); STALENESS is never stored — a commit
// newer than `sha` touching `paths` makes the entity stale, and we re-derive
// that from git at read time so a doc, memory or persona can never claim a
// freshness the repo contradicts (M-14370: pointers over copies, and a pointer
// only rots when nobody is watching). Nothing here writes the graph.

// The anchored paths, split on newline OR comma and trimmed. Both spellings
// ride the one column so a caller can write whichever reads cleaner.
/// anchorPaths('src/db.ts, src/types.ts') -> ['src/db.ts', 'src/types.ts']
/// anchorPaths('src/db.ts\nsrc/types.ts') -> ['src/db.ts', 'src/types.ts']
/// anchorPaths('  ') -> []
/// anchorPaths(null) -> []
export let anchorPaths = (paths?: string | null): string[] =>
  (paths ?? '').split(/[\n,]/).map((p) => p.trim()).filter(Boolean)

// Where an anchor stands against the code right now:
//   clean   nothing has touched its paths since its sha
//   stale   commits newer than sha touched them — `moved` names them (short)
//   unknown git could not answer (no sha, no paths, sha rebased away, no repo)
// A freshness we cannot vouch for is UNKNOWN, never clean — an anchor that
// reads fresh on a lie is worse than one that admits it can't tell.
export type Freshness =
  | { state: 'clean' }
  | { state: 'stale'; moved: string[] }
  | { state: 'unknown'; why: string }

let dec = new TextDecoder()

// git in `cwd`, quiet and non-interactive — this may run against a checkout
// with no one to answer a credential prompt. Never throws; a spawn failure
// (no git, no repo) reads as a not-ok result the caller turns into 'unknown'.
let git = async (cwd: string, ...args: string[]) => {
  try {
    let { success, stdout, stderr } = await new Deno.Command('git', {
      args: ['-C', cwd, ...args],
      env: { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' },
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    return {
      ok: success,
      out: dec.decode(stdout).trim(),
      err: dec.decode(stderr).trim(),
    }
  } catch (e) {
    return { ok: false, out: '', err: String(e) }
  }
}

// Ask git how one anchor stands in `cwd`. `git log <sha>..HEAD -- <paths>`
// lists the commits that touched the paths AFTER the anchored sha; any line
// means the code moved past it. The sha is checked FIRST (cat-file), because a
// sha the repo doesn't know makes `log` fail the same way an empty range
// succeeds-empty would look — and "rebased away" must read as unknown, not
// clean.
export let freshness = async (
  cwd: string,
  a: { sha?: string | null; paths?: string | null },
): Promise<Freshness> => {
  let paths = anchorPaths(a.paths)
  if (!a.sha) return { state: 'unknown', why: 'no sha' }
  if (!paths.length) return { state: 'unknown', why: 'no paths' }
  let known = await git(cwd, 'cat-file', '-e', `${a.sha}^{commit}`)
  if (!known.ok) {
    return { state: 'unknown', why: `sha ${a.sha} not in this repo` }
  }
  let log = await git(
    cwd,
    'log',
    '--format=%h',
    `${a.sha}..HEAD`,
    '--',
    ...paths,
  )
  if (!log.ok) return { state: 'unknown', why: log.err || 'git log failed' }
  let moved = log.out.split('\n').filter(Boolean)
  return moved.length ? { state: 'stale', moved } : { state: 'clean' }
}

// ---- The exact tiers (D-21211): symbol > content hunk > file:line@sha.
// An anchor may narrow its FIRST path to a region; resolution is tri-state —
// fresh (still where it was said to be), moved (found, HERE is where), broken
// (the region was rewritten or lost) — never silently wrong. Broken is
// signal: the referencing entity needs review. Bytes are read from git's
// object store (`git show HEAD:path`), never copied into the graph.

// Where a resolved anchor points right now: the path, the 1-based inclusive
// line range when one is known, and the HEAD the answer is true at.
export type Loc = {
  path: string
  start?: number
  end?: number
  head: string
}

// The tri-state answer, and which tier produced it: 'hunk' relocated the
// stored text, 'line' replayed diffs over the range, 'paths' is the coarse
// whole-path promise (freshness above, mapped in — moved there names the
// commits, since a path-level anchor has no range to report). `exact: false`
// on a hunk move means the match was whitespace-insensitive.
export type Resolution =
  | { state: 'fresh'; tier: Tier; location: Loc; bytes?: string }
  | {
    state: 'moved'
    tier: Tier
    location: Loc
    bytes?: string
    exact?: boolean
    commits?: string[]
  }
  | { state: 'broken'; tier: Tier; why: string }
export type Tier = 'symbol' | 'hunk' | 'line' | 'paths'

// A unified-diff hunk header, old-file side and new-file side. `-a,b +c,d`:
// b old lines starting at a became d new lines starting at c; a count of 0
// means pure insertion/deletion AT that point.
type Hunk = { oldStart: number; oldCount: number; newCount: number }

/// hunks('@@ -5,2 +5,3 @@ x').length -> 1
/// hunks('@@ -5 +5,0 @@') -> [{ oldStart: 5, oldCount: 1, newCount: 0 }]
/// hunks('context only') -> []
export let hunks = (diff: string): Hunk[] =>
  [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/gm)].map(
    (m) => ({
      oldStart: Number(m[1]),
      oldCount: m[2] == null ? 1 : Number(m[2]),
      newCount: m[3] == null ? 1 : Number(m[3]),
    }),
  )

// Advance a 1-based inclusive line range [start, end] through the diff of one
// file (git diff -U0 sha..HEAD -- path): hunks wholly above shift it, hunks
// wholly below leave it, and any hunk TOUCHING it means the region itself was
// edited — broken, because a range cannot vouch for rewritten content. A pure
// insertion (oldCount 0) sits BETWEEN oldStart and oldStart+1, so it shifts
// the range when at or above its start and breaks it only strictly inside.
/// advance('', 5, 8) -> { state: 'fresh' }
/// advance('@@ -1,2 +1,4 @@', 5, 8) -> { state: 'moved', start: 7, end: 10 }
/// advance('@@ -6 +6,2 @@', 5, 8) -> { state: 'broken' }
export let advance = (
  diff: string,
  start: number,
  end: number,
):
  | { state: 'fresh' }
  | { state: 'moved'; start: number; end: number }
  | { state: 'broken' } => {
  let delta = 0
  for (let h of hunks(diff)) {
    if (h.oldCount == 0) {
      // Inserted between oldStart and oldStart+1.
      if (h.oldStart < start) delta += h.newCount
      else if (h.oldStart < end) return { state: 'broken' }
    } else {
      let oldEnd = h.oldStart + h.oldCount - 1
      if (oldEnd < start) delta += h.newCount - h.oldCount
      else if (h.oldStart > end) continue
      else return { state: 'broken' }
    }
  }
  return delta
    ? { state: 'moved', start: start + delta, end: end + delta }
    : { state: 'fresh' }
}

// A line with its whitespace collapsed — the fuzz locate() falls back to when
// the bytes moved by reindentation alone.
let loose = (line: string) => line.trim().replace(/\s+/g, ' ')

// Find a hunk's lines inside the current file content: every start line where
// the raw lines match, else every start where the whitespace-collapsed lines
// match. Several matches pick the one nearest `near` (the anchored start) —
// patch-fuzz style. Null when the text is nowhere in the file.
/// locate('a\nb\nc\n', 'b\nc', 1) -> { start: 2, end: 3, exact: true }
/// locate('a\n  b\nc\n', 'b', 1) -> { start: 2, end: 2, exact: false }
/// locate('a\nb\n', 'z', 1) -> null
export let locate = (
  content: string,
  hunk: string,
  near?: number | null,
): { start: number; end: number; exact: boolean } | null => {
  let lines = content.split('\n')
  let want = hunk.replace(/\n$/, '').split('\n')
  if (!want.length) return null
  let starts = (eq: (a: string, b: string) => boolean) => {
    let out: number[] = []
    for (let i = 0; i + want.length <= lines.length; i++) {
      if (want.every((w, j) => eq(lines[i + j], w))) out.push(i + 1)
    }
    return out
  }
  let exact = true
  let found = starts((a, b) => a == b)
  if (!found.length) {
    exact = false
    found = starts((a, b) => loose(a) == loose(b))
  }
  if (!found.length) return null
  let at = near ?? found[0]
  let start = found.reduce((a, b) =>
    Math.abs(b - at) < Math.abs(a - at) ? b : a
  )
  return { start, end: start + want.length - 1, exact }
}

// The 1-based inclusive slice of a file's content — the bytes a resolved
// range names, served alongside the answer so a reader needs no second trip.
let slice = (content: string, start: number, end: number) =>
  content.split('\n').slice(start - 1, end).join('\n')

// Resolve one anchor in `cwd`, stablest tier first. Symbol is recorded but
// not yet resolvable (no parser fits the no-build constraint — tree-sitter
// needs a wasm + grammar vendoring story, T-21317); it says so and falls
// through rather than guessing. Hunk relocates the stored text in the file
// at HEAD; line replays diffs sha..HEAD over the range; a bare paths+sha
// anchor maps freshness() in at path granularity. Never throws: every way
// git can fail to vouch reads as broken with its why.
export let resolve = async (
  cwd: string,
  a: {
    paths?: string | null
    sha?: string | null
    symbol?: string | null
    hunk?: string | null
    start?: number | null
    end?: number | null
  },
): Promise<Resolution> => {
  let paths = anchorPaths(a.paths)
  let path = paths[0]
  let exact = a.hunk || a.start != null
  if (!path) return { state: 'broken', tier: 'paths', why: 'no paths' }
  let head = await git(cwd, 'rev-parse', 'HEAD')
  if (!head.ok) {
    return {
      state: 'broken',
      tier: exact ? (a.hunk ? 'hunk' : 'line') : 'paths',
      why: head.err || 'not a git repo',
    }
  }
  if (!exact) {
    // TODO(T-21317): the symbol tier resolves here once a parser is vendored;
    // until then a symbol-only anchor grades at path granularity like this.
    let f = await freshness(cwd, a)
    let loc = { path: paths.join(', '), head: head.out }
    return f.state == 'clean'
      ? { state: 'fresh', tier: 'paths', location: loc }
      : f.state == 'stale'
      ? { state: 'moved', tier: 'paths', location: loc, commits: f.moved }
      : { state: 'broken', tier: 'paths', why: f.why }
  }
  let shown = await git(cwd, 'show', `HEAD:${path}`)
  if (a.hunk) {
    if (!shown.ok) {
      return { state: 'broken', tier: 'hunk', why: `${path} is not at HEAD` }
    }
    let found = locate(shown.out + '\n', a.hunk, a.start)
    if (!found) {
      return {
        state: 'broken',
        tier: 'hunk',
        why: `hunk not found in ${path}`,
      }
    }
    let location = { path, start: found.start, end: found.end, head: head.out }
    let bytes = slice(shown.out, found.start, found.end)
    return found.exact && found.start == (a.start ?? found.start)
      ? { state: 'fresh', tier: 'hunk', location, bytes }
      : { state: 'moved', tier: 'hunk', location, bytes, exact: found.exact }
  }
  // Line tier: a range with no stored text can only be advanced from its sha.
  let start = a.start as number
  let end = a.end ?? start
  if (!shown.ok) {
    return { state: 'broken', tier: 'line', why: `${path} is not at HEAD` }
  }
  if (!a.sha) return { state: 'broken', tier: 'line', why: 'no sha' }
  let known = await git(cwd, 'cat-file', '-e', `${a.sha}^{commit}`)
  if (!known.ok) {
    return {
      state: 'broken',
      tier: 'line',
      why: `sha ${a.sha} not in this repo`,
    }
  }
  let diff = await git(cwd, 'diff', '-U0', `${a.sha}..HEAD`, '--', path)
  if (!diff.ok) {
    return { state: 'broken', tier: 'line', why: diff.err || 'git diff failed' }
  }
  let got = advance(diff.out, start, end)
  if (got.state == 'broken') {
    return {
      state: 'broken',
      tier: 'line',
      why: `lines ${start}-${end} edited since ${a.sha.slice(0, 8)}`,
    }
  }
  let at = got.state == 'moved' ? got : { start, end }
  let location = { path, start: at.start, end: at.end, head: head.out }
  let bytes = slice(shown.out, at.start, at.end)
  return got.state == 'moved'
    ? { state: 'moved', tier: 'line', location, bytes }
    : { state: 'fresh', tier: 'line', location, bytes }
}
