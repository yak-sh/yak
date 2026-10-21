import { batch } from '@preact/signals'
// Browse's learned projection and patch adapter over generic named watches.
import { entire, namedClient, quiet } from '@yaks/client/named'
import type { ClientOpts } from '@yaks/client'
import type { Bundle, Comp } from '@yaks/graph'
import { dead } from '@yaks/graph/bundle'
import type { Coverage, Frame, Socket } from '@yaks/sync'
import { loadVocab } from '@yaks/vocab'
import { type Change, keywords, vocab } from './types.ts'
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
let projections = new WeakMap<typeof vocab, typeof vocab>()
let browserVocab = () => {
  let kept = projections.get(vocab)
  if (kept) return kept
  let docs = vocab.docs.map((doc) => ({
    ...doc,
    $defs: Object.fromEntries(
      Object.entries(doc.$defs ?? {}).map(([name, def]) => {
        if (!def.component || name == 'entity') return [name, def]
        let { status, ...copy } = def
        if (def.extends) return [name, copy]
        return [name, {
          ...copy,
          computed: false,
          properties: {
            ...Object.fromEntries(
              Object.entries(def.properties ?? {}).map(([name, prop]) => {
                let copy = { ...prop, computed: false }
                if (prop.computed) delete copy.enum
                return [name, copy]
              }),
            ),
            eid: { type: 'string', computed: false },
            ...status ? { status: { type: 'string', computed: false } } : {},
          },
        }]
      }),
    ),
  }))
  let projected = loadVocab(docs, keywords)
  projections.set(vocab, projected)
  return projected
}

export type LiveClient = ReturnType<typeof liveClient>
export let liveClient = (opts: {
  url: string
  fetch?: ClientOpts['fetch']
  report?: ClientOpts['report']
  connect: (url: string) => Socket
  changed: (eids: string[]) => void
  ready: (sub: string) => void
  frame: (subs: string[], f: Frame, reset: boolean) => void
  outbox?: ClientOpts['outbox']
  disk?: boolean
}) => {
  let core = namedClient({
    ...opts,
    vocab: browserVocab(),
    batch,
    wireVault: opts.disk
      ? { name: storageKey('tasks-client-wire') }
      : undefined,
  })
  // Changes as whole rows: a reset rebuilds each row from what it carries.
  let bundles = (changes: Change[], reset = false): Bundle[] => {
    let rows = new Map<string, Bundle>()
    for (let { eid, name, comp } of changes) {
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
