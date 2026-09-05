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
//               (graph.ts `#vouching`) — what `created.by` points at.
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
import { mailDoc } from '@yaks/mail'
import { memberDoc } from '@yaks/member'

// The column shapes these documents are written out of. A `ref` names another
// entity and says what happens to this row when that one dies; `owned` is
// `stamped` — readable, never wire-writable, the kernel's own door the only
// writer.
let ref = (death: string, bare = true): PropSchema => ({
  type: 'string',
  ref: 'entity',
  death,
  ...(bare ? {} : { bare: false }),
})
let text: PropSchema = { type: 'string' }
let num: PropSchema = { type: 'number' }
let time: PropSchema = { type: 'string', format: 'date-time' }
let owned = (s: PropSchema): PropSchema => ({ ...s, stamped: true })
// No two rows of the component may share this value — the uniqueness a race is
// decided by, said on the column when it is one column (a composite is said on
// the component, `unique: [['space', 'slug']]`).
let unique = (s: PropSchema): PropSchema => ({ ...s, unique: true })

// A STAMP's three columns: when, by whom, through what. `created`, `updated`
// and every mark a served or fixed row wears are the same three words.
let stampCols: Record<string, PropSchema> = {
  at: owned(time),
  by: owned(ref('keep')),
  via: owned(ref('keep')),
}

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
    created: { type: 'object', properties: stampCols },
    updated: { type: 'object', properties: stampCols },
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

/**
 * What the PLATFORM says in an app's store that the app never asked for: the
 * breaks it noted there, the marks a served or fixed item wears, and the two
 * rows an upload makes. They are core rather than an app's own for the same
 * reason the relations are — every store already holds rows under these names,
 * `app_errors` and the unseen block read them by these names in every app, and
 * a word means the same thing everywhere.
 *
 * The server-owned ones are `stamped`: an `exception` is the platform's word
 * about the app's own code, and the kernel's door (`x-yak-kernel`, graph.ts) is
 * its only writer. The MARKS are stamped too and written bare — `notified: {}`
 * says the thing without saying a column.
 *
 * Their columns are the fleet's own (src/vocab/manifests/kernel.json,
 * comms.json), so a row written through the old store means exactly what a row
 * written through this one means.
 */
export let kernelDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: 'kernel',
  $defs: {
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
    // A known failure state the platform reports deliberately, as against a
    // break nobody chose. `app_errors` reads both facets in every store, so
    // both are declared in every store.
    error: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: { at: owned(time), message: owned(text) },
    },
    archived: { type: 'object', properties: stampCols },
    opened: { type: 'object', properties: stampCols },
    quarantined: { type: 'object', properties: stampCols },
    // The two rows a page's upload makes (apps.ts `took`): the CONTENT,
    // addressed by its sha, and the USE of it, addressed off that. They stay
    // apart because they are two things, and because a component may not point
    // at its own entity.
    blob: { type: 'object', properties: { bytes: num } },
    image: { type: 'object', properties: { w: num, h: num } },
    attachment: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: { blob: ref('cascade'), mime: text, name: text },
    },
  },
}

/**
 * The one mark with two homes: `notified{at, by, via}`, which @yaks/mail also
 * declares. An app's store takes the word from that package (see
 * {@link coreDocs}) because an app has a mailbox; the directory has none, so it
 * declares the word here instead. A vocabulary refuses a component declared
 * twice, and both stores need the mark — the unseen block reads it in every
 * one of them — so the word has one home in each rather than one home overall.
 */
export let notifiedDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: 'notified',
  $defs: { notified: { type: 'object', properties: stampCols } },
}

/** Where the whole of it is written, and what an app's store says when it is
 * asked for a word nobody declared — the same sentence at the write door and
 * the read door, because it is the same missing act. The fleet's own store
 * says it too (src/store/vocab.ts `TEACH`); it is spelled again here because
 * the Store carries the packages' vocabulary and never the fleet's. */
export let GUIDE = 'https://yaks.app/guide.md'
export let TEACH = ' — a component of your own is declared in vocab.json ' +
  'and planted by app_deploy: ' +
  '{"recipe": {"title": "text", "serves": "number"}} · call guide with page ' +
  `components, or ${GUIDE}`

