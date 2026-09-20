import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import type { Reading, Section } from '@yaks/context'
import { idKeywords } from '@yaks/id'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { taskDoc } from '@yaks/task'
import { sessionDoc } from './comp.ts'
import { digest } from './digest.ts'

let vocab = loadVocab([docDoc, taskDoc, sessionDoc], [idKeywords])
let sections = digest({ vocab })

// The store, as far as these sections read it: rows keyed by the words the
// query that wants them names. Each read asks one thing, so a row answers by
// the token it was filed under.
let on = (b: Bundle, word: string): Bundle => ({ ...b, $match: { [word]: 1 } })

let reader = (rows: Bundle[]): Reading => (q: unknown) =>
  rows.filter((b) =>
    Object.keys(b.$match ?? {}).every((k) => String(q).includes(k))
  )

let written = async (session: Bundle, rows: Bundle[]): Promise<Section[]> =>
  await sections(session, reader(rows))

let s1: Bundle = {
  entity: { eid: 's1', num: 3 },
  session: { id: 'abc', actor: 'p1' },
}

// One input entry: prose nothing produced.
let typed = (eid: string, body: string): Bundle =>
  on({ entity: { eid }, entry: { session: 's0' }, content: { body } }, 'entry')

Deno.test('the owner leads, then the handoff, then what is held', async () => {
  let rows = [
    on({ entity: { eid: 's0' }, brief: { text: 'landed it' } }, 'brief!'),
    on(
      { entity: { eid: 's0' }, session: { id: 'old', actor: 'p1' } },
      'session.actor',
    ),
    typed('e1', 'first thing\nand more'),
    typed('e2', 'then this'),
    on({
      entity: { eid: 't1', num: 7 },
      task: {},
      doc: { title: 'ship it' },
      claim: { session: 's1' },
    }, 'claim.session'),
  ]
  assertEquals(await written(s1, rows), [
    { heading: 'owner said', lines: ['- then this', '- first thing'] },
    { heading: 'previously', lines: ['landed it'] },
    { heading: 'claimed', lines: ['- T-7 — ship it'] },
  ])
})

Deno.test('what a model said is not what the owner said', async () => {
  let rows = [
    on(
      { entity: { eid: 's0' }, session: { id: 'old', actor: 'p1' } },
      'session.actor',
    ),
    on({
      entity: { eid: 'e1' },
      entry: { session: 's0' },
      content: { body: 'I will ship it' },
      output: { source: 'a1' },
    }, 'entry'),
    on({
      entity: { eid: 'e2' },
      entry: { session: 's0' },
      content: { body: 'ok' },
      result: { call: 'c1' },
    }, 'entry'),
  ]
  assertEquals((await written(s1, rows))[0], {
    heading: 'owner said',
    lines: [],
  })
})

Deno.test('a transcript nothing has reified asks about nobody', async () => {
  let fresh: Bundle = { entity: { eid: '$session' }, session: { id: 'new' } }
  let rows = [
    on({ entity: { eid: 'x' }, claim: { session: '$session' } }, 'claim'),
  ]
  assertEquals(
    (await written(fresh, rows)).map((s) => s.lines),
    [[], [], []],
  )
})

Deno.test("this session's own brief is never its own handoff", async () => {
  let rows = [
    on({ entity: { eid: 's1' }, brief: { text: 'mine' } }, 'brief!'),
  ]
  assertEquals((await written(s1, rows))[1], {
    heading: 'previously',
    lines: [],
  })
})
