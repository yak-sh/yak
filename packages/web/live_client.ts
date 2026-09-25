// The browser's replica: a @yaks/client box on the host's own /ws (@yaks/api).
// Each named subscription live.ts holds is a server-evaluated watch; @yaks/sync
// owns the socket, its reconnect and the resubscribe after it, and lands every
// frame in the box. The socket is tapped so each frame is also reported by the
// names that asked for it, after it has landed: live.ts keeps its per-name
// bookkeeping (readiness, refusals, one-shot reads) from that.
import { type Client, client, type Watch, wireIdb } from '@yaks/client'
import { type Bundle, type Comp, dead } from '@yaks/graph'
import { type Coverage, echo, type Frame, type Socket } from '@yaks/sync'
import { loadVocab } from '@yaks/vocab'
import { resultComps } from './route.ts'
import { type Change, keywords, vocab } from './types.ts'
import type { Sub } from './live.ts'

// Server-derived columns are ordinary received data in a browser replica.
// Their derivation/writability remains the server's responsibility, and so do
// their values: a computed enum names what can be written, and a derivation may
// read wider (a claimed task's status is `wip`, contributed by the claim).
let browserVocab = () => {
  let docs = structuredClone(vocab.docs)
  for (let doc of docs) {
    for (let [name, def] of Object.entries(doc.$defs ?? {})) {
      if (!def.component || name == 'entity') continue
      def.properties ??= {}
      def.properties.eid = { type: 'string' }
      for (let prop of Object.values(def.properties ?? {})) {
        if (prop.computed) delete prop.enum
        prop.computed = false
      }
    }
  }
  return loadVocab(docs, keywords)
}

// A socket that answers nothing: the replica of a process with no host (a
// test), where frames only ever arrive through `receive`.
export let quiet = (): Socket => ({
  readyState: 1,
  send: () => {},
  close: () => {},
  addEventListener: () => {},
})

// The page draws an entity by whatever components it carries (the registry
// matches on any of them), so every line it watches asks for all of them: `*`,
// the query grammar's widest projection (@yaks/graph `wanted`). A line that
// already says what it answers keeps it: `.fields=` names each row's columns,
// and a `.count!` answers no rows.
export let entire = (line: string): string =>
  /(^|&)(\*|\.count!|\.fields=[^&]*)(&|$)/.test(line)
    ? line
    : line
    ? `${line}&*`
    : '*'

