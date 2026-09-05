// The vocabulary ONE app speaks (T-33811): the core documents every store on
// the platform shares, plus the words that app declared for itself, loaded
// through @yaks/vocab into one `Vocab` — the thing a Store reads its DDL, its
// routing and its admission out of. One app, one vocabulary; the fleet's own
// 83 tables are the fleet's (V-33553).
//
// What is core here, and why each piece is:
//   entity      the spine — the `num` a store mints on first touch. It has no
//               table of its own: @yaks/sqlite raises `entity` and `tombstone`
//               as the layout's fixed spine, and @yaks/graph reserves the
//               tombstone word on the wire, so neither is declared.
//   doc         title and body: the words a person reads, and the only thing
//               search searches. `body` says `store: "blob"`, which is
//               @yaks/blob's keyword — the text is swapped for its address on
//               the way in and back on the way out, and neither `doc` nor the
//               app is told.
//   created     the byline and the clock, both server-owned. @yaks/graph's
//   updated     stamp phase is their only writer, and it writes whichever of
//               `at`/`by`/`via` the vocabulary declares.
//   person      the writer a store mints the first time it meets one
//               (store.ts `knows`) — what `created.by` points at.
//   memberDoc   @yaks/member: who belongs to a space, what they may touch.
//   edgeDoc     @yaks/edge: the link itself, `edge{from, to, ord}`.
//   relationDoc the twelve verbs an edge may WEAR. @yaks/edge ships the link
//               and not one relation, because which relations exist is the
//               application's word — so the platform says its twelve here,
//               through that package's `relation` keyword. They are core and
//               not an app's own: the guide teaches this list to every app,
//               every store already holds rows under these names, and a word
//               means the same thing in every store — so they are reserved
//               like the rest of the core (T-33810).
// @yaks/id's `prefix` keyword is registered rather than used: a component may
// declare the letter its entities are numbered in, and the loader carries it.
//
// And the app's own `vocab.json`, in EITHER spelling. The format is JSON
// Schema now (D-33490 gate 3), and the five-scalar short form every app
// deployed before it still deploys: a short-form manifest is CONVERTED here,
// never refused, because those files exist and their rows are already written
// (Jeff, 2026-09-05: "there are a few users! can't just drop"). The two
// spellings load to the same vocabulary.
import {
  CORE_URI,
  type Keywords,
  loadVocab,
  type PropSchema,
  reserved,
  storable,
  type Vocab,
  type VocabDoc,
} from '@yaks/vocab'
import { BLOB_URI, blobKeywords } from '@yaks/blob'
import { EDGE_URI, edgeDoc, edgeKeywords } from '@yaks/edge'
import { idKeywords } from '@yaks/id'
import { memberDoc } from '@yaks/member'

/** The components every app's store has, whatever it declares of its own. */
export let coreDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true, [BLOB_URI]: true },
  title: 'core',
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string', store: 'blob' },
      },
    },
    person: { type: 'object', kind: true, before: ['doc'], properties: {} },
    created: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
        via: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
    updated: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
        by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
        via: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
      },
    },
  },
}

/**
 * The verbs an edge may wear, in the wire's own spelling — the list the guide
 * teaches, and the only types a store makes an edge for. Note `referenced`,
 * never `references`.
 */
export let RELATIONS: string[] = [
  'requires',
  'contains',
  'reads',
  'about',
  'supervises',
  'delegates',
  'recalled',
  'supersedes',
  'worked',
  'referenced',
  'wants',
  'satisfies',
]

/** Those verbs as one vocabulary document: a bare tag component each, saying
 * `relation` about itself so @yaks/edge reads it off the loaded vocabulary. */
export let relationDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true, [EDGE_URI]: true },
  title: 'relations',
  $defs: Object.fromEntries(
    RELATIONS.map((name) => [name, {
      type: 'object',
      relation: true,
      properties: {},
    }]),
  ),
}

/** The documents an app's vocabulary is built on, in load order. */
export let coreDocs: VocabDoc[] = [coreDoc, memberDoc, edgeDoc, relationDoc]

/** The keyword vocabularies those documents and an app's own may use. Each is
 * owned by the package that reads it — @yaks/id `prefix`, @yaks/blob `store`,
 * @yaks/edge `relation` — and registered so the loader carries it. */
