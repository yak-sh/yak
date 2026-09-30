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
// never moves: it took the name from the fleet-shaped object it replaced
// (T-33807).
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
  type Frame,
  type Handler,
  json,
  poured,
  refuse,
  served,
  signed,
  type Sink,
  type Subs,
  subscriptions,
  Unauthorized,
} from '@yaks/api'
import {
  blobRead,
  blobs,
  blobSchema,
  representations,
  sqliteBlobs,
} from '@yaks/blob'
import {
  as,
  col,
  count,
  type CreateTable,
  type Derived,
  type Driver,
  eq,
  notNull,
  type Raw,
  render,
  select,
  table,
  val,
} from '@yaks/sql'
import { FIT, inspect as inspectStorage, schema } from '@yaks/sqlite'
import {
  driver,
  type DurableSql,
  type DurableStorage,
  type Hibernation,
  profile,
  type Sockets,
  sockets,
  storage,
  type Wire,
} from '@yaks/durable-object'
import { type Effects, effects } from '@yaks/effects'
import { secrets } from '@yaks/secrets'
import { edges } from '@yaks/edge'
import { keys } from '@yaks/key'
import { aliases } from '@yaks/alias'
import {
  type Field,
  fields,
  find,
  schema as ftsSchema,
  search,
} from '@yaks/fts'
import { admitSchema } from '@yaks/graph/schema'
import {
  drain,
  type Field as Text,
  left as unembedded,
  meaning,
  schema as vectorSchema,
  semantic,
} from '@yaks/embedding'
import { after } from '@yaks/fp'
import {
  type Actor,
  type ApplyOpts,
  type Bundle,
  type Comp,
  comps,
  type Graph,
  graph,
  type Plugin,
  Refused,
  sha256,
} from '@yaks/graph'
import { DELIVER, MAIL, mailbox } from '@yaks/mail'
import { models } from '@yaks/model'
import { sessions } from '@yaks/session'
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
import { effectsIn, type Vocab, type VocabDoc } from '@yaks/vocab'
import { reconcile, type Runner, runner } from '@yaks/tools'
import { commands, type Tools } from '@yaks/tools/declared'
import { rouse, soonest, tick, type Ticked, wakes } from '@yaks/wake'
import { type Alarm, arm } from '@yaks/wake/cloudflare'
import {
  asking,
  mentions,
  named,
  type Names,
  PLATFORM,
  type Row,
} from './listing.ts'
import {
  effected,
  installsOf,
  rulesOf,
  type Stored,
  wakesOf,
} from './plugin.ts'
import { PLUGINS } from './plugins.ts'
import { builderModelTool } from './builders.ts'
import type { Env } from './env.ts'
import { resumed, seeded } from './wake.ts'
import type { Binding } from './post.ts'
import { ledger } from './ledger.ts'
import {
  doorOf,
  GIT_STORE,
  IDEMPOTENCY,
  type Namespace,
  PLATFORM_STORE,
} from './door.ts'
import { type Meta, metaOf } from './meta.ts'
import { caught, defect } from './sentry.ts'
import { counts, hop, type Tally, tallying } from './lib/hops.ts'
import {
  BATCHES,
  type Mark,
  type Moving,
  PAUSE,
  rehearse,
  type Rule,
  RULES,
  runs,
  SIZE,
  type Stamp,
  type Standing,
  step,
} from './mover.ts'
import { weighed } from './meter.ts'
import { embedder, SPACE, texts } from './embedding.ts'
import { directoryOf } from './directory.ts'
import { commandWorker } from './dispatch.ts'
import { vaultOf } from './vault.ts'
import {
  aside,
  constrained,
  dead,
  done,
  first,
  fits,
  held,
  interrupted,
  keep,
  type Kept,
  kept,
  keyed,
  landed,
  logged,
  next,
  parked,
  raise,
  replayed,
  retry,
  revived,
  said,
  type Sent,
  started,
  waiting,
  writes,
} from './writes.ts'

// A JSON answer's headers, for one the write log kept as text.
let JSONED = { headers: { 'content-type': 'application/json' } }
import { apex, url } from './host.ts'
import {
  documented,
  install,
  rebuild,
  recut,
  requestIds,
  respelled,
  retire,
  shed,
  unholed,
  unworded,
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
  unsaid,
} from './vocab.ts'

/**
 * Which words an object wakes with, from the one thing that decides it: which
 * object it is. Two names on this platform are not apps — the directory
 * (`yak/platform`) and the git object graph (`yak/git`, D-34943) — and each
 * speaks its own vocabulary instead of an app's `vocab.json`. Every other name
 * is an app.
 *
 * It is a function rather than branches because every place that builds a
 * store has to answer it the same way, and a third store would otherwise be a
 * word added in one of them and forgotten in the other.
 */
export let vocabOfStore = (name: string, declared: unknown = {}): Vocab =>
  name == PLATFORM_STORE
    ? platformVocab()
    : name == GIT_STORE
    ? gitVocab()
    : appVocab(declared)

/** What a store raises out of its words (`#build`): the words, whether it is
 * one of the platform's own two stores rather than an app, what its storage
 * reads a stored value through, which properties are searched, and the schema
 * as one word. */
type Shape = {
  vocab: Vocab
  own: boolean
  derived: Derived
  searchable: Field[]
  stamp: string
}

// The shapes this isolate has raised, the most recent few. A shape is pure in
// which store it is and the `vocab.json` it holds, and one isolate wakes many
// objects, so a wake under words it has seen loads, renders and hashes nothing.
let shapes = new Map<string, Shape>()
let SHAPES = 16

let shapeOf = (name: string, declared: string | null): Shape => {
  // Neither the directory nor the git object graph is an app: each speaks its
  // own words whatever it holds, so its name is the whole key.
  let own = name == PLATFORM_STORE || name == GIT_STORE
  let key = own ? name : declared == null ? 'app' : `app ${declared}`
  let held = shapes.get(key)
  if (held) {
    // Keep the shape the isolate reaches for — the platform's own, and the app
    // core every store that declares nothing shares — hot: a hit is the most
    // recently used, so a burst of one-off declarations never evicts it.
    shapes.delete(key)
    shapes.set(key, held)
    return held
  }
  let vocab = vocabOfStore(name, declared ?? {})
  let read = blobRead(vocab)
  let derived = { ...read, ...(own ? {} : appDerived(vocab)) }
  let searchable = fields(vocab)
  // The blob table first: the `doc_value` view and the search triggers read a
  // body's text out of it, so it has to be standing before they are.
  let ddl = [
    ...blobSchema(),
    ...schema(vocab, derived),
    ...ftsSchema(searchable, read),
    ...vectorSchema(),
  ]
  // With the revision of the fitting that brings standing tables to it
  // (@yaks/sqlite `FIT`), which reads what it changes off the tables: a store
  // an older fitting left behind installs once more when that learns more.
  let stamp = sha256(
    [FIT, ...ddl.map((s) => render(s).sql)].join('\n'),
  )
  let shape = { vocab, own, derived, searchable, stamp }
  shapes.set(key, shape)
  if (shapes.size > SHAPES) shapes.delete(shapes.keys().next().value!)
  return shape
}

/**
 * The slice of a `DurableObjectState` this object needs: its storage, and its
 * hibernatable sockets. A Worker's own `DurableObjectState` satisfies it.
 *
 * Two things beyond @yaks/durable-object's own slice, because the platform asks
 * this object for them and no app ever does. `databaseSize` is how many bytes
 * it holds — the only per-app storage figure that exists, since Cloudflare's
 * storage dataset has no per-object dimension (the store tells the directory,
 * `#tell`). `deleteAll` is the one way to empty an object: dropping the tables
 * leaves metadata behind, and an object whose storage is empty ceases to exist.
 */
