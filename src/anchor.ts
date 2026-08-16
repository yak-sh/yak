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
