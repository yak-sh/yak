// Personas, materialized. A persona is a curated view over the graph —
// its doc describes the persona in the graph, its EDGES are the prompt tiers
// (contains = preload the whole body, reads = carry the one-line index;
// everything else in
// scope stays searchable) — and this module renders that view as one
// markdown document: for a spawned session's system prompt, and for the
// repo-local .tasks/ files native harnesses read (CLAUDE.md symlinks
// there when a repo adopts them — the flip is the owner's move, never
// ours). materialize() and filesFor() are pure over rows+deps so the
// CLI verb, the server effect, and the tests render the same bytes;
// only syncFiles() touches the filesystem, and it stops at the write —
// committing what it wrote is git.ts's job, at the callers.
import { type Dep, type Edge, idOf } from './types.ts'
import { memoryHead, type Row } from './client.ts'
import { hot } from './query.ts'
import { entityUrl } from './url.ts'

// A persona's home page in the UI — the header points hand-editors back
// at the graph.

// The DIALECT is the frame a provider reads — header text and section
// names; the content is single-sourced from the graph and never varies.
// One provider-agnostic dialect today, as data so a second one is an
// addition, not a refactor. Intended home when formats diverge:
// adapters.ts provider rows declare their dialect + target filenames,
// and sync renders one persona into N provider files.
export type Dialect = {
  header: (id: string, title: string) => string
  rule: string
  index: string
}
export let DIALECT: Dialect = {
  header: (id, title) =>
    `<!-- GENERATED from ${id} (${title}) — edit in the graph (${
      entityUrl(id)
    }, memory_save), never here: the
next sync overwrites hand edits. -->`,
  rule: '---',
  index:
    '## Memory Index\n\n*Recall a body by id (memory_recall / task show).*',
}

let byWarm = (now: number) => (a: Row, b: Row) =>
  hot(b.comps, now) - hot(a.comps, now)

// One index line — the memory_recall rendering, tolerant of non-memory
// targets (any doc can ride the index tier). Warmth ORDERS the index but
// never prints: a score in the line re-materializes every persona file
// on every decay tick, and that churn buries the real diffs.
export let indexLine = (r: Row, _now: number) => {
  let m = r.comps.memory
  let n = Number(r.comps.recall?.count ?? 0)
  let head = memoryHead(r)
  let seen = m?.last_confirmed_at
    ? ` · confirmed ${String(m.last_confirmed_at).slice(0, 10)}`
    : ''
  return `- ${idOf(r)} ${head}${r.comps.doc?.title ?? ''}${
    n ? ` · ${n}×` : ''
  }${seen}`
}

// The persona's tier members, resolved warm-first, following persona
// children. A contains/reads child that is ITSELF a persona is not a memory —
// recurse into it and merge ITS tiers in, PRESERVING association: the base's
// contains-memories flow to this persona's preload, its reads-memories to the
// index, whichever edge reached the base. So a fleet-base persona holds a
// memory bundle once and every container inherits it. Dedup by id (a memory
// reachable by several paths appears once); preload wins the fuller form over
// index. `seen` guards a persona cycle — a memory's contribution is
// path-independent, so visiting a base once anywhere yields the right set.
// Dead or docless children still drop silently — a tier names what it can say.
let tiers = (
  all: Row[],
  deps: Dep[],
  eid: string,
  now: number,
  seen = new Set<string>(),
): { pre: Row[]; idx: Row[] } => {
  let pre = new Map<string, Row>()
  let idx = new Map<string, Row>()
  seen.add(eid)
  let kids = (type: Edge) =>
    deps.filter((d) => d.parent == eid && d.type == type)
      .map((d) => all.find((r) => r.eid == d.child))
      .filter((r): r is Row => !!r?.comps.doc)
  for (let type of ['contains', 'reads'] as const) {
    let here = type == 'contains' ? pre : idx
    for (let r of kids(type)) {
      if (r.comps.persona) {
        if (seen.has(r.eid)) continue
        let sub = tiers(all, deps, r.eid, now, seen)
        for (let m of sub.pre) pre.set(m.eid, m)
        for (let m of sub.idx) idx.set(m.eid, m)
      } else here.set(r.eid, r)
    }
  }
  for (let e of pre.keys()) idx.delete(e) // preload wins the fuller form
  let warm = (m: Map<string, Row>) => [...m.values()].sort(byWarm(now))
  return { pre: warm(pre), idx: warm(idx) }
}

