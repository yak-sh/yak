import { equal, ok, test } from '@yaks/testing'
import { derivedEid, minted } from '@yaks/graph/identity'
import { sessionTools } from './children.ts'
import { pages, transcriptGraph } from './testing.ts'

let g = transcriptGraph(pages)
await g.apply([{
  entity: { eid: 'parent' },
  session: {},
}])
let spawn = sessionTools(g).find((tool) => tool.name == 'spawn')!
let call = { entity: { eid: 'delegate-call' } }
let context = { session: 'parent', call, entries: [] }
let child = await spawn.run(
  { prompt: 'hello', instructions: 'stay focused' },
  context,
)
let initial = await g.read(`.entry.session=${child}&*`)

test('delegation replays the same UUID child and leaves one set of UUID entries', async () => {
  equal(await spawn.run({ prompt: 'hello' }, context), child)
  equal(child, derivedEid('child:delegate-call'))
  ok(minted(String(child)))
  let entries = await g.read(`.entry.session=${child}&*`)
  equal(
    entries.map((row) => row.entity.eid),
    initial.map((row) => row.entity.eid),
  )
  ok(entries.length >= 2)
  ok(entries.every((row) => minted(row.entity.eid)))
})
