// Parity: @yaks/sql, compiling a REAL query corpus against the FULL fleet
// vocabulary, must select the same rows the fleet's own src/sql.ts compiler
// selects. Both statements run against one in-memory graph and their eid sets
// are held against each other — a compiler that "looks right" and one that IS
// right are indistinguishable from the inside, and this is the seam where they
// come apart.
//
// The graph is the fleet compiler's own adversarial fixture, reproduced here:
// numeric columns matched as text, an empty string beside an absent column,
// derived status across the cancelled→completed→claim→open ordering, a
// reference-deref path, time stamps. If @yaks/sql disagrees with src/sql.ts on
// any line below, the two answer different questions and the test says so.
//
// The fleet Vocab is converted mechanically from the fleet manifests (the same
// converter vocab/parity_test.ts uses — fleet glue, so it lives in the test),
// then loaded through @yaks/vocab and handed to @yaks/sql with the fleet's
// derived-column registrations (task.status, updated.at).

import { assert, assertEquals } from '@std/assert'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import type { PropSchema, VocabDoc } from '@yaks/vocab'
import { compile, Unsupported } from '@yaks/sql'
import { derived as fleetDerived } from './sql_derived.ts'

import { parseQuery } from './query.ts'
import { aggregateSql, countSql, select, where, windowed } from './sql.ts'
import { run } from './relation.ts'
import { textBlob } from './db.ts'
import { isRef } from './props.ts'
import { derivedProps } from './types.ts'
import { open } from './store/sqlite.ts'

import canvas from './vocab/manifests/canvas.json' with { type: 'json' }
import capture from './vocab/manifests/capture.json' with {
  type: 'json',
}
import comms from './vocab/manifests/comms.json' with { type: 'json' }
import identity from './vocab/manifests/identity.json' with {
  type: 'json',
}
import kernel from './vocab/manifests/kernel.json' with { type: 'json' }
import mail from './vocab/manifests/mail.json' with { type: 'json' }
import platform from './vocab/manifests/platform.json' with {
  type: 'json',
}
import roles from './vocab/manifests/roles.json' with { type: 'json' }
import sessions from './vocab/manifests/sessions.json' with {
  type: 'json',
}
import work from './vocab/manifests/work.json' with { type: 'json' }

// ---- the converter (copied from src/vocab/parity_test.ts: fleet glue) ------

type ManifestType =
  | string
  | { enum: readonly string[] | string; aliases?: Record<string, string> }
  | { eid: string; death: string }
  | { well: string }
  | { text: string }
type ManifestComp = {
  kind?: boolean
  before?: string[]
  prefix?: string
  by_name?: boolean
  wire?: boolean
  log?: boolean
  cols?: Record<string, ManifestType>
  stamped?: Record<string, ManifestType>
}
type Manifest = {
  name: string
  enums?: Record<string, { values: string[] }>
  comps: Record<string, ManifestComp>
}

let manifests: Manifest[] = [
  canvas,
  capture,
  comms,
  identity,
  kernel,
  mail,
  platform,
  roles,
  sessions,
  work,
] as Manifest[]

let enums: Record<string, string[]> = {}
for (let m of manifests) {
  for (let [name, e] of Object.entries(m.enums ?? {})) enums[name] = e.values
}

let SCALARS: Record<string, PropSchema> = {
  text: { type: 'string' },
  body: { type: 'string', store: 'blob' },
  number: { type: 'number' },
  priority: { type: 'number', format: 'priority' },
  bool: { type: 'boolean' },
  query: { type: 'string', format: 'query' },
  time: { type: 'string', format: 'date-time' },
  url: { type: 'string', format: 'uri' },
}

let propOf = (t: ManifestType): PropSchema => {
  if (typeof t == 'string') return { ...SCALARS[t] }
  if ('enum' in t) {
    let values = typeof t.enum == 'string' ? enums[t.enum] : t.enum
    return { enum: values, ...(t.aliases ? { aliases: t.aliases } : {}) }
  }
  if ('eid' in t) return { type: 'string', ref: t.eid, death: t.death }
  return { type: 'string' }
}

let shy = new Set([
  'fork.from',
  'accept.body',
  'edge.from',
  'edge.to',
  'member.person',
  'pane.parent',
  'session.parent',
])

let compOf = (spec: ManifestComp): PropSchema => ({
  type: 'object',
  ...(spec.kind ? { kind: true } : {}),
  ...(spec.before ? { before: spec.before } : {}),
  ...(spec.wire === false ? { wire: false } : {}),
  ...(spec.log ? { bare: false } : {}),
  ...(spec.prefix ? { prefix: spec.prefix } : {}),
  ...(spec.by_name ? { by_name: true } : {}),
  properties: {
    ...Object.fromEntries(
      Object.entries(spec.cols ?? {}).map(([p, t]) => [p, propOf(t)]),
    ),
    ...Object.fromEntries(
      Object.entries(spec.stamped ?? {}).map((
        [p, t],
      ) => [p, { ...propOf(t), stamped: true }]),
    ),
  },
})

