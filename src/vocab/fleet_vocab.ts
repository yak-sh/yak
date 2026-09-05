// The fleet vocabulary, converted for the @yaks/* stack. @yaks/vocab describes a
// component vocabulary as JSON Schema documents; the fleet authors ITS vocabulary
// as annotated Rust, projected to src/vocab/manifests/*.json. This module is the
// one mechanical bridge between the two shapes: it reads the fleet manifests and
// emits the @yaks/vocab documents, then loads them into a runtime `Vocab`.
//
// It is fleet GLUE, not part of any @yaks/* package (the packages ship zero
// components). It lived copied inside two parity tests; one truth here so a third
// reader — the @yaks/sqlite integration spike — shares it rather than a copy.
//
// Deliberate divergences the meta-model does not carry, applied here: log comps
// yield their bare spellings (query.ts filters them from routing), the curated
// bareShy/sharedRefs list yields a few more, and the derived columns (task.status,
// updated.at) are declared computed (persist: false) — readable, routable, never
// stored.

import { loadVocab } from '@yaks/vocab'
import type { Keywords, PropSchema, Vocab, VocabDoc } from '@yaks/vocab'
import { ID_URI, idKeywords } from '@yaks/id'
import { nameKeywords, NAMES_URI } from '@yaks/names'
import { EDGE_URI, edgeKeywords } from '@yaks/edge'
import { BLOB_URI, blobKeywords } from '@yaks/blob'
import { derivedProps, type PropType } from '../types.ts'
import { natureOf } from '../edge.ts'

import canvas from './manifests/canvas.json' with { type: 'json' }
import capture from './manifests/capture.json' with { type: 'json' }
import comms from './manifests/comms.json' with { type: 'json' }
import identity from './manifests/identity.json' with { type: 'json' }
import kernel from './manifests/kernel.json' with { type: 'json' }
import mail from './manifests/mail.json' with { type: 'json' }
import platform from './manifests/platform.json' with { type: 'json' }
import roles from './manifests/roles.json' with { type: 'json' }
import sessions from './manifests/sessions.json' with { type: 'json' }
import work from './manifests/work.json' with { type: 'json' }

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
  edges?: string[]
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

// The relation tags, gathered the way enums are. A manifest names the edge
// TYPES a query says (`referenced`); the comp an edge entity WEARS is its
// nature (`references`), which edge.ts maps. @yaks/edge reads the pair off the
// `relation` keyword, so the fleet's edge vocabulary reaches the package as a
// declaration rather than as a second copy of the list.
let relationOf: Record<string, string> = {}
for (let m of manifests) {
  for (let type of m.edges ?? []) relationOf[natureOf[type] ?? type] = type
}

let compOf = (name: string, spec: ManifestComp): PropSchema => ({
  type: 'object',
  ...(relationOf[name] ? { relation: relationOf[name] } : {}),
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

// The keyword vocabularies the fleet's own components use beyond the core
// meta-model. Each is owned by the package that interprets it (@yaks/id reads
// `prefix`, @yaks/names reads `by_name`, @yaks/edge reads `relation`,
// @yaks/blob reads `store`), and registered here so the loader carries it.
export let fleetKeywords: Keywords[] = [
  idKeywords,
  nameKeywords,
  edgeKeywords,
  blobKeywords,
]

let docOf = (m: Manifest): VocabDoc => ({
  $vocabulary: {
    'https://yaks.sh/vocab/core': true,
    [ID_URI]: true,
    [NAMES_URI]: true,
    [EDGE_URI]: true,
    [BLOB_URI]: true,
  },
  title: m.name,
  $defs: Object.fromEntries(
    Object.entries(m.comps).map(([name, spec]) => [name, compOf(name, spec)]),
  ),
})

// The fleet manifests + derived columns, as the @yaks/vocab documents they map
// to. Exposed so a test can assert over the docs before loading them; most
// callers want the loaded `Vocab` from fleetVocab().
export let fleetDocs = (): VocabDoc[] => {
  let docs = manifests.map(docOf)
  for (let d of docs) {
    for (let [name, def] of Object.entries(d.$defs ?? {})) {
      for (let [p, s] of Object.entries(def.properties ?? {})) {
        if (shy.has(`${name}.${p}`)) s.bare = false
      }
    }
  }
  // The fleet's derived columns (types.ts derivedProps) are hand-written fleet
  // logic, not manifest data: declared computed (persist: false) — readable,
  // routable, never writable, value computed downstream.
  for (let [comp, ps] of Object.entries(derivedProps)) {
    let def = docs.map((d) => d.$defs?.[comp]).find((x) => x)
    for (let [p, t] of Object.entries(ps)) {
      def!.properties![p] = {
        ...propOf(t as PropType as ManifestType),
        persist: false,
      }
    }
  }
  return docs
}

// The whole fleet vocabulary, loaded through @yaks/vocab.
export let fleetVocab = (): Vocab => loadVocab(fleetDocs(), fleetKeywords)
