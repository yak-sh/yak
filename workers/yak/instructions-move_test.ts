import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Comp } from '@yaks/graph'
import { sha256 } from '@yaks/graph/sha256'
import { instructionsOf } from '@yaks/session/told'
import { BATCH, TOLD, toldBackfill } from './instructions-move.ts'
import { operatorMemory } from './operator-testing.ts'

// An ask kept holding its instructions' text names them by the told row that
// keeps each text once, a batch an alarm, and reads the same text after.
test("an ask's instructions move to one told row per text, in batches, once", async () => {
  let kept = new Map<string, string>()
  let marks = { get: (k: string) => kept.get(k), set: kept.set.bind(kept) }
  let { g } = operatorMemory()
  let session = crypto.randomUUID()
  let offer = sha256('[]')
  await g.apply([
    { entity: { eid: session }, session: {} },
    { entity: { eid: offer }, offer: { tools: [] } },
  ], { trusted: true })
  let text = (i: number) => `Rules ${i % 3}`
  let asks = Array.from({ length: BATCH + 1 }, (_, i) => ({
    entity: { eid: crypto.randomUUID() },
    entry: { session },
    ask: {},
    sending: { instructions: text(i), offer },
  }))
  await g.apply(asks, { trusted: true })
  let store = { g, marks }
  let passes = [await toldBackfill(store), await toldBackfill(store)]
  assertEquals([...passes, await toldBackfill(store)], [true, false, false])
  assertEquals(kept.get(TOLD), 'done')
  let moved = await g.get(asks.map((a) => a.entity.eid), ['sending'])
  assertEquals(
    moved.map((b) => b.sending),
    asks.map((_, i) => ({ told: sha256(text(i)), offer })),
  )
  assertEquals((await g.read('.told')).length, 3)
  assertEquals(
    await Promise.all(moved.map((b) => instructionsOf(g, b.sending as Comp))),
    asks.map((_, i) => text(i)),
  )
})