let docOf = (m: Manifest): VocabDoc => ({
  $vocabulary: {
    'https://yaks.sh/vocab/core': true,
    'https://yaks.sh/vocab/fleet': true,
  },
  title: m.name,
  $defs: Object.fromEntries(
    Object.entries(m.comps).map(([name, spec]) => [name, compOf(spec)]),
  ),
})

let docs = manifests.map(docOf)
for (let d of docs) {
  for (let [name, def] of Object.entries(d.$defs ?? {})) {
    for (let [p, s] of Object.entries(def.properties ?? {})) {
      if (shy.has(`${name}.${p}`)) s.bare = false
    }
  }
}
for (let [comp, ps] of Object.entries(derivedProps)) {
  let def = docs.map((d) => d.$defs?.[comp]).find((x) => x)
  for (let [p, t] of Object.entries(ps)) {
    def!.properties![p] = { ...propOf(t as ManifestType), persist: false }
  }
}
let V = loadVocab(docs)

// ---- the graph (the fleet compiler's own fixture) --------------------------

let db = open(':memory:')
let base = Number(
  (db.prepare('select max(num) as n from entity').get() as { n: number }).n ??
    0,
)
let n = 0
type Cell = string | number | null
let put = (eid: string, rows: Record<string, Record<string, Cell>>) => {
  db.prepare('insert into entity (eid, num) values (?, ?)').run(eid, base + ++n)
  for (let [comp, cols] of Object.entries(rows)) {
    if (comp == 'doc') {
      cols = { ...cols, body: textBlob(db, String(cols.body ?? '')) }
    }
    let names = Object.keys(cols)
    let colSql = ['entity', ...names.map((k) => `"${k}"`)].join(',')
    let valSql = [
      '(select id from entity where eid = ?)',
      ...names.map((k) =>
        isRef(comp, k) ? '(select id from entity where eid = ?)' : '?'
      ),
    ].join(',')
    db.prepare(`insert into "${comp}" (${colSql}) values (${valSql})`)
      .run(eid, ...names.map((k) => cols[k]))
  }
}

let NOW = Date.parse('2026-08-20T15:00:00.000Z')
let ago = (ms: number) => new Date(NOW - ms).toISOString()
let HOUR = 3_600_000
let DAY = 24 * HOUR

put('p1', { doc: { title: 'a project' }, project: {} })
put('w1', {
  doc: { title: 'touched just now' },
  created: { at: ago(9 * DAY), by: null, via: null },
  updated: { at: ago(5 * 60_000), by: null, via: null },
})
put('w4', {
  doc: { title: 'made today, never touched' },
  created: { at: ago(2 * HOUR), by: null, via: null },
})
put('w5', { doc: { title: 'no stamps at all' } })
put('sc', { session: { id: 'sc' } })
put('e1', {
  doc: { title: 'alpha widget', body: 'the first one' },
  task: { priority: 1, domain: 'Eng', project: 'p1' },
  proposed: { at: '2026-08-01T00:00:00.000Z', by: null, via: null },
})
put('e2', {
  doc: { title: 'beta WIDGET', body: '100% sure' },
  task: { priority: 2, domain: 'Ops', project: 'p1' },
  claim: { session: 'sc' },
})
put('e3', {
  doc: { title: 'gamma', body: 'under_score' },
  task: { priority: 0, domain: '', project: null },
  completed: { at: '2026-08-02T00:00:00.000Z', by: null },
})
put('e4', { doc: { title: 'delta', body: '' } })
put('e5', {
  doc: { title: '10', body: 'digits in a text column' },
  task: { priority: 10, domain: '9' },
})
put('e9', {
  doc: { title: 'cancelled task' },
  task: { priority: 3 },
  claim: { session: 'sc' },
  completed: { at: '2026-08-02T00:00:00.000Z', by: null },
  cancelled: { at: '2026-08-03T00:00:00.000Z', by: null, reason: 'superseded' },
})
put('e8', { proposed: { at: '', by: null, via: null } })
put('pt', { task: { priority: 1, domain: '' }, project: {} })

// ---- the two compilers, one graph ------------------------------------------

let mine = (q: string): string[] =>
  (db.prepare(compile(parse(q), V, { derived: fleetDerived, now: NOW }).sql)
    .all(
      ...compile(parse(q), V, { derived: fleetDerived, now: NOW }).params,
    ) as {
      eid: string
    }[])
    .map((r) => r.eid).sort()

let ref = (q: string): string[] | null => {
  let rel = where(parseQuery(q), NOW)
  return rel ? run<{ eid: string }>(db, rel).map((r) => r.eid).sort() : null
}

// Every common-path line: @yaks/sql agrees with src/sql.ts, and src/sql.ts did
// not decline (a decline would mean the reference itself fell to JS, so the
// corpus would not be proving compiled parity).
let agree = (q: string) => {
  let r = ref(q)
  assert(r != null, `reference declined (not a compiled-parity case): ${q}`)
  assertEquals(mine(q), r, `disagreed on: ${q}`)
}