// The whole persona as one markdown document: header naming the edit path,
// preloaded bodies (warmest first — the budgeted auto-tier hangs off this
// ordering later), then the index. A persona's own body describes it to graph
// readers; prompt instructions belong in contained memories. Each
// preloaded body is its own little document — a rule before it, an H1
// title over it — so a body may use ## freely. Rules ride as their own
// parts: the \n\n join blank-lines every --- and no text line above can
// read it as a setext underline.
export let materialize = (
  all: Row[],
  deps: Dep[],
  p: Row,
  now: number,
  d: Dialect = DIALECT,
) => {
  let { pre, idx } = tiers(all, deps, p.eid, now)
  let header = d.header(idOf(p), String(p.comps.doc?.title ?? 'persona'))
  let parts = [
    header,
    ...pre.flatMap((r) => [
      d.rule,
      `# ${idOf(r)} ${r.comps.doc?.title ?? ''}\n\n${
        String(r.comps.doc?.body ?? '').trim()
      }`,
    ]),
    ...(idx.length
      ? [
        d.rule,
        `${d.index}\n\n${idx.map((r) => indexLine(r, now)).join('\n')}`,
      ]
      : []),
  ]
  return parts.filter(Boolean).join('\n\n') + '\n'
}

// A project's COMMON persona — the one the project `contains` (an
// edge, so the marker is graph-data the editor can move). Among its
// other personas the common one is what lands as .tasks/AGENTS.md.
export let commonOf = (all: Row[], deps: Dep[], projectEid: string) =>
  all.find((r) =>
    r.comps.persona?.home == projectEid &&
    deps.some((d) =>
      d.parent == projectEid && d.type == 'contains' && d.child == r.eid
    )
  )

// A project's SPECIALIST personas, surfaced as edges. `home` is the
// one truth for ownership (commonOf and filesFor derive from it); these
// project→persona `reads` edges are DERIVED from it — never stored — so a
// specialist shows on its project's card and navigates, and the two facts
// can't drift (a home is a fact, like a board is a query: membership is
// computed, not an edge list). The common persona already rides `contains`
// so it's skipped, as is any persona already carrying a stored edge from
// its home (no double sentence).
//
// It takes the homes, not the graph, because every door that returns edges
// owes these: snapshot() folds them into `deps` off the persona table, and
// the keyed reading (db.ts depsOf) off the same table screened by eid. A
// door that reads only the `dependency` table silently loses them.
export let homeReads = (
  homes: { eid: string; home: unknown }[],
  deps: Dep[],
): Dep[] =>
  homes.flatMap(({ eid, home }) =>
    home &&
      !deps.some((d) =>
        d.parent == home && d.child == eid &&
        (d.type == 'contains' || d.type == 'reads')
      )
      ? [{ parent: String(home), type: 'reads' as const, child: eid }]
      : []
  )

// A venture the materializer writes to: a project with a checkout that is
// not retired. Retired drops out of BOTH the render and the sweep — no new
// projection, and its adopted files left exactly as the venture last saw
// them (deleting them would dangle a CLAUDE.md symlink). filesFor and
// taskRoots share this so the two can't disagree on who is managed.
let managed = (r: Row) =>
  !!(r.comps.project && r.comps.repo?.path && !r.comps.archived)

// Every file materialization owes the fleet: for each project with a
// checkout, the common persona (if any) as .tasks/AGENTS.md and each
// other home persona as .tasks/personas/<slug>.md. Fleet-shared
// personas (no home) ride spawns only — they are nobody's file.
//
// Each file carries its venture's `push` permission, because that is the
// only place the two facts meet: git.ts sees paths, and only the project
// row knows whether this venture's origin may hear from us.
export let filesFor = (all: Row[], deps: Dep[], now: number) => {
  let out: { path: string; body: string; push: boolean }[] = []
  for (let proj of all.filter(managed)) {
    let root = `${proj.comps.repo.path}/.tasks`
    let push = !!proj.comps.repo.push
    let base = commonOf(all, deps, proj.eid)
    if (base) {
      out.push({
        path: `${root}/AGENTS.md`,
        body: materialize(all, deps, base, now),
        push,
      })
    }
    for (
      let p of all.filter((r) =>
        r.comps.persona?.home == proj.eid && r.eid != base?.eid
      )
    ) {
      let slug = String(p.comps.alias?.slug ?? idOf(p))
      out.push({
        path: `${root}/personas/${slug}.md`,
        body: materialize(all, deps, p, now),
        push,
      })
    }
  }
  return out
}

