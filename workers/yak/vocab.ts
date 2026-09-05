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
//   docDoc      @yaks/doc: title and body, the words a person reads and the
//               only thing search searches. `body` says `store: "blob"`, which
//               is @yaks/blob's keyword — the text is swapped for its address
//               on the way in and back on the way out, and neither `doc` nor
//               the app is told.
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
import { blobKeywords } from '@yaks/blob'
import { docDoc } from '@yaks/doc'
import { EDGE_URI, edgeDoc, edgeKeywords } from '@yaks/edge'
import { idKeywords } from '@yaks/id'
import { memberDoc } from '@yaks/member'

/** The components every app's store has that no package owns: the spine, the
 * writer, and the two server-owned stamps. `doc` is @yaks/doc's, `member`
 * @yaks/member's, and both are loaded beside this one (see {@link coreDocs}). */
export let coreDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: 'core',
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
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
export let coreDocs: VocabDoc[] = [
  coreDoc,
  docDoc,
  memberDoc,
  edgeDoc,
  relationDoc,
]

// ---- the platform's own store (T-33814) -------------------------------------
//
// One object on this platform is not an app: the DIRECTORY, the meta space's
// store, named `yak/platform` and holding every space, app, member, hostname,
// deploy, sign-in and meter there is. It runs the same Store class over the
// same packages; what differs is the VOCABULARY it wakes with — these words
// instead of an app's `vocab.json`.
//
// It does not load @yaks/member's document. That package's `member.role` is
// `owner|member`, and the platform's roster has three seats
// (`owner|editor|viewer`), so the word is declared here at the platform's own
// meaning. Nothing installs @yaks/member's guard on this store either: the
// kernel decides who may read and write the directory before the request
// reaches the object (directory.ts), and there is no app to be a member OF.

/** The store the directory lives in, named the way every app's store is. Its
 * slugs are the platform's own and never move, so the name is a constant. */
export let PLATFORM_STORE = 'yak/platform'

let ref = (death: string, bare = true): PropSchema => ({
  type: 'string',
  ref: 'entity',
  death,
  ...(bare ? {} : { bare: false }),
})
let text: PropSchema = { type: 'string' }
let num: PropSchema = { type: 'number' }
let time: PropSchema = { type: 'string', format: 'date-time' }
// Server-owned: readable, never wire-writable. The kernel's own door writes it.
let owned = (s: PropSchema): PropSchema => ({ ...s, stamped: true })

/**
 * The platform's own components — what the directory IS, as one JSON Schema
 * document. Every word here is the fleet contract's own (src/types.ts) read
 * back in the format @yaks/vocab loads: the same columns, the same closed sets,
 * the same death behaviour, so a row written through the old store means
 * exactly what a row written through this one means.
 *
 * The server-owned ones are `stamped`: a `plan` nobody may lift for themselves,
 * a `signin` no client may author, a `meter` the hourly sweep reads off
 * Cloudflare, an `exception` the platform noted about itself. They stay
 * readable, and the kernel's own door (`x-yak-kernel`, graph.ts) is the only
 * writer.
 */
export let platformDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: 'platform',
  $defs: {
    space: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: { slug: text, home: ref('detach') },
    },
    app: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        slug: text,
        space: ref('cascade'),
        version: num,
        access: { enum: ['public', 'open', 'private'] },
      },
    },
    // Every address an app has answered at: the one it was born at — which is
    // what its Durable Object is named, so it may never move — and, in
    // `slugs`, each one a rename left behind.
    alias: { type: 'object', properties: { slug: text, slugs: text } },
    member: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        space: ref('cascade'),
        person: ref('cascade', false),
        role: { enum: ['owner', 'editor', 'viewer'] },
      },
    },
    email: { type: 'object', properties: { address: text } },
    hostname: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        name: text,
        app: ref('cascade'),
        stage: { enum: ['pending', 'active', 'error'] },
        at: time,
      },
    },
    deploy: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        app: ref('cascade'),
        version: num,
        files: text,
        worker: text,
      },
    },
    published: {
      type: 'object',
      properties: { name: text, version: num, at: time, about: text },
    },
    installed: {
      type: 'object',
      properties: { of: ref('detach'), version: num },
    },
    plan: {
      type: 'object',
      properties: {
        tier: owned({ enum: ['free', 'plus'] }),
        customer: owned(text),
        subscription: owned(text),
        status: owned(text),
        until: owned(time),
        ending: owned(time),
        at: owned(time),
      },
    },
    meter: {
      type: 'object',
      properties: {
        month: owned(text),
        requests: owned(num),
        rows_read: owned(num),
        rows_written: owned(num),
        bytes: owned(num),
        emails: owned(num),
        at: owned(time),
      },
    },
    // The mark a served line wears. Server-owned like the fleet's, and a bare
    // presence in practice: the sweep writes it, and clears it (`notified:
    // null`) when a space's standing moves.
    notified: {
      type: 'object',
      properties: {
        at: owned(time),
        by: owned(ref('keep')),
        via: owned(ref('keep')),
      },
    },
    signin: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        email: owned(text),
        code: owned(text),
        expires: owned(time),
        tries: owned(num),
      },
    },
    report: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        app: ref('keep'),
        space: ref('keep'),
        version: num,
        release: text,
        at: time,
      },
    },
    exception: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        at: owned(time),
        request: owned(text),
        version: owned(num),
        message: owned(text),
        stack: owned(text),
      },
    },
  },
}

/** The documents the directory's vocabulary is built on, in load order. */
export let platformDocs: VocabDoc[] = [
  coreDoc,
  docDoc,
  edgeDoc,
  relationDoc,
  platformDoc,
]

/**
 * The uniques the directory's races are decided by. @yaks/sqlite derives tables
 * and columns from a vocabulary and no indexes, so the platform says its own:
 * two isolates minting the space `ada` at once must not both win, one hostname
 * points at one app, and an offer's name is the platform-wide handle it is
 * installed by. The losing write bounces, re-reads, and finds the winner
 * (directory.ts `own`).
 */
export let PLATFORM_INDEXES: string[] = [
  'create unique index if not exists space_slug on "space" ("slug")',
  'create unique index if not exists app_space_slug on "app" ("space", "slug")',
  'create unique index if not exists alias_slug on "alias" ("slug")',
  'create unique index if not exists member_space_person on "member" ' +
  '("space", "person")',
  'create unique index if not exists hostname_name on "hostname" ("name")',
  'create unique index if not exists deploy_app_version on "deploy" ' +
  '("app", "version")',
  'create unique index if not exists published_name on "published" ("name")',
]

/**
 * The directory's whole vocabulary: the core documents plus the platform's own
 * words. The Store loads it instead of {@link appVocab} when the object it woke
 * in is the meta store (graph.ts).
 */
export let platformVocab = (): Vocab => loadVocab(platformDocs, appKeywords)

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
