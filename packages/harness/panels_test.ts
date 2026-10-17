import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type ComponentChild, h } from 'preact'
import type { Bundle } from '@yaks/graph'
import { print } from '@yaks/tui/print'
import { dress } from './sheet.ts'
import { type Context, panels, SessionLabel, type UIAgent } from './panels.ts'

let panel = panels.find((p) => p.title == 'Context usage')!
let row = (
  eid: string,
  seq: number,
  usage?: Record<string, number>,
): Bundle => ({
  entity: { eid },
  entry: { session: 's', seq },
  ask: { to: 'model' },
  ...(usage ? { usage } : {}),
})
let context = (
  transcript: UIAgent['transcript'],
  session?: string,
): Context => ({
  agent: { transcript } as UIAgent,
  session,
  sessions: [],
})
// What a tree shows, painted once in the harness's dress, colors aside.
let shown = (node: ComponentChild) =>
  // deno-lint-ignore no-control-regex -- the painter's words, not its colors
  print(node, 70, dress).replace(/\x1b\[[0-9;]*m/g, '')
let text = (rows: Bundle[]) =>
  shown(h(panel.Render, { ...context(() => Promise.resolve(rows), 's'), rows }))

test('context panel reads only the selected transcript, including its inherited prefix', async () => {
  let calls: string[] = []
  let rows = [row('parent-ask', 90, { input_tokens: 12 })]
  let read = (session: string) => {
    calls.push(session)
    return Promise.resolve(rows)
  }
  assertEquals(await panel.read(context(read)), [])
  assertEquals(calls, [])
  assertEquals(await panel.read(context(read, 'child')), rows)
  assertEquals(calls, ['child'])
  assert((text(rows)).includes('Input context: 12 tokens'))
})

test('context panel uses latest reported ask in transcript order, not totals or sequence order', () => {
  let rendered = text([
    row('inherited', 90, {
      input_tokens: 900,
      output_tokens: 70,
      cached_tokens: 80,
    }),
    row('latest', 2, {
      input_tokens: 25,
      output_tokens: 3,
      total_tokens: 28,
      cached_tokens: 0,
    }),
    row('pending', 3),
    {
      entity: { eid: 'response' },
      content: { body: 'hello' },
      usage: { input_tokens: 999 },
    },
  ])
  assert(!rendered.includes('Last reported request'))
  assert(rendered.includes('Input context: 25 tokens'))
  assert(rendered.includes('Output: 3 tokens'))
  assert(rendered.includes('Cached: 0 tokens'))
  assert(!rendered.includes('900'))
  assert(!rendered.includes('999'))
})

test('context panel handles unavailable and optional usage without carrying old counts forward', () => {
  for (let rows of [[], [row('pending', 1)]]) {
    let rendered = text(rows)
    assert(rendered.includes('Input context: unavailable'))
    assert(!rendered.includes('Output:'))
    assert(!rendered.includes('Cached:'))
  }
  let rendered = text([
    row('old', 1, { input_tokens: 55, output_tokens: 7, cached_tokens: 5 }),
    row('new', 2, { input_tokens: 0 }),
  ])
  assert(rendered.includes('Input context: 0 tokens'))
  assert(!rendered.includes('Output:'))
  assert(!rendered.includes('Cached:'))
  assert(
    (text([row('partial', 1, { output_tokens: 4 })])).includes(
      'Input context: unavailable',
    ),
  )
})

test('sidebar labels keep names and indicators without redundant status text', () => {
  let child = 'abcdef01-2345-4789-abcd-0123456789ab'
  let sessions: Bundle[] = [
    { entity: { eid: child }, session: { id: child, status: 'settled' } },
    {
      entity: { eid: 'root-id' },
      session: { id: 'Meaningful name', status: 'running' },
    },
  ]
  let ui = shown(
    h(
      'div',
      null,
      ...sessions.map((b) => h('div', null, h(SessionLabel, { b }))),
    ),
  )
  assert(ui.includes('abcdef01'), ui)
  assert(!ui.includes('child:'), ui)
  assert(!/\b(settled|running|wip)\b/.test(ui), ui)
  assert(ui.includes('● abcdef01'), ui)
  assert(ui.includes('Meaningful name'), ui)
})

test('context panel compacts displayed counts without changing usage', () => {
  const usage = {
    input_tokens: 273000,
    output_tokens: 1200,
    cached_tokens: 999999,
    total_tokens: 274200,
    reasoning_tokens: 1000,
  }
  const before = JSON.stringify(usage)
  const rendered = text([row('large', 1, usage)])
  assert(rendered.includes('Input context: 273k tokens'))
  assert(rendered.includes('Output: 1.2k tokens'))
  assert(rendered.includes('Cached: 1m tokens'))
  assert(!rendered.includes('Last reported request'))
  assertEquals(JSON.stringify(usage), before)
})
