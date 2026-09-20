import { archetypeDoc } from '@yaks/archetype'
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
// And the app's own `vocab.json` — or `vocab.yml`, read through the same door
// (@yaks/yaml, M-34605). It is a JSON Schema 2020-12 document with `$defs`
// (D-33490 gate 3), the same shape every `packages/*/vocab.json` is written in,
// and it is the ONE spelling: a keyword belongs to the column — `search`,
// `stamped`, a reference's `death` — and a manifest flattened to bare type
// words could not carry one (T-37546).
import { type Host, url } from './host.ts'
import {
  CORE_URI,
  type Keywords,
  loadVocab,
  type PropSchema,
  storable,
  type Vocab,
  type VocabDoc,
} from '@yaks/vocab'
import { aliasDoc } from '@yaks/alias'
import { blobKeywords } from '@yaks/blob'
import { docDoc } from '@yaks/doc'
import { EDGE_URI, edgeDoc, edgeKeywords } from '@yaks/edge'
import { gitDoc } from '@yaks/git'
import { idKeywords } from '@yaks/id'
import { keyDoc, keyKeywords } from '@yaks/key'
import { mailDoc } from '@yaks/mail'
import { memberDoc } from '@yaks/member'
import { toolsDoc } from '@yaks/tools'
import { wakeDoc } from '@yaks/wake'
import { read } from '@yaks/yaml'
import { RESERVED as FLEET } from '../../src/store/vocab.ts'
import { vocabOf } from './plugin.ts'
import { PLUGINS } from './plugins.ts'
import { sweepDoc } from './wake.ts'

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
let bool: PropSchema = { type: 'boolean' }
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
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    person: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {},
    },
    created: {
      component: true,
      type: 'object',
      properties: stampCols,
    },
    updated: {
      component: true,
      type: 'object',
      properties: stampCols,
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
      component: true,
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
      component: true,
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
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      // `code` is @yaks/tools' half of this word: what a refused CALL says
      // about itself, written by the runner rather than stamped by the
      // platform. One word, both meanings, so a store never has to choose.
      properties: { at: owned(time), message: owned(text), code: text },
    },
    archived: {
      component: true,
      type: 'object',
      properties: stampCols,
    },
    opened: {
      component: true,
      type: 'object',
      properties: stampCols,
    },
    quarantined: {
      component: true,
      type: 'object',
      properties: stampCols,
    },
    // The two rows a page's upload makes (apps.ts `took`): the CONTENT,
    // addressed by its sha, and the USE of it, addressed off that. They stay
    // apart because they are two things, and because a component may not point
    // at its own entity.
    blob: {
      component: true,
      type: 'object',
      properties: { bytes: num },
    },
    image: {
      component: true,
      type: 'object',
      properties: { w: num, h: num },
    },
    attachment: {
      component: true,
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
  $defs: {
    notified: {
      component: true,
      type: 'object',
      properties: stampCols,
    },
  },
}

/** What a `vocab.json` looks like, for a refusal that teaches. */
export let EXAMPLE =
  '{"$defs": {"recipe": {"properties": {"serves": {"type": "number"}}}}}'

/** Where the whole of it is written, and what an app's store says when it is
 * asked for a word nobody declared — the same sentence at the write door and
 * the read door, because it is the same missing act. The fleet's own store
 * says it too (src/store/vocab.ts `TEACH`); it is spelled again here because
 * the Store carries the packages' vocabulary and never the fleet's. */
export let GUIDE = url({}, '/guide.md')
export let teach = (env: Host = {}) =>
  ' — a component of your own is declared in vocab.json ' +
  'and planted by app_deploy: ' +
  `${EXAMPLE} · call guide with page ` +
  `components, or ${url(env, '/guide.md')}`
