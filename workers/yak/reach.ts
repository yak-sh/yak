// yaks.app's reach (@yaks/reach): every store a caller can read, each one a
// member of one composition. A read that names no app is one question asked
// of every store, answered as one bundle per eid, and a write sends each
// component to the store that word lives in; the fan-out, the split and the
// merge are the package's. What is here is the door each member is: a
// store's Durable Object, asked at `GET /query` and `POST /apply`, vouched for
// the caller, and its vocabulary as the directory last accepted it. tools.ts
// owns which stores are in reach.
import { listed, names, type Row, STAMPS } from '@yaks/platform/listing'
import type { Bundle } from '@yaks/graph'
import { type Trash, trashOrder, type TrashPage } from '@yaks/graph/trash'
import { requested } from '@yaks/graph/bundle'
import { sha256 } from '@yaks/graph'
import { type Door, IDEMPOTENCY } from '@yaks/durable-object/door'
import { durable, INTENT } from '@yaks/api/log'
import { misfit, Refused, status } from '@yaks/graph/errors'
import {
  type App,
  appStore,
  META_STORE,
  ranked,
  type Space,
  storeName,
} from './directory.ts'
import type { Env } from './env.ts'
import { vouched, type Who } from './session.ts'
import { edits, mode } from '@yaks/member'
import { declarationOf } from './declaration.ts'
import { compile, lensesIn } from '@yaks/lens'
import {
  lensDocAt,
  sessionRows,
  spoken as lensSpoken,
} from '@yaks/platform/lenses'
import {
  appKeywords,
  appVocab,
  lentDocs,
  packagesOf,
  platformDocs,
} from './vocab.ts'
import { type Clock, once, system } from '@yaks/fp'
import { type Asked, bareLine, type Line } from '@yaks/query'
import {
  type Ask,
  type Frame,
  type Member,
  reach as composition,
} from '@yaks/reach'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { refuse, rejected } from './tool.ts'
import { caught } from './defects.ts'
import { said as told } from '@yaks/api/log'
import { answered } from './meta.ts'
import { sandboxed } from '@yaks/platform/installs'
import { trashSearch } from './trash-wire.ts'

export type { Ask }

// The words the PLATFORM says in every store, including its vocabulary and
// journal. A word outside this list was declared by an app, which is what
// makes it the most specific thing said about a row. Composed on first use.
let core = once((): Vocab => appVocab())

// The directory has no app-owned vocab.json for `/vocab` to answer: its own
// words are the documents shipped with the platform. Keep only the words not
// already in every store, the same shape an app's `/vocab` answers, so routing
// and alias derivation see `secret.name` and the rest of the directory's own
// identities without treating shared words as though only it declared them.
let platformWords = once((): VocabDoc => ({
  title: 'platform',
  $defs: Object.fromEntries(
    platformDocs().flatMap((doc) => Object.entries(doc.$defs ?? {}))
      .filter(([name]) => !core().all.includes(name)),
  ),
}))

// One store in reach: the app, the space it is in, and who the caller is
// there. `at` is what a bundle names as the component's home.
export type Reach = {
  space: Space
  app: App
  who: Who
  /** This store's caller vocabulary, retained throughout a composed read. */
  headers?: Record<string, string>
  /** How the store is reached, where it is not through its Durable Object's
   * stub: a store composing its own reach answers its own part itself. */
  door?: Door
}

export let at = (r: { space: Space; app: App }) =>
  `${r.space.slug}/${r.app.slug}`

// The space's language, and the platform's listing rule: a stamp leaves a
// listing unless the line names it (listing.ts `listed`), so one fetched only
// to order by leaves the answer too. A store left out of a read is reported
// with its space and app, which is what its `at` spells.
let fan = once(() =>
  composition({
    core: core(),
    // And the words the apps' `"platform"` dependencies lend, beneath their
    // own.
    union: (defs, docs) =>
      loadVocab(
        [
          ...core().docs,
          ...lentDocs({
            $defs: defs,
            packages: [...new Set(docs.flatMap(packagesOf))].sort(),
          }),
          { title: 'space', $defs: defs },
        ],
        appKeywords,
      ),
    hidden: (comp, line) => STAMPS.includes(comp) && !names(line, comp),
    silent: (e, m) => {
      let [space, app] = m.at.split('/')
      caught(e, { request: 'reach', space, app })
    },
  })
)

