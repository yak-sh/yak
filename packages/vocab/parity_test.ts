// Parity: the FULL fleet vocabulary, converted mechanically from the fleet
// manifests into the @yaks/vocab JSON Schema format, loaded through the
// runtime, must answer exactly what the fleet's generated src/types.ts (and
// src/query.ts routing) answer today — same comps, same column types, same
// kindOrder, same death worklists, same routing. The converter lives HERE, in
// the test, because it is fleet glue: the package ships zero components.
//
// Known, deliberate divergences (the fleet layers rules the meta-model does
// not carry): the log partition (log comps don't claim bare spellings), the
// curated bareShy/sharedRefs bare-routing lists, and derived value COMPUTATION
// (statusOf) — the derived column itself is declared here as persist: false.

import { assert, assertEquals } from '@std/assert'
import { loadVocab } from './mod.ts'
import type { Column, PropSchema, VocabDoc } from './mod.ts'
import {
  comps,
  deaths,
  derivedProps,
  kindOrder,
  prefix,
  type PropType,
  stamped,
} from '../../src/types.ts'
import { route } from '../../src/query.ts'
import canvas from '../../src/vocab/manifests/canvas.json' with { type: 'json' }
import capture from '../../src/vocab/manifests/capture.json' with {
  type: 'json',
}
import comms from '../../src/vocab/manifests/comms.json' with { type: 'json' }
import identity from '../../src/vocab/manifests/identity.json' with {
  type: 'json',
}
import kernel from '../../src/vocab/manifests/kernel.json' with { type: 'json' }
import mail from '../../src/vocab/manifests/mail.json' with { type: 'json' }
import platform from '../../src/vocab/manifests/platform.json' with {
  type: 'json',
}
import roles from '../../src/vocab/manifests/roles.json' with { type: 'json' }
import sessions from '../../src/vocab/manifests/sessions.json' with {
  type: 'json',
}
import work from '../../src/vocab/manifests/work.json' with { type: 'json' }

// ---- the converter: one manifest comp spec → one $defs object schema -------

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

// Named enums resolve across all manifests, the way gen.ts resolves them.
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
  // a well ({well} in a manifest, {text} in types.ts) dissolves: completion
  // draws from examples ∪ the column's live distinct values
  return { type: 'string' }
}

// The fleet's bare-spelling suppressions, said declaratively: a log comp never
// claims bare spellings (query.ts filters sessionComps out of routing), and the
// curated bareShy columns (plus the edge-vocabulary `parent` refs) yield their
// bare word to the concept that already owns it.
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
// The fleet's derived columns (types.ts derivedProps) are hand-written fleet
// logic, not manifest data: declared here as computed (persist: false) enum
// columns — readable, routable, never writable, value computed downstream.
for (let [comp, ps] of Object.entries(derivedProps)) {
  let def = docs.map((d) => d.$defs?.[comp]).find((x) => x)
  for (let [p, t] of Object.entries(ps)) {
    def!.properties![p] = { ...propOf(t), persist: false }
  }
}
let v = loadVocab(docs)

// ---- the canonical type spelling both sides collapse to --------------------

let canonType = (t: PropType): string =>
  typeof t == 'string'
    ? t
    : 'enum' in t
    ? `enum:${t.enum.join('|')}`
    : 'eid' in t
    ? `ref:${t.eid}:${t.death}`
    : 'text' // a well is a text column whose pool name dissolved

let canonCol = (c: Column): string =>
  c.category == 'enum'
    ? `enum:${c.values!.join('|')}`
    : c.category == 'ref'
    ? `ref:${c.ref}:${c.death}`
    : c.scalar!

// ---- parity ----------------------------------------------------------------

Deno.test('parity: the writable component list', () => {
  assertEquals(v.comps, Object.keys(comps).sort())
})

Deno.test('parity: kindOrder, exactly', () => {
  assertEquals(v.kinds, kindOrder)
})

Deno.test('parity: every wire-writable column, name and type', () => {
  for (let [name, cols] of Object.entries(comps)) {
    assertEquals(v.comp(name)!.writable, Object.keys(cols), name)
    for (let [p, t] of Object.entries(cols)) {
      assertEquals(canonCol(v.column(name, p)!), canonType(t), `${name}.${p}`)
    }
  }
})

Deno.test('parity: every stamped column, name and type', () => {
  for (let name of v.all) {
    assertEquals(
      v.comp(name)!.stamped,
      Object.keys(stamped[name] ?? {}),
      name,
    )
  }
  for (let [name, cols] of Object.entries(stamped)) {
    for (let [p, t] of Object.entries(cols)) {
      let c = v.column(name, p)!
      assert(c.stamped, `${name}.${p} is stamped`)
      assertEquals(canonCol(c), canonType(t), `${name}.${p}`)
    }
  }
})

Deno.test('parity: death worklists, all four words', () => {
  for (let word of ['cascade', 'detach', 'release', 'keep'] as const) {
    assertEquals(v.deaths(word).sort(), deaths(word).sort(), word)
  }
})

Deno.test('parity: enum aliases ride along', () => {
  assertEquals(v.column('review', 'verdict')!.aliases, {
    approve: 'approved',
    reject: 'rejected',
    changes: 'changes_requested',
  })
})

Deno.test('parity: fleet keywords (prefix, by_name)', () => {
  for (let [kind, p] of Object.entries(prefix)) {
    assertEquals(v.comp(kind)?.prefix, p, kind)
  }
})

Deno.test('parity: derived status is readable, never writable', () => {
  let status = v.column('task', 'status')!
  assertEquals(status.persist, false)
  assertEquals(status.values, ['open', 'wip', 'done', 'cancelled'])
  assert(!v.comp('task')!.writable.includes('status'))
})

Deno.test('parity: bare routing agrees with the fleet on the shared spellings', () => {
  // The sample every board actually speaks. The fleet's curated layers
  // (bareShy, the log partition) own the rest; see the header comment.
  for (
    let p of [
      'status',
      'title',
      'body',
      'priority',
      'project',
      'assignee',
      'domain',
      'query',
      'color',
      'target',
      'scope',
      'session',
      'from',
      'person',
      'claim',
    ]
  ) {
    assertEquals(v.route(p), route(p), `.${p}`)
  }
})

Deno.test('parity: dotted paths aim through references', () => {
  assertEquals(v.aim('comment.target.doc.title'), [
    { comp: 'comment', prop: 'target' },
    { comp: 'doc', prop: 'title' },
  ])
  assertEquals(v.aim('task.project.doc.title'), [
    { comp: 'task', prop: 'project' },
    { comp: 'doc', prop: 'title' },
  ])
  assertEquals(v.aim('created.by'), [{ comp: 'created', prop: 'by' }])
})
