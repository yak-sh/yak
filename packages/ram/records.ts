// The stored record is keyed by vocabulary identity. Its bundle is the
// label projection shared by reads, indexes and the transaction's undo log.
import type { Bundle, Comp, Eid } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'

type RecordOf = { entity: Bundle['entity']; [key: string]: Comp | undefined }
let named = (
  b: Bundle,
  comp: (name: string) => string,
  prop: (comp: string, name: string) => string,
): RecordOf => {
  let cells = Object.fromEntries(
    Object.entries(b).flatMap(([c, value]) =>
      c == 'entity' || value == null || c.startsWith('$') ? [] : [[
        comp(c),
        Object.fromEntries(
          Object.entries(value as Comp).map(([p, val]) => [prop(c, p), val]),
        ),
      ]]
    ),
  )
  return { entity: b.entity, ...cells }
}

export let records = (vocab: () => Vocab) => {
  let rows = new Map<Eid, RecordOf>()
  let bundles = new WeakMap<RecordOf, Bundle>()
  let recorded = new WeakMap<Bundle, RecordOf>()
  let read = (row: RecordOf): Bundle => {
    let held = bundles.get(row)
    if (held) return held
    let v = vocab()
    let bundle = named(row, (c) => {
      let w = v.word(c)
      return w && 'comp' in w && !w.prop ? w.comp : c
    }, (c, p) => {
      let w = v.word(p)
      return w && 'comp' in w && w.prop && v.stored(w.comp) == c ? w.prop : p
    }) as Bundle
    bundles.set(row, bundle)
    recorded.set(bundle, row)
    return bundle
  }
  return {
    get: (eid: Eid) => {
      let row = rows.get(eid)
      return row && read(row)
    },
    set: (eid: Eid, bundle: Bundle) => {
      let v = vocab()
      let row = recorded.get(bundle) ?? named(bundle, v.stored, v.stored)
      rows.set(eid, row)
      return read(row)
    },
    delete: (eid: Eid) => rows.delete(eid),
    values: function* () {
      for (let row of rows.values()) yield read(row)
    },
    [Symbol.iterator]: function* () {
      for (let [eid, row] of rows) yield [eid, read(row)] as const
    },
  }
}
