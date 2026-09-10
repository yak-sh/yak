// Transaction identity reads: one owner needs indexed probes, not a JSON set
// materialized once per component. Keep the set gather for batches, and share
// its column projection so refs, derived values and bodies have one SQL truth.
import type { Vocab } from '@yaks/vocab'
import type { BindOpts } from '@yaks/sql'
import { type Bundle, tombstoned } from '@yaks/graph'
import type { Driver } from './driver.ts'
import { compSql, get } from './read.ts'

export let keyed = (driver: Driver, vocab: Vocab, opts: BindOpts) => {
  let names = vocab.all.filter((c) => c != 'entity')
  let probes: string[] = []
  for (let i = 0; i < names.length; i += 400) {
    probes.push(
      names.slice(i, i + 400).map((c) =>
        `select '${c}' as name from "${c}" where entity = ?1`
      ).join(' union all '),
    )
  }
  let columns = new Map<string, string>()
  return (eids: string[], selected?: string[]): Bundle[] => {
    if (eids.length != 1) return get(driver, vocab, eids, opts)
    let eid = eids[0]
    let row = driver.query(
      `select e.id, e.num, t.entity as dead${
        vocab.comp('archetype')
          ? ', (select a.eid from entity a where a.id = e.archetype) as archetype'
          : ''
      } from entity e
       left join tombstone t on t.entity = e.id where e.eid = ?`,
      [eid],
    )[0]
    if (!row) return []
    let entity = {
      eid,
      ...row.num == null ? {} : { num: Number(row.num) },
      ...(row.archetype == null ? {} : { archetype: String(row.archetype) }),
    }
    if (row.dead != null) return [tombstoned(entity)]
    let b: Bundle = { entity }
    let found = selected
      ? selected.filter((c) => names.includes(c)).map((name) => ({ name }))
      : probes.flatMap((probe) => driver.query(probe, [Number(row.id)]))
    for (let { name } of found) {
      let comp = String(name)
      let sql = columns.get(comp)
      if (!sql) columns.set(comp, sql = compSql(vocab, comp, opts.derived))
      let held = driver.query(sql, [eid])[0]
      if (held) {
        let present = vocab.column(comp, 'present')
        if (!present?.persist && !opts.derived?.[`${comp}.present`]) {
          delete held.present
        }
        b[comp] = held
      }
    }
    return [b]
  }
}