let doorAt = (env: Env, r: Reach): Door =>
  r.door ?? appStore(env.STORE, r.space, r.app, env)

/** Retained app removals visible to named editors in this reach. The directory
 * retains credentials and private rows, and has its own recovery interface. */
export let trashed = async (
  env: Env,
  reach: Reach[],
  eids?: string[],
  page: TrashPage = {},
): Promise<Trash[]> => {
  if (eids && !eids.length) return []
  let stores = reach.filter((r) =>
    storeName(r.space, r.app) != META_STORE && r.who.person &&
    ['owner', 'editor'].includes(r.who.role ?? '')
  )
  let read = async (page: TrashPage): Promise<Trash[]> =>
    (await Promise.all(stores.map((r) =>
      doorAt(env, r).consume(
        `/trash?${trashSearch(eids, page)}`,
        async (res) => {
          if (!res.ok) throw await answered(res)
          return await res.json() as Trash[]
        },
        {},
        { ...vouched(r.who), ...r.headers },
      )
    ))).flat()
  let before = page.before ??
    (page.after ? (await read({ id: page.after, limit: 1 }))[0] : undefined)
  if (page.after && !before) {
    throw new Refused('the trash cursor is no longer available')
  }
  let groups = await read({
    ...page,
    after: undefined,
    ...before ? { before } : {},
  })
  return groups.sort(trashOrder).slice(0, page.limit ?? 20)
}

// One store as a member: its /query and /apply doors, vouched, and its words.
//
// A read is answered by the listing rule every other door answers by
// (listing.ts), cut by `said`, the line the caller asked: a composed read asks
// each store a part of the line and then gathers the bundle by `id=`, and the
// listing rule applied to those words hid the stamps the caller had named
// (C-32800 item 4). The question carries the same door's screen an app's page
// asks with (listing.ts `asking`), because an app's store keeps person rows as
// its own bookkeeping, and a person titled with what to call them matches
// `.doc` like any row. A refusal is thrown as the store's own sentence, after
// the store's address.
//
// A write's `check` rehearses the batch: every phase runs and the transaction
// is rolled back (@yaks/graph `check`). The access rule is the page's: an
// owner or editor writes, and so does anyone at all when the app is open.
let memberOf = (
  env: Env,
  r: Reach,
  headers: Record<string, string> = {},
): Member => ({
  at: at(r),
  name: r.app.slug,
  space: r.space.slug,
  sandboxed: sandboxed(r.app),
  vocab: () => vocabAt(env, r.space, r.app, r.headers),
  read: async (line, { said, live = false } = {}) => {
    let asked = bareLine(line)
    let door = doorAt(env, r)
    let bundles = await door.consume(
      `/query?q=${encodeURIComponent(asked)}${live ? '&live=1' : ''}&listing=1`,
      async (res) => {
        // Said with the store's address, as a write's refusal is: in a read of
        // several, it says whose words the sentence speaks of.
        if (!res.ok) throw rejected(res.status, `${at(r)}: ${await told(res)}`)
        return await res.json()
      },
      {},
      { ...vouched(r.who), ...r.headers },
    )
    return Array.isArray(bundles)
      ? listed(bundles as Row[], said ?? asked) as Bundle[]
      : bundles
  },
  watch: (line, sink) =>
    watching(doorAt(env, r), at(r), line, sink, {
      ...vouched(r.who),
      ...r.headers,
    }),
  apply: (entities, check) => {
    if (!edits(mode(r.app.access), r.who.role)) {
      throw refuse('access', `not a writer of ${at(r)}`)
    }
    return doorAt(env, r).consume(
      `/apply${check ? '?check=1' : ''}`,
      async (res) => {
        // A write the store's log kept (@yaks/api/log) lands later, in order: the
        // agent is told so rather than that it failed, so it does not send it
        // twice.
        if (res.status == 202) {
          throw refuse('unavailable', `${at(r)}: ${await told(res)}`)
        }
        if (!res.ok) {
          // A write that did not fit the store's words still says so, so the
          // page's door can file it as the app's break (apps.ts `mistaken`).
          let no = await answered(res)
          let e = rejected(res.status, `${at(r)}: ${no.message}`)
          throw misfit(no) ? Object.assign(e, { misfit: true }) : e
        }
        return await res.json() as Bundle[]
      },
      {
        method: 'POST',
        body: JSON.stringify(entities),
      },
      { ...vouched(r.who), ...r.headers, ...headers },
    )
  },
})

