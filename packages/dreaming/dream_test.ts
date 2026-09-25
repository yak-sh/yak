import { assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { counter, ids, noon, shop } from '../builders/harness.ts'
import { dreamingDoc } from './vocab.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

Deno.test('a dream is a builder: it builds on its schedule, and reads as a dream', async () => {
  let { g, vocab } = await shop({
    desk: { provider: ids.house, model: ids.mind, persona: ids.voice },
    rest: '1h',
    now: noon,
    eid: counter(),
  }, [dreamingDoc])
  await g.apply([{
    entity: { eid: 'z-writeup' },
    dream: { scope: ids.work },
    builder: {},
    doc: { title: 'Write up', body: 'Write up what is waiting.' },
  }])
  let [line] = (await g.read('.entry&?content')) as Bundle[]
  assertEquals(comp(line, 'content')?.body, 'Write up what is waiting.')
  let [dream] = (await g.read('.eid=z-writeup')) as Bundle[]
  assertEquals(vocab.kindOf(dream), 'dream')
  assertEquals(comp(dream, 'builder')?.floor, '2026-09-19T13:00:00.000Z')
  assertEquals(((await g.read('.built')) as Bundle[]).length, 1)
})
