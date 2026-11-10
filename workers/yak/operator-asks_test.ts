// What needs a person, read from their machine through their space's tunnel
// and drawn beside their conversation with their Operator: both ends in one
// process.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Comp, mint } from '@yaks/graph'
import { parseHTML } from 'linkedom'
import { Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { mcpConnect } from './connected-mcp.ts'
import { machineOf } from './machine-testing.ts'
import { answered, asksList, asksOf, type Listed } from './operator-asks.ts'
import { operatorContext } from './operator.ts'

let { box, env, dir, space, ada, bob, person } = await machineOf(
  'operator-asks',
  ['task_list', 'decision_answer'],
)
let decision = mint()
let numbered = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    entity: { eid: mint() },
    task: {},
    doc: { title: `Ask ${String(i).padStart(2, '0')}`, body: '1. Do it.' },
  }))
await box.graph.apply([
  {
    entity: { eid: decision },
    task: {},
    doc: { title: 'Which day?' },
    decision: {
      question: 'Which day does it ship?',
      choices: [
        { label: 'Friday', description: 'This week.' },
        { label: 'Monday', description: 'After the weekend.' },
      ],
      recommended: 'Monday',
    },
  },
  ...numbered(12),
], { trusted: true })

let connect = async (asks?: unknown) =>
  await mcpConnect.run(
    await operatorContext(env, { person: ada }, space, () => dir),
    { name: 'box', url: '/mcp', machine: 'adas', ...asks ? { asks } : {} },
  )

// The list drawn, as the person reads it: each row's lines and buttons, and
// how many it counts.
let drawn = (listed: Listed) => {
  let list = asksList(listed, '/a', '/manage/here')
  let { document } = parseHTML(
    `<div>${renderToString(h(Fragment, null, list.node))}</div>`,
  )
  return {
    count: list.count,
    back: document.querySelector('[name=back]')?.getAttribute('value'),
    rows: [...document.querySelectorAll('.Asks_Item')].map((r) =>
      [...r.querySelectorAll('.Rows_Name, .Rows_Meta, button')].map((e) =>
        e.textContent
      )
    ),
    text: document.querySelector('div')!.textContent ?? '',
  }
}

test('a person who named no list is shown none', async () => {
  await connect()
  assertEquals(await asksOf(env, ada, space.eid), null)
})

test('the list is what the server answers, in its order, the first ten shown and the rest behind one line', async () => {
  await connect({
    tool: 'task_list',
    query: '.task.status=open&.order=doc.title',
  })
  let listed = (await asksOf(env, ada, space.eid))!
  assertEquals(listed.off, undefined)
  assertEquals(listed.asks.map((a) => a.title), [
    ...Array.from(
      { length: 12 },
      (_, i) => `Ask ${String(i).padStart(2, '0')}`,
    ),
    'Which day?',
  ])
  let { rows, text, count, back } = drawn(listed)
  assertEquals(rows[0], ['Ask 00', 'Do it.', 'Reply'])
  assertEquals([rows.length, count], [13, 13])
  // A choice comes back to the page it was pressed on.
  assertEquals(back, '/manage/here')
  assertEquals(text.includes('3 more'), true)
  assertEquals(rows.at(-1), [
    'Which day?',
    'Which day does it ship?',
    'Monday',
    'Friday',
    'Reply',
  ])
})

test('a choice pressed beside a decision is the person’s own answer on their machine', async () => {
  let { server } = (await asksOf(env, ada, space.eid))!
  await answered(env, ada, space.eid, server, decision, 'Friday')
  let [it] = await box.graph.get([decision], ['decided'])
  let { choice, by, via } = it.decided as Comp
  assertEquals([choice, by, via], ['Friday', person, box.me])
})

test('a person who does not own the machine’s space reaches nothing, and a machine that is off is said to be', async () => {
  let { server } = (await asksOf(env, ada, space.eid))!
  await assertRejects(() =>
    answered(env, bob, space.eid, server, decision, 'Monday')
  )
  let off = { ...env, DISPATCH: undefined } as typeof env
  let listed = (await asksOf(off, ada, space.eid))!
  assertEquals(listed.asks, [])
  assertEquals(typeof listed.off, 'string')
  let shown = drawn(listed)
  assertEquals(shown.text.includes('Your machine is off'), true)
  assertEquals(shown.count, 0)
})

test('another space’s Operator page lists nothing of the machine', async () => {
  assertEquals(await asksOf(env, ada, mint()), null)
})

test('an empty tool takes the list away', async () => {
  await connect({ tool: '' })
  assertEquals(await asksOf(env, ada, space.eid), null)
})
