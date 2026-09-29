import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { ids, noon, shop } from '../builders/testing.ts'
import { modelToolEid } from '../builders/model.ts'
import { dreamingDoc } from './vocab.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

Deno.test('a dream is a scheduled builder and reads as a dream', async () => {
  let { g, vocab, runner } = await shop({ rest: '1h', now: noon }, [
    dreamingDoc,
  ])
  await g.apply([{
    entity: { eid: 'z-writeup' },
    dream: { scope: ids.work },
    builder: { to: modelToolEid() },
    content: { body: 'Write up what is waiting.' },
    using: { model: ids.model },
    doc: { title: 'Write up' },
  }])
  let [build] = await g.read('.build&*')
  assert(build)
  let [call] = await g.read('.call&*')
  await runner.due(call.entity.eid)
  let [line] = await g.read('.entry&?content')
  assert(
    String(comp(line, 'content')?.body).startsWith('Write up what is waiting.'),
  )
  let [dream] = await g.read('.eid=z-writeup')
  assertEquals(vocab.kindOf(dream), 'dream')
  assertEquals(comp(dream, 'builder')?.floor, '2026-09-19T13:00:00.000Z')
})
