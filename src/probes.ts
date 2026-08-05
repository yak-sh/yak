// What a session left running. A probe — a headless browser holding a CDP
// port, a server on a scratch db, a checkout nobody returns to — outlives the
// agent that spawned it: the shell exits, the process reparents to init, and
// nothing remembers it was scaffolding. So this is a RECONCILER, not a hook:
// a pure reading of /proc as it stands right now, converging from any
// starting state, because a killed session never fires the SessionEnd that a
// cleanup-at-wrap design would depend on.
//
// The graph only MAPS — a session id to the pid it ran as. /proc DECIDES: a
// session is live because its pid is alive and still a provider, never
// because a row says so. And a process is only ever a candidate if it carries
// a marker it could not carry by accident: a throwaway checkout, a graph that
// is not the live one, a browser waiting to be driven. Everything standing in
// a real directory is invisible to the sweep, which is what spares the live
// server and every venture's service without an allow-list to maintain.

import {
  argsOf,
  bornAt,
  commOf,
  cwdOf,
  descends,
  envOf,
  lineage,
  ownerOf,
  pids,
} from './proc.ts'

// The provider comms. An agent is never reaped, and everything descending
// from a live one is its business, not the sweep's.
export let AGENTS = ['claude', 'codex']

// How long a probe is left alone. Long enough that a verification run in
// flight is never raced; short enough that a leak is measured in minutes.
export let GRACE = 30 * 60 * 1000

export type Proc = {
  pid: number
  comm: string
  args: string[]
  cwd: string
  gone: boolean // the cwd was deleted under it
  born: number
  session?: string // CLAUDE_CODE_SESSION_ID, inherited from its spawner
  db?: string // DB_PATH — a server pointed at a scratch graph is a probe
}

// A session as the graph records it. Only these three columns matter here:
// the id a probe carries, the directory it worked in, the pid it ran as.
export type Session = { id: string; cwd?: string | null; pid?: number | null }

export type Live = {
  sessions: Set<string>
  pids: number[]
  cwds: string[]
}

export type Verdict = { proc: Proc; reap: boolean; why: string }

// A git worktree: the fleet's one convention for throwaway ground, named the
// same way everywhere (`tasks-worktrees/<repo>/<task>`, the legacy
// `worktrees/<repo>/<task>`, and `.claude/worktrees/<id>`).
// A scratchpad is NOT enough on its own — an operator may deliberately park
// something long-lived there, and a bare temp directory is not a claim.
export let worktree = (cwd: string) => /(^|\/)(tasks-)?worktrees\//.test(cwd)

// A Claude scratchpad is rooted under its session id. A probe must keep its
// DB_PATH to use the graph, so this ownership survives env filtering and
// reparenting even when CLAUDE_CODE_SESSION_ID does not.
let scratchSession = (path?: string) =>
  path?.match(/(^|\/)([^/]+)\/scratchpad(\/|$)/)?.[2]

// A browser held open for CDP. Nothing on this box legitimately runs headless
// with a debugging port for hours — the probe that opened it is long gone,
// and the port it squats on is why two agents end up driving one browser.
export let browser = (p: Proc) =>
  p.comm.startsWith('chrome') && !flagged(p, '--type') &&
  optOf(p, '--remote-debugging-port') != null

// Chrome rewrites its argv into ONE contiguous string, so cmdline reads back
// as a single NUL-free blob: flags come out of the joined line, never by
// walking argv, or every helper looks like it was launched bare — which is
// exactly how the first live run left five renderers behind.
let joined = (p: Proc) => p.args.join(' ')
let flagged = (p: Proc, name: string) =>
  new RegExp(`(^|\\s)${name}(=|\\s|$)`).test(joined(p))

// The three shapes, and nothing else, may ever be reaped. Each is a marker a
// process could only carry by being scaffolding: a throwaway checkout, a
// graph that is not the live one, a browser waiting to be driven.
export let probe = (p: Proc) =>
  worktree(p.cwd) || (p.db != null && /scratchpad/.test(p.db)) || browser(p)

let optOf = (p: Proc, name: string) =>
  joined(p).match(new RegExp(`(^|\\s)${name}=(\\S+)`))?.[2]

