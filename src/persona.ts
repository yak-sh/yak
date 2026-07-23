// Personas, materialized. A persona is a curated view over the graph —
// its doc is the core text, its EDGES are the tiers (contains = preload
// the whole body, reads = carry the one-line index; everything else in
// scope stays searchable) — and this module renders that view as one
// markdown document: for a spawned session's system prompt, and for the
// repo-local .tasks/ files native harnesses read (CLAUDE.md symlinks
// there when a repo adopts them — the flip is the owner's move, never
// ours). materialize() and filesFor() are pure over rows+deps so the
// CLI verb, the server effect, and the tests render the same bytes;
// only syncFiles() touches the filesystem.
import { type Dep, idOf } from './types.ts'
import { type Row } from './client.ts'
import { hot } from './query.ts'

// A persona's home page in the UI — the header points hand-editors back
// at the graph. One base for now; federation can teach it homes later.
let BASE = 'http://127.0.0.1:5173'

// The DIALECT is the frame a provider reads — header text and section
// names; the content is single-sourced from the graph and never varies.
// One provider-agnostic dialect today, as data so a second one is an
// addition, not a refactor. Intended home when formats diverge:
// adapters.ts provider rows declare their dialect + target filenames,
// and sync renders one persona into N provider files.
export type Dialect = {
  header: (id: string, title: string) => string
  preloaded: string
  index: string
}
export let DIALECT: Dialect = {
  header: (id, title) =>
    `<!-- GENERATED from ${id} (${title}) — edit in the graph (${BASE}/${id}, memory_save), never here: the
next sync overwrites hand edits. -->`,
  preloaded: '## Preloaded',
  index: '## Index\n\nRecall a body by id (memory_recall / task show).',
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
  let head = m ? `${m.type}: ` : ''
  let seen = m?.last_confirmed_at
    ? ` · confirmed ${String(m.last_confirmed_at).slice(0, 10)}`
    : ''
  return `- ${idOf(r)} ${head}${r.comps.doc?.title ?? ''}${
    n ? ` · ${n}×` : ''
  }${seen}`
}

// The persona's tier members, resolved and warm-first. Dead or docless
// children drop silently — a tier names what it can still say.
let tier = (all: Row[], deps: Dep[], eid: string, type: string, now: number) =>
  deps.filter((d) => d.parent == eid && d.type == type)
    .map((d) => all.find((r) => r.eid == d.child))
    .filter((r): r is Row => !!r?.comps.doc)
    .sort(byWarm(now))

// The whole persona as one markdown document: header naming the edit
// path, the core text, preloaded bodies (warmest first — the budgeted
// auto-tier hangs off this ordering later), then the index.
export let materialize = (
  all: Row[],
  deps: Dep[],
  p: Row,
  now: number,
  d: Dialect = DIALECT,
) => {
  let pre = tier(all, deps, p.eid, 'contains', now)
  let idx = tier(all, deps, p.eid, 'reads', now)
  let body = String(p.comps.doc?.body ?? '').trim()
  let header = d.header(idOf(p), String(p.comps.doc?.title ?? 'persona'))
  // Native harnesses need YAML frontmatter at byte 0, so when the body opens
  // with a --- block the header rides just after it, never before.
  let fm = body.match(/^---\n[\s\S]*?\n---(?:\n|$)/)
  let lead = fm
    ? `${fm[0].trimEnd()}\n\n${header}\n\n${body.slice(fm[0].length).trim()}`
    : `${header}\n\n${body}`
  let parts = [
    lead,
    ...(pre.length
      ? [
        d.preloaded,
        ...pre.map((r) =>
          `### ${idOf(r)} ${r.comps.doc?.title ?? ''}\n\n${
            String(r.comps.doc?.body ?? '').trim()
          }`
        ),
      ]
      : []),
    ...(idx.length
      ? [`${d.index}\n\n${idx.map((r) => indexLine(r, now)).join('\n')}`]
      : []),
  ]
  return parts.filter(Boolean).join('\n\n') + '\n'
}

// A project's COMMON persona — the one the project `contains` (an
// edge, so the marker is graph-data the editor can move). Among its
// other personas the common one is what lands as .tasks/AGENTS.md.
export let commonOf = (all: Row[], deps: Dep[], projectEid: string) =>
  all.find((r) =>
    r.comps.persona?.home_eid == projectEid &&
    deps.some((d) =>
      d.parent == projectEid && d.type == 'contains' && d.child == r.eid
    )
  )

// A project's SPECIALIST personas, surfaced as edges. `home_eid` is the
// one truth for ownership (commonOf and filesFor derive from it); these
// project→persona `reads` edges are DERIVED from it — never stored — so a
// specialist shows on its project's card and navigates, and the two facts
// can't drift (a home is a fact, like a board is a query: membership is
// computed, not an edge list). The common persona already rides `contains`
// so it's skipped, as is any persona already carrying a stored edge from
// its home (no double sentence). snapshot() folds these into `deps`.
export let homeReads = (all: Row[], deps: Dep[]): Dep[] =>
  all.flatMap((r) => {
    let home = r.comps.persona?.home_eid
    return home &&
        !deps.some((d) =>
          d.parent == home && d.child == r.eid &&
          (d.type == 'contains' || d.type == 'reads')
        )
      ? [{ parent: String(home), type: 'reads' as const, child: r.eid }]
      : []
  })

// Every file materialization owes the fleet: for each project with a
// checkout, the common persona (if any) as .tasks/AGENTS.md and each
// other home persona as .tasks/personas/<slug>.md. Fleet-shared
// personas (no home) ride spawns only — they are nobody's file.
export let filesFor = (all: Row[], deps: Dep[], now: number) => {
  let out: { path: string; body: string }[] = []
  for (let proj of all.filter((r) => r.comps.project && r.comps.repo?.path)) {
    let root = `${proj.comps.repo.path}/.tasks`
    let base = commonOf(all, deps, proj.eid)
    if (base) {
      out.push({
        path: `${root}/AGENTS.md`,
        body: materialize(all, deps, base, now),
      })
    }
    for (
      let p of all.filter((r) =>
        r.comps.persona?.home_eid == proj.eid && r.eid != base?.eid
      )
    ) {
      let slug = String(p.comps.alias?.slug ?? idOf(p))
      out.push({
        path: `${root}/personas/${slug}.md`,
        body: materialize(all, deps, p, now),
      })
    }
  }
  return out
}

// Write what changed, report what was written. Reads before writing so
// an unchanged materialization never churns mtimes (or git status), and
// a failure on one file never stops the rest — the caller hears both.
export let syncFiles = (files: { path: string; body: string }[]) => {
  let written: string[] = []
  let failed: string[] = []
  for (let f of files) {
    try {
      let had: string | undefined
      try {
        had = Deno.readTextFileSync(f.path)
      } catch { /* new file */ }
      if (had == f.body) continue
      Deno.mkdirSync(f.path.slice(0, f.path.lastIndexOf('/')), {
        recursive: true,
      })
      Deno.writeTextFileSync(f.path, f.body)
      written.push(f.path)
    } catch (e) {
      failed.push(`${f.path}: ${(e as Error).message}`)
    }
  }
  return { written, failed }
}