export let TEACH = teach()

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
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        // READ, never written: what the entity WEARS says its state, so a
        // task is done because it wears `completed`, not because a column was
        // set to a word. `computed: true` says there is no column at all;
        // {@link appDerived} is the expression that reads it.
        status: {
          enum: ['open', 'wip', 'done', 'cancelled'],
          computed: true,
        },
      },
    },
    filed: {
      component: true,
      type: 'object',
      properties: {
        priority: num,
        project: ref('detach'),
        assignee: ref('detach'),
        domain: text,
      },
    },
    // The two marks that end a task. Both are the store's to fill — the clock
    // from the write, the writer from whoever is asking — so `completed: {}`
    // is the whole write, and `completed: null` opens it again.
    completed: {
      component: true,
      type: 'object',
      properties: stampCols,
    },
    cancelled: {
      component: true,
      type: 'object',
      properties: { ...stampCols, reason: text },
    },
    project: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: { color: text },
    },
    comment: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: { target: ref('cascade') },
    },
    // Something for sale (sell.ts, T-34525). Platform's rather than each app's
    // for the reason every other word here is platform's — a `product` in one
    // shop is the same word as a `product` in the next, so one filter reads
    // both — and for one more: the CHECKOUT DOOR reads `price_cents` off this
    // row, and a door that took the price off the wire would take a price a
    // buyer can edit. A word the platform charges money against is a word the
    // platform declares.
    //
    // `sizes` is the variants the seller offers, comma-separated, and what a
    // page turns into the `options` on a cart line. `stock` is the seller's own
    // count — nothing here decrements it, because a shop that oversells by one
    // is a conversation and a shop that loses an order to a race is a bug.
    product: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        price_cents: num,
        sizes: text,
        stock: num,
        image: { type: 'string', format: 'uri' },
      },
    },
    // Something SOLD (sell.ts, T-34526): one row per completed Stripe
    // checkout, written into the app's own store by the Connect webhook, as
    // the app. Platform's rather than each app's for the reason `product` is:
    // the platform writes it, and a word the platform writes is a word the
    // platform declares — an app that spelled its own `order` would have the
    // platform writing into a shape it does not know.
    //
    // It is the WHOLE record of a sale on this side. The money itself is
    // Stripe's: `session` and `intent` are how a seller finds it there, and
    // `account` says whose books it landed on. Nothing here is authoritative
    // about the payment — Stripe is — and the row exists so the seller knows
    // what to put in the box and who to post it to.
    //
    // `items` is the cart as JSON in one text column, the way `home.first`
    // is; a column is a scalar, and this is a list.
    order: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        session: text,
        intent: text,
        account: text,
        items: text,
        total_cents: num,
        fee_cents: num,
        email: text,
        status: { enum: ['paid', 'refunded', 'disputed'] },
      },
    },
    favorite: {
      component: true,
      type: 'object',
      properties: { at: owned(time) },
    },
    web: {
      component: true,
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
 * {@link kernelDoc} does not.
 *
 * `keyDoc` and `aliasDoc` are among them because a NAME is how an agent
 * addresses a row it wrote last week without having kept the eid (T-34390).
 * @yaks/key's `key{of, value}` is the carrier — a value an entity answers to,
 * as an entity of its own, named after what it says — and `alias` is the kind
 * of value that is a name. They are core rather than each app's own for the
 * reason every other core word is: a word means the same thing in every
 * store. */
/** Derived classification metadata is readable but never client-authored. */
export const classificationDoc: VocabDoc = {
  ...archetypeDoc,
  $defs: Object.fromEntries(
    Object.entries(archetypeDoc.$defs ?? {}).map(
      ([name, definition]) => [name, { ...definition, wire: false }],
    ),
  ),
}

/**
 * The words an INVOCATION is made of (@yaks/tools): what was asked, what came
 * back, the claim in between, and the tool a call names. Every store speaks
 * them, because asking is a ROW here — and a row is the only thing that can
 * wait: a `call` wearing a `wake` is work asked for later (D-37562), and the
 * store that will run it is the store that has to hold it.
 *
 * `error` and `exception` are left out: both vocabularies spell them, the
 * platform's are the ones a break page reads, and the one column @yaks/tools
 * adds (`error.code`) is declared on the platform's above.
 */
let invocationDoc: VocabDoc = {
  title: 'invocation',
  $defs: Object.fromEntries(
    Object.entries(toolsDoc.$defs ?? {}).filter(
      ([name]) => name != 'error' && name != 'exception',
    ),
  ),
}

export let coreDocs: VocabDoc[] = [
  coreDoc,
  classificationDoc,
  docDoc,
  memberDoc,
  edgeDoc,
  relationDoc,
  kernelDoc,
  appsDoc,
  mailDoc,
  keyDoc,
  aliasDoc,
  invocationDoc,
  // A schedule is every store's word now (D-37562): an app writes `wake{at}`
  // on anything it means to come back to, its Durable Object arms its own
  // alarm for the earliest one (graph.ts), and what the firing MEANS is left
  // to the app's own rules on `fired`. The directory's sweeps are the same
  // rows in the same shape.
  wakeDoc,
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
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: { slug: unique(text) },
    },
    app: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      unique: [['space', 'slug']],
      properties: {
        slug: text,
        space: ref('cascade'),
        version: num,
        access: { enum: ['public', 'open', 'private'] },
        // The app's HANDLE: what its Durable Object, its dispatch script, its
        // R2 export path and its analytics rows are named by (directory.ts
        // `storeName`). Written once at birth and never read as an address —
        // `<space>/<app>.<6 hex of the eid>`, so the Cloudflare dashboard still
        // sorts it under its space and reads as the app it is, and so two apps
        // that hold one address a year apart are still two objects. Unique
        // by construction, and the index is what makes that true rather than
        // hoped for (T-34657).
        store: unique(text),
      },
    },
    // Storage survives config edits and renames. Only the kernel may record
    // account resource ids, so an app cannot claim another tenant's data.
    binding: {
      component: true,
      type: 'object',
      unique: [['app', 'name', 'type'], ['type', 'resource']],
      properties: {
        app: owned(ref('cascade')),
        name: owned(text),
        type: owned({ enum: ['d1', 'r2_bucket', 'vectorize'] }),
        id: owned(text),
        resource: owned(text),
      },
    },
    // Every address an app has answered at, oldest first: `slug` the one it was
    // born at, `slugs` each one a rename left behind. ADDRESS HISTORY and
    // nothing else — the handle it is stored under is `app.store` above, which
    // is why a rename moves an address and never a byte (T-34657). Bare slugs,
    // in the space's own namespace, so a SPACE rename leaves every app's
    // history standing.
    //
    // It was spelled `alias` until T-34390, when that word became the
    // platform's own (@yaks/alias, in {@link coreDocs}): a name any entity may
    // wear in any store. Two things cannot share one word, and the one every
    // store speaks wins — so the app's addresses are `former`, which is what
    // the record is about.
    //
    // A space wears it too, for the same reason and in the same shape
    // (T-34658): its birth subdomain and every one a rename left behind, each
    // still redirecting. Not unique here — uniqueness is over an address WITHIN
    // a space for an app, and over the whole platform for a space, and neither
    // is one column's own race; the tools decide both (tools.ts `taken`).
    former: {
      component: true,
      type: 'object',
      properties: { slug: text, slugs: text },
    },
    // WHICH app is the space's front page, and the paths its worker sees FIRST
    // before the app whose slug owns them (D-34197, T-34227). One fact, one
    // spelling: the app WEARING `home` is the home app, and its globs are
    // columns of the same word — a `space.home` beside it would be a second
    // place to say the same thing, and two spellings of one fact drift.
    //
    // At most one app per space wears it. The vocabulary cannot say so —
    // `unique` covers one component's own columns and `home` has no space of
    // its own — so it is the directory's rule instead (directory.ts `homing`,
    // where moving it is one batch that drops the old and adds the new).
    //
    // A column is a scalar (@yaks/vocab `storable`), so the list is JSON in one
    // text column — ordered, and read back by router.ts `firstOf`. The
    // `former.slugs` above splits on whitespace instead, which is the older
    // spelling of a list here;
    // JSON is the one that round-trips exactly what an agent passed.
    home: {
      component: true,
      type: 'object',
      properties: { first: text },
    },
    member: {
      component: true,
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
    // A seat reaches every app in its space; this reaches ONE (T-37615). It is
    // the word @yaks/member already spells for that — the same three levels,
    // the same meaning — said here because the ladder a page is read by is the
    // platform's roster and this is its other rung: somebody invited to one
    // app holds that app's data and its page as a member does, and holds no
    // other app in the space at all. Never its FILES: writing an app's bytes
    // stays a member's act (apps.ts, public/guide/sharing.md).
    grant: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      unique: [['app', 'person']],
      properties: {
        app: ref('cascade'),
        person: ref('cascade', false),
        access: { enum: ['owner', 'editor', 'viewer'] },
      },
    },
    email: {
      component: true,
      type: 'object',
      properties: { address: text },
    },
    // A hostname somebody owns, and the ONE place it serves: a space, whose
    // front page it opens at `/` with every app of it at `/<app>/`, or a single
    // app, which it opens at `/` outright (T-34596). One column for both,
    // because it is one fact — what this name is aimed at — and the two forms
    // differ only in which entity it names; a second column would let a row say
    // both and mean neither.
    hostname: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        name: unique(text),
        serves: ref('cascade'),
        stage: { enum: ['pending', 'active', 'error'] },
        at: time,
      },
    },
    deploy: {
      component: true,
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
    // One time this app's STORE was put back to a moment (recover.ts,
    // T-34507): when it was asked for, the moment asked for, who asked, and
    // the bookmark the store stood at before it moved.
    //
    // An entity of its own per restore, like `deploy`, and not a word on the
    // app row — because the record exists so that a restore can itself be
    // undone, and a second restore overwriting the first would take away the
    // way back from it. It lives in the DIRECTORY, which is a different object
    // from the store it describes, so the trail survives the very recovery it
    // is about: what the store held is wound back, and what happened to it is
    // still written down here.
    restored: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        app: ref('cascade'),
        at: owned(time),
        to: owned(time),
        by: owned(ref('keep')),
        from_bookmark: owned(text),
      },
    },
    published: {
      component: true,
      type: 'object',
      properties: { name: unique(text), version: num, at: time, about: text },
    },
    installed: {
      component: true,
      type: 'object',
      properties: { of: ref('detach'), version: num },
    },
    // That this app — or this SPACE — is IN THE TRASH, and since when
    // (erase.ts, T-34430, T-34431). A delete marks it and keeps everything:
    // the bytes, the store, the slug. While it is worn the app answers
    // nothing on the web, leaves everyone's tool and view lists, is not the
    // front page whatever else it wears, and its mail bounces; a space wearing
    // it does all of that for every app in it at once. `app_restore` and
    // `space_restore` take the word off and give all of that back, and thirty
    // days on the daily sweep erases it for good.
    //
    // One word on the row rather than a state column beside it, for the
    // reason `home` is one: what is in the trash is what WEARS this, and a
    // second spelling of the same fact drifts from it. That is also why an
    // app and a space share the word — it says one thing, thrown away and
    // since when, and every reader asks the row in front of it.
    trashed: {
      component: true,
      type: 'object',
      properties: { at: time, by: ref('keep') },
    },
    // That this app's OFFER has been put forward for the gallery, and whether
    // we said yes (gallery.ts, T-34476). Two stamps rather than a state word:
    // `asked_at` is the owner of the app asking, `listed_at` is the platform
    // answering, and a row wearing both is on https://yaks.app/gallery. The
    // pair reads as one sentence in either direction — nothing is listed that
    // was never asked for, and clearing the word un-asks and de-lists at once.
    //
    // Server-owned, both of them, and the only word on an app that is: the
    // listing is on OUR site under OUR name (M-4522), so it may never be
    // something a write can lift for itself. The tools stamp them through the
    // kernel's own door (directory.ts `stamp`).
    gallery: {
      component: true,
      type: 'object',
      properties: { asked_at: owned(time), listed_at: owned(time) },
    },
    // The colours an app's owner set for its installed chrome (apps.ts
    // `manifesting`/`pinned`, T-33055) — settable BY THE APP, through
    // `app_set`, never guessed off its page: an app that names neither gets
    // the platform's own palette instead of a browser's default grey.
    theme: {
      component: true,
      type: 'object',
      properties: { theme_color: text, background_color: text },
    },
    // That this app's store has been SEEDED, and by which release (seed.ts,
    // T-34327). The mark is what makes the seed a once — a redeploy finds it
    // and writes nothing, so the data an app comes with never lands on top of
    // what the person has changed since. It lives on the app rather than in
    // the store because an install mints a new app row and a new store
    // together, and the copy is meant to be seeded again.
    seeded: {
      component: true,
      type: 'object',
      properties: { at: time, version: num },
    },
    // The Stripe account this space SELLS through (sell.ts, T-34524). Direct
    // charges: the connected account is the merchant, so this is the whole of
    // what the platform keeps about it — the id every call carries in its
    // `Stripe-Account` header, and the two words Stripe answers with about
    // whether it is ready. Everything else about the merchant — their bank,
    // their business details, their disputes — is Stripe's and stays there.
    //
    // Server-owned, all three, for the reason `plan` is: `charges_enabled` is
    // what the checkout door reads before it takes anybody's money, and a
    // column a space could write for itself is a space selling before Stripe
    // ever said it may. Only the Connect webhook and `space_sell` write them,
    // through the kernel's own door (directory.ts `stamp`).
    stripe: {
      component: true,
      type: 'object',
      properties: {
        account: owned(text),
        charges_enabled: owned(bool),
        details_submitted: owned(bool),
      },
    },
    // What the platform takes from one sale, in BASIS POINTS (sell.ts `fee`),
    // on the platform's OWN space row — `yak`, the one row in this directory
    // that is the platform rather than a customer. Unset reads as 0, which is
    // every sale until somebody sets a rate.
    //
    // Stamped, and the only writer is the owner's own door (sell.ts `fees`).
    // A fee a space could write for itself is a seller choosing what they pay
    // us; a fee written around that door is one the read cache would go on
    // answering for a TTL, and the rate a sale is charged has to be the rate
    // the owner set a moment ago.
    fee: {
      component: true,
      type: 'object',
      properties: { bps: owned(num) },
    },
    plan: {
      component: true,
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
      component: true,
      type: 'object',
      properties: {
        month: text,
        requests: num,
        rows_read: num,
        rows_written: num,
        bytes: num,
        files: num,
        emails: num,
        builds: num,
        tokens: num,
        seconds: num,
        built: num,
        at: time,
      },
    },
    signin: {
      component: true,
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
    // When this person last got in, and how (identity.ts `landed`, T-34351).
    // One row, so it holds the LAST way in rather than a trail — which is the
    // question a standing sign-in link raises: has anybody used it at all. Not
    // `kind`: it is a mark a person wears, never a thing of its own.
    signed_in: {
      component: true,
      type: 'object',
      properties: {
        at: owned(time),
        via: owned({ enum: ['code', 'link'] }),
      },
    },
    report: {
      component: true,
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
 * one store those doors cannot answer for.
 *
 * A plugin's words land between the core documents and the platform's own
 * (plugin.ts `vocab`): after the words they are written in, and before the
 * platform's, which is what the directory IS and answers last. `memory` is
 * one of them, and is among the DIRECTORY's words and not an app's (T-34473):
 * a memory is a thing the person said about how they want things built, and it
 * holds whether they are looking at one app or another — so it belongs to the
 * SPACE, and the directory is the one store a space has. The words themselves
 * are its `doc.body`, which is why @yaks/doc is loaded above every plugin. */
export let platformDocs: VocabDoc[] = [
  coreDoc,
  classificationDoc,
  docDoc,
  edgeDoc,
  relationDoc,
  kernelDoc,
  notifiedDoc,
  keyDoc,
  aliasDoc,
  wakeDoc,
  sweepDoc,
  ...vocabOf(PLUGINS),
  platformDoc,
]

/**
 * The directory's whole vocabulary: the core documents plus the platform's own
 * words. The Store loads it instead of {@link appVocab} when the object it woke
 * in is the meta store (graph.ts).
 */
export let platformVocab = (): Vocab => loadVocab(platformDocs, appKeywords)

// ---- the git object graph's store (D-34943) ---------------------------------

/** What the git object store speaks: @yaks/git's words, the two carriers they
 * ride (an `entry` and a `parent` are @yaks/edge links, a `compat` oid is a
 * @yaks/key value), and the spine.
 *
 * It is NOT built on {@link coreDocs}, and the reason is one word: `blob`. The
 * platform means a page's upload by it ({@link kernelDoc}) and @yaks/git means
 * where an object's bytes are — one name, two meanings, so the two vocabularies
 * cannot be loaded together and this store loads only the one it needs. Nothing
 * is lost: this object holds git objects, and a git object has no title, no
 * mailbox and no members.
 *
 * `gitDoc` carries the package's `ref` word too, and this store keeps no refs:
 * a branch belongs to one app, so its row is the DIRECTORY's (git.ts loads
 * @yaks/git's `refDoc` there). A word a store holds no rows under costs it
 * nothing. */
export let gitDocs: VocabDoc[] = [
  coreDoc,
  classificationDoc,
  edgeDoc,
  keyDoc,
  aliasDoc,
  gitDoc,
]

/** The git object store's whole vocabulary (graph.ts, {@link gitDocs}). */
export let gitVocab = (): Vocab => loadVocab(gitDocs, appKeywords)

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
export let appKeywords: Keywords[] = [
  idKeywords,
  blobKeywords,
  edgeKeywords,
  keyKeywords,
]

/**
 * Every word the platform already says, sorted. A `vocab.json` naming one is
 * refused: a word means the same thing everywhere.
 *
 * Two lists, because the platform is two things. An app's store plants the
 * core documents, so those names are taken there. And the FLEET's whole
 * vocabulary is taken too (store/vocab.ts `RESERVED`) — that is the list the
 * guide publishes under "Components of your own", and a word it spells is a
 * word this platform means something by, whether or not an app's store raises
 * a table for it.
 *
 * A `tool: true` entry is NOT one of them. A document carries its components
 * and its tools in one `$defs` map, and only the components are words an app
 * may not reuse — a tool is a verb somebody calls, and `mail_send` never
 * collides with a column called `mail_send`. Reserving them made every tool a
 * package declares cost an app a word it was never going to want.
 */
export let RESERVED: string[] = [
  ...new Set([
    ...coreDocs.flatMap((d) =>
      Object.entries(d.$defs ?? {}).filter(([, e]) => e?.tool !== true)
        .map(([name]) => name)
    ),
    ...FLEET,
  ]),
].sort()

// The five words a column's TYPE is spelled with, and the JSON Schema each is.
// A manifest writes the schema; these are for reading one back in a sentence —
// a refusal saying what a column already is, the arguments a kind's tools take
// (kinds.ts), the types a CSV's cells are coerced to (csv.ts).
let WORDS: Record<string, PropSchema> = {
  text: { type: 'string' },
  number: { type: 'number' },
  bool: { type: 'boolean' },
  time: { type: 'string', format: 'date-time' },
  url: { type: 'string', format: 'uri' },
}

let object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

/** The word a declared column's type is spelled with. A column no word spells
 * reads as `text`, which is what it stores as. */
export let wordOf = (s: PropSchema): string =>
  Object.entries(WORDS).find(([, one]) =>
    one.type == s.type && one.format == s.format
  )?.[0] ?? 'text'

/**
 * A document as `{comp: {col: word}}` — every component's columns as the word
 * each one's type is spelled with. That is how the kernel READS a vocabulary
 * where it needs the types and not the keywords (tools.ts `sheetOf`,
 * reach.ts `spoken`); the document itself is what a store keeps and answers.
 */
export let wordsOf = (doc: VocabDoc): Record<string, Record<string, string>> =>
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

/**
 * Where each word of a space LIVES: the component schemas one app homes, by
 * name. Read off that app's `/vocab`, which answers only the words it homes —
 * so a use never looks like a second declaration (tools.ts `homesIn`).
 */
export type Homes = Record<
  string,
  { at: string; props: Record<string, PropSchema> }
>

/**
 * A manifest split by home. A word another app in the space already declares
 * is not a second declaration but a USE (T-32728): nothing is planted here,
 * the writes route to the home store (reach.ts), and a column this manifest
 * adds grows the HOME's table by the additive rule {@link grew} holds every
 * store to.
 *
 * So a manifest arrives split three ways: `mine` the words this app homes,
 * `uses` the words it borrows and where each lives, and `grows` the columns
 * each home has to add. A column travels as its SCHEMA, never as its type
 * alone: `search` and every other keyword belong to the column, and the store
 * that plants it is the one that reads them (T-37546).
 *
 * The one refusal is a SHAPE conflict — the same column with two types —
 * because the rows already written under the home's type are the record of
 * what that column is, and no manifest may rewrite them.
 */
export let homed = (next: VocabDoc, homes: Homes) => {
  let mine: Record<string, PropSchema> = {}
  let uses: Record<string, string> = {}
  let grows: Record<string, Record<string, Record<string, PropSchema>>> = {}
  for (let [name, schema] of Object.entries(next.$defs ?? {})) {
    let home = homes[name]
    if (!home) {
      mine[name] = schema
      continue
    }
    uses[name] = home.at
    let add: Record<string, PropSchema> = {}
    for (let [col, s] of Object.entries(schema.properties ?? {})) {
      let had = home.props[col]
      if (had && (had.type != s.type || had.format != s.format)) {
        throw new Error(
          `vocab.json: ${name}.${col} is ${wordOf(s)} here and ${
            wordOf(had)
          } in ${home.at}, where ${name} lives — a column keeps the type its ` +
            'rows were written under',
        )
      }
      if (!had) add[col] = s
    }
    if (Object.keys(add).length) {
      grows[home.at] = { ...grows[home.at], [name]: add }
    }
  }
  return { mine: { ...next, $defs: mine }, uses, grows }
}

/**
 * What a deploy says about a word it does not own, in the sentence the person
 * asked for: where it lives, and that this app still reads and writes it.
 */
export let livesIn = (uses: Record<string, string>) =>
  Object.entries(uses).map(([name, at]) =>
    `${name} lives in ${at}; this app reads and writes it there`
  )

/** One component an app declared. Its own word is the most specific thing said
 * about a row — an entity wearing `recipe` is a recipe, not the `doc` it also
 * wears for its title — so it is a KIND sorting before `doc` unless the
 * manifest says otherwise, which is also what earns it its two tools
 * (kinds.ts). */
let mine = (schema: PropSchema): PropSchema => ({
  // `component: true` is the marker @yaks/vocab wants on a component, and it
  // is put on HERE rather than asked of the person: an app manifest's $defs
  // entries are its components, that is the whole of what the file is for, and
  // a store that accepted one before the marker existed reads back the same
  // way (T-37551).
  component: true,
  type: 'object',
  kind: true,
  before: ['doc'],
  ...schema,
})

/**
 * An app's `vocab.json` as one document: a JSON Schema 2020-12 document with
 * `$defs`, which is the one spelling a manifest is written in. A manifest of
 * bare component names declares no `$` keyword, and is refused in a sentence
 * naming the shape.
 *
 * It is checked here rather than at the load: a name the platform already owns
 * is refused, and so is anything a column cannot hold.
 *
 * `file` is what a refusal calls it — the app may have written it as `.json` or
 * `.yml` (tools.ts `spelled`), and the sentence has to name the file they are
 * looking at.
 *
 * `"tools": false` is the one word a manifest says about ITSELF rather than
 * about a component — no tools synthesized for its kinds (kinds.ts, T-34513) —
 * so it is lifted off and carried on the document. A boolean tells it from a
 * component named `tools`, which is an object of columns like any other.
 */
export let appDoc = (source: unknown, file = 'vocab.json'): VocabDoc => {
  let held = source
  if (typeof held == 'string') {
    try {
      held = held.trim() ? read(held, file) : {}
    } catch (e) {
      throw new Error(`${(e as Error).message} — ${EXAMPLE}`)
    }
  }
  if (held == null) held = {}
  if (!object(held)) throw new Error(`${file} is an object — ${EXAMPLE}`)
  let off = typeof held.tools == 'boolean' ? held.tools : undefined
  let body = off === undefined
    ? held
    : Object.fromEntries(Object.entries(held).filter(([k]) => k != 'tools'))
  let keys = Object.keys(body)
  if (keys.length && !keys.some((k) => k.startsWith('$'))) {
    throw new Error(
      `${file}: ${keys.join(', ')} — a manifest is a JSON Schema document, ` +
        `one $defs entry per component and one properties entry per column: ` +
        `${EXAMPLE}; the whole of it is in the guide under ` +
        `"Components of your own" (${GUIDE})`,
    )
  }
  let doc = body as VocabDoc
  if (doc.$defs) {
    doc = {
      ...doc,
      $defs: Object.fromEntries(
        Object.entries(doc.$defs).map(([name, s]) => [name, mine(s)]),
      ),
    }
  }
  if (off !== undefined) doc = { ...doc, tools: off }
  // The platform's words, all of them, before anything is planted: a manifest
  // refused one name at a time is probed one deploy at a time, and every probe
  // that got through left a component behind for good (C-32624 item 1). The
  // sentence is the one the guide prints under "The words already taken", and
  // it says where the whole list is, because the agent reading it has no other
  // source.
  let taken = Object.keys(doc.$defs ?? {}).filter((n) => RESERVED.includes(n))
  if (taken.length) {
    throw new Error(
      `${file}: ${taken.join(', ')} ${
        taken.length == 1 ? 'is a word' : 'are words'
      } the platform already says — pick another name; the whole list is in ` +
        `the guide under "Components of your own" (${GUIDE})`,
    )
  }
  let errs = storable(doc)
  if (errs.length) throw new Error(`${file}: ${errs.join('; ')}`)
  return doc
}

/**
 * What a store's `/vocab` ANSWERED, as the document it means — and an empty
 * document where it cannot be read at all. A door reading a vocabulary is
 * reading it to say something else (which words are in reach, which kinds an
 * app holds, what a batch may write), so one store with an answer nothing can
 * parse reads as an app with no words of its own rather than a failed request.
 * {@link appDoc} is the door a DEPLOY comes through, where a refusal is the
 * whole point.
 */
export let meant = (said: unknown): VocabDoc => {
  try {
    return appDoc(said)
  } catch {
    return {}
  }
}

/**
 * One app's whole vocabulary: the core documents plus its own `vocab.json`,
 * loaded into the `Vocab` a Store reads its DDL, routing and admission out of.
 * The source is the file as written — text or already parsed — and an app that
 * declares nothing gets the core alone.
 */
export let appVocab = (source: unknown = {}): Vocab =>
  loadVocab([...coreDocs, appDoc(source)], appKeywords)
