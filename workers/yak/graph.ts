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
// It serves TWO roles, told apart by the name the kernel gives the object. An
// app's store wakes with the core plus its own `vocab.json`; the DIRECTORY —
// the one object named `yak/platform` — wakes with the platform's own
// vocabulary, uniques and all (vocab.ts `platformDoc`, T-33814). One class,
// one composition, two vocabularies.
//
// This class carries the DO's own NAME, `Store`, so wrangler's migration list
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
// ONE seam, and it is @yaks/api's `Authenticate` — the same value @yaks/mcp's
// mount takes, so the agent door and the page door cannot disagree about who
// is writing. {@link authenticating} is it: the vouch in, the `$actor` entity
// out, and a refusal for a caller this app's mode does not admit. Nothing else
// in this object reads a credential, and no bundle's own `$actor` survives
// (@yaks/api `signed`).
//
// THE CREDENTIAL IS VERIFIED ONCE, AT THE EDGE. A session cookie, an OAuth
// bearer and a sealed grant are three things to check and one answer — a
// person and the level they hold — so the kernel checks them where they
// arrive (identity.ts `withAuth`, dispatch.ts `granted`) and says the answer
// in the vouch: `x-yak-person`, `x-yak-role`, `x-yak-title`, beside the app
// this store holds (`x-yak-app`) and what the directory says its access mode
// is (`x-yak-access`).
//
// WHY THE VOUCH IS BELIEVED. Not because it is signed — it is not — but
// because nothing else can say it. A Durable Object is reachable only through
// its binding, from this Worker, and the one door onto a store (door.ts
// `storeOf`) STRIPS the whole vouch set from any request it is handed before
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
import { type Driver, fields, find } from '@yaks/fts'
import {
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
import { DELIVER, MAIL, mailbox, sending } from '@yaks/mail'
import {
  actorOf,
  Denied,
  type Level,
  level,
  levelOn,
  members,
  type Mode,
  mode,
  type Policy,
  policy,
  reads,
  writes,
} from '@yaks/member'
import { parse } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { named, type Row } from './listing.ts'
import { type Binding, posting } from './post.ts'
import type { Namespace } from './door.ts'
import { metering } from './meter.ts'
import { PLATFORM } from './route.ts'
import {
  addressed,
  addresses,
  type Bucket,
  carry,
  FORMER,
  HOMED,
  homed,
  homes,
  housed,
  keyOf,
  lines,
  MARK,
  rebuild,
  recut,
  Refused as Unreconciled,
  type Report,
  type Slots,
  slugged,
  stale,
  taken,
} from './migrate.ts'
import {
  appDerived,
  appDoc,
  appVocab,
  grew,
  GUIDE,
  PLATFORM_STORE,
  platformVocab,
  shortOf,
  TEACH,
} from './vocab.ts'

/**
 * The slice of a `DurableObjectState` this object needs: its storage, and its
 * hibernatable sockets. A Worker's own `DurableObjectState` satisfies it.
 *
 * Two things beyond @yaks/durable-object's own slice, because the PLATFORM asks
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
  }
  // The runtime's own gate: work started here finishes before any request is
  // delivered, which is what makes a one-pass migration safe to start from the
  // first request that reaches the object. Absent in the workerd stand-in, where
  // an object is driven one call at a time anyway.
  blockConcurrencyWhile?<T>(body: () => Promise<T>): Promise<T>
}

/** The bindings this object is handed — the Worker's whole `env`, of which it
 * reads three: the bucket a migration writes the object's whole old graph to
 * before it moves a row (migrate.ts), Cloudflare Email Sending, which is how a
 * letter written here leaves (post.ts, T-33686), and the store namespace, which
 * is how the letter it just sent reaches the space's meter — the directory is
 * another object in that namespace (meter.ts `metering`, T-33688). */
export type Bindings = {
  EXPORTS?: Bucket
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
 * The vouch off a request. `x-via` names an INSTRUMENT that named itself —
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
 * THE seam: the vouch as @yaks/api's `Authenticate`, which @yaks/mcp's mount
 * takes too. Nobody at all is `null` — an anonymous visitor, which an `open`
 * or `public` app admits and a `private` one refuses.
 *
 * A READ never reaches `apply()`, so it is refused here, in @yaks/member's own
 * words: the app's mode against the level this caller holds. The level is the
 * kernel's when it vouched one — the platform's roster lives in the directory,
 * not in an app's store — and this store's own grants otherwise, which is what
 * a share link and an app's own `grant` rows are. A WRITE passes here and is
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
  let who = v.person ? { eid: v.person } : null
  let held = app()
  if (!held) return who
  let m = await may.modeOf(held)
  let has = v.level ?? await may.levelOf(v.person, held)
  if (reads(m, has)) return who
  // Signed out, the way in is to sign in; signed in and holding nothing, it
  // is the app owner's to grant. Neither answer says more about the app than
  // the address already did.
  if (!who) throw new Unauthorized('sign in to read this app')
  throw new Denied(who.eid, held, 'viewer', 'read')
}

// The spine's own name.
let SPINE = 'entity'

// The two pieces of the wider platform grammar an app's store refuses BY NAME
// rather than answering some other way (public/guide/querying.md, where both
// are written down as this store's own limits). A work lane is the fleet's
// board, which nothing here has; semantic ranking needs a vector index, which
// nothing here has either — and an empty answer to a question about neither
// would read as "no rows" rather than "not that question".
// The three directives that reshape an answer into ONE value rather than a set
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

// A tools manifest without its views, and its views alone — the two halves a
// release can move one of (see the `/tools` door). Both read the JSON as
// written and say nothing about whether it is a manifest at all: what is in
// the slot is whatever the kernel put there.
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

let apart = (manifest: string): string =>
  JSON.stringify(
    entries(manifest).map(([name, t]) => [name, { ...t, view: undefined }]),
  )

let viewed = (manifest: string): string =>
  [...new Set(entries(manifest).map(([, t]) => t?.view).filter(Boolean))]
    .map(String).sort().join('\n')

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
  #bind: Bindings
  // An object still holding the FLEET-shaped store this class replaces
  // (T-33809). Nothing above the storage is built while this is true — planting
  // the new schema over the old tables is exactly what must not happen — so the
  // first request runs the pass and everything is raised after it.
  #pending: boolean
  // Whether this object is behind the LATEST migration (migrate.ts `MARKS`):
  // one that never carried, or one that carried before a later pass existed.
  // Decided ONCE, here, rather than read off the storage on every request.
  #behind: boolean
  #passing: Promise<void> | null = null
  // Why the pass refused, when it did. The rows are the old ones, untouched.
  #refused: string | null = null

  constructor(ctx: State, bind: Bindings = {}) {
    this.#ctx = ctx
    this.#bind = bind
    ctx.storage.sql.exec(KV)
    this.#pending = !this.#get('migrated') && stale(ctx.storage)
    if (!this.#pending) this.#boot()
    // The passes after the first read and write the NEW schema, so they are
    // asked after the boot — and only of an object that is not already at the
    // LAST marker (migrate.ts `MARKS`), with one question per pass: an object
    // that stopped at an older marker because it had nothing to move for it
    // still has to be asked about the ones added since.
    this.#behind = this.#pending ||
      (this.#get('migrated') != FORMER &&
        (housed(ctx.storage) || slugged(ctx.storage)))
  }

  // Waking on whatever this object holds. Everything above the storage is
  // rebuilt from the remembered vocabulary, which is why a deploy is a write
  // and a reboot rather than a migration: the schema is additive — a table the
  // store has never seen is created, a column a word grew is added — and what
  // changed is which words the graph admits. Nothing is ever dropped or
  // retyped; T-33809 owns moving rows that a changed COLUMN would need.
  #boot() {
    let ctx = this.#ctx
    // Which words this object speaks is a question of WHICH OBJECT it is. One
    // store on the platform is the directory (the meta space, T-33814): it
    // wakes with the platform's own vocabulary, which declares the uniques its
    // races are decided by. Every other object is an app, and wakes with the
    // core plus whatever its `vocab.json` declared.
    let meta = this.#get('name') == PLATFORM_STORE
    let vocab = meta ? platformVocab() : appVocab(this.#get('vocab') ?? {})
    let drive = driver(ctx.storage)
    this.#drive = drive
    let bytes = sqliteBlobs(drive)
    let store = storage(ctx.storage, vocab, {
      derived: { ...blobRead(vocab), ...(meta ? {} : appDerived()) },
      // A body is stored as its address (@yaks/blob `store: "blob"`), so the
      // search index is told how to read one back as prose — or it would hold
      // hashes and a search would find a body by its title alone (T-33978).
      text: blobText(vocab),
    })
    // Every index the vocabulary declares is already in `store.ddl()` — the
    // directory's uniques included, since they are words of `platformDoc`.
    // The blob table FIRST: the `doc_value` view and the search triggers read
    // a body's text out of it, so it has to be standing before they are.
    let ddl = [...blobSchema(), ...store.ddl()]
    // The schema this object stands at, as one word: a wake under the same
    // vocabulary runs no DDL at all, and a deploy that added a component
    // raises its table on the next request.
    //
    // A BRAND-NEW object raises nothing yet: it does not know which store it
    // is until its first request says so, and planting an app's core into what
    // turns out to be the directory would leave tables no word of its
    // vocabulary names. `#learn` reboots the moment the name arrives, and every
    // door runs after it.
    let named = !!this.#get('name') || !!this.#get('schema')
    let stamp = sha256(ddl.join('\n'))
    let held = this.#get('schema')
    if (named && held != stamp) {
      // A DEFINITION cannot be altered by replaying it. `create ... if not
      // exists` says nothing about a trigger or a full-text index that is
      // already standing, so one raised under an older schema keeps its old
      // shape while the tables under it move — which is how a search index came
      // to hold blob ADDRESSES after the triggers learned to resolve them
      // (T-33978). A definition holds no rows of its own, so it is dropped and
      // raised again at the current shape whenever the stamp moves, and the
      // index is then rebuilt off the content it mirrors. Nothing to do the
      // first time: there is no older shape to be wearing.
      if (held) recut(drive)
      for (let stmt of ddl) drive.exec(stmt)
      // A word that GREW a column: `create table if not exists` says nothing
      // about a table that is already there, so the new column has to be added
      // to the live table or every read naming it fails at the engine
      // (@yaks/sqlite `grown`). After the creates, so a table raised a moment
      // ago is there to interrogate.
      for (let stmt of store.grown()) drive.exec(stmt)
      if (held) rebuild(drive)
      this.#put('schema', stamp)
    }
    let app = this.#get('app')
    // The registry an app's own effects register on (T-33816), and the one
    // this platform puts on it: a letter leaves through the Email Sending
    // binding, post-commit (T-33686). It is FRESH on every boot, so the
    // registration below happens once per incarnation however often a store
    // is rebuilt.
    // An effect writes back through the KERNEL's own door — a new batch
    // through this graph's `apply()`, trusted and unsigned — so what a letter
    // came to is journaled, cast to every open socket, and seen by whatever
    // else is watching, instead of a row a page finds on its next query
    // (T-34044). `#trust` is the same door `x-yak-kernel` writes through; the
    // graph it names is whichever one this object last built, which is the
    // only one that could be committing.
    let fx = effects(vocab, { write: (b) => this.#trust(b, null) })
    // Who carries a letter out of THIS store, and only for an app: the
    // platform's own store writes its sign-in codes through mail.ts from the
    // fleet's own address, and has no app whose name a letter could leave
    // under. No binding is a sender that refuses (post.ts), so a deploy
    // without one bounces a letter rather than swallowing it — and the send is
    // metered against the space's month on the way through (meter.ts), which
    // is why the address is read at SEND time and not at boot.
    let post = meta || !app ? null : metering(
      this.#bind,
      () => this.#get('mail'),
      posting(this.#bind.MAIL),
    )
    let g = graph({
      storage: store,
      vocab,
      // The guard is added LAST and only when this object knows which app it
      // holds: @yaks/member refuses a write by an actor with no level, so a
      // store that cannot name its app has no access question to ask and the
      // kernel's own gate in front of it is the whole rule.
      plugins: [
        // First, before anything reads a word that is not there. The DIRECTORY
        // is left out: its words are the platform's own, its callers are the
        // kernel's own, and `vocab.json` is not a sentence to say to any of
        // them.
        ...(meta ? [] : [this.#teaching]),
        // Before every check, because it is about the SHAPE a value arrived in.
        this.#lowering,
        edges(vocab),
        // The carrier and the one kind of it every store speaks: a NAME, which
        // is how anything addresses a row it wrote last week without having
        // kept the eid. The carrier goes first — the name rides it (T-34390).
        keys(vocab),
        aliases(vocab),
        blobs(vocab, bytes),
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
        ...(post && app
          ? [this.#posting(app), mailbox({ domain: PLATFORM })]
          : []),
      ],
    })
    // A letter goes when it asks to, whichever of its two components arrives
    // last: `sending` reads the whole entity rather than the patch that woke
    // it, so a letter written whole and one that gains its recipient later go
    // the same way. It is idempotent — a letter already carrying `delivered`
    // or `bounced` is left alone — so two slots are still one send.
    if (post) {
      fx.created(MAIL, sending({ sender: post }))
      fx.created(DELIVER, sending({ sender: post }))
    }
    this.#vocab = vocab
    this.#graph = g
    let subs = subscriptions(g)
    this.#live = sockets(this.#naming(subs), ctx)
    // The one `Authenticate` (T-33813). The app is read at REQUEST time — the
    // object may learn which app it holds from the request being answered —
    // and the mode with it, so a store told its access changed follows the
    // new word without a reboot.
    this.#auth = authenticating(
      policy(g.storage),
      () => this.#get('app'),
      (v) => void (v.person && this.#vouched.set(v.person, v)),
    )
    this.#route = api({ graph: g, subs, authenticate: this.#auth })
    // The registry is FRESH, and the sockets are not: they belong to the
    // runtime and outlive every incarnation of this object, so whatever they
    // are watching is re-opened against the new one. Without this a deploy
    // would leave every open page subscribed to a registry nothing commits to.
    this.#live.wake()
  }

  /** What this object holds, and the seam that says who is asking it — the
   * two values @yaks/mcp's mount is built out of, so the agent door is the
   * same graph under the same `Authenticate` as the page door (T-33812). */
  get door(): { graph: Graph; authenticate: Authenticate } {
    return { graph: this.#graph, authenticate: this.#auth }
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
    let name = req.headers.get('x-store')
    // The name is what says whether this object is the directory, so learning
    // it for the first time can change which vocabulary it speaks — and the
    // object was constructed before any request could tell it.
    if (name && this.#get('name') != name) {
      this.#put('name', name)
      this.#boot()
    }
    // Which app this object holds is an APP's question. The directory is not
    // one — it speaks the platform's vocabulary, which has no `grant` and no
    // `access`, and the kernel decides who may read and write it before the
    // request arrives (vocab.ts, `platformDoc`). A caller that names an app on
    // its way to the directory is naming an app whose ROW lives here, not the
    // object it is talking to, so the word is ignored rather than believed:
    // believing it installs @yaks/member's guard on a store with no seats and
    // writes a grant into a table that does not exist.
    if (this.#get('name') == PLATFORM_STORE) return
    let app = req.headers.get('x-yak-app')
    if (app && this.#get('app') != app) {
      this.#put('app', app)
      this.#boot()
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
  // to answer "and everyone else?". It is written STRAIGHT THROUGH storage,
  // not through apply(): the platform's word about who may write is not an
  // application write and does not pass the application's guard, which would
  // refuse it (only an owner may write an `access`).
  #mode(m: Mode) {
    let app = this.#get('app')
    if (!app) return
    this.#patch([{ entity: { eid: app }, access: { mode: m } }])
  }

  // What the kernel has vouched about somebody, this incarnation, kept BY
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
   * It is a WRITE-PATH plugin rather than a door's own step, because there is
   * more than one door — @yaks/api's `/apply`, @yaks/mcp's tools, whatever
   * mounts next — and the guard that reads these rows would otherwise hold
   * for one of them and not the others. `precondition` is where it belongs:
   * inside the batch's transaction, before @yaks/member's guard runs, so the
   * platform's word is a row by the time the rule asks for one, and a refused
   * batch rolls the row back with everything else it wrote.
   *
   * A READ writes nothing at all: an app learns who its members are when one
   * of them writes to it, not when one of them looks at it.
   */
  /**
   * A word nobody declared, refused at the write door instead of dropped.
   *
   * @yaks/graph drops an unknown COMPONENT on purpose — forward compatibility,
   * so a newer client's batch still lands (admit.ts). This platform has the
   * opposite problem: an app's own words are its `vocab.json`, and a `recipe`
   * silently dropped is a page that saved nothing and said it saved. So the
   * store that HOLDS the vocabulary says where a word comes from, in the same
   * sentence the read door says it in (`#taught`).
   */
  #teaching: Plugin = {
    name: 'yak/teach',
    hooks: {
      normalize: (bundles) => {
        for (let b of bundles) {
          for (let [name] of comps(b)) {
            if (!this.#vocab.all.includes(name)) {
              throw new Refused(`unknown component: ${name}${TEACH}`)
            }
          }
        }
        return bundles
      },
    },
  }

  /**
   * A row read back, handed straight back. A reference READS as `{eid, name}`
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
        // The APP writing as itself (dispatch.ts `owning`, `env.APP`) is the
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
   * THE `from` IS THE PLATFORM'S WORD, stamped over whatever the batch said.
   * The address is a claim about who wrote — a letter from
   * `ada.cookbook@yaks.app` is DKIM-signed by us and read by the world as
   * ours — and a column a client may write is a column a client may forge. A
   * letter the KERNEL writes is left alone: that is an ARRIVAL (T-33687),
   * whose `from` is the sender's own, out on the web.
   *
   * WHO MAY SEND is the roster, not the app's mode. @yaks/member's rule is
   * about the APP, and an `open` app admits an anonymous visitor's write on
   * purpose — that is what open means. But a letter does not stay in the app:
   * it leaves under the platform's name, so an open app with no rule here is
   * an open relay, and the first spam run would take the zone's reputation
   * with it. So the ASK to send — the `deliver` component — is held to a level
   * that writes: a member or an editor, and never nobody at all. Writing the
   * letter is not held to anything; a draft is ordinary data.
   */
  #posting(app: string): Plugin {
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
          this.#kernelling ? bundles : bundles.map(letter),
        precondition: (bundles, tx) => {
          if (this.#kernelling || !bundles.some((b) => b[DELIVER])) {
            return bundles
          }
          let who = actorOf(bundles)
          return then(levelOn(tx, who, app), (held) => {
            if (!writes(held)) throw new Denied(who, app, 'editor')
            return bundles
          }) as Bundle[] | Promise<Bundle[]>
        },
      },
    }
  }

  // Whether the batch running RIGHT NOW came in at the kernel's door. A Durable
  // Object is single-threaded and its storage is synchronous, so `#trust()`
  // below runs `apply()` from the line that sets this to the line that clears
  // it without ever yielding: no other batch can be between the two. And the
  // failure it could have is the safe one — a flag cleared too early leaves the
  // guard ON, which refuses a write rather than admitting one.
  #kernelling = false

  /**
   * @yaks/member's guard, with the one writer it is not about taken out.
   *
   * The guard asks whether the ACTOR may write this app. The platform is not an
   * actor — it writes ABOUT the app rather than in it: the break it noted
   * (unseen.ts `noted`), the mark on a line it served. That door is
   * {@link Store.fetch}'s `x-yak-kernel` branch, which no client can reach
   * (door.ts `storeOf` strips the whole vouch set), and a batch through it
   * carries no person to hold a level — so the rule as written would refuse
   * exactly the writes the platform must always be able to make.
   *
   * The rule itself stays @yaks/member's. Only who it is asked about is ours.
   */
  #guarding(app: string): Plugin {
    let plugin = members({ app })
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
  #trust(bundles: Bundle[], who: string | null) {
    this.#kernelling = true
    try {
      return this.#graph.apply(
        signed(bundles, who ? { eid: who } : null),
        { trusted: true },
      )
    } finally {
      this.#kernelling = false
    }
  }

  #patch(bundles: Bundle[]) {
    this.#graph.storage.tx((tx) => tx.patch(bundles))
  }

  // ---- the passes (T-33809, T-34227) ---------------------------------------

  /** The migrations, at most once per object however many requests arrive at
   * once: the runtime's gate holds every other request while they run, and the
   * promise is kept so a second caller inside this incarnation waits on the
   * first rather than starting a second pass. */
  #pass(request: Request): Promise<void> {
    // A throw here can only come from BEFORE the transaction — reading the
    // object out, or writing it to the bucket — because the transaction takes
    // itself back and hands over a report instead. So nothing moved, and the
    // object says why rather than answering 500 to everything that arrives.
    //
    // A refusal is NOT retried on the next request, deliberately. Every way
    // this refuses is a bug in the code or the environment — an unreadable
    // table (T-34019), an unbound bucket, counts that do not reconcile — and
    // none of them clear without a deploy, which restarts every object anyway.
    // Retrying would only re-export the object's whole graph to R2 once per
    // request, which is a bill and a bucket full of identical dumps for a
    // refusal that is still going to refuse.
    let go = () =>
      this.#passes(request).catch((e) => {
        this.#pending = false
        this.#behind = false
        this.#refused = `the migration could not start: ${
          e instanceof Error ? e.message : String(e)
        }`
      })
    return this.#passing ??= this.#ctx.blockConcurrencyWhile
      ? this.#ctx.blockConcurrencyWhile(go)
      : go()
  }

  /** Every pass this object is behind, oldest first: the move off the
   * fleet-shaped store, then each one after it. A refusal stops the line —
   * a later pass reads what an earlier one wrote. */
  async #passes(request: Request) {
    if (this.#pending) await this.#carrying(request)
    if (!this.#refused) await this.#homing(request)
    if (!this.#refused) await this.#addressing(request)
    this.#behind = false
  }

  /**
   * The second pass (T-34227): `space.home` becomes `home{}` on the app it
   * named. Same order as the first — the `space` rows reach R2 before one
   * moves, the move is one transaction, the report is written beside them —
   * and an object with nothing to move only writes the marker, so it is never
   * asked again.
   */
  async #homing(request: Request) {
    let ctx = this.#ctx
    let name = request.headers.get('x-store') ?? this.#get('name') ?? ''
    if (!housed(ctx.storage)) return void this.#put('migrated', HOMED)
    let bucket = this.#bind.EXPORTS
    if (!bucket) {
      this.#refused = 'no export bucket is bound (EXPORTS): this store will ' +
        'not move a row without a restore path'
      return
    }
    let dump = homes(ctx.storage)
    dump.store = name
    let key = keyOf(name, dump.at)
    let wrote = `${key}/rows.jsonl`
    await bucket.put(wrote, lines(dump))
    let report: Report
    try {
      report = ctx.storage.transactionSync(() =>
        homed(ctx.storage, {
          store: name,
          app: request.headers.get('x-yak-app'),
          export: wrote,
        })
      )
    } catch (e) {
      report = e instanceof Unreconciled ? e.report : {
        store: name,
        app: request.headers.get('x-yak-app'),
        at: dump.at,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
        mark: HOMED,
        moved: [],
        dropped: [],
        export: wrote,
      }
    }
    try {
      await bucket.put(`${key}/report.json`, JSON.stringify(report, null, 2))
    } catch (e) {
      console.warn('store: migration report', e)
    }
    if (report.ok) return void this.#put('migrated', HOMED)
    this.#refused = `${report.message ?? 'the migration refused'} — the rows ` +
      `are unchanged and exported to ${wrote}`
  }

  /**
   * The third pass (T-34390): the app addresses move out of the table the core
   * word `alias` now owns and into `former`. Same order as the ones before it —
   * the rows reach R2 before one moves, the move is one transaction, the report
   * is written beside them — and an object with nothing to move only writes the
   * marker, so it is never asked again. Every app store is that object.
   */
  async #addressing(request: Request) {
    let ctx = this.#ctx
    let name = request.headers.get('x-store') ?? this.#get('name') ?? ''
    if (!slugged(ctx.storage)) return void this.#put('migrated', FORMER)
    let bucket = this.#bind.EXPORTS
    if (!bucket) {
      this.#refused = 'no export bucket is bound (EXPORTS): this store will ' +
        'not move a row without a restore path'
      return
    }
    let dump = addresses(ctx.storage)
    dump.store = name
    let key = keyOf(name, dump.at)
    let wrote = `${key}/rows.jsonl`
    await bucket.put(wrote, lines(dump))
    let report: Report
    try {
      report = ctx.storage.transactionSync(() =>
        addressed(ctx.storage, {
          store: name,
          app: request.headers.get('x-yak-app'),
          export: wrote,
        })
      )
    } catch (e) {
      report = e instanceof Unreconciled ? e.report : {
        store: name,
        app: request.headers.get('x-yak-app'),
        at: dump.at,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
        mark: FORMER,
        moved: [],
        dropped: [],
        export: wrote,
      }
    }
    try {
      await bucket.put(`${key}/report.json`, JSON.stringify(report, null, 2))
    } catch (e) {
      console.warn('store: migration report', e)
    }
    if (report.ok) return void this.#put('migrated', FORMER)
    this.#refused = `${report.message ?? 'the migration refused'} — the rows ` +
      `are unchanged and exported to ${wrote}`
  }

  /**
   * Export, carry, reconcile — in that order, because the order is the safety.
   * The export reaches R2 before a row moves, the carry is one transaction that
   * either lands whole or leaves the object exactly as it was, and the report
   * is written either way, beside the rows it is about.
   */
  async #carrying(request: Request) {
    let ctx = this.#ctx
    let slots = ctx.storage.kv
    // What the object is: the kernel says so on every request, and the store it
    // replaces wrote the same word into its own slots. Both are read, because
    // the vocabulary this schema is raised from depends on it.
    let name = request.headers.get('x-store') ??
      String(slots?.get('name') ?? '')
    let app = request.headers.get('x-yak-app')
    for (let w of ['name', 'vocab', 'uses', 'tools'] as Word[]) {
      let held = w == 'name' ? name : slots?.get(w)
      if (held != null && String(held)) this.#put(w, String(held))
    }
    let bucket = this.#bind.EXPORTS
    if (!bucket) {
      this.#pending = false
      this.#refused = 'no export bucket is bound (EXPORTS): this store will ' +
        'not move a row without a restore path'
      return
    }
    let dump = taken(ctx.storage, slots)
    dump.store = name
    let key = keyOf(name, dump.at)
    let wrote = `${key}/rows.jsonl`
    await bucket.put(wrote, lines(dump))
    let report: Report
    try {
      report = ctx.storage.transactionSync(() =>
        carry(ctx.storage, {
          store: name,
          app,
          vocab: name == PLATFORM_STORE
            ? platformVocab()
            : appVocab(this.#get('vocab') ?? {}),
          plant: () => this.#boot(),
          grantEid,
          export: wrote,
        })
      )
    } catch (e) {
      report = e instanceof Unreconciled ? e.report : {
        store: name,
        app,
        at: dump.at,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
        mark: MARK,
        moved: [],
        dropped: [],
        export: wrote,
      }
    }
    // The report is beside the rows it is about, and a bucket that would not
    // take it does not undo a pass that already landed — the rows are the thing.
    try {
      await bucket.put(`${key}/report.json`, JSON.stringify(report, null, 2))
    } catch (e) {
      console.warn('store: migration report', e)
    }
    this.#pending = false
    if (report.ok) return void this.#put('migrated', MARK)
    this.#refused = `${report.message ?? 'the migration refused'} — the rows ` +
      `are unchanged and exported to ${wrote}`
  }

  /**
   * The object after a refusal. The rows are the OLD ones, exactly as they were
   * — the pass ran in one transaction and it unwound — and this object cannot
   * read them: they are in the fleet's shape, and everything above the storage
   * here is raised from a vocabulary that has no tables for it. So it says so,
   * with the export key, and answers nothing else.
   *
   * There is no half-open door to hold here. What a page asks a store is
   * `/query?q=`, which the fleet's own door does not parse at all (it reads the
   * whole query string as the filter line), so an app that could still be read
   * "in the old grammar" is an app no client of it could read. A refusal that
   * says what happened and where the rows are is the whole of what is useful,
   * and every byte is in R2. `/graph` is the exception, and only because it
   * answers off the storage rather than off the graph: the meter reads an
   * object's size, and an object in this state still has one.
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
   * The object's door. What the kernel says about this object is read FIRST —
   * it may rebuild everything above the storage — and `wake()` comes next, so
   * a batch applied by the request that woke this object still reaches the
   * sockets it inherited.
   */
  async fetch(request: Request): Promise<Response> {
    // The one pass, before this object answers anything (T-33809). It runs
    // inside the runtime's own gate, so every other request waits on it rather
    // than racing it, and it runs from a REQUEST rather than the constructor
    // because the kernel's vouch is what names this object and the app it holds.
    if (this.#behind) await this.#pass(request)
    if (this.#refused) return this.#stalled(request)
    this.#learn(request)
    this.#live.wake()
    let path = new URL(request.url).pathname
    let kernel = request.headers.get('x-yak-kernel') == '1'
    if (path == '/vocab') return this.#vocabDoor(request)
    // The three slots beside the vocabulary: the words this app USES but does
    // not home (T-32728), the tools it declares (T-32685), and what the object
    // weighs. None is graph data — a declaration holds no rows and a byte count
    // is not one — so each is a word in this object's own memory, and the
    // kernel is the only caller.
    if (path == '/uses') return this.#slot(request, 'uses')
    if (path == '/tools') {
      let was = this.#get('tools') ?? '{}'
      let answer = await this.#slot(request, 'tools')
      if (!answer.ok || request.method != 'POST') return answer
      let now = this.#get('tools') ?? '{}'
      // The manifest's two halves, compared apart (T-33004): the TOOL half is
      // the manifest with the views taken out — what `tools/list` is made of —
      // and the VIEW half is the set of pages those tools name, which is what
      // `resources/list` is made of. A release that only repointed a view moves
      // resources and not tools, and the kernel says each with its own
      // `list_changed` (declared.ts).
      let said = await answer.json() as Record<string, unknown>
      return Response.json({
        ...said,
        changed: apart(now) != apart(was),
        views: viewed(now) != viewed(was),
      })
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
      return this.#erase()
    }
    // The socket is a READ that stays open, and it is the one door @yaks/api
    // does not answer here — hibernation is the runtime's, so `sockets` takes
    // it — which would leave it the one door with no policy on it. So it asks
    // the same seam, by hand, at the handshake.
    if (path == '/ws') {
      try {
        await this.#auth(request)
      } catch (e) {
        return refuse(e)
      }
      return this.#live.accept(request)
    }
    if (path == '/apply' && request.method == 'POST' && kernel) {
      return this.#kernel(request)
    }
    if (path == '/query') {
      let url = new URL(request.url)
      let line = url.searchParams.get('q') ?? ''
      let no = unserved(line)
      if (no) return refuse(new Refused(no))
      // An AGGREGATE is not a listing — `.count!` answers one number — and
      // @yaks/api's read door answers bundles, which is the wrong half of the
      // compiled statement. So it is answered here, off the raw rows, in the
      // shape every door on this platform says it in.
      let agg = aggOf(line)
      if (agg) {
        try {
          await this.#auth(request)
          return await this.#counted(line, agg)
        } catch (e) {
          return refuse(e)
        }
      }
      return await this.#kinded(await this.#route(request), line)
    }
    return await this.#route(request)
  }

  // The word a row is NAMED by. `kind` is not a column and no client can derive
  // it: it is the most specific component this vocabulary says the entity wears
  // (@yaks/vocab `kindOf`), and only a store holding the vocabulary can say
  // which that is. Every caller above reads it — the composing read calls a row
  // by it (reach.ts), a page's listing draws with it, and the guide documents it
  // on every row.
  #kind = (row: Bundle): Bundle => ({
    kind: this.#vocab.kindOf(row as Record<string, unknown>),
    ...row,
  })

  // Outputs speak HUMAN (db.ts `human()`): a column that references a person
  // answers `{eid, name}` when this store knows who that is, and the bare eid
  // when it does not. A view gets ONE query, and a byline it would need a second
  // question for is no byline — the inline leaderboard drew "someone" on every
  // row while `created.by` was a uuid (C-32730 item 5). Writes are unmoved: the
  // value is the eid, and a read shape handed back is lowered to it.
  //
  // Which columns reference is the vocabulary's word (`refCols`), and who among
  // them is a PERSON is this store's own rows — the writer it minted when they
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

  // What a listing CARRIES, beside what it selects (Jeff, 2026-09-03): "we
  // should query for the exact components we want: `.book!&.recipe?` = must be
  // book, recipe is optional but requested. asking for all comps is i imagine
  // most useful for debugging". So an answer carries the components the filter
  // NAMES — by presence (`.book!`), by request (`.loan?`), or by a predicate of
  // its own — and nothing else. A filter that names none (an `id=` fetch, a
  // bare search term) left nothing out and answers the whole bundle, which is
  // also the only useful answer to someone who does not yet know what they
  // found; `*` is the debugging form that asks for everything by name.
  //
  // A component asserted ABSENT (`.archived=`) names no component the answer
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

  // The rows, cut to what was asked for. The spine and the `kind` NAME a row,
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
  // word of your own comes from. The DIRECTORY says nothing of the kind — its
  // callers are the kernel's own.
  async #taught(answer: Response): Promise<Response> {
    if (answer.ok || this.#get('name') == PLATFORM_STORE) return answer
    let said = await answer.json() as { error?: string; message?: string }
    return /^unknown (prop|component)/.test(said.message ?? '') &&
        !said.message!.includes(GUIDE)
      ? Response.json({ ...said, message: said.message + TEACH }, {
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

  // A text term RANKS as well as filters: a search answers closest first, and
  // each row says how close (public/client.js `search`, and reach.ts reads the
  // same word to merge two apps' hits into one order). @yaks/sql compiles a
  // bare word as a predicate and stops there, so the ranking is read off the
  // very index it matched through (@yaks/fts) and painted on the rows the
  // filter already chose. `rank` is the answer's own word about a row, never a
  // component: nothing stores it and no vocabulary declares it.
  //
  // bm25 counts DOWN — a closer match is a smaller number, and they are
  // negative — so what a page reads is its negation, where bigger is better.
  #ranked(rows: Bundle[], line: string): Bundle[] {
    let text = parse(line).clauses
      .flatMap((c) => c.kind == 'text' ? [c.value] : []).join(' ')
    if (!text.trim() || !rows.length) return rows
    // Only what @yaks/sqlite raised an index for, which is `doc` (ddl.ts).
    let hits = find(
      this.#drive,
      fields(this.#vocab).filter((f) => f.comp == 'doc'),
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
  // ONCE per sink, since `close` and `drop` find a subscription by the sink it
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
        // `true` is a subscription to EVERYTHING, which names no component and
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
    }
  }

  // One of the object's own memory slots as a door: a GET reads back what it
  // last accepted, a POST replaces it whole. The body is stored as WRITTEN —
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
    this.#ctx.storage.sql.exec(KV)
    if (name) this.#put('name', name)
    this.#boot()
    return Response.json({ ok: true })
  }

  // The platform writing about its own data: a `plan` a person may not lift,
  // the `meter` the hourly sweep read off Cloudflare, the `signin` no client
  // may author, the `exception` we noted about ourselves. Those columns are
  // `stamped` — readable, never wire-writable — so the ordinary door refuses
  // them, and this one admits them by handing @yaks/graph `trusted`.
  //
  // The flag is the kernel's by construction: a store is only ever reached
  // through a request the Worker builds from scratch, and door.ts `storeOf`
  // strips the whole vouch set from any request it is handed, so
  // `x-yak-kernel` can never arrive from outside.
  async #kernel(request: Request): Promise<Response> {
    try {
      let body = await request.json()
      if (!Array.isArray(body)) {
        return json({
          error: 'Refused',
          message: '/apply takes a JSON array of bundles',
        }, 400)
      }
      return json(await this.#trust(body as Bundle[], vouchOf(request).person))
    } catch (e) {
      return refuse(e)
    }
  }

  // The app's own components (vocab.json): a GET reads back what this store
  // last accepted, a POST replaces it. The manifest is loaded — and refused —
  // before a byte of it is written down, so a refusal leaves the store exactly
  // as it was. The kernel is the only caller; a client never spells a store's
  // path.
  //
  // The answer is what this app now says and what MOVED, which naming the
  // components does not tell whoever deployed it (C-32652 item 4): a renamed
  // column arrives BESIDE the old one, and `added` is how they see that. Nothing
  // ever leaves — the DDL is additive and a column's rows are already written —
  // so `dropped` is empty and stays that way.
  #vocabDoor(request: Request): Response | Promise<Response> {
    if (request.method == 'GET') {
      return Response.json(JSON.parse(this.#get('vocab') ?? '{}'))
    }
    if (request.method != 'POST') {
      return Response.json(
        { error: 'NotAllowed', message: '/vocab takes GET or POST' },
        { status: 405, headers: { allow: 'GET, POST' } },
      )
    }
    return request.text().then((body) => {
      try {
        let { doc, dropped, added, kept } = grew(
          appDoc(this.#get('vocab') ?? '{}'),
          appDoc(body),
          (name) => this.#rows(name),
        )
        appVocab(doc)
        this.#put('vocab', JSON.stringify(shortOf(doc)))
        // A word that left held nothing, so its table goes with it. Everything
        // else about the schema is additive and `#boot` runs it.
        for (let name of dropped) {
          this.#ctx.storage.sql.exec(
            `drop table if exists "${name.replaceAll('"', '""')}"`,
          )
        }
        this.#boot()
        return Response.json({
          ok: true,
          // The app's OWN words, not the whole vocabulary it speaks: a store's
          // `/vocab` is what it HOMES, which is how a deploy across a space
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
    // this class replaces can wake THIS object — before its first request, and
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