// A socket as the runtime hands a Worker one: accepted before it is used.
type Wire = {
  accept: () => void
  send: (text: string) => void
  close: (code?: number) => void
  addEventListener: (
    type: 'message' | 'close' | 'error',
    fn: (e: { data?: unknown }) => void,
  ) => void
}

// How long a store's socket that closed waits before it opens again: a wait
// drawn at random below `wait`, which doubles from `FIRST` to `MOST` while the
// socket keeps failing, and starts again at `FIRST` only once a socket has
// held for `HELD`. Drawn at random, a deploy that closes every tab's socket
// at once has them open again spread across the wait rather than together,
// and one a store accepts and closes again (a refusal, an overload) backs off
// rather than coming back four times a second.
let FIRST = 1_000
let MOST = 30_000
let HELD = 10_000

type Watch = (
  door: Door,
  at: string,
  line: string,
  sink: (frame: Frame) => void,
  headers: Record<string, string>,
  path?: string,
  saying?: (say: (frame: unknown) => void) => () => void,
) => () => void

/** One socket per store, path and caller, carrying every line watched there
 * (graph.ts `/ws`), as the caller: each frame it sends, its id taken off, to
 * the line it answers. A tab keeps one (reach-door.ts), so its lines at one
 * store cost that store one socket, however many it watches. A socket that
 * drops (a deploy, an evicted object) opens again after a wait (`FIRST`,
 * `MOST`, `HELD`), and each line's first answer then is said with `reset`,
 * since what left while it was away is said no other way. One the store
 * refuses to open is said to each line as the store's refusal and left
 * closed; one that failed is tried again. `saying`, when given, is handed
 * each socket as it opens, to say on it what the caller has to say (a tab's
 * whereabouts), and what it returns is called when that socket goes; lines
 * with something to say share a socket only with lines that do too. The last
 * line closed closes the socket. */
export let socketsOf = (
  { clock = system, random = Math.random }: {
    clock?: Clock
    random?: () => number
  } = {},
): Watch => {
  let held = new Map<string, ReturnType<typeof shared>>()
  return (door, at, line, sink, headers, path = '/ws', saying) => {
    let key = JSON.stringify([path, at, headers, !!saying])
    let add = held.get(key)
    if (!add) {
      add = shared(
        door,
        at,
        headers,
        path,
        saying,
        clock,
        random,
        () => held.delete(key),
      )
      held.set(key, add)
    }
    return add(line, sink)
  }
}

/** One line watched on a socket of its own (`socketsOf`). */
export let watching: Watch = (...args) => socketsOf()(...args)

