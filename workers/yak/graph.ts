import { backfill as backfillArchetypes } from '@yaks/sqlite'
import { archetypes } from '@yaks/archetype'
// The Store Durable Object, built out of the packages (T-33810, D-33490): one
// app's graph, and nothing of the fleet's. It is composition, not code —
//
//   appVocab(manifest)          core + member + edge + the twelve relations +
//                               the app's own vocab.json          (vocab.ts)
//   storage(ctx.storage, vocab) the object's SQLite as @yaks/graph's Storage
//                               (@yaks/durable-object → @yaks/sqlite)
//   graph(storage, plugins)     the phased apply(): edges, members, blobs,
//                               effects, the mailbox        (@yaks/graph)
//   subscriptions(graph)        a saved query that keeps answering (@yaks/api)
//   api({graph, subs})          POST /apply, GET /query            (@yaks/api)
//   sockets(subs, ctx)          /ws, over hibernatable sockets
//                               (@yaks/durable-object)
//
// — and the five lines above are the whole of what this object does. Bundles
// in and bundles out: no fleet schema is planted, there is no `snapshot()`,
// and no SQL is written here.
//
// It serves two roles, told apart by the name the kernel gives the object. An
// app's store wakes with the core plus its own `vocab.json`; the directory —
// the one object named `yak/platform` — wakes with the platform's own
// vocabulary, uniques and all (vocab.ts `platformDoc`, T-33814). One class,
// one composition, two vocabularies.
//
// This class carries the DO's own name, `Store`, so wrangler's migration list
// never moves: it took the name from the fleet-shaped object it replaced, which
// is gone (T-33807), and migrate.ts carries that object's rows across on the
// first request that reaches one (T-33809).
//
// ## What the object remembers
// A Durable Object's memory does not survive an eviction, so everything this
// one is told rides in its own SQLite: the address it was born at, the app's
// `vocab.json` as deployed, the app entity it holds, what the directory says
// that app's access mode is, and the address its letters leave from
// (directory.ts `mailbox`). Each is learned from the header that first
// carries it — the kernel builds every request to a store from scratch, so a
// client can never send one — and each is written down, because the next
// request may reach a fresh incarnation.
//
// ## Who is asking (T-33813)
// one seam, and it is @yaks/api's `Authenticate` — the same value @yaks/mcp's
// mount takes, so the agent door and the page door cannot disagree about who
// is writing. {@link authenticating} is it: the vouch in, the `$actor` entity
// out, and a refusal for a caller this app's mode does not admit. Nothing else
// in this object reads a credential, and no bundle's own `$actor` survives
// (@yaks/api `signed`).
//
// The credential is verified once, at the edge. A session cookie, an OAuth
// bearer and a sealed grant are three things to check and one answer — a
// person and the level they hold — so the kernel checks them where they
// arrive (identity.ts `withAuth`, dispatch.ts `granted`) and says the answer
// in the vouch: `x-yak-person`, `x-yak-role`, `x-yak-title`, beside the app
// this store holds (`x-yak-app`) and what the directory says its access mode
// is (`x-yak-access`).
//
// Why the vouch is believed. Not because it is signed — it is not — but
// because nothing else can say it. A Durable Object is reachable only through
// its binding, from this Worker, and the one door onto a store (door.ts
// `storeOf`) strips the whole vouch set from any request it is handed before
// it stamps its own. So the set is the kernel's by construction, in one place
// that can be read, rather than by every caller remembering not to forward a
// visitor's headers. A shared secret would put a signature on a hop that has
// no other traveller; it would also have to reach this object, which would be
// one more thing to hold and rotate for no attacker it excludes.
//
// The `yak/vouch` plugin then mirrors that word into this store's own rows —
// the person, their name, and the level the kernel vouched — inside the
// batch's own transaction, so @yaks/member's guard has something to read when
// the batch reaches it and a refused batch takes the rows back with it.
import {
  api,
  type Authenticate,
  type Handler,
  json,
  poured,
  refuse,
  signed,
  type Sink,
  type Subs,
  subscriptions,
  Unauthorized,
} from '@yaks/api'
import { blobRead, blobs, blobSchema, blobText, sqliteBlobs } from '@yaks/blob'
import {
  driver,
  type DurableSql,
  type DurableStorage,
  type Hibernation,
  type Sockets,
  sockets,
  storage,
  type Wire,
} from '@yaks/durable-object'
import { effects } from '@yaks/effects'
import { edges } from '@yaks/edge'
import { keys } from '@yaks/key'
import { aliases } from '@yaks/alias'
import {
  type Driver,
  fields,
  find,
  schema as ftsSchema,
  search,
} from '@yaks/fts'
import {
  type ApplyOpts,
  type Bundle,
  type Comp,
  comps,
  detached,
  type Graph,
  graph,
  type Plugin,
  Refused,
  sha256,
  then,
} from '@yaks/graph'
import { DELIVER, MAIL, mailbox } from '@yaks/mail'
import {
  actorOf,
  Denied,
  type Floors,
  type Level,
  level,
  members,
  type Mode,
  mode,
  type Policy,
  policy,
  reads,
} from '@yaks/member'
import { parse } from '@yaks/query'
import { jsonb, type Vocab, type VocabDoc } from '@yaks/vocab'
import { reconcile, type Runner, runner } from '@yaks/tools'
import { commands, modern, type Tools } from '../../src/store/tools.ts'
import { soonest, tick, type Ticked, wakes } from '@yaks/wake'
import { type Alarm, arm } from '@yaks/wake/cloudflare'
import { named, type Row } from './listing.ts'
import { effected, rulesOf, wakesOf } from './plugin.ts'
import { PLUGINS } from './plugins.ts'
import type { Env } from './env.ts'
import { seeded } from './wake.ts'
import type { Binding } from './post.ts'
import { ledger } from './ledger.ts'
import { doorOf, GIT_STORE, type Namespace, PLATFORM_STORE } from './door.ts'
import { type Meta, metaOf } from './meta.ts'
import { caught, defect } from './sentry.ts'
import {
  constrained,
  dead,
  done,
  fits,
  held,
  keep,
  type Kept,
  logged,
  oldest,
  parked,
  replayed,
  said,
  tried,
  waiting,
  WRITES,
} from './writes.ts'
import { apex, url } from './host.ts'
import {
  addressed,
  aimedOld,
  carry,
  documented,
  FILED,
  filed,
  FORMER,
  HANDLED,
  handled,
  HOMED,
  homed,
  housed,
  install,
  MARK,
  MARKS,
  mistooled,
  rebuild,
  recut,
  Refused as Unreconciled,
  type Report,
  SANDBOXED,
  served,
  SERVES,
  type Slots,
  slugged,
  stale,
  TOOLED,
  tooled,
  trusting,
  unfiled,
  unhandled,
  untrusted,
} from './migrate.ts'
import {
  appDerived,
  appDoc,
  appVocab,
  gitVocab,
  grew,
  meant,
  numbered,
  platformVocab,
  teach,
} from './vocab.ts'

/**
 * The columns of a manifest that hold a JSON value (type object, array or a
 * union), which a deploy may not plant yet.
 *
 * TODO(T-37988): delete once this build is the one before. It reads such a
 * column, but the build before it refuses the whole vocabulary at load, so a
 * store that planted one would stop serving if production rolled back
 * (D-37972).
 */
let unplantable = (doc: VocabDoc): string[] =>
  Object.entries(doc.$defs ?? {}).flatMap(([name, s]) =>
    Object.entries(s?.properties ?? {})
      .filter(([, c]) => jsonb(c))
      .map(([col]) =>
        `vocab.json: ${name}.${col} holds a JSON value (type object, array ` +
        'or a union), which an app cannot declare yet — keep it as JSON ' +
        'text for now: "type": "string", "format": "json"'
      )
  )

/**
 * Which words an object wakes with, from the one thing that decides it: which
 * object it is. Two names on this platform are not apps — the directory
 * (`yak/platform`) and the git object graph (`yak/git`, D-34943) — and each
 * speaks its own vocabulary instead of an app's `vocab.json`. Every other name
 * is an app.
 *
 * It is a function rather than two branches because both places that build a
 * store — the boot, and the migration that carries one across (`carry`) — have
 * to answer it the same way, and a third store would otherwise be a word added
 * in one of them and forgotten in the other.
 */
export let vocabOfStore = (name: string, declared: unknown = {}): Vocab =>
  name == PLATFORM_STORE
    ? platformVocab()
    : name == GIT_STORE
    ? gitVocab()
    : appVocab(declared)

/**
 * The slice of a `DurableObjectState` this object needs: its storage, and its
 * hibernatable sockets. A Worker's own `DurableObjectState` satisfies it.
 *
 * Two things beyond @yaks/durable-object's own slice, because the platform asks
 * this object for them and no app ever does. `databaseSize` is how many bytes
 * it holds — the only per-app storage figure that exists, since Cloudflare's
 * storage dataset has no per-object dimension (usage.ts reads it through
 * `/graph`). `deleteAll` is the one way to empty an object: dropping the tables
 * leaves metadata behind, and an object whose storage is empty ceases to exist.
 */
export type State = Hibernation & {
  storage: DurableStorage & {
    sql: DurableSql & { databaseSize: number }
    deleteAll(): Promise<void>
    // The object's key-value slots beside its SQL. Nothing in this class writes
    // one — its own memory is the `yak_kv` table below — but the store this one
    // replaces kept everything it remembered there (its name, the app's
    // `vocab.json`, its tools), so the migration reads them across (migrate.ts).
    kv?: Slots
    // Cloudflare's point-in-time recovery, which is a whole store's way back
    // (recover.ts, T-34507): where this object's SQLite stands now, the
    // bookmark for a moment in the last thirty days, and the one to restore to
    // when it next starts. Optional because a back-end may not offer them —
    // local workerd answers the first and refuses the other two — and the door
    // says so rather than pretending.
    getCurrentBookmark?(): Promise<string>
    getBookmarkForTime?(at: number | Date): Promise<string>
    onNextSessionRestoreBookmark?(bookmark: string): Promise<string>
    // The object's one alarm, which is this store's whole clock (D-37562):
    // every wake row it holds is owed at an instant, and the earliest of them
    // is what the runtime is asked to come back for. Optional like the
    // bookmarks — a stand-in that schedules nothing need not offer them, and a
    // store without them simply never wakes itself.
    getAlarm?(): Promise<number | null>
    setAlarm?(at: number): Promise<void>
  }
  // The runtime's own gate: work started here finishes before any request is
  // delivered, which is what makes a one-pass migration safe to start from the
  // first request that reaches the object. Absent in the workerd stand-in, where
  // an object is driven one call at a time anyway.
  blockConcurrencyWhile?<T>(body: () => Promise<T>): Promise<T>
  // Restarting the object on the spot, which is how a recovery takes effect
  // now rather than at the next wake (`#recovery`). Optional for the same
  // reason: the stand-in has no session to end.
  abort?(reason?: string): void
}

