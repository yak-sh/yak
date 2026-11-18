// Explicit purge belongs to the owner of the retained versions. These writes
// bypass ordinary entity mutation: deliberately erased history is not trash.
import type { Bundle } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import {
  among,
  array,
  type BindOpts,
  col,
  type Driver,
  select,
  table,
} from '@yaks/sql'
import { foreign, stood } from './physical.ts'
import { valuesOf } from './read.ts'
import { TRASH } from './trash.ts'
import { erased } from './mode.ts'
import { tables } from './physical.ts'
import { WRITTEN } from './written.ts'

let metadata = new Set(['entity', '$branch', '$from', '$to'])

/** Every version of exactly these identities, including retired columns. */
export let purgeHistory = (
  driver: Driver,
  vocab: Vocab,
  eids: string[],
  opts: BindOpts,
): Bundle[] => {
  let names = new Map(
    driver.query(select({
      cols: [col('id'), col('eid')],
      from: table('entity'),
      where: among(col('eid'), array(eids)),
    })).map((r) => [Number(r.id), String(r.eid)]),
  )
  let out: Bundle[] = []
  for (
    let [name, shape] of Object.entries(stood(
      driver,
      (name) => !foreign(name) && name.endsWith('$versions'),
    ))
  ) {
    let comp = name.slice(0, -'$versions'.length)
    let where = among(col('entity', comp), array([...names.keys()]))
    if (vocab.comp(comp)) {
      out.push(
        ...valuesOf(driver, vocab, comp, name, where, opts).map((
          [id, value],
        ) => ({ entity: { eid: names.get(id)! }, [comp]: value })),
      )
    }
    // The current vocabulary cannot decode a retired property. Its stored
    // value still matters to resources retaining content by address.
    let extras = shape.cols.map((c) => String(c.name)).filter((p) =>
      !metadata.has(p) && !vocab.prop(comp, p)
    )
    if (extras.length) {
      out.push(
        ...driver.query(select({
          cols: [col('entity', comp), ...extras.map((p) => col(p, comp))],
          from: table(name, comp),
          where,
        })).map(({ entity, ...value }) => ({
          entity: { eid: names.get(Number(entity))! },
          [comp]: value,
        })),
      )
    }
    driver.query({
      t: 'delete',
      from: name,
      where: among(col('entity'), array([...names.keys()])),
    })
  }
  if (tables(driver).includes(WRITTEN)) {
    driver.query({
      t: 'insert',
      into: WRITTEN,
      cols: ['entity'],
      q: select({
        cols: [col('id')],
        from: table('entity'),
        where: among(col('eid'), array(eids)),
      }),
    })
  }
  erased(driver)
  return out
}

/** Exact candidate strings, including inside JSON, without depending on the
 * current vocabulary to remember retired columns. */
export let retained = (driver: Driver, values: string[]): string[] => {
  let candidates = new Set(values), found = new Set<string>()
  let visit = (value: unknown): void => {
    if (typeof value == 'string') {
      if (candidates.has(value)) found.add(value)
      if (/^[\[{]/.test(value)) {
        try {
          visit(JSON.parse(value))
        } catch { /* ordinary text */ }
      }
    } else if (value && typeof value == 'object') {
      for (let part of Object.values(value)) visit(part)
    }
  }
  let shapes = stood(driver, (name) => !foreign(name))
  for (let [name, shape] of Object.entries(shapes)) {
    if (
      name != TRASH && !name.endsWith('$versions') &&
      !shape.cols.some((c) => c.name == 'entity' && Number(c.pk) > 0)
    ) continue
    let cols = shape.cols.map((c) => String(c.name)).filter((p) =>
      !metadata.has(p)
    )
    if (cols.length) {
      for (
        let row of driver.query(select({
          cols: cols.map((p) => col(p)),
          from: table(name),
        }))
      ) visit(row)
    }
  }
  return [...found]
}
