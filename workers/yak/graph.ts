// The Store Durable Object, built out of the packages (T-33810, D-33490): one
// app's graph, and nothing of the fleet's. It is composition, not code —
//
//   appVocab(manifest)          core + member + edge + the twelve relations +
//                               the app's own vocab.json          (vocab.ts)
//   storage(ctx.storage, vocab) the object's SQLite as @yaks/graph's Storage
//                               (@yaks/durable-object → @yaks/sqlite)
//   graph(storage, plugins)     the phased apply(): edges, members, blobs,
//                               effects                    (@yaks/graph)
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
// vocabulary and the uniques its races are decided by (vocab.ts `platformDoc`,
// T-33814). One class, one composition, two vocabularies.
//
// This class carries the DO's own NAME, `Store`, so wrangler's migration list
// never moves; the old store.ts wears the same name beside it until T-33807
// takes it away, and index.ts says which one the binding is. T-33809 carries
// the data across.
//
// ## What the object remembers
// A Durable Object's memory does not survive an eviction, so everything this
// one is told rides in its own SQLite: the address it was born at, the app's
// `vocab.json` as deployed, the app entity it holds, and what the directory
// says that app's access mode is. Each is learned from the header that first
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
// its binding, from this Worker, and the one door onto a store (store.ts
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
  subscriptions,
  Unauthorized,
} from '@yaks/api'
import { blobRead, blobs, blobSchema, sqliteBlobs } from '@yaks/blob'
import {
  driver,
  type DurableStorage,
  type Hibernation,
  type Sockets,
  sockets,
  storage,
  type Wire,
} from '@yaks/durable-object'
import { edges } from '@yaks/edge'
import { effects } from '@yaks/effects'
import {
  type Bundle,
  type Graph,
  graph,
  type Plugin,
  sha256,
  then,
} from '@yaks/graph'
import {
  actorOf,
  Denied,
  type Level,
  level,
  members,
  type Mode,
  mode,
  type Policy,
  policy,
  reads,
} from '@yaks/member'
import type { Vocab } from '@yaks/vocab'
import {
  appVocab,
  PLATFORM_INDEXES,
  PLATFORM_STORE,
  platformVocab,
} from './vocab.ts'

/** The slice of a `DurableObjectState` this object needs: its storage, and its
 * hibernatable sockets. A Worker's own `DurableObjectState` satisfies it. */
export type State = Hibernation & { storage: DurableStorage }

// What the object remembers about itself, and the table it remembers it in.
// One row per word — the object's SQLite is the only memory that survives an
// eviction, and this is smaller than asking @yaks/graph to hold configuration
// as data.
type Word = 'name' | 'vocab' | 'app' | 'access' | 'schema'
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

/** The id a mirrored grant is filed under: one per (app, person), derived, so
 * the same vouch lands on one row however often it is said. */
export let grantEid = (app: string, person: string): string =>
  sha256(`grant\x00${app}\x00${person}`)

export class Store {
  #ctx: State
  #vocab!: Vocab
  #graph!: Graph
  #live!: Sockets
  #route!: Handler
  #auth!: Authenticate

  constructor(ctx: State) {
    this.#ctx = ctx
    ctx.storage.sql.exec(KV)
    this.#boot()
  }

