import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { idKeywords } from '@yaks/id'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { goalDoc } from './vocab.ts'
import { digest } from './digest.ts'

let vocab = loadVocab([docDoc, goalDoc], [idKeywords])

let asked: string[] = []
let store = (rows: Bundle[]) => (q: unknown) => {
  asked.push(String(q))
  return rows
}

let v = (num: number, title: string, scope?: string): Bundle => ({
  entity: { eid: `v${num}`, num },
  goal: scope ? { scope } : {},
  doc: { title },
})

let told = async (actor: string | undefined, rows: Bundle[], options = {}) => {
  asked = []
  return await digest({ vocab }, options)(
    { entity: { eid: 's1' }, session: { id: 'abc', actor } },
    store(rows),
  )
}

Deno.test('the standing goals are titles, oldest first', async () => {
  assertEquals(
    await told('p1', [
      v(10, 'Reduce noise, amplify signal'),
      v(12, 'A useful TUI'),
    ]),
    [{
      heading: 'goals',
      lines: ['- V-10 Reduce noise, amplify signal', '- V-12 A useful TUI'],
    }],
  )
  assertEquals(asked[0].includes('.order=entity.num'), true)
})

Deno.test('a scoped goal holds for its own project, an unscoped one everywhere', async () => {
  let rows = [v(1, 'everywhere'), v(2, 'mine', 'p1'), v(3, 'theirs', 'p2')]
  assertEquals((await told('p1', rows))[0].lines, [
    '- V-1 everywhere',
    '- V-2 mine',
  ])
  // A transcript naming no actor gets the ones that hold everywhere.
  assertEquals((await told(undefined, rows))[0].lines, ['- V-1 everywhere'])
})

Deno.test('a goal filtered out does not eat a place in the answer', async () => {
  let rows = [v(1, 'theirs', 'p2'), v(2, 'mine', 'p1'), v(3, 'also mine', 'p1')]
  assertEquals((await told('p1', rows, { goals: 2 }))[0].lines, [
    '- V-2 mine',
    '- V-3 also mine',
  ])
  // The window asked for is wider than the answer, for exactly that reason.
  assertEquals(asked[0].includes('.limit=8'), true)
})