/**
 * The words the platform gives every app to reach for rather than invent
 * (public/guide/components.md §The platform's vocabulary): a state, the two
 * marks that end one, a thing work belongs to, a note aimed at anything, a
 * star, and an address out on the web. They mean the same thing in every store
 * on the platform, which is the whole reason they are the platform's and not
 * each app's own — a `task` in one app is the same word as a `task` in the
 * next, so one filter reads both.
 *
 * Their columns are the fleet contract's own (src/types.ts), so a row written
 * through the old store means what a row written through this one means.
 */
export let appsDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: 'apps',
  $defs: {
    task: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        priority: num,
        project: ref('detach'),
        assignee: ref('detach'),
        domain: text,
        // READ, never written: what the entity WEARS says its state, so a
        // task is done because it wears `completed`, not because a column was
        // set to a word. `persist: false` says there is no column at all;
        // {@link appDerived} is the expression that reads it.
        status: {
          enum: ['open', 'wip', 'done', 'cancelled'],
          persist: false,
        },
      },
    },
    // The two marks that end a task. Both are the store's to fill — the clock
    // from the write, the writer from whoever is asking — so `completed: {}`
    // is the whole write, and `completed: null` opens it again.
    completed: { type: 'object', properties: stampCols },
    cancelled: {
      type: 'object',
      properties: { ...stampCols, reason: text },
    },
    project: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: { color: text },
    },
    comment: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: { target: ref('cascade') },
    },
    favorite: { type: 'object', properties: { at: owned(time) } },
    web: {
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri' },
        frozen_at: owned(time),
      },
    },
  },
}

/**
 * The columns a store READS rather than stores, as the SQL that reads them
 * (@yaks/sql `Derived`). One today: a task's `status`, which is what the entity
 * wears. There is no `claim` in an app's store, so `wip` never happens here —
 * the word is declared because the platform's status grammar is one grammar,
 * and a filter that names it must still parse.
 */
export let appDerived = (): Record<
  string,
  { tag: 'text'; values: string[]; expr: (owner: string) => string }
> => ({
  'task.status': {
    tag: 'text',
    values: ['open', 'wip', 'done', 'cancelled'],
    // The owner is NULL where the row wears no `task` at all — a filter joins
    // the component table on the left so absence is askable — and a status is
    // a fact about a task, so there it is null rather than `open`. Without that
    // first arm every entity in the store answers `.task.status=open`.
    expr: (owner) =>
      `(case when ${owner} is null then null ` +
      `when exists (select 1 from "cancelled" where ` +
      `"cancelled"."entity" = ${owner}) then 'cancelled' ` +
      `when exists (select 1 from "completed" where ` +
      `"completed"."entity" = ${owner}) then 'done' else 'open' end)`,
  },
})

/** The documents an app's vocabulary is built on, in load order.
 *
 * `mailDoc` is among them because every app has a mailbox (T-33686): a letter
 * is an entity here like anywhere else, and the same six words say the one it
 * sends and the one that arrives. It brings `notified` with it, which is why
 * {@link kernelDoc} does not. */