export type LiveClient = ReturnType<typeof liveClient>
export let liveClient = (opts: {
  url: string
  connect: (url: string) => Socket
  changed: (eids: string[]) => void
  ready: (sub: string) => void
  // A frame the socket carried, once the box has landed it, with the names
  // whose line it answers and whether it replaced the whole set.
  frame: (subs: string[], f: Frame, reset: boolean) => void
  disk?: boolean
}) => {
  let handles = new Map<string, { line: string; watch: Watch }>()
  let named = new Map<string, Set<string>>() // line -> the names holding it
  let lines = new Map<string, string>() // wire id -> line
  let fresh = new Set<string>() // wire ids whose next frame is the whole set
  let deliver: ((event: Event & { data?: unknown }) => void) | undefined
  let after = (text: string) => {
    let f = JSON.parse(text) as Frame
    let line = f.id ? lines.get(f.id) : undefined
    if (!line) return
    let reset = !f.refused && (fresh.delete(f.id) || !!f.reset)
    opts.frame([...named.get(line) ?? []], f, reset)
  }
  let tap = (s: Socket): Socket => ({
    get readyState() {
      return s.readyState
    },
    send: (text) => {
      let m = JSON.parse(text)
      if (typeof m.subscribe == 'string') {
        lines.set(m.id, m.subscribe)
        fresh.add(m.id)
      } else if (m.unsubscribe) {
        lines.delete(m.unsubscribe)
        fresh.delete(m.unsubscribe)
      }
      s.send(text)
    },
    close: () => s.close(),
    addEventListener: (type, fn) => {
      if (type != 'message') return s.addEventListener(type, fn)
      let wrapped = (e: Event & { data?: unknown }) => {
        fn(e)
        after(String(e.data))
      }
      deliver = wrapped
      s.addEventListener(type, wrapped)
    },
  })
  let box: Client = client(browserVocab(), [], {
    url: opts.url,
    connect: (url) => tap(opts.connect(url)),
    vault: false,
    retainUnownedProps: true,
    provenance: () => null,
    wireVault: opts.disk && globalThis.indexedDB
      ? wireIdb({ name: 'tasks-client-wire' })
      : false,
    // Local writes use echoed patches below, never sync's automatic POST.
    fetch: () => {
      throw new Error('writes leave through the durable outbox (live.ts)')
    },
    report: (r) => {
      if (r.error) console.warn('live client', r.error)
    },
  })
  box.cache.onRows(opts.changed)
  let open = (sub: string, line: string) => {
    if (handles.get(sub)?.line === line) return
    close(sub)
    let wire = entire(line)
    let watch = box.watch(wire, { evaluate: 'server' })
    handles.set(sub, { line, watch })
    let names = named.get(wire) ?? new Set()
    named.set(wire, names.add(sub))
    watch.subscribe(() => opts.ready(sub))
    opts.ready(sub)
  }
  let close = (sub: string) => {
    let h = handles.get(sub)
    if (!h) return
    handles.delete(sub)
    let wire = entire(h.line)
    let names = named.get(wire)
    names?.delete(sub)
    if (!names?.size) named.delete(wire)
    h.watch.close()
  }
  // Changes as whole rows: a reset rebuilds each row from what it carries.
  let bundles = (changes: Change[], reset = false): Bundle[] => {
    let rows = new Map<string, Bundle>()
    for (let { eid, name, comp } of changes) {
      if (name in resultComps) continue
      let row = rows.get(eid)
      if (!row) {
        row = reset
          ? { entity: { eid } }
          : { ...box.ent(eid), entity: box.ent(eid)?.entity ?? { eid } }
        rows.set(eid, row)
      }
      if (name === 'entity') {
        if (comp === null) {
          row = { entity: row.entity, tombstone: {} }
          rows.set(eid, row)
        } else row.entity = { ...row.entity, ...comp }
      } else if (comp === null) row[name] = null
      else row[name] = { ...reset ? {} : row[name] as Comp, ...comp }
    }
    return [...rows.values()]
  }
  let whole = (rows: Bundle[]) =>
    Object.fromEntries(
      rows.map((row) => [row.entity.eid, true as Coverage]),
    )
  // A frame written as changes, for a name this side opened: a test's server.
  // It lands through the same socket listener a carried frame does.
  let receive = (f: Sub) => {
    let h = handles.get(f.sub)
    let id = h &&
      [...lines].find(([, line]) => line === entire(h.line))?.[0]
    if (!id || !deliver) return
    let frame: Frame = f.error
      ? { id, refused: { error: 'read', message: f.error } }
      : f.agg
      ? { id, tally: f.agg }
      : {
        id,
        reset: f.replace,
        bundles: bundles(f.changes ?? [], !!f.replace).filter((b) => !dead(b)),
        gone: [
          ...f.drop ?? [],
          ...bundles(f.changes ?? []).filter(dead).map((b) => b.entity.eid),
        ],
      }
    if (frame.bundles) frame.coverage = whole(frame.bundles)
    deliver({ data: JSON.stringify(frame) } as Event & { data: string })
  }
  return {
    box,
    open,
    close,
    receive,
    active: () => handles.size,
    retry: (sub: string) => {
      let h = handles.get(sub)
      if (!h) return
      handles.delete(sub)
      h.watch.close()
      open(sub, h.line)
    },
    has: (sub: string) => handles.has(sub),
    members: (sub: string) =>
      handles.get(sub)?.watch.value.map((b) => b.entity.eid) ?? [],
    ready: (sub: string) => handles.get(sub)?.watch.ready ?? false,
    patch: (changes: Change[]) =>
      box.graph.apply(echo(bundles(changes)), { trusted: true }),
  }
}