// Containment, spelled once. Worktree roots nest at different depths across
// the fleet (`tasks-worktrees/<repo>/<name>` here, `.claude/worktrees/<name>`
// there), so the sweep never tries to NAME the root — it asks whether one
// path is inside another, which is true at any depth.
export let within = (path: string, root: string) =>
  path == root || path.startsWith(`${root}/`)

// The graph maps, /proc decides: a row is live only when its pid is alive AND
// still running a provider. The comm check is the pid-reuse guard — six days
// on, that number belongs to somebody else.
export let liveSessions = (sessions: Session[], comm = commOf) =>
  sessions.filter((s) => s.pid && AGENTS.includes(comm(s.pid)))

export let live = (sessions: Session[], comm = commOf): Live => {
  let alive = liveSessions(sessions, comm)
  return {
    sessions: new Set(alive.map((s) => s.id)),
    pids: alive.map((s) => s.pid as number),
    cwds: alive.map((s) => s.cwd ?? '').filter((c) => c != ''),
  }
}

// Why this process is none of the sweep's business. Order matters: the
// self-checks come before any judgement, so no predicate below them can
// ever be the thing that kills the sweep.
let spared = (
  p: Proc,
  it: Live,
  agents: number[],
  self: number[],
  now: number,
  grace: number,
  kin = descends,
): string | undefined => {
  if (self.includes(p.pid)) return 'the sweep itself'
  if (AGENTS.includes(p.comm)) return 'an agent'
  if (!probe(p)) return `standing in ${p.cwd || 'an unreadable cwd'}`
  if (now - p.born < grace) return 'younger than the grace period'
  if (p.session && it.sessions.has(p.session)) {
    return `session ${p.session.slice(0, 8)} is live`
  }
  let owner = scratchSession(p.db)
  if (owner && it.sessions.has(owner)) {
    return `session ${owner.slice(0, 8)} owns its scratch graph`
  }
  // Both directions of the family. A helper BELOW a live agent is that
  // agent's business; a launcher ABOVE one is holding it up — a harness node
  // process reparented to init still has a fourteen-day codex under it.
  if (agents.some((a) => kin(p.pid, a) || kin(a, p.pid))) {
    return "in a live agent's line"
  }
  let home = it.cwds.find((c) => within(p.cwd, c))
  if (home) return `${home} is a live session's ground`
}

let orphan = (p: Proc) =>
  browser(p)
    ? `headless browser on ${optOf(p, '--remote-debugging-port') ?? '?'}`
    : `${p.comm} in ${p.cwd}${p.gone ? ' (gone)' : ''}`

// The whole judgement, as one function of what /proc says. Chrome's helpers
// and crash handlers are decided LAST, from the browsers that survive: a
// helper belongs to the user-data-dir it was launched with, and a crashpad
// handler with no browser left anywhere is nothing but a held file handle.
export let judge = (
  procs: Proc[],
  it: Live,
  self = lineage(),
  now = Date.now(),
  grace = GRACE,
  kin = descends,
): Verdict[] => {
  // Every agent on the box, not only the ones the graph knows about: a bare
  // codex run or a harness instance owns its children just as surely as a
  // stamped session does, and its helpers are nobody's litter.
  let agents = [
    ...new Set([
      ...it.pids,
      ...procs.filter((p) => AGENTS.includes(p.comm)).map((p) => p.pid),
    ]),
  ]
  let out = procs.map((proc): Verdict => {
    let why = spared(proc, it, agents, self, now, grace, kin)
    return why
      ? { proc, reap: false, why }
      : { proc, reap: true, why: orphan(proc) }
  })
  let doomed = new Set(
    out.filter((v) => v.reap && browser(v.proc))
      .map((v) => optOf(v.proc, '--user-data-dir'))
      .filter((d) => d != null),
  )
  let browsers = out.filter((v) => browser(v.proc))
  let orphanedHandlers = browsers.length > 0 && browsers.every((v) => v.reap)
  for (let v of out) {
    if (v.reap || self.includes(v.proc.pid)) continue
    if (v.proc.comm.startsWith('chrome')) {
      let dir = optOf(v.proc, '--user-data-dir')
      if (dir && doomed.has(dir)) {
        v.reap = true
        v.why = `chrome helper of ${dir}`
      } else if (v.proc.comm.includes('crashpad') && orphanedHandlers) {
        v.reap = true
        v.why = 'crash handler with no browser left'
      }
    }
  }
  return out
}