// One socket at a store, and the lines watched on it.
let shared = (
  door: Door,
  at: string,
  headers: Record<string, string>,
  path: string,
  saying: ((say: (frame: unknown) => void) => () => void) | undefined,
  clock: Clock,
  random: () => number,
  done: () => void,
) => {
  type Line = { line: string; sink: (frame: Frame) => void; first: boolean }
  let lines = new Map<string, Line>()
  let next = 0, wait = FIRST, again = false, opening = false
  let wire: Wire | undefined
  let timer: (() => void) | undefined
  let steady: (() => void) | undefined
  let unsay: (() => void) | undefined
  let each = (frame: Frame) => {
    for (let one of lines.values()) one.sink(frame)
  }
  let subscribe = (ws: Wire, id: string, one: Line) => {
    one.first = again
    ws.send(JSON.stringify({ subscribe: one.line, id }))
  }
  let gone = () => {
    unsay?.()
    unsay = undefined
    steady?.()
    steady = undefined
  }
  let open = async () => {
    let res = await door(path, { headers: { upgrade: 'websocket' } }, headers)
    let ws = (res as Response & { webSocket?: Wire }).webSocket
    if (!ws) {
      let code = res.status == 101 || path != '/ws' && res.status == 404
        ? 503
        : res.status
      throw Object.assign(
        rejected(code, `${at}: ${await told(res)}`),
        { status: code },
      )
    }
    ws.accept()
    if (!lines.size) return ws.close(1000)
    wire = ws
    steady = clock.after(HELD, () => void (wait = FIRST))
    ws.addEventListener('message', (e) => {
      if (wire != ws) return
      let id: string, frame: Frame
      try {
        let { id: was, ...said } = JSON.parse(String(e.data)) as Frame
        id = String(was)
        frame = said
      } catch (error) {
        caught(error, { request: 'reach member socket frame', store: at })
        ws.close(1011)
        retry()
        return
      }
      let one = lines.get(id)
      if (!one) return
      if (one.first && frame.bundles) frame.reset = true
      if (frame.bundles) one.first = false
      one.sink(frame)
      if (path != '/ws' && frame.refused) {
        let { error } = frame.refused as { error?: string }
        if (status(Object.assign(new Error(), { name: error })) >= 500) {
          ws.close(1011)
          retry()
        }
      }
    })
    ws.addEventListener('close', () => wire == ws && retry())
    for (let [id, one] of lines) subscribe(ws, id, one)
    unsay = saying?.((frame) => wire == ws && ws.send(JSON.stringify(frame)))
  }
  let retry = () => {
    if (!lines.size || timer !== undefined) return
    gone()
    wire = undefined
    again = true
    timer = clock.after(random() * wait, () => {
      timer = undefined
      start()
    })
    wait = Math.min(wait * 2, MOST)
  }
  let start = () => {
    if (!lines.size) return
    opening = true
    open().finally(() => opening = false).catch((e) => {
      if (!lines.size) return
      each({ refused: e })
      if (((e as { status?: number })?.status ?? status(e)) >= 500) {
        caught(e, { request: 'reach member socket', store: at })
        retry()
      }
    })
  }
  return (line: string, sink: (frame: Frame) => void) => {
    let id = `w${next++}`
    let one: Line = { line, sink, first: false }
    lines.set(id, one)
    // A socket refused for good opens again for a line asked anew.
    if (wire) subscribe(wire, id, one)
    else if (!opening && timer === undefined) start()
    return () => {
      if (!lines.delete(id)) return
      if (lines.size) {
        return void wire?.send(JSON.stringify({ unsubscribe: id }))
      }
      done()
      gone()
      timer?.()
      timer = undefined
      wire?.close(1000)
      wire = undefined
    }
  }
}

/** A read no store answers live, kept live: `read` is sent to `sink` whole
 * at once, and again each time a line it reads from moves, as `moved` watches
 * it. The first answer `moved` gives is what was just read, and a read asked
 * while one is in flight waits for it, so moves coming fast read once. What
 * `moved` refuses, and a read that fails, is said as the refusal. */
export let rereading = (
  read: () => Promise<Bundle[]>,
  moved: (sink: (frame: Frame) => void) => () => void,
  sink: (frame: Frame) => void,
): () => void => {
  let closed = false, reading = false, again = false, heard = false
  let ask = async () => {
    if (reading) return void (again = true)
    reading = true
    try {
      let bundles = await read()
      if (!closed) sink({ bundles, reset: true })
    } catch (error) {
      if (!closed) sink({ refused: error })
    }
    reading = false
    if (again && !closed) {
      again = false
      void ask()
    }
  }
  void ask()
  let stop = moved((frame) => {
    if (closed) return
    if (frame.refused) return sink({ refused: frame.refused })
    if (!frame.bundles) return
    if (heard || frame.reset) void ask()
    heard = true
  })
  return () => {
    closed = true
    stop()
  }
}

// The reach as members, ranked as a space's homes are (directory.ts `ranked`),
// and the one named among them: routing goes by identity, so a named store
// already in reach is that very member.
let membersOf = (
  env: Env,
  reach: Reach[],
  named?: Reach,
  headers?: Record<string, string>,
) => {
  let order = ranked(reach, (r) => r.app)
  let members = order.map((r) => memberOf(env, r, headers))
  let i = named ? order.indexOf(named) : -1
  let one = named && (i >= 0 ? members[i] : memberOf(env, named, headers))
  return { members, named: one }
}