export let appKeywords: Keywords[] = [idKeywords, blobKeywords, edgeKeywords]

/** Every word the platform already says in an app's store, sorted. A
 * `vocab.json` naming one is refused: a word means the same thing everywhere. */
export let RESERVED: string[] = [
  ...new Set(coreDocs.flatMap((d) => Object.keys(d.$defs ?? {}))),
].sort()

/** What a `vocab.json` looks like, for a refusal that teaches. */
export let EXAMPLE =
  '{"$defs": {"recipe": {"type": "object", "properties": {"serves": ' +
  '{"type": "number"}}}}}'

// The five words a short-form manifest spells, and the JSON Schema each is.
// This is the whole of the old format: one component per key, one typed column
// per entry, nothing around it.
let SHORT: Record<string, PropSchema> = {
  text: { type: 'string' },
  number: { type: 'number' },
  bool: { type: 'boolean' },
  time: { type: 'string', format: 'date-time' },
  url: { type: 'string', format: 'uri' },
}

let object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

let propOf = (comp: string, col: string, type: unknown): PropSchema => {
  let s = typeof type == 'string' ? SHORT[type] : undefined
  if (!s) {
    throw new Error(
      `vocab.json: ${comp}.${col} is ${JSON.stringify(type)} — one of ${
        Object.keys(SHORT).join(', ')
      }`,
    )
  }
  return { ...s }
}

// One short-form component. It becomes a KIND sorting before `doc`, because an
// app's own word is the most specific thing said about a row: an entity wearing
// `recipe` is a recipe, not the `doc` it also wears for its title.
let compOf = (name: string, cols: unknown): PropSchema => {
  if (!object(cols)) {
    throw new Error(`vocab.json: ${name} is an object of columns — ${EXAMPLE}`)
  }
  return {
    type: 'object',
    kind: true,
    before: ['doc'],
    properties: Object.fromEntries(
      Object.entries(cols).map(([col, t]) => [col, propOf(name, col, t)]),
    ),
  }
}

/**
 * The five-scalar short form, as the JSON Schema document it means:
 * `{"recipe": {"serves": "number"}}` → a `$defs.recipe` object schema whose
 * `serves` property is `{"type": "number"}`. `text` → string, `number` →
 * number, `bool` → boolean, `time` → string/date-time, `url` → string/uri.
 *
 * The result is the APP half of a load — its components sort before `doc`, so
 * it is loaded beside {@link coreDocs}, never alone.
 */
export let schemaOf = (manifest: Record<string, unknown>): VocabDoc => ({
  $vocabulary: { [CORE_URI]: true },
  title: 'app',
  $defs: Object.fromEntries(
    Object.entries(manifest).map(([name, cols]) => [name, compOf(name, cols)]),
  ),
})

/**
 * An app's `vocab.json` as one document, whichever spelling it was written in:
 * JSON Schema passes through, the short form is converted. The two are told
 * apart by SHAPE — a JSON Schema document declares a `$` keyword (`$defs`,
 * `$schema`, `$id`), and a manifest of bare component names cannot.
 *
 * It is checked here rather than at the load: a name the platform already owns
 * is refused, and so is anything a column cannot hold.
 */
export let appDoc = (source: unknown): VocabDoc => {
  let held = source
  if (typeof held == 'string') {
    try {
      held = held.trim() ? JSON.parse(held) : {}
    } catch {
      throw new Error(`vocab.json is not JSON — ${EXAMPLE}`)
    }
  }
  if (held == null) held = {}
  if (!object(held)) throw new Error(`vocab.json is an object — ${EXAMPLE}`)
  let doc = Object.keys(held).some((k) => k.startsWith('$'))
    ? held as VocabDoc
    : schemaOf(held)
  let errs = [...reserved(doc, RESERVED), ...storable(doc)]
  if (errs.length) throw new Error(`vocab.json: ${errs.join('; ')}`)
  return doc
}

/**
 * One app's whole vocabulary: the core documents plus its own `vocab.json`,
 * loaded into the `Vocab` a Store reads its DDL, routing and admission out of.
 * The source is the file as written — text or parsed, either spelling — and an
 * app that declares nothing gets the core alone.
 */
export let appVocab = (source: unknown = {}): Vocab =>
  loadVocab([...coreDocs, appDoc(source)], appKeywords)
