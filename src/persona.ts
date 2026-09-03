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
import { accepted, memoryHead, type Row } from './client.ts'
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
  header: (id: string, title: string, name: string) => string
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
    '## Memory Index\n\n*Recall a body by id (MCP `memory_recall` / CLI `task show`).*',
}

// The claude AGENT-FILE dialect. `claude --agent <name>` (and every native
// harness that reads `.claude/agents/<name>.md`) loads a persona as the
// session's system prompt — but ONLY if the file OPENS with YAML frontmatter
// carrying `name` and `description`; a file that starts with the HTML banner
// is silently "not found" (verified against claude 2.1.250). So a specialist
// persona projection — the file `.claude/agents/<slug>.md` symlinks to — leads
// with frontmatter, then the same banner as its first body line. `name` is the
// slug, because claude keys the agent by this frontmatter name, not the
// filename: an `operator.md` symlink to `taskmaster.md` registers as agent
// `taskmaster`. codex reads the very same file RAW (model_instructions_file),
// where the frontmatter is harmless preamble. The description is the persona's
// one-line doc title, JSON-encoded so any character stays a valid YAML scalar.
export let AGENT: Dialect = {
  header: (id, title, name) =>
    `---\nname: ${name}\ndescription: ${JSON.stringify(title)}\n---\n${
      DIALECT.header(id, title, name)
    }`,
  rule: DIALECT.rule,
  index: DIALECT.index,
}

// The claude agent name a persona registers under — its slug, sanitized to
// claude's charset (lowercase, digits, hyphens), falling back to its lowered
// id. cli.ts resolves the same name from the operator symlink's realpath, so
// the two agree without a shared table.
export let agentName = (p: Row) =>
  String(p.comps.alias?.slug ?? idOf(p)).toLowerCase().replace(
    /[^a-z0-9-]+/g,
    '-',
  )