/** The Worker's bindings: outgoing mail for every store, and `#Env` for the
 * directory's platform rules. The rules in app
 * stores receive no platform bindings, even if an app declares matching tags.
 * A stand-in may supply only the bindings its operations need. */
export type Bindings = Partial<Env> & {
  MAIL?: Binding
  STORE?: Namespace
}

// What the object remembers about itself, and the table it remembers it in.
// One row per word — the object's SQLite is the only memory that survives an
// eviction, and this is smaller than asking @yaks/graph to hold configuration
// as data.
type Word =
  | 'name'
  | 'vocab'
  | 'uses'
  | 'tools'
  | 'app'
  | 'access'
  | 'mail'
  | 'schema'
  | 'migrated'
  | 'wakes'
  | 'planted'
  // One person's localStorage in a sandboxed app (installed.ts): their keys
  // as one JSON object, kept here rather than as rows, which the app's other
  // readers could query.
  | `storage:${string}`
// The most one person keeps in one app's storage, in characters of JSON.
let STORED = 1024 * 1024

let KV = `create table if not exists yak_kv (
    k text primary key,
    v text not null
  )`

/** What the kernel vouched for one request: who is asking, the level the
 * platform says they hold on this app, and what to call them. */
export type Vouch = {
  person: string | null
  level: Level | null
  title: string | null
}

/**
 * The vouch off a request. `x-via` names an instrument that named itself —
 * attribution, never a level, and never a person's name — while
 * `x-yak-person` is the kernel's own word about a caller it verified.
 */
export let vouchOf = (req: Request): Vouch => {
  let via = req.headers.get('x-via')
  let said = req.headers.get('x-yak-role')
  return {
    person: via ?? req.headers.get('x-yak-person'),
    level: via || !said ? null : level(said),
    title: via ? null : req.headers.get('x-yak-title'),
  }
}

/**
 * The seam: the vouch as @yaks/api's `Authenticate`, which @yaks/mcp's mount
 * takes too. Nobody at all is `null` — an anonymous visitor, which an `open`
 * or `public` app admits and a `private` one refuses.
 *
 * A read never reaches `apply()`, so it is refused here, in @yaks/member's own
 * words: the app's mode against the level this caller holds. The level is the
 * kernel's when it vouched one — the platform's roster lives in the directory,
 * not in an app's store — and this store's own grants otherwise, which is what
 * a share link and an app's own `grant` rows are. A write passes here and is
 * refused again inside the transaction by @yaks/member's precondition guard,
 * which is the only check that can read the batch.
 */
export let authenticating = (
  may: Policy,
  app: () => string | null,
  heard: (v: Vouch) => void = () => {},
): Authenticate =>
async (req) => {
  let v = vouchOf(req)
  heard(v)
  let who = v.person ? { by: v.person } : null
  let held = app()
  if (!held) return who
  let m = await may.modeOf(held)
  let has = v.level ?? await may.levelOf(v.person, held)
  if (reads(m, has)) return who
  // Signed out, the way in is to sign in; signed in and holding nothing, it
  // is the app owner's to grant. Neither answer says more about the app than
  // the address already did.
  if (!who) throw new Unauthorized('sign in to read this app')
  throw new Denied(String(who.by), held, 'viewer', 'read')
}

// The spine's own name.
let SPINE = 'entity'

// The two pieces of the wider platform grammar an app's store refuses by name
// rather than answering some other way (public/docs/querying.md, where both
// are written down as this store's own limits). A work lane is the fleet's
// board, which nothing here has; semantic ranking needs a vector index, which
// nothing here has either — and an empty answer to a question about neither
// would read as "no rows" rather than "not that question".
// The three directives that reshape an answer into one value rather than a set
// of rows. A line naming one is not a listing at all.
type Agg = 'count' | 'distinct' | 'tally'
let AGGS: Agg[] = ['count', 'distinct', 'tally']
let aggOf = (line: string): Agg | null =>
  parse(line).clauses.map((c) => c.kind as Agg).find((k) => AGGS.includes(k)) ??
    null

let unserved = (line: string): string | null => {
  for (let seg of line.split('&')) {
    if (seg.startsWith('work=')) {
      return 'work lanes are not served by this store'
    }
    if (/^\.order=-?similar$/.test(seg)) {
      return 'semantic ranking is not served by this store'
    }
  }
  return null
}

// A hibernatable socket the runtime will also close for us.
type Closable = Wire & { close?(code: number, reason: string): void }

// The views a tools manifest names (see the `/tools` door). It reads the JSON
// as written and says nothing about whether it is a manifest at all: what is
// in the slot is whatever the kernel put there.
let entries = (manifest: string): [string, Record<string, unknown>][] => {
  try {
    let held = JSON.parse(manifest)
    return held && typeof held == 'object' && !Array.isArray(held)
      ? Object.entries(held as Record<string, Record<string, unknown>>)
      : []
  } catch {
    return []
  }
}

let viewed = (manifest: string): string =>
  [...new Set(entries(manifest).map(([, t]) => t?.view).filter(Boolean))]
    .map(String).sort().join('\n')

// What a back-end with no point-in-time recovery says. Local workerd offers
// `getCurrentBookmark` and refuses the other two in very nearly these words, so
// one sentence covers both the method that is missing and the method that
// throws — and a person is told the truth about their data either way.
let NO_PITR =
  "this store's back end does not offer point-in-time recovery — it is a " +
  'Cloudflare production Durable Object that does, and local development does ' +
  'not'

/**
 * The platform's words that ask a level of their own in an app's store,
 * whatever the app's `access` (@yaks/member `floors`, T-37881). An `open` app
 * takes a visitor's rows on purpose, and these are the rows that are not a
 * visitor's to write:
 *
 *   product  what the checkout charges (sell.ts `priced`): the seller's
 *   order    what was sold: its columns are the webhook's alone (vocab.ts),
 *            and an owner may clear one
 *   deliver  the ask to send a letter, which leaves under the platform's
 *            name — an open app with no floor here is an open relay, and the
 *            first spam run would take the zone's reputation with it. Writing
 *            the letter is not held to anything; a draft is ordinary data.
 */
export let FLOORS: Floors = {
  product: 'editor',
  order: 'owner',
  [DELIVER]: 'editor',
}

/** The id a mirrored grant is filed under: one per (app, person), derived, so
 * the same vouch lands on one row however often it is said. */
export let grantEid = (app: string, person: string): string =>
  sha256(`grant\x00${app}\x00${person}`)

export class Store {
  #ctx: State
  #vocab!: Vocab
  #graph!: Graph
  #drive!: Driver
  #live!: Sockets
  #route!: Handler
  #auth!: Authenticate
  #meta!: Meta
  #bind: Bindings
  // An object still holding the fleet-shaped store this class replaces
  // (T-33809). Nothing above the storage is built while this is true — planting
  // the new schema over the old tables is exactly what must not happen — so the
  // first request runs the pass and everything is raised after it.
  #pending = false
  // Whether this object is behind the latest migration (migrate.ts `MARKS`):
  // one that never carried, or one that carried before a later pass existed.
  // Decided once, here, rather than read off the storage on every request.
  #behind = false
  #passing: Promise<void> | null = null
  // Why the pass refused, when it did. The rows are the old ones, untouched.
  #refused: string | null = null
  // This object's one alarm (D-37562), or null where the runtime under it has
  // none. One adapter for the incarnation: `arm` serializes its read-compare-
  // write per storage object, so two wakes arriving together cannot leave the
  // later one holding the alarm.
  #alarm: Alarm | null = null
  // The schedules this object was born with, planted once (`#sowing`).
  #sowing: Promise<void> | null = null
  // The app's own commands, as a runner over this store (T-37605), beside the
  // manifest they were built from. A deploy is the only thing that moves that
  // manifest, and a new one is a new runner.
  #runs: { said: string; run: Runner } | null = null
  // The write log's replay (writes.ts). `#landing` is the kept write whose
  // batch is being applied right now, which the `yak/writes` hook takes out
  // of the log in that batch's own transaction; `#draining` is the replay in
  // progress, one at a time; `#stuck` says the last one stopped on a failure,
  // and only the alarm or the next incarnation tries it again.
  #landing: number | null = null
  #draining: Promise<void> | null = null
  #callers = new Map<number, (answer: Response) => void>()
  #stuck = false

