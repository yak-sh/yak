import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { graph, Stale } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { spineDoc } from '@yaks/kernel/vocab'
import { docDoc } from '@yaks/doc'
import { attributed } from './attribution.ts'

let held = () => {
  let vocab = loadVocab([spineDoc, docDoc])
  return graph({ vocab, storage: ram(vocab) })
}

test('attribution is bounded, repeatable, and leaves timestamps intact', async () => {
  let g = held()
  let now = '2026-10-03T00:00:00.000Z'
  g.apply(
    ['a', 'b', 'c'].map((eid) => ({
      entity: { eid },
      doc: { title: eid },
      $actor: { via: 'browser' },
    })),
    { now },
  )
  assertEquals(await attributed(g, 'browser', 'ada', 2), {
    filled: 2,
    more: true,
  })
  assertEquals(await attributed(g, 'browser', 'ada', 2), {
    filled: 1,
    more: false,
  })
  assertEquals(await attributed(g, 'browser', 'other', 2), {
    filled: 0,
    more: false,
  })
  for (let row of await g.read('.doc ?created ?updated')) {
    assertEquals(row.created, { at: now, via: 'browser', by: 'ada' })
    assertEquals(row.updated, undefined)
  }
})

test('a byline that moved after selection cannot be assigned to the wrong browser', async () => {
  let g = held()
  g.apply([{
    entity: { eid: 'a' },
    doc: { title: 'First' },
    $actor: { via: 'browser' },
  }])
  g.apply([{
    entity: { eid: 'a' },
    doc: { title: 'Second' },
    $actor: { via: 'browser' },
  }])
  let changed = {
    ...g,
    read: async (...args: Parameters<typeof g.read>) => {
      let rows = await g.read(...args)
      g.apply([{
        entity: { eid: 'a' },
        doc: { title: 'Third' },
        $actor: { via: 'another' },
      }])
      return rows
    },
  }
  await assertRejects(() => attributed(changed, 'browser', 'ada'), Stale)
  let [row] = await g.get(['a'])
  assertEquals(row.created?.by, undefined)
  assertEquals(row.updated?.via, 'another')
  assertEquals(row.updated?.by, undefined)
})