// The .tasks roots the materializer OWNS, one per managed venture, with the
// venture's push permission. filesFor writes what SHOULD be there; the sweep
// (orphans) reads what IS there and deletes the difference — so a repo whose
// last persona was deleted is still reconciled, even though it produced no
// file this render.
export let taskRoots = (all: Row[]): { root: string; push: boolean }[] =>
  all.filter(managed).map((r) => ({
    root: `${r.comps.repo.path}/.tasks`,
    push: !!r.comps.repo.push,
  }))

// The two file shapes the materializer can hold under a .tasks root. We own
// the directory end to end, so a listing is authoritative: anything matching
// these shapes is ours, and a missing dir or file is simply nothing to sweep.
let held = (root: string) => {
  let out: string[] = []
  try {
    Deno.statSync(`${root}/AGENTS.md`)
    out.push(`${root}/AGENTS.md`)
  } catch { /* no common persona here */ }
  try {
    for (let e of Deno.readDirSync(`${root}/personas`)) {
      if (e.isFile && e.name.endsWith('.md')) {
        out.push(`${root}/personas/${e.name}`)
      }
    }
  } catch { /* no specialists here */ }
  return out
}

// Projection files present under an owned root that this render did NOT
// produce — a persona was deleted or its slug renamed, leaving a stale spec
// still wearing the "authoritative" banner. Each is a delete (body: null,
// the wire's clear semantics) carrying its venture's push, so syncFiles
// removes it and git.ts commits the removal. The render IS the manifest;
// no side-ledger to drift.
export let orphans = (
  roots: { root: string; push: boolean }[],
  keep: { path: string }[],
) => {
  let want = new Set(keep.map((f) => f.path))
  return roots.flatMap(({ root, push }) =>
    held(root).filter((p) => !want.has(p))
      .map((path) => ({ path, body: null, push }))
  )
}

// The full reconcile plan: files to write (filesFor) plus orphans to delete.
// Impure — it reads the .tasks dirs to see what's there but shouldn't be — so
// it lives beside syncFiles, not the pure renderers. One plan feeds both the
// CLI verb and the server effect, so they reconcile identically.
export let projection = (all: Row[], deps: Dep[], now: number) => {
  let files = filesFor(all, deps, now)
  return [...files, ...orphans(taskRoots(all), files)]
}

// Write via a temp file + rename: writeTextFileSync truncates before it
// writes, so a harness reading CLAUDE.md mid-write sees an empty file — and
// that file is what every agent here boots into. rename is atomic within a
// filesystem; the temp rides in the same directory to stay on it, and is
// cleaned if the rename fails so a broken write leaves no litter.
let writeAtomic = (path: string, body: string) => {
  let tmp = `${path}.${crypto.randomUUID()}.tmp`
  try {
    Deno.writeTextFileSync(tmp, body)
    Deno.renameSync(tmp, path)
  } catch (e) {
    try {
      Deno.removeSync(tmp)
    } catch { /* nothing to clean */ }
    throw e
  }
}

// Reconcile the plan to disk: write string bodies, remove null ones (an
// orphan or a retracted spec). Reads before writing so an unchanged
// materialization never churns mtimes (or git status), and a failure on one
// file never stops the rest — the caller hears all three.
export let syncFiles = (files: { path: string; body: string | null }[]) => {
  let written: string[] = []
  let removed: string[] = []
  let failed: string[] = []
  for (let f of files) {
    try {
      if (f.body == null) {
        try {
          Deno.removeSync(f.path)
          removed.push(f.path)
        } catch { /* already gone — nothing to un-write */ }
        continue
      }
      let had: string | undefined
      try {
        had = Deno.readTextFileSync(f.path)
      } catch { /* new file */ }
      if (had == f.body) continue
      Deno.mkdirSync(f.path.slice(0, f.path.lastIndexOf('/')), {
        recursive: true,
      })
      writeAtomic(f.path, f.body)
      written.push(f.path)
    } catch (e) {
      failed.push(`${f.path}: ${(e as Error).message}`)
    }
  }
  return { written, removed, failed }
}
