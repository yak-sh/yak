// Tasks' protocol boundary. Payloads, membership, readiness and retention belong
// to @yaks/client; only addressed transport names and declared projections live
// here. No query is evaluated over an incomplete browser graph.
import { type Client, client, type Watch, wireIdb } from '@yaks/client'
import { type Bundle, type Comp, dead } from '@yaks/graph'
import { type Coverage, echo, type Frame, type Socket } from '@yaks/sync'
import { loadVocab } from '@yaks/vocab'
import { fleetDocs, fleetKeywords } from './vocab/fleet_vocab.ts'
import { bodyCols } from './props.ts'
import { bodied } from './subs.ts'
import { type Field, resultComps } from './query.ts'
import type { Change } from './types.ts'
import type { Sub } from './live.ts'

// Server-derived columns are ordinary received data in a browser replica.
// Their derivation/writability remains the server's responsibility.
let browserVocab = () => {
  let docs = fleetDocs()
  for (let doc of docs) {
    for (let def of Object.values(doc.$defs ?? {})) {
      def.properties ??= {}
      def.properties.eid = { type: 'string' }
      for (let prop of Object.values(def.properties ?? {})) prop.persist = true
    }
  }
  return loadVocab(docs, fleetKeywords)
}

type Handle = { key: string; watch: Watch }
type Group = {
  id?: string
  names: Set<string>
  transport: string
  q: string
  body: boolean
  silent: boolean
  fields?: Field[]
  peers: Map<string, Exclude<Coverage, true>>
}
export type LiveClient = ReturnType<typeof liveClient>
export let liveClient = (opts: {
  send: (sub: string, q?: string) => void
  changed: (eids: string[]) => void
  ready: (sub: string) => void
  disk?: boolean
}) => {
  let muted = false
  let groups = new Map<string, Group>()
  let handles = new Map<string, Handle>()
  let ids = new Map<string, Group>()
  let names = new Map<string, Group>()
  let transports = new Map<string, Group>()
  let message: ((event: Event & { data?: unknown }) => void) | undefined
  let socket: Socket = {
    readyState: 1,
    addEventListener: (type, fn) => {
      if (type === 'message') message = fn
    },
    close: () => {},
    send: (text) => {
      let f = JSON.parse(text)
      if (f.subscribe !== undefined) {
        let g = groups.get(f.subscribe)!
        g.id = f.id
        ids.set(f.id, g)
        if (!g.silent && !muted) opts.send(g.transport, g.q)
      } else {
        let g = ids.get(f.unsubscribe)
        if (g) {
          if (!g.silent && !muted) opts.send(g.transport)
          ids.delete(f.unsubscribe)
        }
      }
    },
  }
  let box: Client = client(browserVocab(), [], {
    url: 'http://tasks-adapter.invalid',
    connect: () => socket,
    vault: false,
    retainUnownedColumns: true,
    provenance: () => null,
    wireVault: opts.disk && globalThis.indexedDB
      ? wireIdb({ name: 'tasks-client-wire' })
      : false,
    // Local writes use echoed patches below, never sync's automatic POST.
    fetch: () => {
      throw new Error('Tasks writes must use the durable outbox')
    },
    report: (r) => {
      if (r.error) console.warn('Tasks client adapter', r.error)
    },
  })
  box.cache.onRows(opts.changed)
  let open = (sub: string, q: string, silent = false) => {
    let key = JSON.stringify([q, bodied(sub)])
    if (handles.get(sub)?.key === key) {
      let g = groups.get(key)!
      if (g.silent && !silent) {
        g.silent = false
        opts.send(g.transport, g.q)
      }
      return
    }
    close(sub)
    let g = groups.get(key)
    if (!g) {
      groups.set(
        key,
        g = {
          names: new Set(),
          q,
          body: bodied(sub),
          transport: sub,
          silent,
          peers: new Map(),
        },
      )
      transports.set(sub, g)
    }
    let activate = g.silent && !silent
    if (activate) g.silent = false
    g.names.add(sub)
    names.set(sub, g)
    let watch = box.watch(key, { evaluate: 'server' })
    handles.set(sub, { key, watch })
    watch.subscribe(() => opts.ready(sub))
    opts.ready(sub)
    if (activate) opts.send(g.transport, g.q)
  }
  let close = (sub: string) => {
    let h = handles.get(sub)
    if (!h) return
    let g = groups.get(h.key)!
    // Keep the transport name until the package has sent its final unsubscribe.
    handles.delete(sub)
    h.watch.close()
    names.delete(sub)
    g.names.delete(sub)
    if (!g.names.size) {
      groups.delete(h.key)
      transports.delete(g.transport)
    }
  }
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
  let scope = (
    rows: Bundle[],
    projection: Field[] | undefined,
    body: boolean,
  ) =>
    Object.fromEntries(rows.map((row) => {
      let coverage: Coverage = {}
      if (projection) {
        for (let f of projection) {
          let ps = coverage[f.comp] as string[] | undefined
          coverage[f.comp] = [...ps ?? [], f.prop]
        }
      } else {
        // Include absent components so full snapshots clear removed tags, but
        // exclude deliberately unloaded body columns on ordinary list doors.
        for (let name of box.vocab.all) {
          coverage[name] = body || !bodyCols(name).length
            ? true
            : box.vocab.columns(name).filter((p) => !bodyCols(name).includes(p))
        }
      }
      return [row.entity.eid, coverage]
    }))
  let receive = (f: Sub) => {
    let g = transports.get(f.sub) ?? names.get(f.sub)
    if (!g) return
    // A refusal carries no authoritative data, even if a malformed transport
    // attached changes. Preserve payload, membership and coverage unchanged.
    if (f.error) {
      message?.(
        {
          data: JSON.stringify({
            id: g.id!,
            refused: { error: 'read', message: f.error },
          }),
        } as Event & { data: string },
      )
      return [...g.names]
    }
    if (f.replace && !f.error) {
      g.fields = f.fields
      g.peers.clear()
    }
    // Tasks sends patches after the initial reset; sync expects covered snapshots.
    let rows = bundles(f.changes ?? [], !!f.replace && !f.shadow)
    let deaths = (f.changes ?? []).filter((c) =>
      c.name === 'entity' && c.comp === null
    )
    if (deaths.length) box.graph.apply(echo(bundles(deaths)), { trusted: true })
    let peers = bundles(f.peers ?? [], !!f.replace)
    let frame: Frame = {
      id: g.id!,
      reset: f.replace,
      bundles: rows.filter((b) => !dead(b)),
      gone: [...f.drop ?? [], ...rows.filter(dead).map((b) => b.entity.eid)],
      coverage: scope(rows, g.fields, g.body || !!f.shadow),
      peers,
      peerGone: f.unpeers,
      // A peer delta is a covered snapshot too; only delivered peer columns
      // are known, never all the other columns shared RAM happens to contain.
      peerCoverage: Object.fromEntries(peers.map((row) => {
        let coverage: Exclude<Coverage, true> = {
          ...g.peers.get(row.entity.eid),
        }
        for (let c of f.peers ?? []) {
          if (c.eid === row.entity.eid && c.name !== 'entity') {
            coverage[c.name] = c.comp === null ? true : [
              ...new Set([
                ...(Array.isArray(coverage[c.name])
                  ? coverage[c.name] as string[]
                  : []),
                ...Object.keys(c.comp),
              ]),
            ]
          }
        }
        g.peers.set(row.entity.eid, coverage)
        return [row.entity.eid, coverage]
      })),
    }
    for (let eid of f.unpeers ?? []) g.peers.delete(eid)
    message?.({ data: JSON.stringify(frame) } as Event & { data: string })
    return [...g.names]
  }
  return {
    box,
    // Topology owns reconnection. Refresh only readiness while disconnected;
    // the epoch handshake later resends the asks over the real transport.
    invalidate: () => {
      muted = true
      try {
        box.wire?.refresh()
      } finally {
        muted = false
      }
    },
    active: () => [...groups.values()].filter((g) => !g.silent).length,
    open,
    close,
    receive,
    retry: (sub: string) => {
      let h = handles.get(sub)
      let g = h && groups.get(h.key)
      if (g) {
        g.silent = false
        box.wire?.refresh(g.id)
      }
    },
    has: (sub: string) => names.has(sub) || transports.has(sub),
    aliases: (
      sub: string,
    ) => [...(transports.get(sub) ?? names.get(sub))?.names ?? []],
    members: (sub: string) =>
      handles.get(sub)?.watch.value.map((b) => b.entity.eid) ?? [],
    ready: (sub: string) => handles.get(sub)?.watch.ready ?? false,
    patch: (changes: Change[]) => {
      let rows = bundles(changes)
      return box.graph.apply(echo(rows), { trusted: true })
    },
  }
}