let CORPUS = [
  // derived status — the single most common board filter, via the hook
  '.status=open',
  '.status=wip',
  '.status=done',
  '.status=cancelled',
  '.status=open,wip',
  '.status!=done',
  // scalars: numbers, ranges, comparisons, lists, enums
  '.priority=1',
  '.priority=1..3',
  '.priority>=2',
  '.priority<1',
  '.domain=Eng',
  '.domain=Eng,Ops',
  '.domain~=n',
  // presence / absence, over a component facet and a reference column. The
  // reference presence/absence is spelled EXPLICITLY (`.task.project!`): a BARE
  // `.project!` is a documented @yaks/vocab-vs-fleet-parser divergence — the
  // vocab's `route` returns the `task.project` column, while the fleet parser
  // sends a value-less op to the `project` COMPONENT facet ("is a project" vs
  // "has a project"). @yaks/sql routes through the vocab, as instructed.
  '.task!',
  '.task=',
  '.task.project!',
  '.task.project=',
  '.project=p1',
  // reference-deref path (task.project → doc.title)
  '.task.project.doc.title~=project',
  '.task.project.doc.title~=nothing',
  // full-text
  'widget',
  'gamma',
  // .kind scope (present-and-earlier-absent)
  '.kind=task',
  '.kind=project',
  // boolean composition
  '.priority=1&.domain=Eng',
  '.status=open&.priority>=1',
  // time
  '.proposed.at>=2026-08-01',
  '.proposed.at<2026-08-02',
]

for (let q of CORPUS) {
  Deno.test(`parity: ${q}`, () => agree(q))
}

// The window is newest-first by spine num, a prefix — so its answer is an
// ORDERED list, not a set. @yaks/sql applies `.limit`; the reference wraps
// where() in windowed(). The two must page identically.
Deno.test('parity: .limit window pages identically', () => {
  let q = '.status=open&.limit=3'
  let list = (db.prepare(
    compile(parse(q), V, { derived: fleetDerived, now: NOW }).sql,
  ).all(
    ...compile(parse(q), V, { derived: fleetDerived, now: NOW }).params,
  ) as {
    eid: string
  }[]).map((r) => r.eid)
  let refRel = windowed(where(parseQuery('.status=open'), NOW)!, { limit: 3 })
  let refList = run<{ eid: string }>(db, refRel).map((r) => r.eid)
  assertEquals(list, refList)
})

// The aggregates: `.count!` reduces the selection; `.distinct`/`.tally` reduce
// a column. Each runs its own value-shaped statement, so parity is over the
// value→count rows, not eids.
let rows = (rel: unknown) =>
  run<{ value: string; n?: number }>(db, rel as never)
    .map((r) => `${r.value}:${r.n ?? ''}`).sort()
let compiled = (q: string) => {
  let c = compile(parse(q), V, { derived: fleetDerived, now: NOW })
  return db.prepare(c.sql).all(...c.params) as { value: string; n?: number }[]
}

Deno.test('parity: .count! counts identically', () => {
  let mineN = compiled('.status=open&.count!')[0].n
  let refN =
    run<{ n: number }>(db, countSql(parseQuery('.status=open&.count!'))!)[0].n
  assertEquals(mineN, refN)
})

Deno.test('parity: .tally=domain over the same filter', () => {
  let mineR = compiled('.tally=domain').map((r) => `${r.value}:${r.n}`).sort()
  assertEquals(mineR, rows(aggregateSql(parseQuery('.tally=domain'))))
})

Deno.test('parity: .distinct=domain over the same filter', () => {
  let mineR = compiled('.distinct=domain').map((r) => r.value).sort()
  assertEquals(
    mineR,
    run<{ value: string }>(db, aggregateSql(parseQuery('.distinct=domain'))!)
      .map((r) => r.value).sort(),
  )
})

// A `.fields` projection selects EXACTLY the membership `where()` gives the
// same filter — the projected columns ride along but never change the set.
Deno.test('parity: .fields projection keeps the membership', () => {
  let mineEids = compiled('.status=open&.fields=priority').map((
    r,
  ) => (r as unknown as { eid: string }).eid).sort()
  assertEquals(mineEids, ref('.status=open')!)
  // and the reference agrees the projection is membership-preserving
  assertEquals(
    run<{ eid: string }>(
      db,
      select(parseQuery('.status=open&.fields=priority'))!,
    )
      .map((r) => r.eid).sort(),
    ref('.status=open')!,
  )
})

// The advanced directives are declined LOUDLY, not faked. This documents the
// honest coverage boundary: a gap throws Unsupported naming the feature.
Deno.test('gaps: advanced directives throw Unsupported', () => {
  for (
    let q of [
      '.near=e1&.order=similar',
      '.edges!',
      '.reaches[requires,<=3]=e1',
    ]
  ) {
    let threw: unknown
    try {
      compile(parse(q), V, { derived: fleetDerived, now: NOW })
    } catch (e) {
      threw = e
    }
    assert(threw instanceof Unsupported, `expected Unsupported for ${q}`)
  }
})
