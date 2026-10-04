// Choosing a retained take changes only the chosen marks. The hook enforces
// one mark per build/slot at every graph door, including plain entity patches.

import {
  type Actor,
  type Comp,
  type Graph,
  type Hook,
  type Plugin,
  Refused,
  signed,
} from '@yaks/graph'
import { after } from '@yaks/fp'
import { CallError } from '@yaks/tools'
import { changing } from './change.ts'

export let choosing: Hook = (bundles, tx) => {
  let marked = bundles.filter((row) => row.chosen != null)
  if (!marked.length) return bundles
  return after(tx.get(marked.map((row) => row.entity.eid)), (rows) => {
    let old = new Map(rows.map((row) => [row.entity.eid, row]))
    let want = new Map<string, string>()
    let builds = new Set<string>()
    for (let row of marked) {
      let built = {
        ...old.get(row.entity.eid)?.built as Comp,
        ...row.built as Comp,
      }
      if (!built.build || !built.slot) {
        throw new Refused('chosen needs an output take')
      }
      let slot = JSON.stringify([built.build, built.slot])
      if (want.has(slot) && want.get(slot) != row.entity.eid) {
        throw new Refused('choose only one take per build and slot')
      }
      want.set(slot, row.entity.eid)
      builds.add(String(built.build))
    }
    let line = `.built.build=${[...builds].join(',')}&.chosen&*`
    return after(tx.read(line), (prior) => [
      ...prior.filter((row) => {
        let built = row.built as Comp
        let chosen = want.get(JSON.stringify([built.build, built.slot]))
        return chosen != null && chosen != row.entity.eid
      }).map((row) => ({ entity: row.entity, chosen: null })),
      ...bundles,
    ])
  })
}

export let choices = (): Plugin => ({
  name: '@yaks/builders',
  admission: () => true,
  hooks: {
    precondition: choosing,
    stamp: (bundles, tx, _err, context) =>
      changing((context!.graph as Graph).vocab)(bundles, tx),
  },
})

export let choose = async (
  graph: Graph,
  output: string,
  actor: Actor | null,
): Promise<string> => {
  let names = await graph.address([output])
  let eid = names.get(output) ?? output
  let [row] = await graph.get([eid])
  if (!row?.built) throw new CallError('refused', `${output} is no output take`)
  await graph.apply(signed([{ entity: row.entity, chosen: {} }], actor), {
    trusted: true,
  })
  return eid
}