export type State = Hibernation & {
  storage: DurableStorage & {
    sql: DurableSql & { databaseSize: number }
    deleteAll(): Promise<void>
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
  | 'release'
  | `vocab:${string}`
  | `uses:${string}`
  | `tools:${string}`
  | `seed:${string}`
  | 'seeded'
  | 'app'
  | 'access'
  | 'mail'
  | 'schema'
  | 'wakes'
  | 'planted'
  | 'effect-migrated'
  // How far each rule of the mover got here (mover.ts), under its mark.
  | Mark
  // The bytes it last told the directory it holds (`#tell`).
  | 'weighed'
  // One person's localStorage in a sandboxed app (installed.ts): their keys
  // as one JSON object, kept here rather than as rows, which the app's other
  // readers could query.
  | `storage:${string}`
// The most one person keeps in one app's storage, in characters of JSON.
let STORED = 1024 * 1024

let KV: CreateTable = {
  t: 'create table',
  name: 'yak_kv',
  ifNot: true,
  cols: [
    { name: 'k', type: 'text', pk: true },
    { name: 'v', type: 'text', notNull: true },
  ],
}

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

// The piece of the wider platform grammar an app's store refuses by name
// rather than answering some other way (public/docs/querying.md, where it is
// written down as this store's own limit). A work lane is the fleet's board,
// which nothing here has, and an empty answer to a question about one would
// read as "no rows" rather than "not that question".
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
 *   order    what was sold: its properties are the webhook's alone (vocab.ts),
 *            and an owner may clear one
 *   deliver  the ask to send a letter, which leaves under the platform's
 *            name — an open app with no floor here is an open relay, and the
 *            first spam run would take the zone's reputation with it. Writing
 *            the letter is not held to anything; a draft is ordinary data.
 *   using    the ask for a model's turn, which the space pays for (D-40545):
 *            its members' to make, unless the app's manifest says
 *            `"models": "open"` ({@link floorsOf}), and then its visitors keep
 *            the pace every write of theirs keeps (apps.ts `visiting`).
 *   builder  an instruction that starts model turns at the account's expense.
 *            Only an editor may write its settings, even in an open app.
 */
export let FLOORS: Floors = {
  product: 'editor',
  order: 'owner',
  [DELIVER]: 'editor',
  using: 'editor',
  builder: 'editor',
}

/** The floors an app's own manifest leaves standing: every one, less the
 * floor on asking its models where it opens them to anyone who may write. */
export let floorsOf = (manifest: VocabDoc): Floors =>
  manifest.models == 'open'
    ? Object.fromEntries(Object.entries(FLOORS).filter(([k]) => k != 'using'))
    : FLOORS

/** The id a mirrored grant is filed under: one per (app, person), derived, so
 * the same vouch lands on one row however often it is said. */
export let grantEid = (app: string, person: string): string =>
  sha256(`grant\x00${app}\x00${person}`)

// Request paths become profile labels only for known Store doors. An arbitrary
// caller path or method must not create a new label.
let routes = new Set([
  '/',
  '/vocab',
  '/vocab.json',
  '/uses',
  '/storage',
  '/tools',
  '/graph',
  '/restore',
  '/writes',
  '/alarm',
  '/move',
  '/ws',
  '/apply',
  '/query',
])
let routeKind = (request: Request): string => {
  let path = new URL(request.url).pathname
  return routes.has(path) &&
      ['GET', 'POST', 'PUT', 'DELETE'].includes(request.method)
    ? `${request.method} ${path}`
    : 'http other'
}

export class Store {
  #ctx: State
  #vocab!: Vocab
  #graph!: Graph
  // The object's SQLite, as the driver every statement here runs through.
  #sql!: Driver
  #profile: ReturnType<typeof profile> | null = null
  // Constructor work belongs to the first fetch that woke this incarnation.
  #pending: Tally = new Map()
  #measure = (rowsRead?: number) => {
    hop('stmts')
    if (rowsRead != null) hop('rows', rowsRead)
  }
  #people = new Map<string, string | null>()
  #live!: Sockets
  #route!: Handler
  #auth!: Authenticate
  #meta!: Meta
  #bind: Bindings
  // The mover's rules (mover.ts `RULES`), and the ones whose batch failed in
  // this incarnation: those wait for the next one, which fixed code arrives
  // as.
  #rules: Rule[]
  #halted = new Set<Mark>()
  // Why this object's schema would not stand, when it would not. The rows are
  // as they were: the boot ran in one transaction and it unwound.
  #refused: string | null = null
  // This object's one alarm (D-37562), or null where the runtime under it has
  // none. One adapter for the incarnation: `arm` serializes its read-compare-
  // write per storage object, so two wakes arriving together cannot leave the
  // later one holding the alarm.
  #alarm: Alarm | null = null
  #effects!: Effects
  #effectsReady = false
  #effectWork: Promise<void> | null = null
  #effectAgain = false
  // The text this object embeds, over the storage it was built on, how the
  // store narrows a search by a filter line, and the drain of its queue in
  // progress (`#embedding`).
  #texts!: {
    sql: Driver
    fields: Text[]
    screen: (line: string) => Raw | null
  }
  #vectorWork: Promise<void> | null = null
  #vectorAgain = false
  // The schedules this object was born with, planted once (`#sown`), and
  // how long the ground lies fallow after a planting that threw: until when,
  // and how many throws the wait has doubled for.
  #sowing: Promise<void> | null = null
  #fallow = { until: 0, throws: 0 }
  // When this incarnation began: a job marked begun before it was begun by
  // one that is gone (wake.ts `resumed`).
  #born = Date.now()
  // The app's own commands, as a runner over this store (T-37605), beside the
  // manifest they were built from. A deploy is the only thing that moves that
  // manifest, and a new one is a new runner.
  #runs: { said: string; run: Runner } | null = null
  // The write log's replay (writes.ts). `#landing` is the kept write whose
  // batch is being applied right now, which the `yak/writes` hook takes out
  // of the log in that batch's own transaction; `#draining` is the replay in
  // progress, one at a time; `#stuck` says the last one stopped because the
  // log itself failed, and only the alarm or the next incarnation tries again.
  #landing: number | null = null
  #draining: Promise<void> | null = null
  #callers = new Map<number, (answer: Response) => void>()
  #stuck = false
  // The object's own memory (`yak_kv`), as this incarnation last read or
  // wrote it. Only this object writes that table, so once a word is read the
  // copy here is what the table says, and a request that asks it again costs
  // no statement. A transaction that fails forgets the copy (`#atomic`),
  // since what it wrote there rolled back.
  #kv = new Map<Word, string | null>()
  // A draft changes the Store's in-memory graph while one request prepares it.
  // Other requests and alarms wait for that request to restore the serving
  // release; ordinary requests still run together.
  #visits = 0
  #quiet: (() => void) | null = null
  #draft: Promise<void> | null = null

  constructor(ctx: State, bind: Bindings = {}, rules: Rule[] = RULES) {
    this.#ctx = ctx
    this.#bind = bind
    this.#rules = rules
    let { getAlarm, setAlarm } = ctx.storage
    if (getAlarm && setAlarm) {
      this.#alarm = {
        getAlarm: () => getAlarm.call(ctx.storage),
        setAlarm: (at) => setAlarm.call(ctx.storage, at),
      }
    }
    tallying(this.#pending, () => {
      try {
        this.#start()
      } catch (e) {
        this.#failed(e)
      }
    })
  }

  #start() {
    let ctx = this.#ctx
    this.#sql = driver(ctx.storage, undefined, this.#measure)
    this.#sql.query(KV)
    // The write log, before anything that can refuse the object: a store
    // whose graph cannot boot still keeps what it is sent (writes.ts). What
    // the last incarnation set aside waits again, for this one's code.
    raise(this.#sql)
    interrupted(this.#sql)
    revived(this.#sql)
    this.#reshaping()
    this.#boot()
  }

  // What an object keeps is in the one shape a deploy takes now. A store that
  // last accepted an older one remembers it that way, and nothing converts one
  // at the door any more — so it is rewritten here, before anything above the
  // storage reads it: the vocabulary as the document (T-37546, migrate.ts
  // `documented`), and the tools with `$arg` for `{{arg}}` (migrate.ts
  // `unholed`), a JSON Schema for each argument (T-38021, migrate.ts
  // `unworded`) and each query clause in its one spelling (T-39341, migrate.ts
  // `respelled`). After one wake no old shape is left in the object.
  #reshaping() {
    let shapes = [
      ['vocab', documented],
      ['tools', unholed],
      ['tools', unworded],
      ['tools', respelled],
    ] as const
    for (let [w, to] of shapes) {
      let held = this.#get(w)
      let now = held && to(held)
      if (now) this.#put(w, now)
    }
  }

  // Waking on whatever this object holds. Everything above the storage is
  // rebuilt from the remembered vocabulary, which is why a deploy is a write
  // and a reboot rather than a migration: a table the store has never seen is
  // created, a column a word grew is added, and what changed is which words the
  // graph admits. Only a word that holds nothing is dropped or retyped by
  // `prepare` (the vocab door); a text eid becoming a reference is converted
  // by schema fitting while the old rows stay in place until it succeeds.
  #boot(prepare = () => {}) {
    this.#atomic(() => {
      prepare()
      this.#build()
    })
  }

  // One transaction over this object's storage. A failure refuses the object
  // (`#failed`) and forgets the memory's copy, which may hold a word the
  // rollback took back.
  #atomic(body: () => void) {
    try {
      this.#ctx.storage.transactionSync(body)
    } catch (e) {
      this.#kv.clear()
      this.#failed(e)
    }
  }

  #schema(vocab: Vocab, stamp: string, name: string) {
    let held = this.#get('schema')
    if (!(this.#get('name') || held) || held == stamp) return
    // Definitions cannot be altered by replaying them. Raise each changed
    // index, trigger and view from the vocabulary in the same transaction.
    if (held) recut(this.#sql)
    requestIds(this.#sql, vocab)
    for (let stmt of blobSchema()) this.#sql.query(stmt)
    let unfit = install(this.#sql, vocab, blobRead(vocab))
    for (let e of unfit) defect(e, { request: 'schema fit', store: name })
    if (held) rebuild(this.#sql)
    if (!unfit.length) this.#put('schema', stamp)
  }

  #build() {
    let ctx = this.#ctx
    this.#people.clear()
    // Which words this object speaks is a question of which object it is
    // (`vocabOfStore`). One store on the platform is the directory (the meta
    // space, T-33814); one is the git object graph (D-34943); every other
    // object is an app, and wakes with the core plus whatever its `vocab.json`
    // declared.
    let name = this.#get('name') ?? ''
    if (name == 'yourname/vale.f52dc2' && !this.#profile) {
      this.#profile = profile((summary) =>
        console.log(
          'yak store rows',
          JSON.stringify({ store: name, ...summary }),
        )
      )
    }
    let observe = this.#profile?.observe
    let meta = name == PLATFORM_STORE
    // Neither of the platform's own two stores is an app, which is what the
    // app-shaped extras below are for: `task.status` is an expression over
    // words a git object graph does not have, and `vocab.json` is not a
    // sentence to say to a caller of either one.
    let { vocab, own, derived, searchable, stamp } = shapeOf(
      name,
      this.#get('vocab'),
    )
    let drive = this.#sql = driver(ctx.storage, observe, this.#measure)
    let bytes = sqliteBlobs(drive)
    let store = storage(
      ctx.storage,
      vocab,
      {
        // A number is @yaks/id's, and only the platform's own stores loaded it
        // (vocab.ts): the directory's memories are ordered by the number it
        // minted, while an app's entities are pointed at by the eid its client
        // minted and never by a number, so nothing mints one for them.
        number: numbered(vocab),
        // The vocabulary says which prose is searched — @yaks/doc declares its
        // title and body, and an app's own vocab.json declares `"search": true`
        // on whatever of its words it wants found. sqlite owns no index. The
        // same text has a vector each (`#embedding`), which `.near` ranks.
        extend: [search(searchable), semantic(drive, { model: SPACE })],
        // A body is stored as its address (@yaks/blob `store: "blob"`), so the
        // reads and the `doc_value` view resolve it as prose. The FTS schema
        // receives the same resolution, keeping hashes out of the index
        // (T-33978).
        derived,
      },
      observe,
      this.#measure,
    )
    this.#texts = {
      sql: drive,
      fields: texts(vocab, derived),
      screen: (line) => store.screen(line),
    }
    // The schema this object stands at is one word (`shapeOf`): a wake under
    // the same vocabulary runs no DDL at all, and a deploy that added a
    // component raises its table on the next request. Every index the
    // vocabulary declares is in it — the directory's uniques included, since
    // they are words of `platformDoc`.
    //
    // A brand-new object raises nothing yet: it does not know which store it
    // is until its first request says so, and planting an app's core into what
    // turns out to be the directory would leave tables no word of its
    // vocabulary names. `#learn` reboots the moment the name arrives, and every
    // door runs after it.
    this.#schema(vocab, stamp, name)
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
      defer: true,
      max: 2,
      nudge: () => this.#workingEffects(),
      report: (error, { handler }) =>
        defect(error, { request: `effect ${handler}`, store: name }),
    })
    // Where the directory keeps a connection's credential (vault.ts). A key
    // comes out of a write before anything else reads it, and is sealed once
    // the write commits, by the same plugin; an app's store keeps none.
    let vault = meta ? vaultOf(this.#bind) : null
    let g = graph({
      storage: store,
      vocab,
      report: (error, { phase, plugin }) =>
        defect(error, { request: `${plugin} ${phase}`, store: name }),
      // An app's own words are its `vocab.json`, so a word nobody declared is
      // refused with where one comes from — the sentence the read door says
      // too (`#taught`). The directory says nothing of the kind: its words
      // are the platform's own and its callers are the kernel's own.
      ...(own ? {} : { teach: teach(this.#bind) }),
      // The guard is added last and only when this object knows which app it
      // holds: @yaks/member refuses a write by an actor with no level, so a
      // store that cannot name its app has no access question to ask and the
      // kernel's own gate in front of it is the whole rule.
      plugins: [
        ...(vault ? [secrets(vault, (b) => this.#trust(b, null))] : []),
        ...(vocab.comp('archetype') ? [archetypes()] : []),
        // Before every check, because it is about the shape a value arrived in.
        this.#lowering,
        edges(vocab),
        // The carrier and the one kind of it every store speaks: a name, which
        // is how anything addresses a row it wrote last week without having
        // kept the eid. The carrier goes first — the name rides it (T-34390).
        keys(vocab),
        aliases(),
        blobs(vocab, bytes),
        representations(),
        wakes(),
        // A transcript's rules, in an app's store (D-40545): a model named by
        // its name, an entry's place in its transcript allocated as it lands.
        ...(own ? [] : [models(), sessions()]),
        fx,
        // Before the guard, because it is what the guard reads.
        this.#vouching,
        ...(app ? [this.#guarding(app, vocab, meant(this.#get('vocab')))] : []),
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
        // What an app holds, told to the directory once a write has committed
        // (`#tell`). The platform's own two stores are not apps and are not
        // metered.
        ...(own ? [] : [{ name: 'yak/weigh', hooks: { effect: this.#weigh } }]),
        // A sleeping wake armed by the write that makes its `while` hold
        // (`#rouse`), in every store.
        { name: 'yak/rouse', hooks: { effect: this.#rouse } },
        {
          name: 'yak/names',
          hooks: {
            effect: (bundles) => {
              for (let b of bundles) this.#people.delete(b.entity.eid)
              return bundles
            },
          },
        },
        // A text the write changed, embedded once it has committed
        // (`#embedding`). Its triggers queued it in the write's own statement,
        // so a write that queued nothing costs one count.
        {
          name: 'yak/embed',
          hooks: {
            effect: (bundles) => {
              if (this.#owes()) this.#embedding()
              return bundles
            },
          },
        },
        // Last, so the answer a keyed write keeps is the batch as every other
        // commit hook left it (`#logging`).
        this.#logging,
        ...(own ? [] : [admitSchema(vocab)]),
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
    // The app's own commands, run here (T-37605, D-37562). @yaks/tools
    // declares which calls still want running as two effects — one for a call
    // nobody scheduled, one for a call whose wake has fired — and a host
    // handles both. That is the whole of the scheduled case: a page writes a
    // `call` wearing a `wake{at}`, the object comes back at that instant, the
    // firing makes the second hold, and the answer lands beside the ask. Each
    // is an `effect` row this store's pool works once the write commits
    // (`#workingEffects`), so the answer follows the write rather than riding
    // its response.
    let due = (e: { entity: { eid: string } }) =>
      this.#runner().due(e.entity.eid)
    let declared = new Set(effectsIn(vocab.docs).map((e) => e.name))
    fx.handle(Object.fromEntries(
      this.#runner(g).rules.filter((r) => declared.has(r.rule.name))
        .map((r) => [r.rule.name, due]),
    ))
    effected(PLUGINS, fx, this.#stored(g))
    this.#effects = fx
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
    // Only an app's store answers a page, and the platform's own two are made
    // of the rows an app's page is spared.
    let spared = own ? [] : PLATFORM.filter((w) => vocab.comp(w))
    this.#live = sockets(
      this.#naming(subs, spared),
      ctx,
      (error) => defect(error, { request: 'socket restore', store: name }),
    )
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
    if (this.#kv.has(k)) return this.#kv.get(k)!
    let [row] = this.#sql.query(select({
      cols: [col('v')],
      from: table(KV.name),
      where: eq(col('k'), val(k)),
    }))
    let v = row ? String(row.v) : null
    this.#kv.set(k, v)
    return v
  }

  #put(k: Word, v: string) {
    this.#sql.query({
      t: 'insert',
      into: KV.name,
      cols: ['k', 'v'],
      rows: [[val(k), val(v)]],
      upsert: [{ on: [col('k')], set: { v: col('v', 'excluded') } }],
    })
    this.#kv.set(k, v)
  }

  // What the kernel told this object about itself, on any request that carries
  // it. The address it was born at never moves; the app it holds and that
  // app's access mode are the directory's to say, so a changed mode is
  // followed rather than argued with. Almost every request says what the
  // object already holds, and that costs a look at its memory: only news
  // opens a transaction.
  #learn(req: Request) {
    if (this.#heard(req).length) this.#atomic(() => this.#remember(req))
  }

  // Draft declarations and seed wait for the directory's release pointer,
  // including the first release from an empty store.
  #candidate(req: Request): string | null {
    let release = req.headers.get('x-yak-release')
    if (
      !req.headers.has('x-yak-base-release') ||
      !release || !/^[a-z0-9-]+$/.test(release)
    ) return null
    return release
  }

  #prepared(next: string): string {
    let was = this.#get('vocab') ?? '{}'
    if (next == was) return next
    let changed = grew(
      appDoc(was),
      appDoc(next),
      (name, prop) => this.#rows(name, prop),
    )
    let before = appVocab(was)
    let after = appVocab(changed.doc)
    retire(this.#sql, before, after)
    for (let name of [...changed.dropped, ...changed.retyped]) {
      let [comp, prop] = name.split('.')
      if (prop) shed(this.#sql, before, after, comp, prop)
      else {
        this.#sql.query({
          t: 'drop',
          kind: 'table',
          name: comp,
          ifExists: true,
        })
      }
    }
    return JSON.stringify(changed.doc)
  }

  // A deploy prepares declarations in this store before the directory moves
  // the app's declaration pointer. That pointer is the serving decision:
  // every request selects its declarations here, so a failed release keeps
  // answering with the old vocabulary and commands even after preparation.
  #select(req: Request): {
    toolsMoved: boolean
    effects: (() => void | Promise<void>)[]
  } {
    let unchanged = () => ({ toolsMoved: false, effects: [] })
    if (this.#candidate(req)) return unchanged()
    let release = req.headers.get('x-yak-release')
    if (release == null || !/^[a-z0-9-]+$/.test(release)) return unchanged()
    let active = this.#get('release')
    if (active == release) return unchanged()
    let toolsMoved = false
    let effects: (() => void | Promise<void>)[] = []
    this.#atomic(() => {
      if (active == null) {
        this.#put('release', release)
        return
      }
      let words = ['vocab', 'uses', 'tools'] as const
      let was = this.#get('vocab') ?? '{}'
      let toolsWas = this.#get('tools') ?? '{}'
      let next = this.#get(`vocab:${release}`) ?? this.#get('vocab') ?? '{}'
      if (active != '0' && release != '0') next = this.#prepared(next)
      for (let word of words) {
        this.#put(`${word}:${active}`, this.#get(word) ?? '{}')
      }
      for (let word of words) {
        this.#put(
          word,
          word == 'vocab' ? next : this.#get(`${word}:${release}`) ??
            this.#get(word) ?? '{}',
        )
      }
      this.#put('release', release)
      if (this.#get('vocab') != was) this.#build()
      let seed = this.#get(`seed:${release}`)
      if (
        seed && !this.#get('seeded') && !req.headers.has('x-yak-base-release')
      ) {
        let { bundles, actor } = JSON.parse(seed) as {
          bundles: Bundle[]
          actor: Actor | null
        }
        let result = this.#graph.apply(signed(bundles, actor), {
          deferEffects: (run) => effects.push(run),
        })
        if (result instanceof Promise) {
          throw new Error('a staged seed must apply synchronously')
        }
        this.#put('seeded', release)
      }
      toolsMoved = this.#get('tools') != toolsWas
    })
    return this.#refused ? unchanged() : { toolsMoved, effects }
  }

  async #enter(draft: boolean): Promise<() => void> {
    while (this.#draft) await this.#draft
    if (!draft) {
      this.#visits++
      return () => {
        if (--this.#visits == 0) {
          this.#quiet?.()
          this.#quiet = null
        }
      }
    }
    let done!: () => void
    this.#draft = new Promise((resolve) => (done = resolve))
    if (this.#visits) {
      await new Promise<void>((resolve) => (this.#quiet = resolve))
    }
    return () => {
      this.#draft = null
      done()
    }
  }

  // What a request says about this object that it does not already hold.
  //
  // Which app this object holds is an app's question. The directory is not
  // one — it speaks the platform's vocabulary, which has no `grant` and no
  // `access`, and the kernel decides who may read and write it before the
  // request arrives (vocab.ts, `platformDoc`). A caller that names an app on
  // its way to the directory is naming an app whose row lives here, not the
  // object it is talking to, so the word is ignored rather than believed:
  // believing it installs @yaks/member's guard on a store with no seats and
  // writes a grant into a table that does not exist.
  #heard(req: Request): [Word, string][] {
    let name = req.headers.get('x-store')
    let said: [Word, string | null][] = [['name', name]]
    if ((name ?? this.#get('name')) != PLATFORM_STORE) {
      said.push(
        ['app', req.headers.get('x-yak-app')],
        ['access', req.headers.get('x-yak-access')],
        // The address this app's letters leave from (directory.ts `mailbox`).
        // Like the access mode it is the directory's word and is followed
        // rather than argued with — an app renamed, or made the space's front
        // page, writes from its new address on the very next request. Nothing
        // is rebuilt for it: `#posting` reads the word at write time.
        ['mail', req.headers.get('x-yak-mail')],
      )
    }
    return said.filter((s): s is [Word, string] =>
      !!s[1] && s[1] != this.#get(s[0])
    )
  }

  #remember(req: Request) {
    let heard = new Map(this.#heard(req))
    for (let [k, v] of heard) this.#put(k, v)
    // The name is what says whether this object is the directory, so learning
    // it for the first time can change which vocabulary it speaks — and the
    // object was constructed before any request could tell it. The app it
    // holds is what its guard asks about. Either is one rebuild, however many
    // of them a request said.
    if (heard.has('name') || heard.has('app')) this.#build()
    let access = heard.get('access')
    if (access) this.#mode(mode(access))
  }

  // The app's access mode, in this store's own rows — what @yaks/member reads
  // to answer "and everyone else?". It is written straight through storage,
  // not through apply(): the platform's word about who may write is not an
  // application write and does not pass the application's guard, which would
  // refuse it (only an owner may write an `access`). The storage unit keeps
  // the app's archetype pointer in step with the row (@yaks/sqlite `ledger`),
  // since @yaks/member reads the mode only from the tables that pointer names.
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

  #lowering: Plugin = {
    name: 'yak/lower',
    hooks: {
      normalize: (bundles) =>
        bundles.map((b) => {
          let out: Record<string, unknown> | null = null
          for (let [name, comp] of comps(b)) {
            if (!comp) continue
            for (let [prop, v] of Object.entries(comp)) {
              let eid = (v as { eid?: unknown } | null)?.eid
              if (
                typeof eid != 'string' ||
                this.#vocab.prop(name, prop)?.category != 'ref'
              ) continue
              out ??= { ...b }
              out[name] = {
                ...(out[name] as Record<string, unknown>),
                [prop]: eid,
              }
            }
          }
          return (out ?? b) as Bundle
        }),
    },
  }

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
        // its own `.person` listing. Its grant is still written — that is
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
        return after(tx.patch(out), () => bundles)
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
   * `ada.cookbook@yaks.app` is DKIM-signed by us and read by the world as ours
   * — and a property a client may write is a property a client may forge. A
   * letter the kernel writes is left alone unless it asks to leave: an arrival
   * (T-33687) keeps the sender's own `from`, out on the web, and the receipt
   * the platform files beside a sale (sell.ts) leaves from the app like any
   * other letter.
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
   * The rule itself stays @yaks/member's, and so do the floors and paces an
   * app's own words declare (`vocab`). Only who it is asked about is ours, and
   * which of this platform's words ask a level of their own (`FLOORS`).
   */
  #guarding(app: string, vocab: Vocab, manifest: VocabDoc): Plugin {
    let plugin = members({ app, vocab, floors: floorsOf(manifest) })
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
  // server-owned properties, and the guard above stands down.
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

  // What a plugin may know about this store (plugin.ts `Stored`), over the
  // graph it is built with. Its kernel door is `#asIs`, as the runner's is,
  // and a write as somebody goes through `apply()` the way their own request
  // would, guard and all.
  #stored = (g: Graph): Stored => ({
    env: this.#bind,
    meta: this.#get('name') == PLATFORM_STORE,
    app: this.#get('app'),
    mail: () => this.#get('mail'),
    graph: { ...g, apply: (change, opts) => this.#asIs(change, opts) },
    as: async (who, bundles, via) =>
      await this.#graph.apply(
        signed(bundles, {
          ...(who ? { by: who } : {}),
          ...(via ? { via } : {}),
        }),
      ),
    commands: () => JSON.parse(this.#get('tools') || '{}'),
    broke: (what, error) => void this.#broke(what, error),
  })

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
      let declared: Tools = JSON.parse(said || '{}')
      this.#runs = {
        said,
        run: runner(
          { ...g, apply: (change, opts) => this.#asIs(change, opts) },
          {
            host: g,
            tools: [
              ...commands(declared, async (path, args, call) => {
                let ns = this.#bind.STORE, appId = this.#get('app')
                if (!ns || !appId) throw new Error('app store is unavailable')
                let held = await directoryOf(ns).appAt(appId)
                if (!held || held.app.trashed || held.space.trashed) {
                  throw new Error('app is unavailable')
                }
                let res = await commandWorker(
                  this.#bind,
                  held.space,
                  held.app,
                  { person: appId, role: 'editor' },
                  path,
                  args,
                  {
                    call: call.entity.eid,
                    at: typeof call.created == 'object' &&
                        call.created != null && 'at' in call.created
                      ? String(call.created.at ?? '')
                      : '',
                    source: typeof call.call == 'object' && call.call != null &&
                        'source' in call.call
                      ? String(call.call.source ?? call.entity.eid)
                      : call.entity.eid,
                  },
                )
                await res.body?.cancel()
                return []
              }),
              builderModelTool,
            ],
            // A call in a transcript is the transcript runner's, run in the
            // order its model asked (@yaks/session, models.ts).
            takes: (call) => !call.entry,
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
    await this.#runner().ensure(['builder_model'])
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

  // The graph as the clock writes it. A firing is the server's write, not a
  // person's: a wake is the object's own business, and @yaks/member's guard
  // asks which person may write an app's data. So it goes through the same
  // door the kernel writes through, carrying the tick's instant, which is the
  // `#Now` its rules read.
  #clock: Pick<Graph, 'read' | 'apply'> = {
    read: (q, o) => this.#graph.read(q, o),
    apply: (b, o) => this.#trust(b as Bundle[], null, o),
  }

  // A wake with `while` repeats only while one of its conditions holds, and
  // one that stopped is armed again by the write that makes one hold
  // (@yaks/wake `rouse`): a player arriving is a write, so arriving is what
  // starts a sleeping world again, with no page asking. Every committed write
  // asks; in a store holding no such wake the asking is one read. A condition
  // it cannot read goes to Sentry, not to the break log — that log is a write,
  // and a write asks again.
  #rouse = async (bundles: Bundle[]): Promise<Bundle[]> => {
    let { refused } = await rouse(this.#clock, Date.now())
    for (let { wake, error } of refused) {
      defect(error, { request: `wake ${wake.entity.eid}`, store: this.#name() })
    }
    return bundles
  }

  // The next instant this object owes, off its own rows: what a tick arms
  // after it has fired, and what a request re-arms when the runtime lost the
  // alarm. `soonest` reads the earliest wake still ahead; a planting that
  // threw is owed when its fallow ends (`#sown`).
  #owed = async (now: number, floor = Infinity): Promise<void> => {
    let next = await soonest(this.#graph, now)
    let replant = this.#sowing ? Infinity : this.#fallow.until || Infinity
    let at = Math.min(next ?? Infinity, floor, replant)
    if (Number.isFinite(at)) await this.#arming(new Date(at).toISOString())
  }

  // Whether the app this store holds is in the trash, on its own or with its
  // space (erase.ts). The word is the directory's, and it is asked here, where
  // a firing is decided, rather than copied into this store: a trashed app is
  // sent no request that could carry it, and a copy goes stale. The
  // platform's own two stores hold no app and never ask.
  #trashed = async (): Promise<boolean> => {
    let app = this.#get('app')
    let ns = this.#bind.STORE
    if (!app || !ns) return false
    let held = await directoryOf(ns).appAt(app)
    return !!(held?.app.trashed || held?.space.trashed)
  }

  /**
   * Fire the wakes due at `now`, then come back for the next one. The
   * runtime's own `alarm()` is this at the present instant; a caller naming
   * the instant is how a test reads a schedule without waiting for one.
   *
   * A refused occurrence stays due and its reason goes to this store's break
   * log — the directory's for the platform's sweeps, the app's for an app's —
   * and the alarm is set a minute out so nothing is silently dropped.
   *
   * An app in the trash fires nothing and arms nothing: its wakes stay owed
   * where they stood, and a restore brings the object back for them (`/alarm`,
   * erase.ts `untrash`), when the stretch it sat out is one firing, as any
   * stretch nobody was there for is. A directory that cannot say is asked
   * again in a minute, never guessed at.
   */
  tick(now = Date.now()): Promise<Ticked> {
    let run = async () => {
      let leave = await this.#enter(false)
      try {
        return await this.#tick(now)
      } finally {
        this.#profile?.flush()
        leave()
      }
    }
    return this.#profile ? this.#profile.run('tick', run) : run()
  }

  async #tick(now: number): Promise<Ticked> {
    let none: Ticked = { fired: [], refused: [] }
    try {
      if (await this.#trashed()) return none
    } catch (e) {
      defect(e, { request: 'wake trash', store: this.#name() })
      await this.#owed(now, now + Store.RETRY)
      return none
    }
    let result = await tick(this.#clock, now)
    for (let { wake, error } of result.refused) {
      await this.#broke(`wake ${wake.entity.eid}`, error)
    }
    await this.#owed(now, result.refused.length ? now + Store.RETRY : Infinity)
    return result
  }

  /** The runtime's clock going off: whatever this object armed itself for. */
  alarm(): Promise<void> {
    let run = async () => {
      let leave = await this.#enter(false)
      try {
        // Writes the log still holds are replayed first, which is what makes
        // the replay need nobody after a deploy.
        let kept = waiting(this.#sql)
        if (this.#refused) {
          if (kept) await this.#retry()
          return
        }
        if (kept) {
          this.#stuck = false
          await this.#drain()
        }
        await this.#sown()
        await this.#tick(Date.now())
        this.#workingEffects()
        this.#embedding()
        await this.#moving()
      } finally {
        this.#profile?.flush()
        leave()
      }
    }
    return this.#profile ? this.#profile.run('alarm', run) : run()
  }

  // Planted once per incarnation, by the first request or alarm to find the
  // ground ready. A planting that throws is noted and let go, and the object
  // serves without it: its effects wait in their rows, and the ground lies
  // fallow for a second, then two, doubling to an hour, before a request or
  // the alarm set for that instant plants again. A store whose trouble has
  // passed heals without a deploy, and one that still cannot plant is not
  // asked to on every request.
  #sown = (): Promise<void> => {
    if (!this.#sowing && Date.now() < this.#fallow.until) {
      return Promise.resolve()
    }
    return this.#sowing ??= this.#sow().catch(this.#unsown)
  }

  #unsown = async (e: unknown) => {
    let wait = Math.min(1000 * 2 ** this.#fallow.throws++, Store.FALLOW)
    this.#fallow.until = Date.now() + wait
    this.#sowing = null
    await this.#broke('wake seed', e)
    await this.#arming(new Date(this.#fallow.until).toISOString())
      .catch((why) =>
        defect(why, { request: 'wake seed alarm', store: this.#name() })
      )
  }

  // The longest the ground lies fallow after a planting that threw (`#sown`).
  static FALLOW = 60 * 60_000

  // What this object was born owing: the rows its plugins declare — the
  // directory's sweeps — planted if they are missing, and the alarm set again
  // if the runtime has none. `seeded` never rewinds a wake somebody moved or
  // resumes one they paused, and the stamp means a store that already holds
  // them asks its storage once rather than its graph three times.
  #sow = async (): Promise<void> => {
    // First, the rows the platform ships (the directory's built
    // integrations, an app's model catalogue), brought up to date before this
    // object answers anything: written as the kernel, their one writer, and
    // only where they moved. Each install says which stores it is for.
    let at = this.#stored(this.#graph)
    for (let install of installsOf(PLUGINS)) {
      try {
        let change = await install((q) => this.#graph.read(q), at)
        if (change.length) await this.#trust(change, null)
      } catch (e) {
        await this.#broke('install', e)
      }
    }
    await this.#migrateEffects()
    let rows = this.#get('name') == PLATFORM_STORE ? wakesOf(PLUGINS) : []
    let stamp = sha256(rows.map((r) => r.entity.eid).join('\n'))
    if (rows.length && this.#get('wakes') != stamp) {
      await seeded(this.#graph, rows, Date.now())
      this.#put('wakes', stamp)
    }
    // And any of them the last incarnation died in the middle of.
    if (rows.length) {
      await resumed(
        this.#clock,
        this.#born,
        (job, e) => this.#broke(`wake ${job}`, e),
      )
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
    this.#effectsReady = true
    this.#workingEffects()
    // Whatever text is owed its vector, and, the first time, every text this
    // store holds.
    this.#embedding()
    // Rows a rule still owes here are moved from the alarm, never by the wake
    // that found them owing (mover.ts).
    if (this.#owing().length) await this.#arming(this.#soon())
  }

  // ---- the mover (mover.ts, D-45640) ---------------------------------------
  //
  // Rows brought into a new shape after this object has booted, from its
  // alarm, a batch at a time. Nothing here can refuse the object: a batch that
  // fails unwinds, is reported, and leaves its rule for the next incarnation,
  // while the store serves the shape it holds.

  // A moment from now: the wake that armed it answers first.
  #soon = () => new Date(Date.now() + PAUSE).toISOString()

  #stamp = (rule: Rule): Stamp | null => {
    let held = this.#get(rule.mark)
    return held ? JSON.parse(held) : null
  }

  // The rules live here that are not done, less the ones this incarnation
  // saw fail. No rules is no read at all.
  #owing = (): Rule[] =>
    this.#rules.length
      ? this.#rules.filter((r) =>
        runs(r, this.#get('name') ?? '') && !this.#halted.has(r.mark) &&
        !this.#stamp(r)?.done
      )
      : []

  // The store as a rule reaches it. The patch is the kernel's own write, and
  // its effects wait in `held` for the caller: run once the batch commits,
  // dropped when it is a rehearsal.
  #mover = (held: (() => void | Promise<void>)[]): Moving => ({
    read: (q) => this.#graph.read(q),
    rows: (q) => this.#graph.rows(q),
    apply: (patch) =>
      this.#trust(patch, null, { deferEffects: (run) => void held.push(run) }),
    tx: (body) => this.#ctx.storage.transactionSync(body),
  })

  // A few batches, yielding the object between them, then the alarm again for
  // whatever is left.
  #moving = async (): Promise<void> => {
    let left = BATCHES
    let name = this.#get('name') ?? ''
    for (let rule of this.#owing()) {
      while (left-- > 0 && !this.#refused) {
        let held: (() => void | Promise<void>)[] = []
        let was = this.#stamp(rule)
        let now = new Date().toISOString()
        let s: Stamp
        try {
          s = this.#ctx.storage.transactionSync(() => {
            let s = step(this.#mover(held), rule, was, SIZE, now)
            this.#put(rule.mark, JSON.stringify(s))
            return s
          })
        } catch (e) {
          this.#kv.clear()
          this.#halted.add(rule.mark)
          defect(e, { request: `move ${rule.mark}`, store: name })
          try {
            let failed = e instanceof Error ? e.message : String(e)
            this.#put(
              rule.mark,
              JSON.stringify({ moved: 0, ...was, at: now, failed }),
            )
          } catch { /* the stamp is a report; the defect already went */ }
          break
        }
        for (let run of held) {
          try {
            await run()
          } catch (e) {
            defect(e, { request: `move ${rule.mark} effects`, store: name })
          }
        }
        if (s.done) break
        await new Promise((r) => setTimeout(r, 0))
      }
    }
    if (this.#owing().length) await this.#arming(this.#soon())
  }

  // Before this store kept effect rows, a prompt could have left on the wire
  // with no ask recorded. Those older requests have an unknown outcome. Mark
  // them interrupted once, before the effect pool's sweep can dispatch them
  // again. The person can inspect and explicitly ask anew.
  #migrateEffects = async () => {
    if (!this.#vocab.comp('effect') || this.#get('effect-migrated')) return
    let rows = await this.#graph.read(
      '.session.status=pending,running,queued (.entries.using|.entries.ask)',
    )
    for (let row of rows) {
      let session = row.entity.eid
      let inflight = await this.#graph.read(
        `.entry.session=${session}&.attempt.state=inflight&*`,
      )
      await this.#trust([
        ...inflight.map((b) => ({
          entity: b.entity,
          attempt: { state: 'interrupted' },
        })),
        {
          entity: { eid: crypto.randomUUID() },
          entry: { session },
          error: { code: 'interrupted' },
          content: {
            body: 'The previous model request may have completed at the ' +
              'provider. Inspect it before asking again.',
          },
        },
      ], null)
    }
    this.#put('effect-migrated', '1')
  }

  #workingEffects = () => {
    if (!this.#vocab.comp('effect')) return
    if (!this.#effectsReady) {
      this.#effectAgain = true
      return
    }
    if (this.#effectWork) {
      this.#effectAgain = true
      return
    }
    this.#effectWork = (async () => {
      do {
        this.#effectAgain = false
        await this.#effects.work(this.#stored(this.#graph).graph)
      } while (this.#effectAgain)
      let pending = await this.#graph.read('.effect.state=pending&*')
      if (pending.length) {
        let now = Date.now()
        let next = Math.min(...pending.map((b) => {
          let e = b.effect as Comp
          return Date.parse(String(e.next ?? e.lease_expiry ?? '')) ||
            now + 60_000
        }))
        await this.#arming(new Date(Math.max(now + 1000, next)).toISOString())
      }
    })().catch(async (error) => {
      defect(error, { request: 'effect pool', store: this.#name() })
      await this.#arming(new Date(Date.now() + Store.RETRY).toISOString())
        .catch((e) =>
          defect(e, { request: 'effect retry', store: this.#name() })
        )
    }).finally(() => {
      this.#effectWork = null
      if (this.#effectAgain) this.#workingEffects()
    })
  }

  // ---- the vectors (@yaks/embedding, T-59101) -------------------------------
  //
  // A vector beside each text the vocabulary marks searched, made by the model
  // embedding.ts names and kept in this object's own SQLite, and held in its
  // memory once a search asks, which is what `.near` ranks; each drain pass
  // folds what it wrote into that copy. Triggers queue a text in the write's
  // own statement; this drains the queue once a write has committed and from
  // the alarm, a batch at a time, waiting on the model between batches, so
  // requests interleave and none waits on it. It drains for a slice and comes
  // back on the alarm for the rest: the first wake after this shipped, every
  // store owes a vector for each text it holds, and it catches up behind its
  // own traffic.
  // A drain that fails goes to Sentry and comes back a minute later; `.near`
  // ranks whatever is stored meanwhile.
  static EMBED = 10_000

  // Whether a text is owed its vector, which asks one count. An object whose
  // schema is not standing yet owes nothing: it has no table to owe it in.
  #owes = () =>
    !!this.#texts && !!this.#get('schema') && unembedded(this.#texts.sql) > 0

  #embedding = () => {
    let model = embedder(this.#bind)
    if (this.#refused || !this.#texts || !this.#get('schema') || !model) return
    if (this.#vectorWork) {
      this.#vectorAgain = true
      return
    }
    let name = this.#name()
    this.#vectorWork = (async () => {
      // Back after this slice whatever becomes of it: an object evicted while
      // it drains takes up the rest on its alarm.
      if (this.#owes()) {
        await this.#arming(
          new Date(Date.now() + Store.EMBED + PAUSE).toISOString(),
        )
      }
      do {
        this.#vectorAgain = false
        let { sql, fields } = this.#texts
        let done = await drain(sql, fields, model, {
          signal: AbortSignal.timeout(Store.EMBED),
        })
        // A text the model will not take is the text's, not the store's: it
        // has no vector, and ranks by its words alone.
        for (let r of done.refused) {
          console.log(
            'yak store embed refused',
            name,
            r.entity,
            r.error.message,
          )
        }
      } while (this.#vectorAgain)
      if (this.#owes()) await this.#arming(this.#soon())
    })().catch(async (error) => {
      defect(error, { request: 'embedding', store: name })
      await this.#arming(new Date(Date.now() + Store.RETRY).toISOString())
        .catch((e) => defect(e, { request: 'embedding retry', store: name }))
    }).finally(() => {
      this.#vectorWork = null
      if (this.#vectorAgain) this.#embedding()
    })
  }

  // ---- the bytes it holds (meter.ts `weighed`) -----------------------------
  //
  // Nothing outside this object can see how much it holds, so it says so
  // itself, to the directory, whenever a committed write moved the figure.
  // One report is in flight at a time: a burst of writes tells the size it came
  // to, not one size per write. A report that fails waits for the next write
  // rather than retrying on its own, so a directory that is down is not called
  // in a loop.
  #weighing: Promise<void> | null = null

  #weigh = (bundles: Bundle[]): Bundle[] => {
    this.#tell()
    return bundles
  }

  #tell() {
    this.#weighing ??= this.#telling().finally(() => (this.#weighing = null))
  }

  // Until what it last told is what it holds: a write that lands while a
  // report is on its way is told on the next turn.
  async #telling(): Promise<void> {
    try {
      for (;;) {
        let app = this.#get('app')
        let ns = this.#bind.STORE
        let bytes = this.#ctx.storage.sql.databaseSize
        if (!app || !ns || String(bytes) == this.#get('weighed')) return
        await weighed({ STORE: ns }, app, bytes)
        this.#put('weighed', String(bytes))
      }
    } catch (e) {
      defect(e, { request: 'meter bytes', store: this.#name() })
    }
  }

  // A break this object noted about itself, written where it notes an app's
  // (unseen.ts `noted`): server-owned properties, through the kernel's own
  // door. Sentry hears it too, named by the store it happened in (sentry.ts).
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

  #failed(e: unknown) {
    let message = 'the schema refused'
    try {
      message = (e instanceof Error ? e.message : String(e)) || message
    } catch { /* a thrown value need not be printable */ }
    this.#refused = message
    // A refused store answers nothing, so it is a defect, not an answer:
    // Sentry hears it named by the store.
    let store = ''
    try {
      store = this.#get('name') ?? ''
    } catch { /* a store too broken to read its own name */ }
    defect(e, { request: 'schema', store })
    console.warn('store: schema refused', this.#refused)
  }

  /**
   * The object after its schema refused to stand. The rows are as they were —
   * the boot ran in one transaction and it unwound — and nothing above the
   * storage was raised to read them, so it says why and answers nothing else.
   * Fixed code arrives as a new incarnation, which boots again.
   */
  #stalled(): Response {
    let why = this.#refused ?? 'this store could not start'
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
  fetch(request: Request): Promise<Response> {
    let tally = this.#pending
    this.#pending = new Map()
    let run = () =>
      tallying(tally, async () => {
        let base = request.headers.get('x-yak-base-release')
        let leave = await this.#enter(base != null)
        let answer: Response
        try {
          if (logged(request)) answer = await this.#write(request)
          else {
            let no = await this.#ready(request)
            if (no) answer = no
            else {
              // Writes kept during an outage land before a read is answered.
              // Recovery must be reachable even when a pending write cannot
              // finish: inspecting it is how a caller learns what to fix.
              if (
                !['/writes', '/inspect'].includes(new URL(request.url).pathname)
              ) {
                await this.#settle()
              }
              answer = await this.#serve(request)
            }
          }
        } finally {
          try {
            if (base != null) {
              // A candidate may have refused while fitting its schema. Its
              // transaction left the serving rows intact, but #build may have
              // replaced part of this incarnation's graph before it failed.
              // Restore the serving release and rebuild it before admitting
              // another request. A serving schema that also fails stays
              // refused, so fixed code can heal it on the next incarnation.
              let refused = this.#refused
              this.#refused = null
              this.#select(
                new Request('http://store/', {
                  headers: { 'x-yak-release': base },
                }),
              )
              if (refused && !this.#refused) this.#boot()
            }
          } finally {
            this.#profile?.flush()
            leave()
          }
        }
        if (answer.status == 101) return answer
        let headers = new Headers(answer.headers)
        let { hops, r2 } = counts(tally)
        headers.set('x-yak-hops', String(hops))
        headers.set('x-yak-stmts', String(tally.get('stmts') ?? 0))
        if (tally.has('rows')) {
          headers.set('x-yak-rows', String(tally.get('rows')))
        }
        headers.set('x-yak-r2', String(r2))
        return new Response(answer.body, {
          status: answer.status,
          statusText: answer.statusText,
          headers,
        })
      })
    return this.#profile ? this.#profile.run(routeKind(request), run) : run()
  }

  /** Everything before a door: the object brought up to date and told what
   * it is. A refusal to start is the answer, when there is one. */
  async #ready(request: Request): Promise<Response | null> {
    if (this.#refused) return this.#stalled()
    this.#learn(request)
    if (this.#refused) return this.#stalled()
    let selected = this.#select(request)
    if (this.#refused) return this.#stalled()
    this.#live.wake()
    // The clock, started. A wake row is owed at an instant and the runtime's
    // alarm is how this object comes back for it — but an object that has
    // never been asked anything is not running, so a request is the moment its
    // schedules are planted and a lost alarm is set again. Once per
    // incarnation, and the stamp keeps it to one read after the first.
    await this.#sown()
    if (selected.toolsMoved) await this.#planting()
    for (let run of selected.effects) await run()
    return null
  }

  // ---- the write log (T-37968, writes.ts) ----------------------------------

  /**
   * A write, kept before anything else happens to it, then applied in its
   * turn by the one replay that runs at a time, which answers its caller as
   * the store always did. A write that finds the object refusing to start, or
   * the log itself failing, is answered 202 and waits in the log. A resend
   * (its idempotency key already in the log) is the write it repeats: told
   * what that one was told, or waiting beside it.
   */
  async #write(request: Request): Promise<Response> {
    let body = await request.text()
    let key = request.headers.get(IDEMPOTENCY)
    let seq: number
    let was: Sent | null
    let unkept = async () => {
      let req = new Request(request, { body })
      return await this.#ready(req) ?? this.#serve(req)
    }
    if (!fits(body) || keyed(body)) return unkept()
    try {
      was = key ? first(this.#sql, key) : null
      seq = was?.seq ?? keep(this.#sql, request, body)
    } catch (e) {
      // Storage that will not take a row: applied as it came, and said.
      defect(e, { request: 'write log', store: this.#name() })
      return unkept()
    }
    if (was?.state == 'applied') return new Response(was.answer, JSONED)
    if (was?.state == 'refused') return refuse(new Refused(was.why))
    if (was?.state == 'failed') return parked(seq, was.why, was.audit)
    if (was?.state == 'interrupted' || was?.state == 'unreviewed') {
      return parked(seq, was.why, true)
    }
    if (await this.#ready(request)) {
      return this.#park(seq, this.#refused ?? 'this app could not start')
    }
    if (this.#stuck) {
      return this.#park(seq, 'earlier writes to this app are still waiting')
    }
    let answer = new Promise<Response>((r) => {
      let other = this.#callers.get(seq)
      this.#callers.set(seq, other ? (a) => (other(a.clone()), r(a)) : r)
    })
    void this.#drain()
    return answer
  }

  /** The log from its oldest waiting write to its newest, one at a time. A
   * write that fails is set aside (`#land`) and the ones behind it go on;
   * only the log itself failing stops the pass, and then the alarm or the
   * next incarnation starts another. Each write whose caller is still waiting
   * (`#callers`) is answered as it lands; the ones left waiting are told they
   * are kept. */
  #drain(): Promise<void> {
    if (this.#draining) return this.#draining
    let sql = this.#sql
    let run = async () => {
      // Yield once, so `#draining` is set before the loop can end and clear
      // it: a write that arrives in between must find the loop running.
      await null
      try {
        for (let k = next(sql); k; k = next(sql, k.seq)) {
          let caller = this.#callers.get(k.seq)
          this.#callers.delete(k.seq)
          started(sql, k.seq)
          let r = await this.#land(k, !!caller)
          let kept = r.status >= 500 && held(sql, k.seq)
          caller?.(kept ? parked(k.seq, await said(r)) : r)
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
   * as asked, and set aside when it fails (writes.ts `aside`), its failure
   * reported where `#commit` caught it. `live` is a write whose caller is
   * still here to be told its refusal; a replay's refusal has nobody to tell,
   * so it stays in the log with its reason and is reported. */
  async #land(k: Kept, live: boolean): Promise<Response> {
    let sql = this.#sql
    try {
      let r = await this.#commit(replayed(k), k.seq)
      if (r.status < 300) done(sql, k.seq)
      else if (r.status >= 500) aside(sql, k.seq, await said(r.clone()))
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
      if (held(sql, k.seq)) aside(sql, k.seq, String(e))
      return refuse(e)
    }
  }

  /** The log first, for a request that reads: unless the log itself failed,
   * which the alarm owns, or a replay is already running. */
  #settle(): Promise<unknown> | void {
    if (this.#draining) return this.#draining
    if (!this.#stuck && waiting(this.#sql)) return this.#drain()
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
   * owned properties are admitted and @yaks/member's guard stands down
   * (`#trust`). The flag is the kernel's by construction: a store is only
   * ever reached through a request the Worker builds from scratch, and
   * door.ts `storeOf` strips the whole vouch set from any request it is
   * handed, so it can never arrive from outside. An NDJSON import is
   * @yaks/api's `pour`, chunk by chunk.
   */
  async #commit(
    request: Request,
    seq: number | null = null,
    opts: ApplyOpts = {},
  ) {
    if (poured(request)) {
      if (opts.check) {
        return refuse(new Refused('streaming writes cannot be dry-run'))
      }
      return await this.#route(request)
    }
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
          ? this.#trust(body as Bundle[], vouchOf(request).person, opts)
          : this.#graph.apply(signed(body as Bundle[], who), opts)
      } finally {
        this.#landing = null
      }
      return json(await out)
    } catch (e) {
      let no = constrained(e)
      caught(no, { request: 'write', store: this.#name() })
      return refuse(no)
    }
  }

  // The hook that closes the loop: inside the transaction of the batch a kept
  // write brought, that write leaves the log, or stays as its answer for a
  // resend (writes.ts `landed`). Every other batch — an effect's, a tick's,
  // one applied after an await — finds `#landing` empty.
  #logging: Plugin = {
    name: 'yak/writes',
    hooks: {
      commit: (bundles) => {
        if (this.#landing != null) {
          landed(this.#sql, this.#landing, () => bundles)
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
    if (path == '/seed') return this.#seedDoor(request)
    // Every word this store speaks, as the documents its vocabulary was loaded
    // from: the platform's and the app's own together, where `/vocab` is the
    // app's alone. A page's @yaks/client loads them, so it routes and admits
    // what this store does and never declares a word again (T-40511).
    if (path == '/vocab.json') return Response.json(this.#vocab.docs)
    // The three slots beside the vocabulary: the words this app uses but does
    // not home (T-32728), the tools it declares (T-32685), and what the object
    // weighs. None is graph data — a declaration holds no rows and a byte count
    // is not one — so each is a word in this object's own memory, and the
    // kernel is the only caller.
    if (path == '/uses') return this.#slot(request, 'uses')
    if (path == '/storage') return this.#storage(request)
    if (path == '/tools') {
      let candidate = this.#candidate(request)
      let key: Word = candidate ? `tools:${candidate}` : 'tools'
      let was = this.#get(key) ?? this.#get('tools') ?? '{}'
      let answer = await this.#slot(request, 'tools')
      if (!answer.ok || request.method != 'POST') return answer
      let now = this.#get(key) ?? '{}'
      // The views this manifest names, compared: the set of pages its
      // commands draw their answers in, which is what `resources/list` is made
      // of, and the kernel tells everyone who can reach the app when it moved
      // (declared.ts `viewsMoved`). The commands themselves move no list —
      // they are not tools, and the tool roster is fixed (T-34541).
      // The rows those commands are called at (`#planting`): a deploy is what
      // moves the manifest, so a deploy is what stands them up.
      if (now != was && !candidate) await this.#planting()
      let said = await answer.json() as Record<string, unknown>
      return Response.json({ ...said, views: viewed(now) != viewed(was) })
    }
    if (path == '/graph') {
      return Response.json({
        db: `do:${this.#get('name') ?? ''}`,
        bytes: this.#ctx.storage.sql.databaseSize,
      })
    }
    // Words ranked by meaning among what a filter line selects, nearest first
    // (memory.ts): the words embedded by the model this store's vectors are
    // in, and those vectors scanned (@yaks/embedding `meaning`). A store with
    // no model bound answers nothing. The kernel's alone, like `/inspect`.
    if (path == '/meaning') {
      if (!kernel || request.method != 'GET') {
        return json({ error: 'NotFound', message: 'no route' }, 404)
      }
      let at = new URL(request.url).searchParams
      let model = embedder(this.#bind)
      if (!model) return Response.json([])
      try {
        let within = at.get('within')
        let { sql, fields, screen } = this.#texts
        return Response.json(
          await meaning(sql, fields, model, at.get('q') ?? '', {
            limit: Number(at.get('limit') ?? 20),
            screen: within ? () => screen(within) : undefined,
          }),
        )
      } catch (e) {
        return refuse(e, request)
      }
    }
    if (path == '/inspect') {
      if (!kernel || request.method != 'GET') {
        return json({ error: 'NotFound', message: 'no route' }, 404)
      }
      let seq = new URL(request.url).searchParams.get('seq')
      if (seq == null) {
        return Response.json({ physical: inspectStorage(this.#sql) })
      }
      let n = Number(seq)
      if (!Number.isSafeInteger(n) || n < 1) {
        return refuse(new Refused('/inspect needs a positive seq'))
      }
      let row = kept(this.#sql, n)
      if (!row) return refuse(new Refused(`write ${n} is not held for review`))
      let original = replayed(row)
      if (poured(original)) {
        return refuse(new Refused('streaming writes cannot be dry-run'))
      }
      let change: Bundle[]
      try {
        change = JSON.parse(row.body)
        if (!Array.isArray(change)) throw new Error('not a batch')
      } catch {
        return refuse(new Refused('held write is not a JSON batch'))
      }
      let names = change.flatMap((b) =>
        Object.keys(b).filter((name) =>
          name != 'entity' && !name.startsWith('$')
        )
      )
      let physical = inspectStorage(this.#sql, 160, names)
      let phases: Record<string, number> = {}
      let start = performance.now()
      let answer = await this.#commit(original, null, {
        check: true,
        trace: (phase, ms) => phases[phase] = (phases[phase] ?? 0) + ms,
      })
      let applied = answer.ok ? (await answer.json() as Bundle[]).length : null
      return Response.json({
        physical,
        dryRun: {
          seq: n,
          status: answer.status,
          bundles: applied,
          ms: performance.now() - start,
          phases,
        },
      })
    }
    if (path == '/writes') {
      if (!kernel) return json({ error: 'NotFound', message: 'no route' }, 404)
      let seq = Number(new URL(request.url).searchParams.get('seq'))
      if (request.method == 'GET') {
        return Response.json(
          writes(
            this.#sql,
            Number.isSafeInteger(seq) && seq > 0 ? seq : undefined,
          ),
        )
      }
      if (request.method != 'POST' || !Number.isSafeInteger(seq) || seq < 1) {
        return refuse(new Refused('/writes retry needs a positive seq'))
      }
      if (!retry(this.#sql, seq)) {
        return refuse(new Refused(`write ${seq} is not held for review`))
      }
      this.#stuck = false
      await this.#drain()
      return Response.json({ seq, writes: writes(this.#sql, seq) })
    }
    // The app this store held is gone (tools.ts app_delete, erase.ts
    // `emptied`): everything in it, at once. Kernel only, like the trusted
    // write — a client's request never carries the flag.
    if (path == '/' && request.method == 'DELETE') {
      if (!kernel) return json({ error: 'NotFound', message: 'no route' }, 404)
      return this.#erase()
    }
    // Where this object's storage stands, and putting it back (recover.ts,
    // T-34507). Kernel only, like the erase: a whole store going backwards is
    // the platform's act on behalf of a member who may write it, and a client
    // never writes a store's path.
    if (path == '/restore') {
      if (!kernel) return json({ error: 'NotFound', message: 'no route' }, 404)
      return this.#recovery(request)
    }
    // Come back now for whatever the wakes are owed (`tick`): what a restore
    // says to an app out of the trash (erase.ts `untrash`), which armed
    // nothing while it sat there. Kernel only, like the erase.
    if (path == '/alarm' && request.method == 'POST') {
      if (!kernel) return json({ error: 'NotFound', message: 'no route' }, 404)
      await this.#arming(new Date().toISOString())
      return Response.json({ ok: true })
    }
    // The mover's door (mover.ts), a sweep's one question of each store:
    // `?rehearse=1` moves every rule's rows inside a transaction it rolls
    // back and says what it found; otherwise the store is woken to move what
    // it owes, and says where each rule stands. Kernel only, like the alarm.
    if (path == '/move' && request.method == 'POST') {
      if (!kernel) return json({ error: 'NotFound', message: 'no route' }, 404)
      let store = this.#get('name') ?? ''
      if (new URL(request.url).searchParams.get('rehearse') == '1') {
        let rules = rehearse(this.#mover([]), this.#rules, SIZE)
        this.#kv.clear()
        return Response.json({ store, rules })
      }
      if (this.#owing().length) await this.#arming(new Date().toISOString())
      let rules: Standing[] = this.#rules.map((r) => ({
        mark: r.mark,
        live: runs(r, store),
        ...this.#stamp(r),
      }))
      return Response.json({ store, rules })
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
    if (path == '/query') return await this.#asked(request)
    return await this.#route(request)
  }

  // `/query`, watched as @yaks/api watches its own doors (`served`): a
  // failure is answered with the `x-request-id` its console line names, and a
  // refusal is the caller's, answered at its status. An aggregate is not a
  // listing — `.count` answers one number — and @yaks/api's read door answers
  // bundles, which is the wrong half of the compiled statement. So it is
  // answered here, off the raw rows, in the shape every door on this platform
  // says it in. A line that does not parse is answered 400.
  #asked = served(async (request) => {
    let url = new URL(request.url)
    let line = url.searchParams.get('q') ?? ''
    let live = url.searchParams.get('live') == '1'
    let no = unserved(line)
    if (no) throw new Refused(no)
    let agg = aggOf(line)
    if (agg && !live) {
      await this.#auth(request)
      return await this.#counted(line, agg)
    }
    return await this.#kinded(await this.#route(request), line)
  }, { route: () => '/query' })

  // The word a row is named by. `kind` is not a property and no client can
  // derive it: it is the most specific component this vocabulary says the
  // entity wears (@yaks/vocab `kindOf`), and only a store holding the
  // vocabulary can say which that is. Every caller above reads it — the
  // composing read calls a row by it (reach.ts), a page's listing draws with
  // it, and the guide documents it on every row.
  #kind = (row: Bundle): Bundle => ({
    kind: this.#vocab.kindOf(row as Record<string, unknown>),
    ...row,
  })

  // Outputs speak human (listing.ts `named`): a property that references a
  // person answers `{eid, name}` on a query, and the name rides beside the eid
  // on a socket. Which properties reference is the vocabulary's word
  // (`refProps`), and who among the eids is a person is this store's own rows —
  // the writer it minted when they first wrote here, wearing what the kernel
  // said to call them.
  #names = (rows: Bundle[]): Names | Promise<Names> => {
    let at = new Set(this.#vocab.refProps().map(([c, p]) => `${c}.${p}`))
    let { eids, refs } = mentions(
      rows as Row[],
      (comp, prop) => at.has(`${comp}.${prop}`),
    )
    if (!eids.length) return { refs, names: {} }
    let missing = eids.filter((eid) => !this.#people.has(eid))
    let read = missing.length ? this.#graph.get(missing, ['person', 'doc']) : []
    return after(read, (found) => {
      for (let eid of missing) this.#people.set(eid, null)
      for (let b of found) {
        let title = (b.doc as { title?: string } | undefined)?.title
        if (b.person && title) this.#people.set(b.entity.eid, title)
      }
      let names: Record<string, string> = {}
      for (let eid of eids) {
        let name = this.#people.get(eid)
        if (name) names[eid] = name
      }
      return { refs, names }
    })
  }

  #speak = (rows: Bundle[]): Bundle[] | Promise<Bundle[]> =>
    after(this.#names(rows), (said) => named(rows as Row[], said) as Bundle[])

  // The read door's half of the graph's `teach`: `unknown prop: .recipe` is true and
  // useless on its own, so the store that holds the vocabulary adds where a
  // word of your own comes from. The directory says nothing of the kind — its
  // callers are the kernel's own.
  async #taught(answer: Response): Promise<Response> {
    if (answer.ok || this.#get('name') == PLATFORM_STORE) return answer
    let said = await answer.json() as { error?: string; message?: string }
    return /^unknown (prop:|component)/.test(said.message ?? '') &&
        !said.message!.includes(url(this.#bind, '/docs.md'))
      ? Response.json({ ...said, message: said.message + teach(this.#bind) }, {
        status: answer.status,
        headers: answer.headers,
      })
      : Response.json(said, { status: answer.status, headers: answer.headers })
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
      this.#sql,
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
    // The rows already carry what the line names (@yaks/graph `wanted`).
    let ranked = this.#ranked(rows as Bundle[], line)
    return Response.json(await this.#speak(ranked.map(this.#kind)))
  }

  // The same rows on a subscription's frames, because a subscription is that
  // query still answering; @yaks/api already cuts each frame to what its query
  // names. A frame keeps each row in the store's own words and says the names
  // beside them, since a page's @yaks/client lands a row only in the words the
  // store speaks, where `created.by` is an eid; the served client paints them,
  // so a page that swaps `query()` for `subscribe()` gets the same rows
  // (public/client.js). Its question is asked the way the app's door asks a
  // page's query (listing.ts `asking`): the platform's own rows `words` names
  // are left out unless the line names one. The sink a socket hands in is
  // wrapped once per sink, since `close` and `drop` find a subscription by the
  // sink it was opened with.
  #naming(subs: Subs, words: string[]): Subs {
    let wrapped = new Map<Sink, Sink>()
    let by = (sink: Sink): Sink => {
      let held = wrapped.get(sink)
      if (!held) {
        wrapped.set(
          sink,
          held = (f) => {
            if (!f.bundles) return sink(f)
            // What a projection reaches rides beside the rows, in the same
            // words.
            let bundles = f.bundles.map(this.#kind)
            let peers = f.peers?.map(this.#kind)
            let rode = peers ? { peers } : {}
            after(this.#names([...bundles, ...peers ?? []]), (said) => {
              let spoken: Frame & Partial<Names> =
                Object.keys(said.names).length
                  ? { ...f, bundles, ...rode, ...said }
                  : { ...f, bundles, ...rode }
              sink(spoken)
            })
          },
        )
      }
      return held
    }
    return {
      snapshot: (query) => subs.snapshot(asking(query, words)),
      open: (sink, id, query) =>
        subs.open(
          by(sink),
          id,
          query === true ? query : asking(query, words),
        ),
      restore: (openings) =>
        subs.restore(openings.map(({ sink, id, query }) => ({
          sink: by(sink),
          id,
          query: query === true ? query : asking(query, words),
        }))),
      close: (sink, id) => subs.close(by(sink), id),
      drop: (sink) => subs.drop(by(sink)),
      commit: subs.commit,
      // A relay carries no membership news and no stored rows, so there is
      // nothing here to rename — only the sink to translate.
      relay: (sink, bundles) => subs.relay(by(sink), bundles),
      pace: subs.pace,
      relaying: (sink) => subs.relaying(by(sink)),
      relayed: (sink, keys) => subs.relayed(by(sink), keys),
    }
  }

  // One of the object's own memory slots as a door: a GET reads back what it
  // last accepted, a POST replaces it whole. The body is stored as written —
  // whoever posts it is the one that can check it against the app's words
  // (tools.ts `released`), and a slot that parsed its own content would be a
  // second vocabulary in the object.
  async #slot(request: Request, word: 'uses' | 'tools'): Promise<Response> {
    let candidate = this.#candidate(request)
    let key: Word = candidate ? `${word}:${candidate}` : word
    if (request.method == 'GET') {
      return Response.json(
        JSON.parse(this.#get(key) ?? this.#get(word) ?? '{}'),
      )
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
    if (now != this.#get(key)) this.#put(key, now)
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
  async #erase(): Promise<Response> {
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
    this.#kv.clear()
    this.#sql.query(KV)
    raise(this.#sql)
    if (name) this.#put('name', name)
    this.#boot()
    if (this.#refused) return this.#stalled()
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

  // Check a draft seed with its candidate vocabulary and hold it for the
  // release switch. The trial's schema and rows roll back together.
  async #seedDoor(request: Request): Promise<Response> {
    let release = request.headers.get('x-yak-release')
    if (
      request.method != 'POST' ||
      !request.headers.has('x-yak-base-release') ||
      !release || !/^[a-z0-9-]+$/.test(release)
    ) return json({ error: 'NotFound', message: 'no route' }, 404)
    try {
      let bundles = await request.json() as Bundle[]
      if (!Array.isArray(bundles)) {
        throw new Refused('/seed takes a JSON array of bundles')
      }
      let actor = await this.#auth(request)
      let rollback = Symbol('candidate seed')
      try {
        this.#ctx.storage.transactionSync(() => {
          let next = this.#get(`vocab:${release}`)
          if (!next) throw new Refused('candidate vocabulary is not staged')
          this.#put('vocab', this.#prepared(next))
          this.#build()
          let result = this.#graph.apply(signed(bundles, actor), {
            check: true,
          })
          if (result instanceof Promise) {
            throw new Error('a staged seed must check synchronously')
          }
          throw rollback
        })
      } catch (e) {
        if (e !== rollback) throw e
      } finally {
        this.#kv.clear()
        this.#boot()
      }
      if (this.#refused) return this.#stalled()
      if (new URL(request.url).searchParams.get('check') != '1') {
        this.#put(`seed:${release}`, JSON.stringify({ bundles, actor }))
      }
      return Response.json({ ok: true })
    } catch (e) {
      return refuse(e, request)
    }
  }

  // The app's own components (vocab.json): a GET reads back what this store
  // last accepted, a POST replaces it. The manifest is loaded — and refused —
  // before a byte of it is written down, so a refusal leaves the store exactly
  // as it was. The kernel is the only caller; a client never writes a store's
  // path.
  //
  // The answer is what this app now says and what moved, which naming the
  // components does not tell whoever deployed it (C-32652 item 4): a renamed
  // property arrives beside the old one, and `added` is how they see that. A
  // word leaves only once nothing is stored under it (vocab.ts `grew`), so
  // each of `dropped` is a table or a column that held nothing.
  //
  // What is written, kept and answered is one thing: the document (T-37546).
  // A manifest is a JSON Schema document and nothing else — a keyword is the
  // property's (`search`, `stamped`, a reference's `death`), and a manifest
  // flattened to bare type words dropped every one of them before any store
  // could read it.
  #vocabDoor(request: Request): Response | Promise<Response> {
    let candidate = this.#candidate(request)
    if (request.method == 'GET') {
      return Response.json(meant(
        candidate
          ? this.#get(`vocab:${candidate}`) ?? this.#get('vocab') ?? '{}'
          : this.#get('vocab') ?? '{}',
      ))
    }
    if (request.method != 'POST') {
      return Response.json(
        { error: 'NotAllowed', message: '/vocab takes GET or POST' },
        { status: 405, headers: { allow: 'GET, POST' } },
      )
    }
    return request.text().then((body) => {
      try {
        let was = appDoc(this.#get('vocab') ?? '{}')
        let next = unsaid(appDoc(body), was)
        let { doc, dropped, added, kept, retyped } = grew(
          was,
          next,
          (name, prop) => this.#rows(name, prop),
        )
        let before = appVocab(was)
        let after = appVocab(doc)
        let prepare = () => {
          retire(this.#sql, before, after)
          for (let name of [...dropped, ...retyped]) {
            let [comp, prop] = name.split('.')
            if (prop) shed(this.#sql, before, after, comp, prop)
            else {
              this.#sql.query({
                t: 'drop',
                kind: 'table',
                name: comp,
                ifExists: true,
              })
            }
          }
        }
        if (candidate) {
          // A draft is validated against the serving rows, but its schema
          // changes roll back. Only the declaration is kept for selection when
          // the directory moves the release pointer.
          let rollback = Symbol('candidate schema')
          try {
            this.#ctx.storage.transactionSync(() => {
              prepare()
              let { vocab, stamp } = shapeOf(
                this.#get('name') ?? '',
                JSON.stringify(doc),
              )
              this.#schema(vocab, stamp, this.#get('name') ?? '')
              throw rollback
            })
          } catch (e) {
            if (e !== rollback) {
              this.#kv.clear()
              defect(e, {
                request: 'schema candidate',
                store: this.#get('name') ?? '',
              })
              return Response.json({
                error: 'Refused',
                message: e instanceof Error ? e.message : String(e),
              }, { status: 503 })
            }
          }
          this.#kv.clear()
          this.#put(`vocab:${candidate}`, JSON.stringify(doc))
        } else {
          // The declaration and its DDL roll back together on boot failure.
          this.#boot(() => {
            this.#put('vocab', JSON.stringify(doc))
            prepare()
          })
          if (this.#refused) return this.#stalled()
        }
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

  // How many rows one component holds, or with a property, how many hold a
  // value there — the question only a store can answer, and what decides
  // whether a word the manifest stopped naming may leave. A table or a column
  // that is not there holds nothing.
  #rows(name: string, prop?: string): number {
    try {
      let [row] = this.#sql.query(select({
        cols: [as(count(), 'n')],
        from: table(name),
        where: prop ? notNull(col(prop)) : undefined,
      }))
      return Number(row?.n ?? 0)
    } catch {
      return 0
    }
  }

  /** A frame from a client: a subscription opened or closed. */
  webSocketMessage(
    ws: Wire,
    data: string | ArrayBuffer,
  ): void | Promise<void> {
    let run = (): void | Promise<void> => {
      if (this.#draft) {
        return this.#draft.then(() => this.webSocketMessage(ws, data))
      }
      // A hibernated socket outlives a deploy, so one can wake an object
      // whose schema refused to stand. The page must reopen the socket.
      if (this.#unbuilt) return void this.#hangUp(ws)
      try {
        let prof = this.#profile
        this.#live.message(
          ws,
          data,
          prof ? (kind, work) => prof.run(`ws ${kind}`, work) : undefined,
        )
      } finally {
        this.#profile?.flush()
      }
    }
    return run()
  }

  /** That client went away. */
  webSocketClose(ws: Wire): void | Promise<void> {
    let run = (): void | Promise<void> => {
      if (this.#draft) return this.#draft.then(() => this.webSocketClose(ws))
      if (!this.#unbuilt) this.#live.close(ws)
    }
    return this.#profile ? this.#profile.run('ws close', run) : run()
  }

  /** Whether the boot refused, so nothing above the storage was raised. */
  get #unbuilt(): boolean {
    return this.#refused != null
  }

  #hangUp(ws: Wire) {
    try {
      ;(ws as Closable).close?.(1012, 'refused')
    } catch { /* already gone */ }
  }
}