// One index line — the memory_recall rendering, tolerant of non-memory
// targets (any doc can ride the index tier). Dynamic composition may order
// these lines by warmth, but the score never prints: that would churn the text
// on every decay tick and bury real diffs.
export let indexLine = (r: Row, _now?: number) => {
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
// The prompt reads stable-first, identity-last (M-31946 §2): what this
// project IS, then what the owner decided, then how the fleet works, and only
// then who this agent is. Each group is a graph fact, never a hand list:
//   0 — project documentation: a scoped memory reached through a COMMON
//       persona (one a project contains, the global base, or a persona a
//       common one contains)
//   1 — owner direction: a feedback memory a PERSON gave, whichever persona it
//       rides. `feedback` alone is too broad a test: an agent's recorded
//       correction wears it too (and so does an endorsed house style), and
//       those are working rules, not the owner speaking. `feedback.by` is the
//       fact that separates them — persona_graph.ts pulls those authors into
//       the row set, since a reference is not an edge the tier walk follows.
//   2 — working rules: an unscoped memory reached through a common persona
//   3 — identity: what a specialist persona says of itself
// Edge order and warmth still decide within a group.
let commonish = (all: Row[], deps: Dep[]) => {
  let personas = new Set(all.filter((r) => r.comps.persona).map((r) => r.eid))
  let projects = new Set(all.filter((r) => r.comps.project).map((r) => r.eid))
  let set = new Set(
    all.filter((r) => idOf(r) == GLOBAL_BASE).map((r) => r.eid),
  )
  for (let d of deps) {
    if (
      d.type == 'contains' && projects.has(d.parent) && personas.has(d.child)
    ) {
      set.add(d.child)
    }
  }
  let grew = true
  while (grew) {
    grew = false
    for (let d of deps) {
      if (
        (d.type == 'contains' || d.type == 'reads') && set.has(d.parent) &&
        personas.has(d.child) && !set.has(d.child)
      ) {
        set.add(d.child)
        grew = true
      }
    }
  }
  return set
}
let peopleIn = (all: Row[]) =>
  new Set(all.filter((r) => r.comps.person).map((r) => r.eid))

let groupOf = (r: Row, viaCommon: boolean, people: Set<string>) =>
  people.has(String(r.comps.feedback?.by ?? ''))
    ? 1
    : !viaCommon
    ? 3
    : r.comps.memory?.scope
    ? 0
    : 2

type Member = { row: Row; rank: number; seq: number; group: number }
let tiers = (
  all: Row[],
  deps: Dep[],
  eid: string,
  order: number | null,
  seen = new Set<string>(),
  common = commonish(all, deps),
  people = peopleIn(all),
): { pre: Row[]; idx: Row[]; groups: Map<string, number> } => {
  let pre = new Map<string, Member>()
  let idx = new Map<string, Member>()
  let viaCommon = common.has(eid)
  let put = (
    tier: Map<string, Member>,
    row: Row,
    rank: number,
    group = groupOf(row, viaCommon, people),
  ) => {
    let at = tier.get(row.eid)
    if (!at) tier.set(row.eid, { row, rank, seq: tier.size, group })
    else {
      // A direct authored order still wins when the same memory also arrived
      // through a persona. Map insertion stays put, preserving the first
      // deterministic path for every otherwise-unranked member.
      if (rank < at.rank) at.rank = rank
      // The stabler group wins: a rule the common persona carries is a rule
      // even when a specialist restates it.
      if (group < at.group) at.group = group
    }
  }
  seen.add(eid)
  let kids = (type: Edge) =>
    deps.filter((d) => d.parent == eid && d.type == type)
      .map((d) => ({ d, r: all.find((r) => r.eid == d.child) }))
      // A proposed memory nobody has decided is a suggestion, not a rule:
      // it reaches no prompt, by either edge, until a person accepts it.
      .filter((x): x is { d: Dep; r: Row } => !!x.r?.comps.doc && accepted(x.r))
      .sort((a, b) =>
        (a.d.ord ?? Number.MAX_SAFE_INTEGER) -
          (b.d.ord ?? Number.MAX_SAFE_INTEGER) ||
        a.r.num - b.r.num || a.r.eid.localeCompare(b.r.eid)
      )
  for (let type of ['contains', 'reads'] as const) {
    let here = type == 'contains' ? pre : idx
    for (let { d, r } of kids(type)) {
      if (r.comps.persona) {
        if (seen.has(r.eid)) continue
        let sub = tiers(all, deps, r.eid, order, seen, common, people)
        // The child's arrays already embody its authored order. Give their
        // members stable parent-local sequence numbers instead of discarding
        // that order and re-sorting them by entity identity at every ancestor.
        for (let m of sub.pre) {
          put(pre, m, Number.MAX_SAFE_INTEGER, sub.groups.get(m.eid))
        }
        for (let m of sub.idx) {
          put(idx, m, Number.MAX_SAFE_INTEGER, sub.groups.get(m.eid))
        }
      } else {
        put(here, r, d.ord ?? Number.MAX_SAFE_INTEGER)
      }
    }
  }
  for (let e of pre.keys()) idx.delete(e) // preload wins the fuller form
  // Ephemeral persona composition ranks by live warmth. Persisted projection
  // cannot: hot() decays against the wall clock, so two unchanged memories can
  // cross and make a generated file stale without a graph write. Stored files
  // use only graph facts — declared edge order, then stable identity. Both
  // paths are total orders, so neither depends on input/SQLite iteration.
  let byGraph = (a: Member, b: Member) =>
    a.rank - b.rank || a.seq - b.seq || a.row.num - b.row.num ||
    a.row.eid.localeCompare(b.row.eid)
  let byWarm = (a: Member, b: Member) =>
    a.group - b.group ||
    (order == null
      ? byGraph(a, b)
      : hot(b.row.comps, order) - hot(a.row.comps, order) || byGraph(a, b))
  let warm = (m: Map<string, Member>) =>
    [...m.values()].sort(byWarm).map((x) => x.row)
  let groups = new Map(
    [...pre.values(), ...idx.values()].map((m) => [m.row.eid, m.group]),
  )
  return { pre: warm(pre), idx: warm(idx), groups }
}

// The standing goals a persona's reader works toward (M-31946 §5): fleet-wide
// ones plus its home project's, titles only, rendered with the owner's
// direction — what the work is FOR sits beside what he said, before the rules.
let goalsOf = (all: Row[], p: Row) =>
  all
    .filter((r) => r.comps.goal && r.comps.doc)
    .filter((r) =>
      !r.comps.goal!.scope || r.comps.goal!.scope == p.comps.persona?.home
    )
    .sort((a, b) => a.num - b.num)
    .map((r) => `- ${idOf(r)} ${r.comps.doc?.title ?? ''}`)

// What one persona DELIVERS, as eid sets — the dedup currency between
// delivery files (T-21957). `pre` is what it preloads in full; `idx` is
// everything it says at all (a preloaded body covers an index line, never
// the reverse). A second document rendered for the same reader passes these
// as `omit` so a tier lands once, through whichever file said it first.
export type Delivered = { pre: Set<string>; idx: Set<string> }
let delivered = (
  all: Row[],
  deps: Dep[],
  eid: string,
  order: number | null,
): Delivered => {
  let { pre, idx } = tiers(all, deps, eid, order)
  return {
    pre: new Set(pre.map((r) => r.eid)),
    idx: new Set([...pre, ...idx].map((r) => r.eid)),
  }
}
export let deliveredBy = (
  all: Row[],
  deps: Dep[],
  eid: string,
  now: number,
): Delivered => delivered(all, deps, eid, now)

// The whole persona as one markdown document: header naming the edit path,
// preloaded bodies (warmest first — the budgeted auto-tier hangs off this
// ordering later), then the index. A persona's own body describes it to graph
// readers; prompt instructions belong in contained memories. Each
// preloaded body is its own little document — a rule before it, an H1
// title over it — so a body may use ## freely. Rules ride as their own
// parts: the \n\n join blank-lines every --- and no text line above can
// read it as a setext underline. `omit` drops tiers another document already
// delivers to the same reader (deliveredBy) — a preload elsewhere silences
// both forms here; an index line elsewhere silences only the index line,
// since this document's preload is the fuller form and still earns its place.
let render = (
  all: Row[],
  deps: Dep[],
  p: Row,
  order: number | null,
  d: Dialect = DIALECT,
  omit?: Delivered,
) => {
  let { pre, idx, groups } = tiers(all, deps, p.eid, order)
  if (omit) {
    pre = pre.filter((r) => !omit.pre.has(r.eid))
    idx = idx.filter((r) => !omit.idx.has(r.eid))
  }
  let header = d.header(
    idOf(p),
    String(p.comps.doc?.title ?? 'persona'),
    agentName(p),
  )
  let body = (r: Row) => [
    d.rule,
    `# ${idOf(r)} ${r.comps.doc?.title ?? ''}\n\n${
      String(r.comps.doc?.body ?? '').trim()
    }`,
  ]
  // Goals ride with the owner's direction: after documentation and feedback,
  // before the working rules and any identity.
  let stable = pre.filter((r) => (groups.get(r.eid) ?? 3) <= 1)
  let rest = pre.filter((r) => (groups.get(r.eid) ?? 3) > 1)
  let goals = goalsOf(all, p)
  let parts = [
    header,
    ...stable.flatMap(body),
    ...(goals.length ? [d.rule, `## Goals\n\n${goals.join('\n')}`] : []),
    ...rest.flatMap(body),
    ...(idx.length
      ? [
        d.rule,
        `${d.index}\n\n${idx.map((r) => indexLine(r)).join('\n')}`,
      ]
      : []),
  ]
  return parts.filter(Boolean).join('\n\n') + '\n'
}
export let materialize = (
  all: Row[],
  deps: Dep[],
  p: Row,
  now: number,
  d: Dialect = DIALECT,
  omit?: Delivered,
) => render(all, deps, p, now, d, omit)

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

// The fleet base persona — the global floor a spawn wears when nothing else
// applies (D-18378). A stable graph identity, named once here; sessions.ts
// resolves it to an eid so persona.ts stays pure over rows. It is the last
// resort: a taskless native chat with no project and no explicit persona still
// wears this, so a spawn is (almost) never personaless.
export let GLOBAL_BASE = 'N-14853'

// The personas a spawn wears, base-first — COMPOSED, never either/or (D-18378,
// T-18382). The project's COMMON persona is the project base; an explicit
// --persona is the specific voice worn ON TOP of it. Returning both (not one
// instead of the other) is the fix: an explicit persona no longer DROPS the
// project base, so a spawn wears global base → project base → specific. Deduped
// (an explicit persona that IS the project common appears once). With a project
// and no --persona, the common rides alone; it already contains the global base.
// With neither, `base` (the global floor) is worn, so a spawn is never
// personaless. composeWorn renders the returned list as one document.
export let wornPersona = (
  all: Row[],
  deps: Dep[],
  spawnPersona: string | undefined,
  projectEid: string | undefined,
  base?: string,
): Row[] => {
  let find = (e?: string) =>
    e ? all.find((r) => r.eid == e && r.comps.doc) : undefined
  let seen = new Set<string>()
  let worn = [
    projectEid ? commonOf(all, deps, projectEid) : undefined,
    find(spawnPersona),
  ].filter((r): r is Row => !!r && !seen.has(r.eid) && !!seen.add(r.eid))
  return worn.length ? worn : [find(base)].filter((r): r is Row => !!r)
}

// Render the worn personas as ONE document. The most specific (last) is the
// primary — it names the header — and each base before it folds in BENEATH it
// as a contained tier (a synthetic contains edge), so base memories merge and
// dedup through the very nesting machinery a stored contains edge uses (tiers).
// No string concatenation, and no CLAUDE.md duplicated into a specialist body.
// A single worn persona renders as itself; an empty list is bare (personaless).
export let composeWorn = (
  all: Row[],
  deps: Dep[],
  worn: Row[],
  now: number,
  d: Dialect = DIALECT,
  omit?: Delivered,
): string | undefined => {
  if (!worn.length) return undefined
  let primary = worn[worn.length - 1]
  let folded: Dep[] = worn.slice(0, -1).map((r) => ({
    parent: primary.eid,
    type: 'contains',
    child: r.eid,
  }))
  return materialize(all, [...deps, ...folded], primary, now, d, omit)
}

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
// row knows whether this venture's origin may hear from us. Generated files
// use the stored tier order: unlike a one-run prompt, their bytes must stay a
// pure function of graph state while the wall clock advances.
export let filesFor = (all: Row[], deps: Dep[]) => {
  let out: { path: string; body: string; push: boolean }[] = []
  for (let proj of all.filter(managed)) {
    let root = `${proj.comps.repo.path}/.tasks`
    let push = !!proj.comps.repo.push
    let base = commonOf(all, deps, proj.eid)
    if (base) {
      out.push({
        path: `${root}/AGENTS.md`,
        body: render(all, deps, base, null),
        push,
      })
    }
    // A specialist file only exists BESIDE its repo's AGENTS.md, and a
    // session reading one reads both — so tiers the common persona already
    // delivers are omitted here rather than said twice (T-21957). Outside a
    // repo the specialist rides the spawn path, which renders complete.
    let said = base ? delivered(all, deps, base.eid, null) : undefined
    for (
      let p of all.filter((r) =>
        r.comps.persona?.home == proj.eid && r.eid != base?.eid
      )
    ) {
      // The filename IS the frontmatter name (agentName): claude keys the
      // agent by the frontmatter, cli.ts resolves the `--agent` value from the
      // symlink's realpath BASENAME, and the two must never disagree.
      out.push({
        path: `${root}/personas/${agentName(p)}.md`,
        body: render(all, deps, p, null, AGENT, said),
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

// A repo has ADOPTED the projection when its root CLAUDE.md or AGENTS.md
// resolves into .tasks/AGENTS.md — then a native harness run in that repo
// already reads the common persona from disk, and a spawn's composed prompt
// may omit what that file delivers (T-21957). Checked fresh each spawn,
// never cached: the flip is the owner's move and may happen between spawns.
export let adopted = (repoPath: string) => {
  for (let name of ['CLAUDE.md', 'AGENTS.md']) {
    try {
      if (
        Deno.realPathSync(`${repoPath}/${name}`).endsWith('/.tasks/AGENTS.md')
      ) return true
    } catch { /* absent or dangling — not adopted via this name */ }
  }
  return false
}

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
export let projection = (all: Row[], deps: Dep[]) => {
  let files = filesFor(all, deps)
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
