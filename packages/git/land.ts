// Landing belongs to the caller's machine. The graph supplies the base and
// accepts a verified commit; this orchestrator only checks/rebases that machine.
/** One run of git. `out` and `err` are RAW, exactly as Git wrote them — a
 * caller that prints Git's own output must not have it trimmed out from under
 * it (land prints `git diff --stat`, whose first line is indented), so
 * trimming is the reader's job, at the point it wants a value. `ok` is whether
 * Git succeeded and `code` is its exit status: a command like
 * `merge-base --is-ancestor` reports its answer as an exit code, so a failed
 * run is often an answer rather than a fault. */
export type Ran = { ok: boolean; code: number; out: string; err: string }

/** How land runs git. It is a parameter so that a test can answer without a
 * repository. */
export type Run = (args: string[], cwd: string) => Promise<Ran>

/** A landing refused for the caller’s own state: a detached or dirty
 * checkout, the base branch, or a revert the guard caught. Unexpected Git
 * failures remain plain errors, not successful landings. */
export class LandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LandError'
  }
}

let dec = new TextDecoder()

// No terminal prompts, ever: this may run with nobody there to answer, and a
// credential prompt would hang the caller instead of failing it.
let quiet = { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' }

// A subprocess that failed to start (no git, no such directory, EAGAIN under
// load) is returned as a failed run carrying the reason, never thrown: every
// caller here already handles a git that failed, and none handles an
// exception.
/** How this package runs git: one subprocess, output raw, never throwing. */
export let run: Run = async (args, cwd) => {
  try {
    let out = await new Deno.Command('git', {
      args,
      cwd,
      env: quiet,
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    return {
      ok: out.success,
      code: out.code,
      out: dec.decode(out.stdout),
      err: dec.decode(out.stderr),
    }
  } catch (e) {
    return {
      ok: false,
      code: -1,
      out: '',
      err: `git ${args.join(' ')} in ${cwd}: ${e}`,
    }
  }
}

/** The accepted commit and the caller’s own checkout directory. */
export type Landed = { landed: string; root: string }

/** Diverged means the base moved: the branch has been rebased and is waiting,
 * and `conflict` reports whether that rebase is sitting unresolved for the
 * caller to finish before landing again. */
export type Diverged = { diverged: true; conflict: boolean }

export type Outcome = Landed | Diverged

/** Landing runs entirely on the caller's machine. The base is a fetched graph
 * revision; accepting HEAD moves the graph's branch, never a shared checkout. */
export type LandOps = {
  cwd: string
  run: Run
  base: string
  accept: (head: string) => Promise<void>
  /** Fetch and return the new base after a concurrent acceptance. */
  refresh?: () => Promise<string>
  write?: (text: string, error?: boolean) => void
  allow?: string[]
}

let defaultWrite = (text: string, error = false) => {
  text = text.trimEnd()
  if (text) (error ? console.error : console.log)(text)
}

let message = (label: string, r: Ran) => {
  let detail = (r.err || r.out).trim().split('\n').find(Boolean)
  return `${label} failed with exit ${r.code}${detail ? `: ${detail}` : ''}`
}

// A rebase can leave content that no commit on the branch ever wrote.
// Resolving a conflict by taking the branch's side wholesale rewinds a file to
// what the branch forked from, undoing every base commit in between — one such
// landing took 22 files back to their pre-base content, and the test suite
// passed because the tests had rewound along with the code. Two questions
// catch that, both asked of the rebased branch in the moment before it lands:
//
//   - which files does `base..HEAD` change that no commit on the branch
//     touches? After a clean rebase that set is empty; anything in it is the
//     rebase's own doing.
//   - for the rest, does the landing diff add lines, and does the landing blob
//     equal a blob that path already held earlier in the base's history?
//     Content the base moved past and the branch puts back is a revert nobody
//     wrote — but only lines the branch adds can put anything back. A hunk that
//     only takes lines away reintroduces nothing, so a pure deletion is a
//     deletion however far back its result happens to match.
//
// The second question exists because a rebase rewrites the branch's commits:
// afterwards a reverting resolution sits inside a branch commit's file list,
// where the first question cannot see it.
export type Revert = { file: string; rewound: boolean }

let lines = (out: string) => out.split('\n').filter(Boolean)

// How far back down the base the blob scan looks: the base's recent history,
// not its whole history.
let DEPTH = 200

// `git log --raw` names the blob each commit left at a path
// (`:mode mode src dst status\tpath`), so one walk of the base's recent history
// yields every content each path has held — no `rev-parse` per file per
// commit. Merge commits print no raw lines and contribute nothing, which is
// right: a merge introduces no content of its own. The base TIP is included
// harmlessly — its blob for a path is `base:path`, which a file in the
// `base...HEAD` diff cannot equal.
let held = (log: string) => {
  let past = new Map<string, Set<string>>()
  for (let line of lines(log)) {
    let m = /^:\S+ \S+ \S+ (\S+) \S+\t(.+)$/.exec(line)
    if (!m) continue
    if (!past.has(m[2])) past.set(m[2], new Set())
    past.get(m[2])!.add(m[1])
  }
  return past
}

// path → whether the landing diff adds anything there. `--numstat` reports
// added and deleted counts per path in the same walk that names the paths, so
// the guard learns both from one command. A binary file reports `-`: its added
// line count is unknowable, which the guard treats as content added.
// `--no-renames` keeps every path plain, so a rename reads as the deletion and
// the addition it is rather than as an `old => new` name that nothing else
// here would match.
let adding = (out: string) =>
  new Map(
    lines(out).flatMap((l) => {
      let m = /^(\d+|-)\t(?:\d+|-)\t(.+)$/.exec(l)
      return m ? [[m[2], m[1] != '0'] as [string, boolean]] : []
    }),
  )

// path → blob for the whole landing tree, from one `ls-tree -r`: cheaper than
// a `rev-parse` per file, and immune to a pathspec longer than argv allows.
let blobs = (out: string) =>
  new Map(
    lines(out).flatMap((l) => {
      let m = /^\S+ blob (\S+)\t(.+)$/.exec(l)
      return m ? [[m[2], m[1]] as [string, string]] : []
    }),
  )

/** Every file this landing would change that the branch did not author. Asked
 * only when the base is an ancestor of the branch, so that `base...HEAD` is
 * exactly the landing diff. How it runs git is a parameter, which is how a
 * test answers without a repository. */
export let reverts = async (
  ask: (args: string[]) => Promise<string>,
  base: string,
): Promise<Revert[]> => {
  let adds = adding(
    await ask(['diff', '--numstat', '--no-renames', `${base}...HEAD`]),
  )
  if (!adds.size) return []
  let changed = [...adds.keys()]
  // Three reads that need nothing from each other, asked at once: what the
  // branch's commits touch, what the base's history held, and the landing
  // tree. `--no-renames` as the diff above: a move names both paths, or the
  // old one reads as the rebase's.
  let [log, raw, tree] = await Promise.all([
    ask(['log', '--format=', '--name-only', '--no-renames', `${base}..HEAD`]),
    ask([
      'log',
      `-${DEPTH}`,
      '--format=',
      '--raw',
      // Full object names: `--raw` abbreviates by default, and the tree these
      // are compared against does not.
      '--no-abbrev',
      '--no-renames',
      base,
    ]),
    ask(['ls-tree', '-r', 'HEAD']),
  ])
  let touched = new Set(lines(log))
  let found = changed.filter((f) => !touched.has(f))
    .map((file) => ({ file, rewound: false }))
  let rest = changed.filter((f) => touched.has(f))
  let past = held(raw)
  let now = blobs(tree)
  for (let file of rest) {
    let blob = now.get(file)
    // A file the branch deletes has no landing blob and nothing to rewind to,
    // and a diff that adds no line put nothing back to rewind to it.
    if (blob && adds.get(file) && past.get(file)?.has(blob)) {
      found.push({ file, rewound: true })
    }
  }
  return found
}

let why = (r: Revert, base: string, at: string) =>
  `  ${r.file} — ${
    r.rewound
      ? `lands at content ${base} already moved past`
      : `changed by the rebase, not by any commit on the branch`
  }${at ? `; ${base} last touched it at ${at}` : ''}`

// The refusal names the files and gives the caller the pointers it needs: the
// base commit that last touched each one, the diff to read, and the flag that
// lands anyway.
let refusal = async (
  ask: (args: string[]) => Promise<string>,
  base: string,
  found: Revert[],
) => {
  let at = await Promise.all(
    found.map((r) =>
      ask(['log', '-1', '--format=%h %s', base, '--', r.file])
        .then((s) => s.split('\n')[0].trim())
    ),
  )
  let names = found.map((r) => r.file)
  return [
    `land: refusing — the rebase left ${names.length} file${
      names.length == 1 ? '' : 's'
    } at content no commit on this branch wrote:`,
    ...found.map((r, i) => why(r, base, at[i])),
    `  inspect: git diff ${base}...HEAD -- ${names.join(' ')}`,
    `  deliberate: land --allow-revert=${names.join(',')}`,
  ].join('\n')
}

/** Land HEAD through the graph, or rebase onto its moved base and stop so
 * the caller can test the newly combined code before trying again. */
export let land = async (ops: LandOps): Promise<Outcome> => {
  let command = ops.run
  let write = ops.write ?? defaultWrite
  let cwd = ops.cwd
  let base = ops.base
  let git = async (args: string[], show = true) => {
    let r = await command(args, cwd)
    if (show) {
      write(r.out)
      write(r.err, true)
    }
    return r
  }
  let read = async (args: string[]) => {
    let r = await git(args, false)
    if (r.code) throw new Error(message(`git ${args[0]}`, r))
    return r.out
  }
  let on = await git(['symbolic-ref', '-q', '--short', 'HEAD'], false)
  if (on.code == 1) throw new LandError('land: the checkout is detached')
  if (on.code) throw new Error(message('read branch', on))
  let branch = on.out.trim()
  if (branch == base.replace(/^refs\/heads\//, '')) {
    throw new LandError('land: the checkout is on the base branch')
  }
  let dirty =
    (await read(['status', '--porcelain=v1', '--untracked-files=all'])).trim()
  if (dirty) throw new LandError(`land: checkout is dirty:\n${dirty}`)
  let ancestry = async () => {
    let r = await git(['merge-base', '--is-ancestor', base, 'HEAD'], false)
    if (r.code != 0 && r.code != 1) throw new Error(message('read ancestry', r))
    return r.code
  }
  if (await ancestry() == 0) {
    let found = await reverts(read, base)
    let allow = new Set(ops.allow ?? [])
    let refuse = found.filter((r) => !allow.has(r.file))
    if (refuse.length) throw new LandError(await refusal(read, base, refuse))
    for (let r of found) {
      write(`land: --allow-revert — landing anyway:${why(r, base, '')}`, true)
    }
    let head = (await read(['rev-parse', 'HEAD'])).trim()
    try {
      await ops.accept(head)
      return { landed: head, root: cwd }
    } catch (error) {
      // Only contention turns acceptance failure into a rebase. Corrupt packs,
      // an unavailable graph, or any other fault must remain visible as such.
      if (!ops.refresh) throw error
      let latest = await ops.refresh()
      // A concurrent receiver may have accepted this exact HEAD, or a
      // post-acceptance cleanup failed. The graph's answer is authoritative.
      if (latest == head) return { landed: head, root: cwd }
      if (latest == base) throw error
      base = latest
    }
  }
  write(`land: ${base} moved — rebasing ${branch} onto it, not landing.`)
  write(`land: changes pulled in from ${base}:`)
  await git(['diff', '--stat', `HEAD...${base}`])
  let rebased = await git(['rebase', base])
  if (rebased.code) {
    write(
      'land: rebase hit conflicts — resolve them, `git rebase --continue`, then land again.',
      true,
    )
    return { diverged: true, conflict: true }
  }
  write('land: rebased cleanly. Re-run the tests, then land again.')
  return { diverged: true, conflict: false }
}
