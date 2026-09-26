// Transaction identity reads: one owner needs indexed probes, not a JSON set
// materialized once per component. Keep the set gather for batches, and share
// its column projection so refs, derived values and bodies have one SQL truth.
import type { Vocab } from '@yaks/vocab'
import {
  ARMS,
  as,
  type BindOpts,
  col,
  type Driver,
  eq,
  lit,
  select,
  table,
  unionAll,
  val,
} from '@yaks/sql'
import { type Bundle, tombstoned } from '@yaks/graph'
import { compSql, get, spine } from './read.ts'
import { descriptor } from './catalog.ts'
import { decoded } from './jsonb.ts'

export let keyed = (driver: Driver, vocab: Vocab, opts: BindOpts) => {
  let names = vocab.all.filter((c) => c != 'entity')
  // A number is shown only where the vocabulary declares one (read.ts
  // `numbered`): the column stands in every layout, and a store that never
  // loaded @yaks/id has nothing to say with it.
  let numbered = !!vocab.prop('entity', 'num')
  // Cut to what this engine's compound SELECT carries (`Driver.arms`): workerd
  // refuses a sixth term where an embedded SQLite takes hundreds, so a probe
  // sized for the latter is a broken read on a Durable Object, not a slow one.
  let wide = driver.arms ?? ARMS
  let chunks: string[][] = []
  for (let i = 0; i < names.length; i += wide) {
    chunks.push(names.slice(i, i + wide))
  }
  // Which of a chunk's tables hold a row for this owner.
  let probe = (chunk: string[], id: number) =>
    unionAll(
      ...chunk.map((c) =>
        select({
          cols: [as(lit(c), 'name')],
          from: table(c),
          where: eq(col('entity'), val(id)),
        })
      ),
    )
  return (eids: string[], selected?: string[]): Bundle[] => {
    if (eids.length != 1) return get(driver, vocab, eids, opts, selected)
    let eid = eids[0]
    let row = driver.query(spine(vocab, eq(col('eid', 'e'), val(eid))))[0]
    if (!row) return []
    let entity = {
      eid,
      ...!numbered || row.num == null ? {} : { num: Number(row.num) },
      ...(row.archetype == null ? {} : { archetype: String(row.archetype) }),
    }
    if (row.dead != null) return [tombstoned(entity)]
    let b: Bundle = { entity }
    let tables = row['@tables'] == null
      ? undefined
      : descriptor(driver, String(row['@tables'])).tables
    let found = tables
      ? tables.filter((c) =>
        names.includes(c) && (!selected || selected.includes(c))
      )
        .map((name) => ({ name }))
      : selected
      ? selected.filter((c) => names.includes(c)).map((name) => ({ name }))
      : chunks.flatMap((chunk) => driver.query(probe(chunk, Number(row.id))))
    for (let { name } of found) {
      let comp = String(name)
      let held = driver.query(compSql(vocab, comp, eid, opts.derived))[0]
      if (held) {
        let present = vocab.prop(comp, 'present')
        if (present?.computed !== false && !opts.derived?.[`${comp}.present`]) {
          delete held.present
        }
        b[comp] = decoded(vocab, comp, held)
      }
    }
    return [b]
  }
}
