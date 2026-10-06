// Bounded authoritative reads for certified admission, never accepted policies.
// Mutation invalidation comes from the same SQL connection; returned objects
// cannot mutate the retained snapshot. Dynamic whole components are re-read.
import type { Bundle, Tx } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import type { Derived } from '@yaks/sql'

export let memoized = (
  revision: () => number,
  vocab: Vocab,
  derived: Derived = {},
) => {
  let held = new Map<string, Bundle | null>()
  let version = -1, bytes = 0
  let sizes = new Map<string, number>()
  let evict = (eid: string) => {
    bytes -= sizes.get(eid) ?? 0
    sizes.delete(eid)
    held.delete(eid)
  }
  let dynamic = new Set(
    Object.entries(derived).filter(([, value]) => !value.stable).map(([p]) =>
      p.split('.')[0]
    ),
  )
  for (let name of vocab.comps) {
    if (
      vocab.comp(name)?.computed ||
      vocab.props(name).some((p) =>
        vocab.prop(name, p)?.computed && !derived[`${name}.${p}`]?.stable
      )
    ) {
      dynamic.add(name)
    }
  }
  let trim = () => {
    while (held.size > 256 || bytes > 1_048_576) {
      evict(held.keys().next().value!)
    }
  }
  return (get: Tx['get'], eids: string[], comps?: string[]): Bundle[] => {
    let seen = revision()
    if (seen != version) {
      held.clear()
      sizes.clear()
      bytes = 0
      version = seen
    }
    // Projections have coverage of their own; retain only whole snapshots.
    if (comps) return get(eids, comps) as Bundle[]
    let missing = [...new Set(eids)].filter((eid) => !held.has(eid))
    let fresh = get(missing) as Bundle[]
    let found = new Map(fresh.map((b) => [b.entity.eid, b]))
    for (let eid of missing) {
      let row = found.get(eid) ?? null
      let size = JSON.stringify(row, (_key, value) =>
        typeof value == 'bigint' ? String(value) : value).length * 2
      sizes.set(eid, size)
      bytes += size
      held.set(eid, structuredClone(row))
    }
    let out = eids.flatMap((eid) => {
      let row = held.get(eid)
      if (!row) return []
      held.delete(eid)
      held.set(eid, row)
      let b = structuredClone(row)
      if (!missing.includes(eid)) {
        let names = Object.keys(b).filter((name) => dynamic.has(name))
        if (names.length) {
          for (let name of names) delete b[name]
          let current = (get([eid], names) as Bundle[])[0]
          if (current) Object.assign(b, current)
        }
      }
      return [b]
    })
    trim()
    return out
  }
}