  // Waking on whatever this object holds. Everything above the storage is
  // rebuilt from the remembered vocabulary, which is why a deploy is a write
  // and a reboot rather than a migration: the tables are additive
  // (`create table if not exists`), and what changed is which words the graph
  // admits. T-33809 owns moving rows that a changed COLUMN would need.
  #boot() {
    let ctx = this.#ctx
    // Which words this object speaks is a question of WHICH OBJECT it is. One
    // store on the platform is the directory (the meta space, T-33814): it
    // wakes with the platform's own vocabulary and the uniques its races are
    // decided by. Every other object is an app, and wakes with the core plus
    // whatever its `vocab.json` declared.
    let meta = this.#get('name') == PLATFORM_STORE
    let vocab = meta ? platformVocab() : appVocab(this.#get('vocab') ?? {})
    let drive = driver(ctx.storage)
    let bytes = sqliteBlobs(drive)
    let store = storage(ctx.storage, vocab, { derived: blobRead(vocab) })
    let ddl = [
      ...store.ddl(),
      ...blobSchema(),
      ...(meta ? PLATFORM_INDEXES : []),
    ]
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
    if (named && this.#get('schema') != stamp) {
      for (let stmt of ddl) drive.exec(stmt)
      this.#put('schema', stamp)
    }
    let app = this.#get('app')
    let g = graph({
      storage: store,
      vocab,
      // The guard is added LAST and only when this object knows which app it
      // holds: @yaks/member refuses a write by an actor with no level, so a
      // store that cannot name its app has no access question to ask and the
      // kernel's own gate in front of it is the whole rule — which is what it
      // is today. T-33815 has the deploy name the app on every call.
      plugins: [
        edges(vocab),
        blobs(vocab, bytes),
        // The registry an app's own effects register on (T-33816). It ships
        // no handler, and with none it is not in the write path at all.
        effects(vocab),
        // Before the guard, because it is what the guard reads.
        this.#vouching,
        ...(app ? [members({ app })] : []),
      ],
    })
    this.#vocab = vocab
    this.#graph = g
    let subs = subscriptions(g)
    this.#live = sockets(subs, ctx)
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
  #vouching: Plugin = {
    name: 'yak/vouch',
    hooks: {
      precondition: (bundles, tx) => {
        let who = actorOf(bundles)
        let v = who ? this.#vouched.get(who) : null
        if (!who || !v) return bundles
        let app = this.#get('app')
        let said = `${app ?? ''} ${v.level ?? ''} ${v.title ?? ''}`
        if (this.#told.get(who) == said) return bundles
        this.#told.set(who, said)
        let out: Bundle[] = [{
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

  #patch(bundles: Bundle[]) {
    this.#graph.storage.tx((tx) => tx.patch(bundles))
  }

  /**
   * The object's door. What the kernel says about this object is read FIRST —
   * it may rebuild everything above the storage — and `wake()` comes next, so
   * a batch applied by the request that woke this object still reaches the
   * sockets it inherited.
   */
  async fetch(request: Request): Promise<Response> {
    this.#learn(request)
    this.#live.wake()
    let path = new URL(request.url).pathname
    if (path == '/vocab') return this.#vocabDoor(request)
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
    if (path == '/apply' && request.method == 'POST') {
      if (request.headers.get('x-yak-kernel') == '1') {
        return this.#kernel(request)
      }
    }
    return this.#route(request)
  }

  // The platform writing about its own data: a `plan` a person may not lift,
  // the `meter` the hourly sweep read off Cloudflare, the `signin` no client
  // may author, the `exception` we noted about ourselves. Those columns are
  // `stamped` — readable, never wire-writable — so the ordinary door refuses
  // them, and this one admits them by handing @yaks/graph `trusted`.
  //
  // The flag is the kernel's by construction: a store is only ever reached
  // through a request the Worker builds from scratch, and store.ts `storeOf`
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
      let who = vouchOf(request).person
      return json(
        await this.#graph.apply(
          signed(body as Bundle[], who ? { eid: who } : null),
          { trusted: true },
        ),
      )
    } catch (e) {
      return refuse(e)
    }
  }

  // The app's own components (vocab.json): a GET reads back what this store
  // last accepted, a POST replaces it. The manifest is loaded — and refused —
  // before a byte of it is written down, so a refusal leaves the store exactly
  // as it was. The kernel is the only caller; a client never spells a store's
  // path.
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
        appVocab(body)
        this.#put('vocab', body.trim() || '{}')
        this.#boot()
        return Response.json({ ok: true, comps: this.#vocab.all })
      } catch (e) {
        return Response.json({
          error: 'Refused',
          message: e instanceof Error ? e.message : String(e),
        }, { status: 400 })
      }
    })
  }

  /** A frame from a client: a subscription opened or closed. */
  webSocketMessage(ws: Wire, data: string | ArrayBuffer): void {
    this.#live.message(ws, data)
  }

  /** That client went away. */
  webSocketClose(ws: Wire): void {
    this.#live.close(ws)
  }
}
