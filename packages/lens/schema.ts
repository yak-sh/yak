import type { VocabDoc } from '@yaks/vocab'

type Rename = { from: [string, string]; to: [string, string] }

/** Translate declarations by the same inverse as read views. Components keep
 * their membership; a cross-component target remains an old-readable word. */
export let schema = (docs: VocabDoc[], pairs: Rename[]): VocabDoc[] => {
  let out = docs
  for (let { from: [fc, fp], to: [tc, tp] } of pairs.toReversed()) {
    let source = out.findIndex((d) => d.$defs?.[fc]?.properties)
    let target = out.findIndex((d) => d.$defs?.[tc]?.properties?.[tp])
    if (source < 0 || target < 0) continue
    let sourceDoc = out[source], sourceComp = sourceDoc.$defs![fc]
    let targetComp = out[target].$defs![tc]
    let props = { ...sourceComp.properties, [fp]: targetComp.properties![tp] }
    if (fc == tc) delete props[tp]
    let required = sourceComp.required?.map((p) => fc == tc && p == tp ? fp : p)
    if (targetComp.required?.includes(tp)) {
      required = [...new Set([...(required ?? []), fp])]
    }
    let next = {
      ...sourceDoc,
      $defs: {
        ...sourceDoc.$defs,
        [fc]: {
          ...sourceComp,
          properties: props,
          ...(required ? { required } : {}),
        },
      },
    }
    out = out.map((d, i) => {
      if (i == source) return next
      if (fc != tc || !d.$defs?.[tc]?.properties?.[tp]) return d
      let comp = d.$defs[tc], properties = { ...comp.properties }
      delete properties[tp]
      return {
        ...d,
        $defs: {
          ...d.$defs,
          [tc]: {
            ...comp,
            properties,
            ...(comp.required
              ? { required: comp.required.filter((p) => p != tp) }
              : {}),
          },
        },
      }
    })
  }
  return out
}
