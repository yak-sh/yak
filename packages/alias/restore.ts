// Retained alias keys return under a free name when their old name was reused.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Restored } from '@yaks/graph/plugin'
import { substitute } from '@yaks/graph/identity'
import { ofOf, valueOf } from '@yaks/key'
import { ALIAS, aliasEid } from './comp.ts'

export let restored = async (
  graph: Graph,
  bundles: Bundle[],
): Promise<Restored> => {
  let aliases = bundles.filter((b) => b[ALIAS] != null && ofOf(b) && valueOf(b))
  let reserved = new Map(aliases.map((b) => [valueOf(b)!, b.entity.eid]))
  let moved = new Map<string, string>()
  let names = new Map<string, string>()
  let notices: string[] = []
  for (let saved of aliases) {
    let was = valueOf(saved)!, of = ofOf(saved)!, name = was
    for (let n = 2;; n++) {
      let [now] = await graph.get([aliasEid(name)])
      let owner = ofOf(now)
      let planned = reserved.get(name)
      if (
        (!owner || owner == of) && (!planned || planned == saved.entity.eid)
      ) break
      name = `${was}-${n}`
    }
    reserved.set(name, saved.entity.eid)
    if (name == was) continue
    let eid = aliasEid(name)
    moved.set(saved.entity.eid, eid)
    names.set(eid, name)
    notices.push(
      `Alias ${JSON.stringify(was)} was taken; restored as ${
        JSON.stringify(name)
      }.`,
    )
  }
  return {
    bundles: substitute(bundles, graph.vocab, moved).map((b) => {
      let name = names.get(b.entity.eid)
      return name
        ? {
          ...b,
          entity: { eid: b.entity.eid },
          key: { ...(b.key as Comp), value: name },
        }
        : b
    }),
    notices,
  }
}
