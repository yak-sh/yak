import { type Bundle, type Comp, derivedEid, type Graph } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import { compile, type Speaks } from './compile.ts'

/** The ordinary `_package{name}` identity. */
export let packageEid = (name: string): string => derivedEid(`_package|${name}`)

/** Authored `$defs` lens entries as private `_lens{package, step, ops}` rows.
 * A document must name its declaring package. Components and other entries
 * are left to their own readers. */
export let lensesIn = (docs: VocabDoc[]): Bundle[] => {
  let rows: Bundle[] = []
  for (let doc of docs) {
    for (let s of Object.values(doc.$defs ?? {})) {
      if (s.lens !== true) continue
      if (!doc.package) {
        throw new Error('Lens: a declaring document needs package')
      }
      let pkg = packageEid(doc.package)
      rows.push({
        entity: { eid: derivedEid(`_lens|${pkg}|${s.step}`) },
        _lens: { package: pkg, step: s.step, ops: s.ops },
      })
    }
  }
  compile(rows)
  return rows
}

/** The step count a set of declaring documents speaks. */
export let versions = (docs: VocabDoc[]): Speaks => {
  let out: Speaks = Object.fromEntries(
    docs.filter((d) => d.package).map((d) => [packageEid(d.package!), 0]),
  )
  for (let b of lensesIn(docs)) {
    let s = b._lens as Comp
    out[String(s.package)] = Math.max(
      out[String(s.package)] ?? 0,
      Number(s.step) + 1,
    )
  }
  return out
}

/** Missing rows the served vocabulary declares. Steps are append-only:
 * reusing one with different operations refuses, including on rollback. */
export let described = async (
  g: Graph,
  docs: VocabDoc[],
): Promise<Bundle[]> => {
  if (!g.vocab.comp('_lens')) return []
  let rows = lensesIn(docs)
  let held = new Map(
    (await g.get(rows.map((r) => r.entity.eid), ['_lens'])).map((
      r,
    ) => [r.entity.eid, r]),
  )
  return rows.filter((r) => {
    let was = held.get(r.entity.eid)?._lens as Comp | undefined
    if (!was) return true
    if (JSON.stringify(was.ops) != JSON.stringify((r._lens as Comp).ops)) {
      throw new Error(`Lens: immutable step ${r.entity.eid} changed`)
    }
    return false
  })
}