  constructor(ctx: State, bind: Bindings = {}) {
    this.#ctx = ctx
    this.#bind = bind
    let { getAlarm, setAlarm } = ctx.storage
    if (getAlarm && setAlarm) {
      this.#alarm = {
        getAlarm: () => getAlarm.call(ctx.storage),
        setAlarm: (at) => setAlarm.call(ctx.storage, at),
      }
    }
    try {
      this.#start()
    } catch (e) {
      this.#failed(e, 'schema')
    }
  }

  #start() {
    let ctx = this.#ctx
    ctx.storage.sql.exec(KV)
    // The write log, before anything that can refuse the object: a store
    // whose graph cannot boot still keeps what it is sent (writes.ts).
    ctx.storage.sql.exec(WRITES)
    this.#documenting()
    this.#pending = !this.#get('migrated') && stale(ctx.storage)
    if (!this.#pending) this.#boot()
    if (this.#refused) return
    // The passes after the first read and write the new schema, so they are
    // asked after the boot — and only of an object that is not already at the
    // last marker (migrate.ts `MARKS`), with one question per pass: an object
    // that stopped at an older marker because it had nothing to move for it
    // still has to be asked about the ones added since.
    this.#behind = this.#pending ||
      (this.#get('migrated') != SANDBOXED &&
        (housed(ctx.storage) || slugged(ctx.storage) ||
          aimedOld(ctx.storage) || unhandled(ctx.storage) ||
          unfiled(ctx.storage) || mistooled(ctx.storage) ||
          untrusted(ctx.storage)))
  }

  // The vocabulary an object keeps is the document (T-37546). A store that
  // last accepted the short type map an app's vocab.json could be written as
  // remembers it that way, and nothing converts one at the door any more — so
  // it is rewritten here, once, before anything above the storage reads it
  // (migrate.ts `documented`). After one wake no short map is left anywhere.
  #documenting() {
    let held = this.#get('vocab')
    let doc = held && documented(held)
    if (doc) this.#put('vocab', doc)
  }

  // Waking on whatever this object holds. Everything above the storage is
  // rebuilt from the remembered vocabulary, which is why a deploy is a write
  // and a reboot rather than a migration: the schema is additive — a table the
  // store has never seen is created, a column a word grew is added — and what
  // changed is which words the graph admits. Nothing is ever dropped or
  // retyped; T-33809 owns moving rows that a changed column would need.
  #boot(prepare = () => {}) {
    try {
      this.#ctx.storage.transactionSync(() => {
        prepare()
        this.#build()
      })
    } catch (e) {
      this.#failed(e, 'schema')
    }
  }

  #build() {
    let ctx = this.#ctx
    // Which words this object speaks is a question of which object it is
    // (`vocabOfStore`). One store on the platform is the directory (the meta
    // space, T-33814); one is the git object graph (D-34943); every other
    // object is an app, and wakes with the core plus whatever its `vocab.json`
    // declared.
    let name = this.#get('name') ?? ''
    let meta = name == PLATFORM_STORE
    // Neither of the two is an app, which is what the app-shaped extras below
    // are for: `task.status` is an expression over words a git object graph
    // does not have, and `vocab.json` is not a sentence to say to a caller of
    // either one.
    let own = meta || name == GIT_STORE
    let vocab = vocabOfStore(name, this.#get('vocab') ?? {})
    let drive = driver(ctx.storage)
    this.#drive = drive
    let bytes = sqliteBlobs(drive)
    // The vocabulary says which prose is searched — @yaks/doc declares its
    // title and body, and an app's own vocab.json declares `"search": true` on
    // whatever of its words it wants found. sqlite owns no index.
    let searchable = fields(vocab)
    let store = storage(ctx.storage, vocab, {
      // A number is @yaks/id's, and only the platform's own stores loaded it
      // (vocab.ts): the directory's memories are ordered by the number it
      // minted, while an app's entities are pointed at by the eid its client
      // minted and never by a number, so nothing mints one for them.
      number: numbered(vocab),
      extend: [search(searchable)],
      derived: { ...blobRead(vocab), ...(own ? {} : appDerived()) },
      // A body is stored as its address (@yaks/blob `store: "blob"`), so the
      // read view resolves it as prose. The FTS schema below receives the
      // same resolution, keeping hashes out of the index (T-33978).
      text: blobText(vocab),
    })
    // Every index the vocabulary declares is already in `store.ddl()` — the
    // directory's uniques included, since they are words of `platformDoc`.
    // The blob table first: the `doc_value` view and the search triggers read
    // a body's text out of it, so it has to be standing before they are.
    let ddl = [
      ...blobSchema(),
      ...store.ddl(),
      ...ftsSchema(searchable, blobText(vocab)),
    ]
    // The schema this object stands at, as one word: a wake under the same
    // vocabulary runs no DDL at all, and a deploy that added a component
    // raises its table on the next request.
    //
    // A brand-new object raises nothing yet: it does not know which store it
    // is until its first request says so, and planting an app's core into what
    // turns out to be the directory would leave tables no word of its
    // vocabulary names. `#learn` reboots the moment the name arrives, and every
    // door runs after it.
    let named = !!this.#get('name') || !!this.#get('schema')
    let stamp = sha256(ddl.join('\n'))
    let held = this.#get('schema')
    if (named && held != stamp) {
      // A definition cannot be altered by replaying it. `create ... if not
      // exists` says nothing about a trigger or a full-text index that is
      // already standing, so one raised under an older schema keeps its old
      // shape while the tables under it move — which is how a search index came
      // to hold blob addresses after the triggers learned to resolve them
      // (T-33978). A definition holds no rows of its own, so it is dropped and
      // raised again at the current shape whenever the stamp moves, and the
      // index is then rebuilt off the content it mirrors. Nothing to do the
      // first time: there is no older shape to be wearing.
      if (held) recut(drive)
      for (let stmt of blobSchema()) drive.exec(stmt)
      install(
        ctx.storage,
        vocab,
        blobText(vocab),
        this.#get('migrated') ?? null,
        !this.#pending,
      )
      if (held) rebuild(drive)
      this.#put('schema', stamp)
    }
    let app = this.#get('app')
    // The registry an app's own effects register on (T-33816), and the one
    // every plugin of this Worker registers on below. It is fresh on every
    // boot, so those registrations happen once per incarnation however often
    // a store is rebuilt.
    // An effect writes back through the kernel's own door — a new batch
    // through this graph's `apply()`, trusted and unsigned — so what a letter
    // came to is journaled, cast to every open socket, and seen by whatever
    // else is watching, instead of a row a page finds on its next query
    // (T-34044). `#trust` is the same door `x-yak-kernel` writes through; the
    // graph it names is whichever one this object last built, which is the
    // only one that could be committing.
    // A handler or hook that fails after its batch committed is sent to
    // Sentry rather than to the console the packages default to. Not noted in
    // this store as `#broke` does: the note is a write, and a hook that fails
    // on every write would answer it with another break, forever.
    let fx = effects(vocab, {
      write: (b) => this.#trust(b, null),
      report: (error, { handler }) =>
        defect(error, { request: `effect ${handler}`, store: name }),
    })
    let g = graph({
      storage: store,
      vocab,
      report: (error, { phase, plugin }) =>
        defect(error, { request: `${plugin} ${phase}`, store: name }),
      // The guard is added last and only when this object knows which app it
      // holds: @yaks/member refuses a write by an actor with no level, so a
      // store that cannot name its app has no access question to ask and the
      // kernel's own gate in front of it is the whole rule.
      plugins: [
        this.#logging,
        ...(vocab.comp('archetype') ? [archetypes()] : []),
        // First, before anything reads a word that is not there. The directory
        // is left out: its words are the platform's own, its callers are the
        // kernel's own, and `vocab.json` is not a sentence to say to any of
        // them.
        ...(own ? [] : [this.#teaching]),
        // Before every check, because it is about the shape a value arrived in.
        this.#lowering,
        edges(vocab),
        // The carrier and the one kind of it every store speaks: a name, which
        // is how anything addresses a row it wrote last week without having
        // kept the eid. The carrier goes first — the name rides it (T-34390).
        keys(vocab),
        aliases(vocab),
        blobs(vocab, bytes),
        wakes(),
        fx,
        // Before the guard, because it is what the guard reads.
        this.#vouching,
        ...(app ? [this.#guarding(app)] : []),
        // The post room. `mailbox()` is @yaks/mail's own plugin: the address
        // canonicalizer, so a mailbox is stored in one spelling and only one.
        // @yaks/doc is composed beside it rather than inside it, and here a
        // step further out still — `doc` is one of the words every store on
        // this platform already speaks (vocab.ts `coreDocs`), so there is
        // nothing left for a `docs()` to declare.
        ...(!meta && app
          ? [this.#posting(), mailbox({ domain: apex(this.#bind) })]
          : []),
        // What every domain of this Worker declares about a write, as data
        // (plugin.ts `rules`, plugins.ts): a query over one bundle in the batch
        // plus what comes out, run by the phase it names. Every store gets
        // every rule — one about a component this store does not speak is inert
        // (@yaks/graph rules.ts) — and a phase runs its rules before its hooks
        // wherever the list sits, so the place decides nothing but the order
        // two rules on one phase fire in.
        // The directory's jobs read and write the directory — which is this
        // object. They get it as a method call (`META`), never as a fetch to
        // this object's own stub: a Durable Object shares one I/O context
        // across every request in flight on it, so each self-request deepens
        // the chain instead of starting one, and the hourly meter asking once
        // per space hit the runtime's depth limit (T-34844).
        {
          name: 'yak/rules',
          rules: rulesOf(PLUGINS),
          resources: {
            Env: () => meta ? { ...this.#bind, META: this.#meta } : undefined,
          },
        },
      ],
    })
    // What every domain of this Worker does about data this store committed
    // (plugin.ts `effects`, plugins.ts): a letter that asks to go is the one
    // there is today (outbox.ts). The store hands over what only it knows —
    // its bindings, whether it is the platform's own, the app it holds and the
    // address it writes from — and knows nothing of what is registered.
    // The object's own clock (D-37562). A `wake` row says when something is
    // owed; the runtime's one alarm is how this object comes back for it. A
    // write that moves a wake arms the alarm, `alarm()` fires what is due, and
    // the tick's own write of the next instant arms it again — so a store
    // holding no schedule sleeps, and one holding a schedule needs no
    // heartbeat to keep it. Every store has this, the directory included: its
    // sweeps are wake rows like anybody's.
    fx.on('wake', {
      doc: 'arm this object for the wake a write just moved',
      created: (e) => this.#arming(e.comp?.at as string),
      changed: { at: (e) => this.#arming(e.comp?.at as string) },
    })
    // The app's own commands, run here (T-37605, D-37562). @yaks/tools says
    // which calls still want running as two rules — one for a call nobody
    // scheduled, one for a call whose wake has fired — and a host registers
    // each as an effect. That is the whole of the scheduled case: a page
    // writes a `call` wearing a `wake{at}`, the object comes back at that
    // instant, the firing makes the second rule hold, and the answer lands
    // beside the ask.
    for (let rule of this.#runner(g).rules) {
      fx.on(rule.plan, (e) => this.#runner().run(e.entity.eid), {
        doc: rule.rule.name,
      })
    }
    effected(PLUGINS, fx, {
      env: this.#bind,
      meta,
      app,
      mail: () => this.#get('mail'),
    })
    this.#vocab = vocab
    this.#graph = g
    // One per incarnation, like the graph: directory.ts seeds once per Meta.
    // Its own writes are not writes reaching it, so they skip the log (and
    // never wait on a replay they may be part of).
    this.#meta = metaOf(
      doorOf(
        async (req) => await this.#ready(req) ?? this.#serve(req),
        PLATFORM_STORE,
      ),
    )
    let subs = subscriptions(g)
    this.#live = sockets(this.#naming(subs), ctx)
    // The one `Authenticate` (T-33813). The app is read at request time — the
    // object may learn which app it holds from the request being answered —
    // and the mode with it, so a store told its access changed follows the
    // new word without a reboot.
    this.#auth = authenticating(
      policy(g.storage),
      () => this.#get('app'),
      (v) => void (v.person && this.#vouched.set(v.person, v)),
    )
    this.#route = api({ graph: g, subs, authenticate: this.#auth })
    // The registry is fresh, and the sockets are not: they belong to the
    // runtime and outlive every incarnation of this object, so whatever they
    // are watching is re-opened against the new one. Without this a deploy
    // would leave every open page subscribed to a registry nothing commits to.
    this.#live.wake()
  }

  /** What this object holds, and the seam that says who is asking it — the
   * values @yaks/mcp's mount is built out of, so the agent door is the same
   * graph under the same `Authenticate` as the page door (T-33812).
   *
   * The third is where a call is recorded (ledger.ts). @yaks/tools writes one
   * as the transcript of having asked, and an app's store speaks its own app's
   * words — not `call`, `result` or `tool` — so the record lives in a graph of
   * its own for the life of this door rather than as three tables in
   * everybody's app. */
  get door(): { graph: Graph; authenticate: Authenticate; calls: Graph } {
    return {
      graph: this.#graph,
      authenticate: this.#auth,
      calls: ledger(this.#graph),
    }
  }

  #get(k: Word): string | null {
    let [row] = this.#ctx.storage.sql
      .exec('select v from yak_kv where k = ?', k).toArray()
    return row ? String((row as { v: unknown }).v) : null
  }

  #put(k: Word, v: string) {
    this.#ctx.storage.sql.exec(
      'insert into yak_kv (k, v) values (?, ?) ' +
        'on conflict(k) do update set v = excluded.v',
      k,
      v,
    )
  }

  // What the kernel told this object about itself, on any request that carries
  // it. The address it was born at never moves; the app it holds and that
  // app's access mode are the directory's to say, so a changed mode is
  // followed rather than argued with.
  #learn(req: Request) {
    try {
      this.#ctx.storage.transactionSync(() => this.#remember(req))
    } catch (e) {
      this.#failed(e, 'schema')
    }
  }

  #remember(req: Request) {
    let name = req.headers.get('x-store')
    // The name is what says whether this object is the directory, so learning
    // it for the first time can change which vocabulary it speaks — and the
    // object was constructed before any request could tell it.
    if (name && this.#get('name') != name) {
      this.#put('name', name)
      this.#build()
    }
    // Which app this object holds is an app's question. The directory is not
    // one — it speaks the platform's vocabulary, which has no `grant` and no
    // `access`, and the kernel decides who may read and write it before the
    // request arrives (vocab.ts, `platformDoc`). A caller that names an app on
    // its way to the directory is naming an app whose row lives here, not the
    // object it is talking to, so the word is ignored rather than believed:
    // believing it installs @yaks/member's guard on a store with no seats and
    // writes a grant into a table that does not exist.
    if (this.#get('name') == PLATFORM_STORE) return
    let app = req.headers.get('x-yak-app')
    if (app && this.#get('app') != app) {
      this.#put('app', app)
      this.#build()
    }
    let said = req.headers.get('x-yak-access')
    if (said && this.#get('access') != said) {
      this.#put('access', said)
      this.#mode(mode(said))
    }
    // The address this app's letters leave from (directory.ts `mailbox`). Like
    // the access mode it is the directory's word and is followed rather than
    // argued with — an app renamed, or made the space's front page, writes
    // from its new address on the very next request. Nothing is rebuilt for
    // it: `#posting` reads the word at write time.
    let from = req.headers.get('x-yak-mail')
    if (from && this.#get('mail') != from) this.#put('mail', from)
  }

  // The app's access mode, in this store's own rows — what @yaks/member reads
  // to answer "and everyone else?". It is written straight through storage,
  // not through apply(): the platform's word about who may write is not an
  // application write and does not pass the application's guard, which would
  // refuse it (only an owner may write an `access`).
  #mode(m: Mode) {
    let app = this.#get('app')
    if (!app) return
    this.#patch([{ entity: { eid: app }, access: { mode: m } }])
  }

  // What the kernel has vouched about somebody, this incarnation, kept by
  // person: two requests can be in flight at once, and a `Vouch` held in one
  // field would be whichever of them spoke last. `#told` is what has already
  // been written down for them, so a session's second write costs no rows.
  #vouched = new Map<string, Vouch>()
  #told = new Map<string, string>()

  /**
   * Who this store knows, from what the kernel vouched: the person as an
   * entity of its own (so a byline resolves to somebody), the name to call
   * them by, and the level the platform says they hold on this app.
   *
   * It is a write-path plugin rather than a door's own step, because there is
   * more than one door — @yaks/api's `/apply`, @yaks/mcp's tools, whatever
   * mounts next — and the guard that reads these rows would otherwise hold
   * for one of them and not the others. `precondition` is where it belongs:
   * inside the batch's transaction, before @yaks/member's guard runs, so the
   * platform's word is a row by the time the rule asks for one, and a refused
   * batch rolls the row back with everything else it wrote.
   *
   * A read writes nothing at all: an app learns who its members are when one
   * of them writes to it, not when one of them looks at it.
   */
  /**
   * A word nobody declared, refused at the write door instead of dropped.
   *
   * @yaks/graph drops an unknown component on purpose — forward compatibility,
   * so a newer client's batch still lands (admit.ts). This platform has the
   * opposite problem: an app's own words are its `vocab.json`, and a `recipe`
   * silently dropped is a page that saved nothing and said it saved. So the
   * store that holds the vocabulary says where a word comes from, in the same
   * sentence the read door says it in (`#taught`).
   */
  #teaching: Plugin = {
    name: 'yak/teach',
    hooks: {
      normalize: (bundles) => {
        for (let b of bundles) {
          for (let [name] of comps(b)) {
            if (!this.#vocab.all.includes(name)) {
              throw new Refused(
                `unknown component: ${name}${teach(this.#bind)}`,
              )
            }
          }
        }
        return bundles
      },
    },
  }

  /**
   * A row read back, handed straight back. A reference reads as `{eid, name}`
   * (`#speak`) because outputs speak human, and the shape a door hands out must
   * be a shape it takes: a page that read a byline and writes it into a column
   * of its own is doing the ordinary thing, and refusing it would make every
   * such page carry a `.eid` of its own. So the object is lowered to the eid it
   * carries, on the way in, before anything checks a value.
   */
  #lowering: Plugin = {
    name: 'yak/lower',
    hooks: {
      normalize: (bundles) =>
        bundles.map((b) => {
          let out: Record<string, unknown> | null = null
          for (let [name, comp] of comps(b)) {
            if (!comp) continue
            for (let [col, v] of Object.entries(comp)) {
              let eid = (v as { eid?: unknown } | null)?.eid
              if (
                typeof eid != 'string' ||
                this.#vocab.column(name, col)?.category != 'ref'
              ) continue
              out ??= { ...b }
              out[name] = {
                ...(out[name] as Record<string, unknown>),
                [col]: eid,
              }
            }
          }
          return (out ?? b) as Bundle
        }),
    },
  }

  #vouching: Plugin = {
    name: 'yak/vouch',
    // The two rows the hook below writes — a person and their grant. Naming
    // them here puts them in the batch's own gather, so the store learns their
    // identities in the read every batch already takes rather than in one of
    // its own (T-34032).
    wants: (bundles) => {
      let who = actorOf(bundles)
      if (!who) return []
      let app = this.#get('app')
      return [{ eids: app ? [who, app, grantEid(app, who)] : [who] }]
    },
    hooks: {
      precondition: (bundles, tx) => {
        let who = actorOf(bundles)
        let v = who ? this.#vouched.get(who) : null
        if (!who || !v) return bundles
        let app = this.#get('app')
        let said = `${app ?? ''} ${v.level ?? ''} ${v.title ?? ''}`
        if (this.#told.get(who) == said) return bundles
        this.#told.set(who, said)
        // The app writing as itself (dispatch.ts `owning`, `env.APP`) is the
        // one actor that is not a person: it is already a row here, carrying
        // this store's `access`, and calling it a person would put the app in
        // its own `.person!` listing. Its grant is still written — that is
        // what @yaks/member's guard reads to admit the write.
        let out: Bundle[] = who == app ? [] : [{
          entity: { eid: who },
          person: {},
          ...(v.title ? { doc: { title: v.title } } : {}),
        }]
        if (app && v.level) {
          out.push({
            entity: { eid: grantEid(app, who) },
            grant: { app, person: who, access: v.level },
          })
        }
        if (!out.length) return bundles
        return then(tx.patch(out), () => bundles)
      },
      // The transaction is gone, taking the rows above with it — because the
      // batch was refused, or because it was only ever a rehearsal
      // (@yaks/graph `Checked`, the `?check=1` half of a write that spans two
      // stores). Either way what this object believes it has written down goes
      // too, or the next batch by that person would skip a row that is not
      // there.
      audit: (bundles) => {
        let who = actorOf(bundles)
        if (who) this.#told.delete(who)
        return bundles
      },
    },
  }

  /**
   * An app's letters: the address they leave from, and who may ask for one.
   *
   * The `from` is the platform's word, stamped over whatever the batch said.
   * The address is a claim about who wrote — a letter from
   * `ada.cookbook@yaks.app` is DKIM-signed by us and read by the world as
   * ours — and a column a client may write is a column a client may forge. A
   * letter the kernel writes is left alone unless it asks to leave: an
   * arrival (T-33687) keeps the sender's own `from`, out on the web, and the
   * receipt the platform files beside a sale (sell.ts) leaves from the app
   * like any other letter.
   *
   * Who may ask for one to leave is `FLOORS` below, not this plugin.
   */
  #posting(): Plugin {
    let letter = (b: Bundle): Bundle => {
      let mail = b[MAIL] as Comp | null | undefined
      // Dropping the envelope is not writing one, and a bundle that is neither
      // a letter nor an ask to send has nothing to say about an address.
      if (mail === null || (!mail && !b[DELIVER])) return b
      return {
        ...b,
        [MAIL]: { ...(mail ?? {}), from: this.#get('mail') ?? '' },
      }
    }
    return {
      name: 'yak/post',
      hooks: {
        normalize: (bundles) =>
          bundles.map((b) => this.#kernelling && !b[DELIVER] ? b : letter(b)),
      },
    }
  }

  // Whether the batch running right now came in at the kernel's door. A Durable
  // Object is single-threaded and its storage is synchronous, so `#trust()`
  // below runs `apply()` from the line that sets this to the line that clears
  // it without ever yielding: no other batch can be between the two. And the
  // failure it could have is the safe one — a flag cleared too early leaves the
  // guard on, which refuses a write rather than admitting one.
  #kernelling = false

  /**
   * @yaks/member's guard, with the one writer it is not about taken out.
   *
   * The guard asks whether the actor may write this app. The platform is not an
   * actor — it writes about the app rather than in it: the break it noted
   * (unseen.ts `noted`), the mark on a line it served. That door is
   * {@link Store.fetch}'s `x-yak-kernel` branch, which no client can reach
   * (door.ts `storeOf` strips the whole vouch set), and a batch through it
   * carries no person to hold a level — so the rule as written would refuse
   * exactly the writes the platform must always be able to make.
   *
   * The rule itself stays @yaks/member's. Only who it is asked about is ours,
   * and which of this platform's words ask a level of their own (`FLOORS`).
   */
  #guarding(app: string): Plugin {
    let plugin = members({ app, floors: FLOORS })
    let guard = plugin.hooks?.precondition
    return {
      ...plugin,
      hooks: {
        ...plugin.hooks,
        precondition: (bundles, tx) =>
          this.#kernelling || !guard ? bundles : guard(bundles, tx),
      },
    }
  }

  // One batch, applied as the caller the door decided it is. `trusted` is two
  // things at once and they are the same thing: @yaks/graph admits the
  // server-owned columns, and the guard above stands down.
  #trust(bundles: Bundle[], who: string | null, opts: ApplyOpts = {}) {
    return this.#asIs(signed(bundles, who ? { by: who } : null), opts)
  }

  // The same door, keeping whatever signature the batch already carries: what
  // the runner writes through (`#runner`). A call reached this store by the
  // ordinary door and @yaks/member's guard has already had its say about who
  // wrote it; the claim and the result beside it are the server's own
  // bookkeeping, and a tool's answer is the caller's own write, already signed
  // as them.
  #asIs(bundles: Bundle[], opts: ApplyOpts = {}) {
    this.#kernelling = true
    try {
      return this.#graph.apply(bundles, { ...opts, trusted: true })
    } finally {
      this.#kernelling = false
    }
  }

  #patch(bundles: Bundle[]) {
    this.#graph.storage.tx((tx) => tx.patch(bundles))
  }

  // ---- the calls (T-37605) -------------------------------------------------

  /**
   * The runner over this store: the app's declared commands as tools, rebuilt
   * when the manifest they come from moves. A call is a row here — what was
   * asked, the claim while it runs, and the answer beside it — so a call
   * wearing a wake is work asked for later, and nothing outside this object
   * has to be awake for it.
   */
  #runner = (g: Graph = this.#graph): Runner => {
    let said = this.#get('tools') ?? '{}'
    if (this.#runs?.said != said || g != this.#graph) {
      let declared: Tools = modern(
        JSON.parse(said || '{}') as Tools,
      )
      this.#runs = {
        said,
        run: runner(
          { ...g, apply: (change, opts) => this.#asIs(change, opts) },
          {
            host: g,
            tools: commands(declared),
            report: (error) => void this.#broke('tool', error),
          },
        ),
      }
    }
    return this.#runs.run
  }

  // The `tool` rows a call names, written when the manifest they come from
  // moves. A call points at a tool entity, so that row has to be standing
  // before anybody can write one — and a deploy is the moment to stand it up.
  #planting = async (): Promise<void> => {
    let said = this.#get('tools') ?? '{}'
    if (this.#get('planted') == said) return
    await this.#runner().ensure()
    this.#put('planted', said)
  }

  // ---- the clock (D-37562) -------------------------------------------------
  //
  // Every store keeps its own schedules and its own alarm. There is no
  // heartbeat over the platform: a Cron Trigger could only reach one object,
  // which made every app's schedules the directory's business and woke the
  // directory twelve times an hour to find nothing owed. A wake row is owed at
  // an instant, the runtime can be asked to come back at an instant, and that
  // is the whole mechanism.

  // How long a refused occurrence waits. A refusal leaves its wake due — a
  // precondition moved, a rule said no — and nothing else will touch that row,
  // so the object comes back for it rather than dropping it. A minute is the
  // same floor @yaks/wake's Deno loop caps its sleep at.
  static RETRY = 60_000

  // Point the alarm at the instant a wake names. `arm` keeps an alarm already
  // set for something sooner, since the object has one alarm and may hold many
  // wakes, and it serializes the read-compare-write per storage it is handed —
  // so the adapter below is built once and kept.
  #arming = (at: string | null | undefined): Promise<unknown> =>
    this.#alarm && at ? arm(this.#alarm, { at }) : Promise.resolve()

  // The next instant this object owes, off its own rows: what a tick arms
  // after it has fired, and what a request re-arms when the runtime lost the
  // alarm. `soonest` reads the earliest wake still ahead.
  #owed = async (now: number, floor = Infinity): Promise<void> => {
    let next = await soonest(this.#graph, now)
    let at = Math.min(next ?? Infinity, floor)
    if (Number.isFinite(at)) await this.#arming(new Date(at).toISOString())
  }

  /**
   * Fire the wakes due at `now`, then come back for the next one. The
   * runtime's own `alarm()` is this at the present instant; a caller naming
   * the instant is how a test reads a schedule without waiting for one.
   *
   * A refused occurrence stays due and its reason goes to this store's break
   * log — the directory's for the platform's sweeps, the app's for an app's —
   * and the alarm is set a minute out so nothing is silently dropped.
   */
  async tick(now = Date.now()): Promise<Ticked> {
    // The firing is the server's write, not a person's: a wake is the object's
    // own business, and @yaks/member's guard asks which person may write an
    // app's data. So it goes through the same door the kernel writes through,
    // carrying the tick's instant, which is the `#Now` its rules read.
    let result = await tick({
      read: (q, o) => this.#graph.read(q, o),
      apply: (b, o) => this.#trust(b as Bundle[], null, o),
    }, now)
    for (let { wake, error } of result.refused) {
      await this.#broke(`wake ${wake.entity.eid}`, error)
    }
    await this.#owed(now, result.refused.length ? now + Store.RETRY : Infinity)
    return result
  }

  /** The runtime's clock going off: whatever this object armed itself for. */
  async alarm(): Promise<void> {
    // Writes the log still holds are replayed first, which is what makes the
    // replay need nobody: the alarm set when one was kept wakes the object
    // after a deploy too. The oldest one's own request names the object for
    // a migration pass still ahead of it.
    let kept = oldest(this.#ctx.storage.sql)
    if (kept && this.#behind) await this.#pass(replayed(kept))
    if (this.#refused || this.#pending) {
      if (kept) await this.#retry()
      return
    }
    if (kept) {
      this.#stuck = false
      await this.#drain()
    }
    await this.tick()
  }

  // What this object was born owing: the rows its plugins declare — the
  // directory's sweeps — planted if they are missing, and the alarm set again
  // if the runtime has none. `seeded` never rewinds a wake somebody moved or
  // resumes one they paused, and the stamp means a store that already holds
  // them asks its storage once rather than its graph three times.
  #sow = async (): Promise<void> => {
    try {
      let rows = this.#get('name') == PLATFORM_STORE ? wakesOf(PLUGINS) : []
      let stamp = sha256(rows.map((r) => r.entity.eid).join('\n'))
      if (rows.length && this.#get('wakes') != stamp) {
        await seeded(this.#graph, rows, Date.now())
        this.#put('wakes', stamp)
      }
      if (this.#alarm && !(await this.#alarm.getAlarm())) {
        await this.#owed(Date.now())
      }
      // The app's own commands, standing: the `tool` rows a call names, and
      // one pass over the calls nobody is waiting on — one another process
      // wrote, one a crash left claimed, one whose wake fired while this
      // object was away. Only a store that has commands asks.
      if ((this.#get('tools') ?? '{}') != '{}') {
        await this.#planting()
        await reconcile(this.#runner())
      }
    } catch (e) {
      await this.#broke('wake seed', e)
    }
  }

  // A break this object noted about itself, written where it notes an app's
  // (unseen.ts `noted`): server-owned columns, through the kernel's own door.
  // Sentry hears it too, named by the store it happened in (sentry.ts).
  #broke = async (request: string, error: unknown) => {
    defect(error, { request, store: this.#get('name') })
    try {
      await this.#trust([{
        entity: { eid: crypto.randomUUID() },
        exception: {
          at: new Date().toISOString(),
          request,
          version: null,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack ?? '' : '',
        },
      }], null)
    } catch (why) {
      caught(why, { request: `note ${request}`, store: this.#get('name') })
    }
  }

  // ---- the passes (T-33809, T-34227) ---------------------------------------

  /** The migrations, at most once per object however many requests arrive at
   * once: the runtime's gate holds every other request while they run, and the
   * promise is kept so a second caller inside this incarnation waits on the
   * first rather than starting a second pass. */
  #pass(request: Request): Promise<void> {
    // Keep the settled promise: retries would report the same refusal on every
    // request, and a rejected runtime gate would restart the object.
    let go = () => {
      try {
        this.#passes(request)
      } catch (e) {
        this.#failed(e, this.#pending ? MARK : 'schema')
      }
      return Promise.resolve()
    }
    return this.#passing ??= this.#ctx.blockConcurrencyWhile
      ? this.#ctx.blockConcurrencyWhile(go)
      : go()
  }

  /** Every pass this object is behind, oldest first: the move off the
   * fleet-shaped store, then each one after it. A refusal stops the line —
   * a later pass reads what an earlier one wrote. */
  #passes(request: Request) {
    if (this.#pending) this.#carrying(request)
    // The second (T-34227): `space.home` becomes `home{}` on the app it named.
    if (!this.#refused) {
      this.#after(request, HOMED, housed, homed)
    }
    // The third (T-34390): the app addresses move out of the table the core
    // word `alias` now owns and into `former`.
    if (!this.#refused) {
      this.#after(request, FORMER, slugged, addressed)
    }
    // The fourth (T-34596): a domain's target moves out of `app`, which named
    // the one app it opened, and into `serves`, which names the app or the
    // whole space. Only the directory has a hostname to move.
    if (!this.#refused) {
      this.#after(request, SERVES, aimedOld, served)
    }
    // The fifth (T-34657): an app's handle — what its store and its script are
    // named by — becomes a column of its own instead of the address it was born
    // at. Only the directory has an app row to name.
    if (!this.#refused) {
      this.#after(request, HANDLED, unhandled, handled)
    }
    if (!this.#refused) {
      this.#after(request, FILED, unfiled, filed)
    }
    // The seventh (D-37943): a tool takes the id its name derives.
    if (!this.#refused) {
      this.#after(
        request,
        TOOLED,
        mistooled,
        (storage, o) => tooled(storage, { ...o, vocab: this.#graph.vocab }),
      )
    }
    // The eighth (C-37980): a copy runs like the space's own apps unless
    // sandboxed, and the build before this one reads it the same way.
    if (!this.#refused) {
      this.#after(request, SANDBOXED, untrusted, trusting)
    }
    this.#behind = false
  }

  /**
   * One pass after the first, whichever it is (migrate.ts `MARKS`): the move is
   * one transaction, and the marker is written only when it reconciles. An
   * object with nothing to move writes the marker and nothing else, so it is
   * never asked again — which is every app store for every one of these. The
   * restore path is the Durable Object's point-in-time recovery.
   *
   * The passes differ in three words each, so they are three arguments and not
   * copies of this: what the object still holds, the move, and the marker it
   * earns.
   */
  #after(
    request: Request,
    mark: string,
    holds: (storage: State['storage']) => boolean,
    move: (
      storage: State['storage'],
      o: { store: string; app: string | null },
    ) => Report,
  ) {
    let ctx = this.#ctx
    let name = request.headers.get('x-store') ?? ''
    let app = request.headers.get('x-yak-app')
    try {
      name ||= this.#get('name') ?? ''
      if (MARKS.indexOf(this.#get('migrated') ?? '') >= MARKS.indexOf(mark)) {
        return
      }
      if (!holds(ctx.storage)) return void this.#put('migrated', mark)
      ctx.storage.transactionSync(() => {
        let report = move(ctx.storage, { store: name, app })
        // Legacy passes write physical tables directly, outside graph tracking.
        // Reclassify their rows before any presence-based reads can observe them.
        if (this.#graph.vocab.comp('archetype')) {
          const sql = driver(ctx.storage)
          sql.exec('update entity set archetype = null')
          backfillArchetypes(sql, false)
        }
        if (!report.ok) throw new Unreconciled(report)
        // A marker and its rows must commit together, including on write failure.
        this.#put('migrated', mark)
      })
    } catch (e) {
      this.#failed(e, mark, name)
    }
  }

  /**
   * Carry, then reconcile — in that order, because the order is the safety.
   * The carry is one transaction that either lands whole or leaves the object
   * exactly as it was.
   */
  #carrying(request: Request) {
    let ctx = this.#ctx
    let slots = ctx.storage.kv
    // What the object is: the kernel says so on every request, and the store it
    // replaces wrote the same word into its own slots. Both are read, because
    // the vocabulary this schema is raised from depends on it.
    let name = request.headers.get('x-store') ??
      String(slots?.get('name') ?? '')
    for (let w of ['name', 'vocab', 'uses', 'tools'] as Word[]) {
      let held = w == 'name' ? name : slots?.get(w)
      if (held != null && String(held)) this.#put(w, String(held))
    }
    // The vocabulary those slots carry is the old object's, which may be the
    // short type map (migrate.ts `documented`): the carry raises the new schema
    // out of it, so it is the document before anything reads it.
    this.#documenting()
    this.#after(
      request,
      MARK,
      () => true,
      (storage, o) =>
        carry(storage, {
          ...o,
          vocab: vocabOfStore(name, this.#get('vocab') ?? {}),
          // A build failure must unwind the whole carry transaction.
          plant: () => this.#build(),
          grantEid,
        }),
    )
    this.#pending = false
  }

  #failed(e: unknown, mark: string, store = '') {
    let message = 'the migration refused'
    try {
      message = (e instanceof Error ? e.message : String(e)) || message
    } catch { /* a thrown value need not be printable */ }
    this.#refused = message
    this.#pending = false
    this.#behind = false
    // A refused store answers nothing, so it is a defect, not an answer:
    // Sentry hears it named by the store and the pass.
    let named = store
    try {
      named ||= this.#get('name') ?? ''
    } catch { /* a store too broken to read its own name */ }
    defect(e, { request: 'migration', store: named, mark })
    console.warn('store: migration refused', this.#refused)
  }

  /**
   * The object after a refusal. The rows are the old ones, exactly as they were
   * — the pass ran in one transaction and it unwound — and this object cannot
   * read them: they are in the fleet's shape, and everything above the storage
   * here is raised from a vocabulary that has no tables for it. So it says so,
   * and answers nothing else.
   *
   * There is no half-open door to hold here. What a page asks a store is
   * `/query?q=`, which the fleet's own door does not parse at all (it reads the
   * whole query string as the filter line), so an app that could still be read
   * "in the old grammar" is an app no client of it could read. A refusal that
   * says what happened is the whole of what is useful. `/graph` is the
   * exception, and only because it answers off the storage rather than off the
   * graph: the meter reads an object's size, and an object in this state still
   * has one.
   */
  #stalled(request: Request): Response {
    let why = this.#refused ?? 'this store has not migrated'
    if (new URL(request.url).pathname == '/graph') {
      return Response.json({
        db: `do:${this.#get('name') ?? ''}`,
        bytes: this.#ctx.storage.sql.databaseSize,
        migration: 'refused',
      })
    }
    return Response.json({ error: 'Refused', message: why }, {
      status: 503,
      headers: { 'x-yak-migration': 'refused' },
    })
  }

  /**
   * The object's door. What the kernel says about this object is read first —
   * it may rebuild everything above the storage — and `wake()` comes next, so
   * a batch applied by the request that woke this object still reaches the
   * sockets it inherited.
   */
  async fetch(request: Request): Promise<Response> {
    if (logged(request)) return this.#write(request)
    let no = await this.#ready(request)
    if (no) return no
    // Writes the log kept while this object could not apply them go first:
    // nothing is answered off rows they have yet to reach.
    await this.#settle()
    return this.#serve(request)
  }

  /** Everything before a door: the object brought up to date and told what
   * it is. A refusal to start is the answer, when there is one. */
  async #ready(request: Request): Promise<Response | null> {
    // The one pass, before this object answers anything (T-33809). It runs
    // inside the runtime's own gate, so every other request waits on it rather
    // than racing it, and it runs from a request rather than the constructor
    // because the kernel's vouch is what names this object and the app it holds.
    if (this.#behind) await this.#pass(request)
    if (this.#refused) return this.#stalled(request)
    this.#learn(request)
    if (this.#refused) return this.#stalled(request)
    this.#live.wake()
    // The clock, started. A wake row is owed at an instant and the runtime's
    // alarm is how this object comes back for it — but an object that has
    // never been asked anything is not running, so a request is the moment its
    // schedules are planted and a lost alarm is set again. Once per
    // incarnation, and the stamp keeps it to one read after the first.
    await (this.#sowing ??= this.#sow())
    return null
  }

  // ---- the write log (T-37968, writes.ts) ----------------------------------

  /**
   * A write, kept before anything else happens to it, then applied in its
   * turn by the one replay that runs at a time, which answers its caller as
   * the store always did. A write that finds the object refusing to start, or
   * the replay stopped on an earlier write that failed, is answered 202 and
   * waits in the log.
   */
  async #write(request: Request): Promise<Response> {
    let body = await request.text()
    let seq: number
    let unkept = async () => {
      let req = new Request(request, { body })
      return await this.#ready(req) ?? this.#serve(req)
    }
    if (!fits(body)) return unkept()
    try {
      seq = keep(this.#ctx.storage.sql, request, body)
    } catch (e) {
      // Storage that will not take a row: applied as it came, and said.
      defect(e, { request: 'write log', store: this.#name() })
      return unkept()
    }
    if (await this.#ready(request)) {
      return this.#park(seq, this.#refused ?? 'this app could not start')
    }
    if (this.#stuck) {
      return this.#park(seq, 'earlier writes to this app are still waiting')
    }
    let answer = new Promise<Response>((r) => this.#callers.set(seq, r))
    void this.#drain()
    return answer
  }

  /** The log from its oldest waiting write, one at a time, until it is empty
   * or a write fails for a reason that is not its own: that one and every
   * write after it wait, in order, for the alarm or the next incarnation.
   * Each write whose caller is still waiting (`#callers`) is answered as it
   * lands; the ones left waiting are told they are kept. */
  #drain(): Promise<void> {
    if (this.#draining) return this.#draining
    let sql = this.#ctx.storage.sql
    let run = async () => {
      // Yield once, so `#draining` is set before the loop can end and clear
      // it: a write that arrives in between must find the loop running.
      await null
      try {
        for (let k = oldest(sql); k; k = oldest(sql)) {
          let caller = this.#callers.get(k.seq)
          this.#callers.delete(k.seq)
          let r = await this.#land(k, !!caller)
          let failed = r.status >= 500 && held(sql, k.seq)
          caller?.(failed ? this.#park(k.seq, await said(r)) : r)
          if (failed) {
            this.#stuck = true
            break
          }
        }
      } catch (e) {
        this.#stuck = true
        defect(e, { request: 'write replay', store: this.#name() })
      }
      // Synchronously after the last look at the log: nothing can be kept
      // between that look and this line without finding the loop gone.
      this.#draining = null
      for (let [seq, caller] of this.#callers) {
        caller(this.#park(seq, 'earlier writes to this app are still waiting'))
      }
      this.#callers.clear()
    }
    return this.#draining = run()
  }

  /** One kept write, applied: out of the log when it commits or is refused
   * as asked, and waiting when it fails. `live` is a write whose caller is
   * still here to be told its refusal; a replay's refusal has nobody to tell,
   * so it stays in the log with its reason and is reported. */
  async #land(k: Kept, live: boolean): Promise<Response> {
    let sql = this.#ctx.storage.sql
    try {
      let r = await this.#commit(replayed(k), k.seq)
      if (r.status < 300) done(sql, k.seq)
      else if (r.status >= 500) tried(sql, k.seq)
      else if (live) done(sql, k.seq)
      else {
        let why = await said(r.clone())
        dead(sql, k.seq, why)
        defect(new Error(`a kept write no longer applies: ${why}`), {
          request: 'write replay',
          store: this.#name(),
        })
      }
      return r
    } catch (e) {
      defect(e, { request: 'write replay', store: this.#name() })
      return refuse(e)
    }
  }

  /** The log first, for a request that reads: unless a replay stopped on a
   * failure, which the alarm owns, or one is already running. */
  #settle(): Promise<unknown> | void {
    if (this.#draining) return this.#draining
    if (!this.#stuck && waiting(this.#ctx.storage.sql)) return this.#drain()
  }

  /** The caller's answer for a kept write, and the alarm that comes back for
   * it. */
  #park(seq: number, why: string): Response {
    void this.#retry()
    return parked(seq, why)
  }

  #retry = () => this.#arming(new Date(Date.now() + Store.RETRY).toISOString())

  // The name, for a report from an object that may be too broken to say it.
  #name(): string | null {
    try {
      return this.#get('name')
    } catch {
      return null
    }
  }

  /**
   * One batch in at `/apply`, the kernel's or a caller's. The graph's own
   * `apply()` is called in one synchronous step after `#landing` names the
   * kept write, so the `yak/writes` hook below takes exactly that write out
   * of the log in the transaction that commits its batch: never one without
   * the other, and so never applied twice.
   *
   * `x-yak-kernel` is the platform writing about its own data: the server-
   * owned columns are admitted and @yaks/member's guard stands down
   * (`#trust`). The flag is the kernel's by construction: a store is only
   * ever reached through a request the Worker builds from scratch, and
   * door.ts `storeOf` strips the whole vouch set from any request it is
   * handed, so it can never arrive from outside. An NDJSON import is
   * @yaks/api's `pour`, chunk by chunk.
   */
  async #commit(request: Request, seq: number | null = null) {
    if (poured(request)) return await this.#route(request)
    try {
      let body = JSON.parse(await request.text())
      if (!Array.isArray(body)) {
        throw new Refused('/apply takes a JSON array of bundles')
      }
      let kernel = request.headers.get('x-yak-kernel') == '1'
      let who = kernel ? null : await this.#auth(request)
      let out
      this.#landing = seq
      try {
        out = kernel
          ? this.#trust(body as Bundle[], vouchOf(request).person)
          : this.#graph.apply(signed(body as Bundle[], who))
      } finally {
        this.#landing = null
      }
      return json(await out)
    } catch (e) {
      return refuse(constrained(e), request)
    }
  }

  // The hook that closes the loop: inside the transaction of the batch a kept
  // write brought, that write leaves the log. Every other batch — an effect's,
  // a tick's, one applied after an await — finds `#landing` empty.
  #logging: Plugin = {
    name: 'yak/writes',
    hooks: {
      commit: (bundles) => {
        if (this.#landing != null) {
          done(this.#ctx.storage.sql, this.#landing)
          this.#landing = null
        }
        return bundles
      },
    },
  }

  /** Every door but the write log's, for an object that is ready. */
  async #serve(request: Request): Promise<Response> {
    let path = new URL(request.url).pathname
    let kernel = request.headers.get('x-yak-kernel') == '1'
    if (path == '/vocab') return this.#vocabDoor(request)
    // The three slots beside the vocabulary: the words this app uses but does
    // not home (T-32728), the tools it declares (T-32685), and what the object
    // weighs. None is graph data — a declaration holds no rows and a byte count
    // is not one — so each is a word in this object's own memory, and the
    // kernel is the only caller.
    if (path == '/uses') return this.#slot(request, 'uses')
    if (path == '/storage') return this.#storage(request)
    if (path == '/tools') {
      let was = this.#get('tools') ?? '{}'
      let answer = await this.#slot(request, 'tools')
      if (!answer.ok || request.method != 'POST') return answer
      let now = this.#get('tools') ?? '{}'
      // The views this manifest names, compared: the set of pages its
      // commands draw their answers in, which is what `resources/list` is made
      // of, and the kernel tells everyone who can reach the app when it moved
      // (declared.ts `viewsMoved`). The commands themselves move no list —
      // they are not tools, and the tool roster is fixed (T-34541).
      // The rows those commands are called at (`#planting`): a deploy is what
      // moves the manifest, so a deploy is what stands them up.
      if (now != was) await this.#planting()
      let said = await answer.json() as Record<string, unknown>
      return Response.json({ ...said, views: viewed(now) != viewed(was) })
    }
    if (path == '/graph') {
      return Response.json({
        db: `do:${this.#get('name') ?? ''}`,
        bytes: this.#ctx.storage.sql.databaseSize,
      })
    }
    // The app this store held is gone (tools.ts app_delete, erase.ts
    // `emptied`): everything in it, at once. Kernel only, like the trusted
    // write — a client's request never carries the flag.
    if (path == '/' && request.method == 'DELETE') {
      if (!kernel) return json({ error: 'NotFound', message: 'no route' }, 404)
      return this.#erase(request)
    }
    // Where this object's storage stands, and putting it back (recover.ts,
    // T-34507). Kernel only, like the erase: a whole store going backwards is
    // the platform's act on behalf of a member who may write it, and a client
    // never spells a store's path.
    if (path == '/restore') {
      if (!kernel) return json({ error: 'NotFound', message: 'no route' }, 404)
      return this.#recovery(request)
    }
    // The socket is a read that stays open, and it is the one door @yaks/api
    // does not answer here — hibernation is the runtime's, so `sockets` takes
    // it — which would leave it the one door with no policy on it. So it asks
    // the same seam, by hand, at the handshake.
    if (path == '/ws') {
      try {
        await this.#auth(request)
      } catch (e) {
        return refuse(e, request)
      }
      return this.#live.accept(request)
    }
    // A batch is applied here, whoever sent it; a dry run is @yaks/api's.
    if (
      path == '/apply' && request.method == 'POST' &&
      (kernel || logged(request))
    ) {
      return this.#commit(request)
    }
    if (path == '/query') {
      let url = new URL(request.url)
      let line = url.searchParams.get('q') ?? ''
      let no = unserved(line)
      if (no) return refuse(new Refused(no))
      // An aggregate is not a listing — `.count!` answers one number — and
      // @yaks/api's read door answers bundles, which is the wrong half of the
      // compiled statement. So it is answered here, off the raw rows, in the
      // shape every door on this platform says it in. A line that does not
      // parse is the caller's to fix, answered 400 like any other refusal.
      try {
        let agg = aggOf(line)
        if (agg) {
          await this.#auth(request)
          return await this.#counted(line, agg)
        }
      } catch (e) {
        return refuse(e, request)
      }
      return await this.#kinded(await this.#route(request), line)
    }
    return await this.#route(request)
  }

  // The word a row is named by. `kind` is not a column and no client can derive
  // it: it is the most specific component this vocabulary says the entity wears
  // (@yaks/vocab `kindOf`), and only a store holding the vocabulary can say
  // which that is. Every caller above reads it — the composing read calls a row
  // by it (reach.ts), a page's listing draws with it, and the guide documents it
  // on every row.
  #kind = (row: Bundle): Bundle => ({
    kind: this.#vocab.kindOf(row as Record<string, unknown>),
    ...row,
  })

  // Outputs speak human (db.ts `human()`): a column that references a person
  // answers `{eid, name}` when this store knows who that is, and the bare eid
  // when it does not. A view gets one query, and a byline it would need a second
  // question for is no byline — the inline leaderboard drew "someone" on every
  // row while `created.by` was a uuid (C-32730 item 5). Writes are unmoved: the
  // value is the eid, and a read shape handed back is lowered to it.
  //
  // Which columns reference is the vocabulary's word (`refCols`), and who among
  // them is a person is this store's own rows — the writer it minted when they
  // first wrote here, wearing what the kernel said to call them.
  #speak = (rows: Bundle[]): Bundle[] | Promise<Bundle[]> => {
    let refs = new Set(this.#vocab.refCols().map(([c, p]) => `${c}.${p}`))
    let ref = (comp: string, col: string) => refs.has(`${comp}.${col}`)
    let mentioned = new Set<string>()
    for (let row of rows) {
      for (let [comp, held] of Object.entries(row)) {
        if (!held || typeof held != 'object' || Array.isArray(held)) continue
        for (let [col, v] of Object.entries(held)) {
          if (typeof v == 'string' && ref(comp, col)) mentioned.add(v)
        }
      }
    }
    if (!mentioned.size) return rows
    return then(detached(this.#graph.storage).get([...mentioned]), (found) => {
      let names = new Map<string, string>()
      for (let b of found) {
        let title = (b.doc as { title?: string } | undefined)?.title
        if (b.person && title) names.set(b.entity.eid, title)
      }
      return named(rows as Row[], ref, () => names) as Bundle[]
    })
  }

  // What a listing carries, beside what it selects (Jeff, 2026-09-03): "we
  // should query for the exact components we want: `.book!&.recipe?` = must be
  // book, recipe is optional but requested. asking for all comps is i imagine
  // most useful for debugging". So an answer carries the components the filter
  // names — by presence (`.book!`), by request (`.loan?`), or by a predicate of
  // its own — and nothing else. A filter that names none (an `id=` fetch, a
  // bare search term) left nothing out and answers the whole bundle, which is
  // also the only useful answer to someone who does not yet know what they
  // found; `*` is the debugging form that asks for everything by name.
  //
  // A component asserted absent (`.archived=`) names no component the answer
  // could carry, which is also what keeps the door's own platform screens
  // (listing.ts `asking`) from reading as requests.
  #wanted(line: string): Set<string> | null {
    let clauses = parse(line).clauses
    // `*` is the grammar's widest projection (@yaks/query), so every door that
    // parses the line reads it the same way and none has to strip it first.
    if (clauses.some((c) => c.kind == 'every')) return null
    let want = new Set<string>()
    for (let c of clauses) {
      if (c.kind != 'pred' || !c.path.length) continue
      // Absence is not a request: `.archived=` names no component the answer
      // could carry, which is also what keeps the door's own platform screens
      // (listing.ts `asking`) from reading as one.
      let absent = c.op == '=' &&
        (c.value == null || (c.value.kind == 'scalar' && !c.value.raw))
      if (absent) continue
      try {
        let comp = this.#vocab.aim(c.path.join('.'), c.op == '!')[0]?.comp
        if (comp && comp != SPINE) want.add(comp)
      } catch { /* a word this store never planted asks for nothing */ }
    }
    return want.size ? want : null
  }

  // The rows, cut to what was asked for. The spine and the `kind` name a row,
  // and a text query's `rank` is the answer's own word about it, so those three
  // ride whatever the filter said.
  #only = (rows: Bundle[], want: Set<string> | null): Bundle[] =>
    !want ? rows : rows.map((r) =>
      Object.fromEntries(
        Object.entries(r).filter(([k]) =>
          k == SPINE || k == 'kind' || k == 'rank' || want.has(k)
        ),
      ) as Bundle
    )

  // The read door's half of `#teaching`: `unknown prop: .recipe` is true and
  // useless on its own, so the store that holds the vocabulary adds where a
  // word of your own comes from. The directory says nothing of the kind — its
  // callers are the kernel's own.
  async #taught(answer: Response): Promise<Response> {
    if (answer.ok || this.#get('name') == PLATFORM_STORE) return answer
    let said = await answer.json() as { error?: string; message?: string }
    return /^unknown (prop|component)/.test(said.message ?? '') &&
        !said.message!.includes(url(this.#bind, '/docs.md'))
      ? Response.json({ ...said, message: said.message + teach(this.#bind) }, {
        status: answer.status,
      })
      : Response.json(said, { status: answer.status })
  }

  // One aggregate, as every door on this platform says it: a count is a
  // number, a distinct is the values, a tally is how many rows each.
  // @yaks/sql answers all three as one value→n shape, so this is the reading.
  async #counted(line: string, agg: Agg): Promise<Response> {
    let rows = await this.#graph.rows(line) as { value: string; n: number }[]
    if (agg == 'count') return Response.json({ count: rows[0]?.n ?? 0 })
    let said = rows.map((r) => [String(r.value ?? ''), r.n] as const)
    return Response.json(
      agg == 'distinct'
        ? { distinct: said.map(([v]) => v) }
        : { tally: Object.fromEntries(said) },
    )
  }

  // A text term ranks as well as filters: a search answers closest first, and
  // each row says how close (public/client.js `search`, and reach.ts reads the
  // same word to merge two apps' hits into one order). @yaks/sql compiles a
  // bare word as a predicate and stops there, so the ranking is read off the
  // very index it matched through (@yaks/fts) and painted on the rows the
  // filter already chose. `rank` is the answer's own word about a row, never a
  // component: nothing stores it and no vocabulary declares it.
  //
  // bm25 counts down — a closer match is a smaller number, and they are
  // negative — so what a page reads is its negation, where bigger is better.
  #ranked(rows: Bundle[], line: string): Bundle[] {
    let text = parse(line).clauses
      .flatMap((c) => c.kind == 'text' ? [c.value] : []).join(' ')
    if (!text.trim() || !rows.length) return rows
    // The same declared fields the boot schema and membership were cut from.
    let hits = find(
      this.#drive,
      fields(this.#vocab),
      text,
      { limit: Math.max(rows.length, 20) },
    )
    let at = new Map(hits.map((h, i) => [h.entity, { i, h }]))
    return rows
      .map((b) => {
        let hit = at.get(b.entity.eid)
        return hit
          ? { ...b, rank: { score: -hit.h.rank, snip: hit.h.snippet } }
          : b
      })
      .sort((a, b) =>
        (at.get(a.entity.eid)?.i ?? rows.length) -
        (at.get(b.entity.eid)?.i ?? rows.length)
      )
  }

  async #kinded(answer: Response, line: string): Promise<Response> {
    if (!answer.ok) return this.#taught(answer)
    let rows = await answer.json()
    if (!Array.isArray(rows)) return Response.json(rows)
    let cut = this.#only(
      this.#ranked(rows as Bundle[], line),
      this.#wanted(line),
    )
    return Response.json(await this.#speak(cut.map(this.#kind)))
  }

  // The same word on a subscription's frames, because a subscription is that
  // query still answering: a page that swaps `query()` for `subscribe()` must
  // get the same rows (public/client.js). The sink a socket hands in is wrapped
  // once per sink, since `close` and `drop` find a subscription by the sink it
  // was opened with.
  #naming(subs: Subs): Subs {
    let wrapped = new Map<Sink, Sink>()
    // What each subscription on that sink asked for, by its id, so a frame is
    // cut to the same components `/query` answers with.
    let wants = new Map<Sink, Map<string, Set<string> | null>>()
    let by = (sink: Sink): Sink => {
      let held = wrapped.get(sink)
      if (!held) {
        wrapped.set(
          sink,
          held = (f) => {
            if (!f.bundles) return sink(f)
            let want = wants.get(sink)?.get(String(f.id)) ?? null
            then(
              this.#speak(this.#only(f.bundles, want).map(this.#kind)),
              (bundles) => sink({ ...f, bundles }),
            )
          },
        )
      }
      return held
    }
    return {
      open: (sink, id, query) => {
        let mine = wants.get(sink) ?? new Map()
        wants.set(sink, mine)
        // `true` is a subscription to everything, which names no component and
        // so cuts nothing.
        mine.set(String(id), query === true ? null : this.#wanted(query))
        return subs.open(by(sink), id, query)
      },
      close: (sink, id) => {
        wants.get(sink)?.delete(String(id))
        return subs.close(by(sink), id)
      },
      drop: (sink) => {
        wants.delete(sink)
        return subs.drop(by(sink))
      },
      commit: subs.commit,
      // A relay carries no membership news and no stored rows, so there is
      // nothing here to rename or cut — only the sink to translate.
      relay: (sink, bundles) => subs.relay(by(sink), bundles),
      relaying: (sink) => subs.relaying(by(sink)),
      relayed: (sink, keys) => subs.relayed(by(sink), keys),
    }
  }

  // One of the object's own memory slots as a door: a GET reads back what it
  // last accepted, a POST replaces it whole. The body is stored as written —
  // whoever posts it is the one that can check it against the app's words
  // (tools.ts `released`), and a slot that parsed its own content would be a
  // second vocabulary in the object.
  async #slot(request: Request, word: Word): Promise<Response> {
    if (request.method == 'GET') {
      return Response.json(JSON.parse(this.#get(word) ?? '{}'))
    }
    if (request.method != 'POST') {
      return Response.json(
        { error: 'NotAllowed', message: `/${word} takes GET or POST` },
        { status: 405, headers: { allow: 'GET, POST' } },
      )
    }
    let body = await request.text()
    let held: unknown
    try {
      held = JSON.parse(body.trim() || '{}')
    } catch {
      held = null
    }
    if (!held || typeof held != 'object' || Array.isArray(held)) {
      return json(
        { error: 'Refused', message: `/${word} takes a JSON object` },
        400,
      )
    }
    let now = JSON.stringify(held)
    if (now != (this.#get(word) ?? '{}')) this.#put(word, now)
    return Response.json({ ok: true, [word]: Object.keys(held) })
  }

  // A person's saved keys (apps.ts `/storage`, public/storage.js): GET them
  // all, or POST `{set, remove, clear}` to change them. The person is the
  // kernel's vouch and nobody else's, so one person never reads another's.
  // Held to a megabyte of text each — a page's preferences and its drafts,
  // not a second database beside the graph.
  async #storage(request: Request): Promise<Response> {
    let person = vouchOf(request).person
    if (!person) {
      return json({ error: 'Refused', message: 'nobody to keep it for' }, 401)
    }
    let word = `storage:${person}` as const
    let held = JSON.parse(this.#get(word) ?? '{}') as Record<string, string>
    if (request.method == 'GET') return Response.json(held)
    let sent = await request.json().catch(() => null) as {
      set?: Record<string, unknown>
      remove?: unknown[]
      clear?: boolean
    } | null
    if (!sent || typeof sent != 'object') {
      return json(
        { error: 'Refused', message: '/storage takes a JSON object' },
        400,
      )
    }
    let next: Record<string, string> = sent.clear ? {} : { ...held }
    for (let k of sent.remove ?? []) delete next[String(k)]
    for (let [k, v] of Object.entries(sent.set ?? {})) next[k] = String(v)
    let text = JSON.stringify(next)
    if (text.length > STORED) {
      return json({ error: 'Refused', message: 'storage is full' }, 413)
    }
    this.#put(word, text)
    return Response.json({ ok: true, keys: Object.keys(next).length })
  }

  // Everything in this object, gone, and the object born again on the spot:
  // an app made later at the same address finds a planted, empty graph rather
  // than one with no tables at all. `deleteAll` takes the object's own memory
  // with it, so the name it answers to is written back before it boots — that
  // word is what says which vocabulary it speaks.
  async #erase(request: Request): Promise<Response> {
    let name = this.#get('name') ?? ''
    // The pages watching this app are watching nothing now. `close` is the
    // runtime's own on a server-side socket; @yaks/durable-object's `Wire` names
    // only what it sends, so the method is asked for structurally here.
    for (let ws of this.#ctx.getWebSockets() as Closable[]) {
      this.#live.close(ws)
      try {
        ws.close?.(1000, 'deleted')
      } catch { /* already gone */ }
    }
    await this.#ctx.storage.deleteAll()
    this.#ctx.storage.sql.exec(KV)
    this.#ctx.storage.sql.exec(WRITES)
    if (name) this.#put('name', name)
    this.#boot()
    if (this.#refused) return this.#stalled(request)
    return Response.json({ ok: true })
  }

  /**
   * Where this object's storage IS, and putting it back there (Cloudflare's
   * point-in-time recovery, T-34507).
   *
   * A GET reads bookmarks and changes nothing: `from` is where the object
   * stands right now — which is the way back from any restore, and therefore
   * the thing the caller writes down before asking for one — and `to`, when a
   * moment was named, is the bookmark for that moment.
   *
   * A POST restores. The restart is a hurry and not the mechanism:
   * `onNextSessionRestoreBookmark` is written down by the runtime, so the
   * recovery happens whenever this object next starts even if the abort never
   * lands. Which is why the answer goes out first — `abort` fails every
   * in-flight request, including the one asking for this — and the restart
   * rides a turn of the loop behind it.
   */
  async #recovery(request: Request): Promise<Response> {
    let s = this.#ctx.storage
    try {
      if (request.method != 'POST') {
        if (!s.getCurrentBookmark) throw new Refused(NO_PITR)
        let from = await s.getCurrentBookmark()
        let at = new URL(request.url).searchParams.get('at')
        if (!at) return Response.json({ from, to: '' })
        if (!s.getBookmarkForTime) throw new Refused(NO_PITR)
        let to = await s.getBookmarkForTime(new Date(at))
        return Response.json({ from, to })
      }
      let said = await request.json() as { bookmark?: string }
      if (!said?.bookmark) throw new Refused('/restore takes a bookmark')
      if (!s.onNextSessionRestoreBookmark) throw new Refused(NO_PITR)
      let undo = await s.onNextSessionRestoreBookmark(said.bookmark)
      let ctx = this.#ctx
      if (ctx.abort) setTimeout(() => ctx.abort?.('restoring'), 0)
      return Response.json({ undo })
    } catch (e) {
      // A runtime that offers none of this throws its own sentence, which is
      // handed on as a refusal rather than a 500: nothing broke, the back end
      // simply cannot do it. Where it can, a throw is ours, and Sentry hears.
      if (!(e instanceof Refused)) {
        caught(e, { request: 'restore', store: this.#get('name') })
      }
      return refuse(e instanceof Refused ? e : new Refused(String(e)))
    }
  }

  // The app's own components (vocab.json): a GET reads back what this store
  // last accepted, a POST replaces it. The manifest is loaded — and refused —
  // before a byte of it is written down, so a refusal leaves the store exactly
  // as it was. The kernel is the only caller; a client never spells a store's
  // path.
  //
  // The answer is what this app now says and what moved, which naming the
  // components does not tell whoever deployed it (C-32652 item 4): a renamed
  // column arrives beside the old one, and `added` is how they see that. Nothing
  // ever leaves — the DDL is additive and a column's rows are already written —
  // so `dropped` is empty and stays that way.
  //
  // What is written, kept and answered is one thing: the document (T-37546).
  // A manifest is a JSON Schema document and nothing else — a keyword is the
  // column's (`search`, `stamped`, a reference's `death`), and a manifest
  // flattened to bare type words dropped every one of them before any store
  // could read it.
  #vocabDoor(request: Request): Response | Promise<Response> {
    if (request.method == 'GET') {
      return Response.json(meant(this.#get('vocab') ?? '{}'))
    }
    if (request.method != 'POST') {
      return Response.json(
        { error: 'NotAllowed', message: '/vocab takes GET or POST' },
        { status: 405, headers: { allow: 'GET, POST' } },
      )
    }
    return request.text().then((body) => {
      try {
        let next = appDoc(body)
        let held = unplantable(next)
        if (held.length) throw new Error(held.join('; '))
        let { doc, dropped, added, kept } = grew(
          appDoc(this.#get('vocab') ?? '{}'),
          next,
          (name) => this.#rows(name),
        )
        appVocab(doc)
        // The declaration and its DDL must roll back together on boot failure.
        this.#boot(() => {
          this.#put('vocab', JSON.stringify(doc))
          for (let name of dropped) {
            this.#ctx.storage.sql.exec(
              `drop table if exists "${name.replaceAll('"', '""')}"`,
            )
          }
        })
        if (this.#refused) return this.#stalled(request)
        return Response.json({
          ok: true,
          // The app's own words, not the whole vocabulary it speaks: a store's
          // `/vocab` is what it homes, which is how a deploy across a space
          // knows whose a component is (reach.ts, T-32700).
          comps: Object.keys(doc.$defs ?? {}),
          dropped,
          added,
          kept,
        })
      } catch (e) {
        return Response.json({
          error: 'Refused',
          message: e instanceof Error ? e.message : String(e),
        }, { status: 400 })
      }
    })
  }

  // How many rows one component holds — the question only a store can answer,
  // and what decides whether a word the manifest stopped naming may leave. A
  // table that is not there holds nothing.
  #rows(name: string): number {
    try {
      let [row] = [...this.#ctx.storage.sql.exec(
        `select count(*) as n from "${name.replaceAll('"', '""')}"`,
      )] as { n: number }[]
      return Number(row?.n ?? 0)
    } catch {
      return 0
    }
  }

  /** A frame from a client: a subscription opened or closed. */
  webSocketMessage(ws: Wire, data: string | ArrayBuffer): void {
    // A hibernated socket outlives a deploy, so one opened against the store
    // this class replaces can wake this object — before its first request, and
    // therefore before anything above the storage exists. There is nothing to
    // serve it: hang up, and the page opens a socket onto whatever answers next.
    if (this.#unbuilt) return void this.#hangUp(ws)
    this.#live.message(ws, data)
  }

  /** That client went away. */
  webSocketClose(ws: Wire): void {
    if (!this.#unbuilt) this.#live.close(ws)
  }

  /** Whether `#boot()` has yet to run: the migration is still ahead of this
   * object, or it refused and nothing above the storage was ever raised. */
  get #unbuilt(): boolean {
    return this.#pending || this.#refused != null
  }

  #hangUp(ws: Wire) {
    try {
      ;(ws as Closable).close?.(1012, 'migrating')
    } catch { /* already gone */ }
  }
}