/** The read, whole (@yaks/reach `read`): one store's own answer, or every
 * store's merged into one bundle per eid. */
export let read = <Q extends string>(
  env: Env,
  reach: Reach[],
  line: Q & Asked<Q>,
  live = false,
): Promise<unknown> =>
  fan().read(membersOf(env, reach).members, line as Line, live)

/** The read, live (@yaks/reach `watch`): `sink` is sent each frame its
 * answer moves by, until what it returns is called. */
export let watch = (
  env: Env,
  reach: Reach[],
  line: string,
  sink: (frame: Frame) => void,
): () => void => fan().watch(membersOf(env, reach).members, line, sink)

/** These eids, whole, out of every store that holds a piece of one. */
export let composed = (
  env: Env,
  reach: Reach[],
  eids: string[],
  ask: Ask = {},
) => fan().composed(membersOf(env, reach).members, eids, ask)

// The words one store declares as its own — its `vocab.json` as the store last
// accepted it (T-32502), read back through the same door the deploy wrote it
// at and loaded as the document it means (vocab.ts `meant`).
// A component nobody declares is the platform's, and every store speaks it. A
// store that cannot answer says nothing, which reads as an app with no words
// of its own.
//
// Words are release metadata. Discovery and schema translation must never
// wake a Store merely to ask which declaration its directory pointer selects.
export let vocabAt = async (
  env: Env,
  space: Space,
  app: App,
  headers: Record<string, string> = {},
): Promise<VocabDoc> => {
  if (at({ space, app }) == META_STORE) return platformWords()
  let doc = (await declarationOf(env, space, app)).vocab
  let speaks =
    lensSpoken(new Request('https://store/vocab', { headers })).speaks
  if (!speaks) return doc
  let docs = compile([
    ...sessionRows(),
    ...lensesIn([lensDocAt(storeName(space, app), doc)]),
  ], speaks)
    .schema(appVocab(doc).docs)
  let own = new Set(Object.keys(doc.$defs ?? {}))
  return {
    ...doc,
    $defs: Object.fromEntries(
      docs.flatMap((d) =>
        Object.entries(d.$defs ?? {}).filter(([name]) => own.has(name))
      ),
    ),
  }
}

/** The batch, split by component into one part per store. */
export let routed = async (
  env: Env,
  reach: Reach[],
  named: Reach | undefined,
  bundles: Bundle[],
  key?: string,
) => {
  let { members, named: one } = membersOf(env, reach, named)
  let stores = new Map(members.map((m, i) => [m, reach[i]]))
  if (one && named) stores.set(one, named)
  let { parts, aliases } = await fan().routed(members, one, bundles, key)
  return {
    parts: parts.map(({ member, entities }) => ({
      r: stores.get(member)!,
      entities,
    })),
    aliases,
  }
}

// Marks caller data in the invocation ledger and carries a selected space, if
// any, to the writer. It is removed before routing and cannot come from JSON.
export let writeSpace = Symbol('writeSpace')

// The write, whole (@yaks/reach `written`): routed, rehearsed everywhere,
// then committed.
export let written = (
  env: Env,
  reach: Reach[],
  named: Reach | undefined,
  bundles: Bundle[],
  headers: Record<string, string> = {},
  check = false,
  defaultSpace?: () => Promise<string | undefined>,
): Promise<{
  bundles: Bundle[]
  aliases: Record<string, string>
  where: string
}> => {
  // Every `$` word the wire carries. The split rebuilds each part out of the
  // keys it knows, so one it does not know would be dropped on the way to a
  // store and the caller would never hear about it — `$num: true` coming back
  // as a write with no number and no word why is exactly what @yaks/graph
  // `requested` refuses, said here because this door is where it would be
  // lost. `$app` is the door's own (agent.ts `aimed`), which is why it is
  // named beside the graph's.
  requested(bundles, ['$app'])
  let key = new Headers(headers).get(IDEMPOTENCY)
  if (durable(key)) {
    headers = { ...headers, [INTENT]: sha256(JSON.stringify(bundles)) }
  }
  let { members, named: one } = membersOf(env, reach, named, headers)
  return fan().written(members, one, bundles, {
    key: durable(key) ? key! : undefined,
    check,
    defaultSpace,
  })
}