export let coreDocs: VocabDoc[] = [
  coreDoc,
  docDoc,
  memberDoc,
  edgeDoc,
  relationDoc,
  kernelDoc,
  appsDoc,
  mailDoc,
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
// `owner|member` — belonging, with access spelled as a grant or the app's mode
// — and the platform's roster IS its access ladder, three seats
// (`owner|editor|viewer`) read space-wide by apps.ts, so the word is declared
// here at the platform's own meaning. A door that can address BOTH stores
// therefore types that column nowhere ({@link PLATFORM_APART}). Nothing
// installs @yaks/member's guard on this store either: the
// kernel decides who may read and write the directory before the request
// reaches the object (directory.ts), and there is no app to be a member OF.

/** The store the directory lives in, named the way every app's store is. Its
 * slugs are the platform's own and never move, so the name is a constant. */
export let PLATFORM_STORE = 'yak/platform'

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
 *
 * The `unique` words are the directory's races, decided in the engine: two
 * isolates minting the space `ada` at once must not both win, one hostname
 * points at one app, and an offer's name is the platform-wide handle it is
 * installed by. @yaks/sqlite raises the index from the declaration; the losing
 * write bounces, re-reads, and finds the winner (directory.ts `own`).
 */
export let platformDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: 'platform',
  $defs: {
    space: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: { slug: unique(text), home: ref('detach') },
    },
    app: {
      type: 'object',
      kind: true,
      before: ['doc'],
      unique: [['space', 'slug']],
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
    alias: { type: 'object', properties: { slug: unique(text), slugs: text } },
    // The home app as the space's router (D-34197): the paths its worker sees
    // FIRST, before the app whose slug owns them. It is the APP's facet and not
    // the space's, because `space.home` already says which app is home and two
    // spellings of one fact would drift.
    //
    // A column is a scalar (@yaks/vocab `storable`), so the list is JSON in one
    // text column — ordered, and read back by router.ts `firstOf`. `alias.slugs`
    // splits on whitespace instead, which is the older spelling of a list here;
    // JSON is the one that round-trips exactly what an agent passed.
    router: { type: 'object', properties: { first: text } },
    member: {
      type: 'object',
      kind: true,
      before: ['doc'],
      unique: [['space', 'person']],
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
        name: unique(text),
        app: ref('cascade'),
        stage: { enum: ['pending', 'active', 'error'] },
        at: time,
      },
    },
    deploy: {
      type: 'object',
      kind: true,
      before: ['doc'],
      unique: [['app', 'version']],
      properties: {
        app: ref('cascade'),
        version: num,
        files: text,
        worker: text,
      },
    },
    published: {
      type: 'object',
      properties: { name: unique(text), version: num, at: time, about: text },
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
    // What the hourly sweep read off Cloudflare (usage.ts). Written by the
    // sweep, through the kernel's door — and NOT stamped, because the fleet
    // contract does not stamp it (src/types.ts `comps`) and the meta space's
    // own graph tier is how a reading is planted or corrected by hand. Nobody
    // but an owner of `yak` reaches that door at all (directory.ts), which is
    // what keeps a customer from writing their own bill.
    meter: {
      type: 'object',
      properties: {
        month: text,
        requests: num,
        rows_read: num,
        rows_written: num,
        bytes: num,
        emails: num,
        builds: num,
        tokens: num,
        built: num,
        at: time,
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
  },
}

/** The documents the directory's vocabulary is built on, in load order.
 *
 * `kernelDoc` is among them for the same reason it is among an app's: the
 * platform notes its own breaks where it notes an app's, `app_errors` and the
 * unseen block read every store the caller can reach by the same words, and a
 * mark spelled `archived` here and nowhere else would make the directory the
 * one store those doors cannot answer for. */
export let platformDocs: VocabDoc[] = [
  coreDoc,
  docDoc,
  edgeDoc,
  relationDoc,
  kernelDoc,
  notifiedDoc,
  platformDoc,
]

/**
 * The directory's whole vocabulary: the core documents plus the platform's own
 * words. The Store loads it instead of {@link appVocab} when the object it woke
 * in is the meta store (graph.ts).
 */
export let platformVocab = (): Vocab => loadVocab(platformDocs, appKeywords)

// What a column ADMITS, as a comparison makes it: the closed set, or the type.
// The same rule reach.ts `colsOf` holds two spaces to.
let shapeOf = (s: PropSchema): string =>
  s.enum ? s.enum.join('|') : String(s.type ?? '?')

/**
 * The columns the DIRECTORY spells at the platform's own meaning while every
 * app store spells them at a package's — today `member.role` alone: three
 * seats here ({@link platformDoc}) against @yaks/member's two, because the
 * platform's roster IS its access ladder and the package keeps belonging and
 * access apart.
 *
 * One name meaning two things is two words. A door whose reach holds the
 * directory AND an app therefore types these nowhere and leaves the answer to
 * the store the bundle lands in (agent.ts `spoken`, `reading`) — the same rule
 * a word two SPACES spell differently already gets (reach.ts `apartIn`).
 *
 * Derived rather than listed, so a platform column that starts disagreeing
 * cannot quietly be typed as the package's.
 */
export let PLATFORM_APART: string[] = (() => {
  let core: Record<string, PropSchema> = {}
  for (let d of coreDocs) Object.assign(core, d.$defs ?? {})
  let out: string[] = []
  for (let [name, mine] of Object.entries(platformDoc.$defs ?? {})) {
    let theirs = core[name]?.properties
    if (!theirs) continue
    for (let [col, s] of Object.entries(mine.properties ?? {})) {
      if (theirs[col] && shapeOf(theirs[col]) != shapeOf(s)) {
        out.push(`${name}.${col}`)
      }
    }
  }
  return out
})()

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
// The short word a declared column is spelled with, for the inverse below and
// for a refusal that says what a column already is. A column no short word
// spells reads as `text`, which is what it stores as.
let wordOf = (s: PropSchema): string =>
  Object.entries(SHORT).find(([, one]) =>
    one.type == s.type && one.format == s.format
  )?.[0] ?? 'text'

/**
 * The inverse of {@link schemaOf}: a document as the five-scalar short form.
 * That is the one spelling a store ANSWERS its own words in — the kernel reads
 * an app's vocabulary as `{comp: {col: type}}` whichever way it was declared
 * (tools.ts `vocabs`, reach.ts `spoken`) — while a POST takes either.
 */
export let shortOf = (doc: VocabDoc): Record<string, Record<string, string>> =>
  Object.fromEntries(
    Object.entries(doc.$defs ?? {}).map(([name, schema]) => [
      name,
      Object.fromEntries(
        Object.entries(schema.properties ?? {}).map((
          [col, s],
        ) => [col, wordOf(s)]),
      ),
    ]),
  )

/**
 * The manifest a store KEEPS after a deploy: columns only ever arrive. A column
 * the new manifest stopped naming stays declared — its rows are still there —
 * and one whose type changed is refused, because the values already stored were
 * written under the old word.
 *
 * A whole COMPONENT the manifest stopped naming is the one thing that may
 * leave, and only when it holds nothing: a name tried once and abandoned is a
 * probe's leftover, not data (C-32624 item 1). `rows` counts what a component
 * holds — the store's question, since only it has the tables.
 *
 * It also says WHAT MOVED, because additive growth is silent where it matters
 * most: rename a column and the manifest reads as one word while the store
 * holds two, the old one still under every row already written (C-32652 item
 * 4). `added` is every column this manifest planted; `kept` is every column the
 * store still declares that this manifest did not name.
 */
export let grew = (
  was: VocabDoc,
  next: VocabDoc,
  rows: (name: string) => number = () => 1,
): {
  doc: VocabDoc
  dropped: string[]
  added: string[]
  kept: string[]
} => {
  let mine = was.$defs ?? {}
  let theirs = next.$defs ?? {}
  let dropped = Object.keys(mine).filter((n) => !(n in theirs) && !rows(n))
  let defs: Record<string, PropSchema> = { ...mine }
  let added: string[] = []
  for (let name of dropped) delete defs[name]
  for (let [name, schema] of Object.entries(theirs)) {
    let props: Record<string, PropSchema> = { ...mine[name]?.properties }
    for (let [col, s] of Object.entries(schema.properties ?? {})) {
      let had = props[col]
      if (had && (had.type != s.type || had.format != s.format)) {
        throw new Error(
          `vocab.json: ${name}.${col} is already ${wordOf(had)} — a column ` +
            'keeps the type its rows were written under',
        )
      }
      if (!had) added.push(`${name}.${col}`)
      props[col] = s
    }
    defs[name] = { ...schema, properties: props }
  }
  let kept = Object.entries(defs).flatMap(([name, s]) =>
    Object.keys(s.properties ?? {})
      .filter((col) => !(col in (theirs[name]?.properties ?? {})))
      .map((col) => `${name}.${col}`)
  )
  return { doc: { ...next, $defs: defs }, dropped, added, kept }
}

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
