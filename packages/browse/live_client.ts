// Browse's learned projection and patch adapter over generic named watches.
import { entire, namedClient, quiet } from '@yaks/client/named'
import { type Bundle, type Comp, dead } from '@yaks/graph'
import type { Coverage, Frame, Socket } from '@yaks/sync'
import { loadVocab } from '@yaks/vocab'
import { type Change, keywords, resultComps, vocab } from './types.ts'
import type { Sub } from './live.ts'
import { storageKey } from './hosting.ts'
export { entire, quiet }
// Server-derived columns are ordinary received data in a browser replica.
// Their derivation/writability remains the server's responsibility, and so do
// their values: a computed enum names what can be written, and a derivation may
// read wider (a claimed task's status is `wip`, contributed by the claim). A
// status ladder (@yaks/vocab's `status` keyword) is the server's derivation
// too, so its component keeps the status as a plain column, and the rungs
// another document adds go with it.
let browserVocab = () => {
  let docs = structuredClone(vocab.docs)
  for (let doc of docs) {
    for (let [name, def] of Object.entries(doc.$defs ?? {})) {
      if (!def.component || name == 'entity') continue
      let ladder = def.status
      delete def.status
      if (def.extends) continue
      def.properties ??= {}
      def.properties.eid = { type: 'string' }
      if (ladder) def.properties.status = { type: 'string' }
      for (let prop of Object.values(def.properties ?? {})) {
        if (prop.computed) delete prop.enum
        prop.computed = false
      }
    }
  }
  return loadVocab(docs, keywords)
}

export type LiveClient = ReturnType<typeof liveClient>
export let liveClient = (opts: {
  url: string
  connect: (url: string) => Socket
  changed: (eids: string[]) => void
  ready: (sub: string) => void
  frame: (subs: string[], f: Frame, reset: boolean) => void
  disk?: boolean
}) => {
  let core = namedClient({
    ...opts,
    vocab: browserVocab(),
    wireVault: opts.disk
      ? { name: storageKey('tasks-client-wire') }
      : undefined,
  })
  // Changes as whole rows: a reset rebuilds each row from what it carries.
  let bundles = (changes: Change[], reset = false): Bundle[] => {
    let rows = new Map<string, Bundle>()
    for (let { eid, name, comp } of changes) {
      if (name in resultComps) continue
      let row = rows.get(eid)
      if (!row) {
        row = reset ? { entity: { eid } } : {
          ...core.box.ent(eid),
          entity: core.box.ent(eid)?.entity ?? { eid },
        }
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
  let receive = (f: Sub) => {
    let rows = bundles(f.changes ?? [], !!f.replace)
    let frame: Omit<Frame, 'id'> = f.error
      ? { refused: { error: 'read', message: f.error } }
      : f.agg
      ? { tally: f.agg }
      : {
        reset: f.replace,
        bundles: rows.filter((b) => !dead(b)),
        gone: [...f.drop ?? [], ...rows.filter(dead).map((b) => b.entity.eid)],
        coverage: Object.fromEntries(
          rows.filter((b) => !dead(b)).map((
            b,
          ) => [b.entity.eid, true as Coverage]),
        ),
      }
    core.receive(f.sub, frame)
  }
  return {
    ...core,
    receive,
    patch: (changes: Change[]) => core.patch(bundles(changes)),
  }
}
