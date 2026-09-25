// pasted(): text → entity spec. Pure over the cache signal — the seams
// the canvas drop and the palette's board chip ride.
import { pasted } from './paste.ts'
import { cache } from './live.ts'
import { assertEquals, assertThrows } from '@std/assert'

let comps = (text: string) => {
  let spec = pasted(text)!
  let eids = new Set(spec.changes.map((c) => c.eid))
  return { names: spec.changes.map((c) => c.name), minted: eids.size }
}

// The board chip's drag payload: a {doc, board} JSON mints both comps on
// ONE fresh eid — dropping the chip on the canvas lands a live board.
Deno.test('pasted: doc+board JSON mints a board', () => {
  cache.value = {}
  let q = 'fable .status=open'
  let spec = pasted(JSON.stringify({
    doc: { title: q, body: '' },
    board: { query: q },
  }))!
  assertEquals(spec.changes.map((c) => c.name), ['doc', 'board'])
  assertEquals(new Set(spec.changes.map((c) => c.eid)).size, 1)
  assertEquals(spec.changes[0].eid, spec.target)
  assertEquals(spec.changes[1].comp?.query, q)
})

Deno.test('pasted: a known id targets the existing entity', () => {
  cache.value = { e1: { entity: { eid: 'e1', num: 7 } } }
  assertEquals(pasted('T-7'), { changes: [], target: 'e1' })
  assertEquals(pasted('T-8'), null)
})

Deno.test('pasted: sigilled ids and full UUIDs target an unnumbered entity', () => {
  let eid = '3f9a1c2e-7b00-4000-8000-000000000001'
  cache.value = { [eid]: { entity: { eid, num: 0 }, task: { eid } } }
  try {
    for (let id of [eid, 'T#3f9a1c2e7b', '#3f9a1c']) {
      assertEquals(pasted(id), { changes: [], target: eid })
    }
    assertThrows(() => pasted('S#3f9a1c'), Error, 'prefix S')
  } finally {
    cache.value = {}
  }
})

Deno.test('pasted: plain text becomes a task, first line the title', () => {
  cache.value = {}
  assertEquals(comps('fix the door\nit squeaks'), {
    names: ['doc', 'task'],
    minted: 1,
  })
})

Deno.test('pasted: terminal task status becomes a lifecycle mark', () => {
  cache.value = {}
  for (
    let [input, mark] of [
      [{ title: 'finished', status: 'done' }, 'completed'],
      [
        { doc: { title: 'called off' }, task: { status: 'cancelled' } },
        'cancelled',
      ],
    ] as const
  ) {
    let spec = pasted(JSON.stringify(input))!
    assertEquals(spec.changes.map((c) => c.name), ['doc', 'task', mark])
    assertEquals(
      Object.hasOwn(
        spec.changes.find((c) => c.name == 'task')!.comp!,
        'status',
      ),
      false,
    )
  }
})