// Everything on the box we could speak for, read once. Another uid's process
// is not ours to judge and would fail the kill anyway.
export let scan = (mine = Deno.uid() ?? undefined): Proc[] => {
  let out: Proc[] = []
  for (let pid of pids()) {
    if (mine != null && ownerOf(pid) != mine) continue
    let born = bornAt(pid)
    let comm = commOf(pid)
    if (born == null || !comm) continue
    let cwd = cwdOf(pid)
    out.push({
      pid,
      comm,
      args: argsOf(pid),
      cwd: cwd.replace(/ \(deleted\)$/, ''),
      gone: cwd.endsWith(' (deleted)'),
      born,
      session: envOf(pid, 'CLAUDE_CODE_SESSION_ID'),
      db: envOf(pid, 'DB_PATH'),
    })
  }
  return out
}

// A throwaway profile, safe to delete. `/tmp` is the whole rule: it is where
// scaffolding goes, and a real Chrome profile lives in $HOME, so the worst a
// wrong verdict here can cost is a re-login — never a person's browser state.
// A path with `..` in it is refused rather than resolved: this deletes
// recursively, so the predicate stays something you can read in one line.
export let throwaway = (dir: string) =>
  /^\/tmp\/[^/]/.test(dir) && !dir.includes('/..')

// The profile directories of the browsers we just reaped. Killing the process
// and leaving its profile is half a cleanup, and on this box the expensive
// half: `/tmp` is RAM-backed tmpfs, so a 150M profile nobody removed is 150M
// of memory and swap. 351 of them (4.6G) helped saturate swap and got
// operators earlyoom-killed (T-10898) — a leak that makes the next OOM more
// likely, which is the shape of a feedback loop.
//
// The sweep already knows each directory (it groups helpers by it), and being
// a reconciler is what makes this the right home: a run that dies by SIGKILL
// runs no cleanup of its own, so no amount of care in the spawner can close
// this. Whoever launched the browser, however it died, the dir goes.
export let profiles = (verdicts: Verdict[]) => [
  ...new Set(
    verdicts.filter((v) => v.reap && browser(v.proc))
      .map((v) => optOf(v.proc, '--user-data-dir'))
      .filter((d): d is string => d != null && throwaway(d)),
  ),
]

// TERM first, KILL what ignores it. A process already gone between the scan
// and the signal is the outcome we wanted, so ESRCH is success.
export let reap = async (verdicts: Verdict[]) => {
  let doomed = verdicts.filter((v) => v.reap).map((v) => v.proc.pid)
  for (let pid of doomed) signal(pid, 'SIGTERM')
  if (!doomed.length) return []
  await new Promise((ok) => setTimeout(ok, 2000))
  for (let pid of doomed) if (commOf(pid)) signal(pid, 'SIGKILL')
  // Profiles AFTER the kill, never before: a live chrome rewrites what we
  // just removed, and would recreate the leak we came to collect.
  for (let dir of profiles(verdicts)) {
    await Deno.remove(dir, { recursive: true }).catch(() => {})
  }
  return doomed
}

let signal = (pid: number, sig: Deno.Signal) => {
  try {
    Deno.kill(pid, sig)
  } catch { /* already gone, or not ours — both are the desired end */ }
}

// ── worktrees ───────────────────────────────────────────────────────────

export type Tree = {
  path: string
  head: string
  branch?: string
  clean: boolean
  merged: boolean
  busy?: string // what is still using it
}

export type TreeVerdict = { tree: Tree; prune: boolean; why: string }

