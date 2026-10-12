// One-time repair of two landing refusals grouped by the retired scalar range
// lowering. Occurrence identities and source history survive the split; every
// changed receipt and counter is guarded and committed in one transaction.
import { compose } from '@yaks/cli/host'
import { read } from '@yaks/cli/config'
import { token } from '@yaks/graph/sha256'
import { absent, and, eq, every } from '@yaks/query'
import { grouped } from '@yaks/tracker'
import type { Bundle, Comp } from '@yaks/graph'

let source = 'c01bf113-2929-881f-9fe7-6833987fe70f'
let moved = new Set([
  '695fa876-9b6a-45c4-a29a-729a8521c244',
  'e4fb2100-97a4-4e3a-8ce3-68ab53de8df5',
])
let comp = (row: Bundle, name: string) => (row[name] ?? {}) as Comp
let host = await compose(read(Deno.args[0]), ['graph'], undefined, {
  process: false,
})
try {
  let g = host.graph
  let [bug] = await g.get([source])
  let rows = await g.read(and(eq('error.bug', source), every()))
  let wrong = rows.filter((row) => moved.has(row.entity.eid))
  if (!wrong.length) {
    console.log('already repaired: 0 occurrences moved')
  } else {
    if (wrong.length != 2 || rows.length != 6 || comp(bug, 'bug').hits != 6) {
      throw Error('source history changed; inspect before repairing')
    }
    let patches: Bundle[] = []
    for (let row of wrong) {
      let fault = comp(row, 'error').fault
      if (typeof fault != 'string' || !fault.startsWith('call:landerror:')) {
        throw Error('unexpected occurrence fault')
      }
      let matches = await g.read(and(
        eq('bug.fault', fault),
        absent('bug.app'),
        every(),
      ))
      if (matches.length) throw Error('destination already exists; inspect it')
      let [receipt, destination] = grouped(row, undefined, [])
      receipt.$was = { error: { bug: token(source) } }
      // These failures were already notified under the incorrect group.
      destination.notified = bug.notified as Comp
      patches.push(receipt, destination)
    }
    let kept = rows.filter((row) => !moved.has(row.entity.eid))
      .sort((a, b) =>
        String(comp(a, 'error').at).localeCompare(
          String(comp(b, 'error').at),
        )
      )
    if (
      kept.some((row) => comp(row, 'error').fault != comp(bug, 'bug').fault)
    ) {
      throw Error('source contains another mismatched fault')
    }
    let latest = comp(grouped(kept.at(-1)!, undefined, [])[1], 'bug')
    patches.push({
      entity: bug.entity,
      $was: {
        bug: Object.fromEntries(
          ['hits', 'first', 'last', 'spot', 'culprit'].map((p) => [
            p,
            token(comp(bug, 'bug')[p]),
          ]),
        ),
        regressed: { error: token(comp(bug, 'regressed').error) },
      },
      bug: {
        hits: 4,
        first: comp(kept[0], 'error').at,
        last: comp(kept.at(-1)!, 'error').at,
        spot: latest.spot ?? null,
        culprit: latest.culprit ?? null,
      },
      ...moved.has(String(comp(bug, 'regressed').error))
        ? { regressed: null }
        : {},
    })
    await g.apply(patches, { trusted: true })
    let repaired = await g.read(and(eq('error.bug', source), every()))
    if (repaired.length != 4) throw Error('source count differs after repair')
    for (let row of wrong) {
      let [saved] = await g.get([row.entity.eid])
      let [destination] = await g.get([String(comp(saved, 'error').bug)])
      if (comp(destination, 'bug').fault != comp(row, 'error').fault) {
        throw Error('destination fault differs after repair')
      }
    }
    console.log(
      'repaired: 2 occurrences moved; 4 vector occurrences retained; 6 total',
    )
  }
} finally {
  await host.close()
}