// A worktree is finished when nothing is left in it that main does not
// already have, and nobody is standing in it. Each clause guards a different
// loss: uncommitted work, unmerged commits, and an agent mid-edit.
export let judgeTree = (t: Tree): TreeVerdict =>
  t.busy
    ? { tree: t, prune: false, why: t.busy }
    : !t.clean
    ? { tree: t, prune: false, why: 'uncommitted work' }
    : !t.merged
    ? { tree: t, prune: false, why: 'not merged into main' }
    : { tree: t, prune: true, why: 'merged and clean' }

let git = (args: string[], cwd: string) => {
  let out = new Deno.Command('git', { args, cwd, stderr: 'piped' }).outputSync()
  return {
    ok: out.success,
    text: new TextDecoder().decode(out.stdout).trim(),
  }
}

// Last git activity in a worktree. Every command an agent runs there
// refreshes its index, so an index untouched for the whole grace period is a
// checkout nobody is standing in — the one signal that survives an agent
// whose shell has no persistent cwd. Read BEFORE the sweep runs its own git:
// `status` can rewrite the index and erase the evidence it came for.
let touched = (path: string) => {
  try {
    let dir = Deno.readTextFileSync(`${path}/.git`)
      .replace(/^gitdir:\s*/, '').trim()
    return Deno.statSync(`${dir}/index`).mtime?.getTime() ?? 0
  } catch {
    return 0
  }
}

// The repo's own throwaway checkouts, named by the same ephemeral-ground
// predicate the process half uses. A root list said less and missed more: a
// fork's tree lives under the repo's own `.claude/worktrees/`, so naming the
// fleet roots left exactly the trees `task land` stops removing (T-13942)
// with no collector at all. A checkout outside any `worktrees/` root is
// somebody's working copy, not a session's leavings.
export let trees = (
  repo: string,
  it: Live,
  procs: Proc[],
  now = Date.now(),
  grace = GRACE,
): Tree[] => {
  let out: Tree[] = []
  let entry: Partial<Tree> = {}
  let finish = () => {
    if (!entry.path || !worktree(entry.path)) return
    let path = entry.path
    let idle = now - touched(path)
    let inside = procs.find((p) => within(p.cwd, path))
    let busy = it.cwds.some((c) => within(c, path))
      ? 'a live session works here'
      : inside
      ? `pid ${inside.pid} (${inside.comm}) is inside`
      : idle < grace
      ? `git ran here ${Math.round(idle / 60_000)}m ago`
      : undefined
    out.push({
      path,
      head: entry.head ?? '',
      branch: entry.branch,
      busy,
      clean: git(['status', '--porcelain'], path).text == '',
      merged: entry.head
        ? git(['merge-base', '--is-ancestor', entry.head, 'main'], repo).ok
        : false,
    })
  }
  for (
    let line of git(['worktree', 'list', '--porcelain'], repo).text.split('\n')
  ) {
    if (line.startsWith('worktree ')) {
      finish()
      entry = { path: line.slice(9) }
    } else if (line.startsWith('HEAD ')) entry.head = line.slice(5)
    else if (line.startsWith('branch ')) {
      entry.branch = line.slice(7).replace(/^refs\/heads\//, '')
    }
  }
  finish()
  return out
}

// One pass, both halves, from the graph's session table. Callers differ only
// in where that table comes from — the CLI reads a snapshot, the server has
// one in hand — so the composition lives here and neither door can drift.
export let sweep = (sessions: Session[], repo?: string, grace = GRACE) => {
  let now = Date.now()
  let it = live(sessions)
  let procs = scan()
  let verdicts = judge(procs, it, lineage(), now, grace)
  // Worktrees are judged against EVERY process, including the ones this pass
  // is about to reap: a checkout somebody stood in a second ago keeps its
  // reprieve until the next pass, which costs ten minutes and nothing else.
  let forest = repo ? trees(repo, it, procs, now, grace).map(judgeTree) : []
  return { verdicts, trees: forest }
}

// Remove the checkout, then the branch — and `git branch -d` refuses an
// unmerged branch on its own, which makes it a second lock on the same door.
export let prune = (repo: string, t: Tree) => {
  let removed = git(['worktree', 'remove', t.path], repo)
  if (!removed.ok) return false
  if (t.branch && t.branch != 'main') git(['branch', '-d', t.branch], repo)
  return true
}
