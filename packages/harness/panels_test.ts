import { assert, assertEquals } from '@std/assert'
import { h } from 'preact'
import type { Bundle } from '@yaks/graph'
import { mount } from '../tui/harness.ts'
import { type Context, panels, type UIAgent } from './panels.ts'

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
let text = async (rows: Bundle[]) => {
  let ctx = context(() => Promise.resolve(rows), 's')
  let ui = await mount(() => h(panel.Render, { ...ctx, rows }), 70, 10)
  try {
    return ui.text()
  } finally {
    ui.free()
  }
}

Deno.test('context panel reads only the selected transcript, including its inherited prefix', async () => {
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
  assert((await text(rows)).includes('Input context: 12 tokens'))
})

Deno.test('context panel uses latest reported ask in transcript order, not totals or sequence order', async () => {
  let rendered = await text([
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
  assert(rendered.includes('Last reported request (not a live estimate)'))
  assert(rendered.includes('Input context: 25 tokens'))
  assert(rendered.includes('Output: 3 tokens'))
  assert(rendered.includes('Cached: 0 tokens'))
  assert(!rendered.includes('900'))
  assert(!rendered.includes('999'))
})

Deno.test('context panel handles unavailable and optional usage without carrying old counts forward', async () => {
  for (let rows of [[], [row('pending', 1)]]) {
    let rendered = await text(rows)
    assert(rendered.includes('Input context: unavailable'))
    assert(!rendered.includes('Output:'))
    assert(!rendered.includes('Cached:'))
  }
  let rendered = await text([
    row('old', 1, { input_tokens: 55, output_tokens: 7, cached_tokens: 5 }),
    row('new', 2, { input_tokens: 0 }),
  ])
  assert(rendered.includes('Input context: 0 tokens'))
  assert(!rendered.includes('Output:'))
  assert(!rendered.includes('Cached:'))
  assert(
    (await text([row('partial', 1, { output_tokens: 4 })])).includes(
      'Input context: unavailable',
    ),
  )
})

Deno.test('sidebar labels keep names and indicators without redundant status text', async () => {
  let child = 'child:abcdef01-2345-6789-abcd-0123456789ab'
  let sessions: Bundle[] = [
    { entity: { eid: child }, session: { id: child, status: 'settled' } },
    {
      entity: { eid: 'root-id' },
      session: { id: 'Meaningful name', status: 'running' },
    },
  ]
  for (let title of ['Sessions', 'Tasks']) {
    let p = panels.find((p) => p.title == title)!
    let rows = title == 'Tasks'
      ? [{
        entity: { eid: 'task', num: 42 },
        task: { status: 'wip' },
        claim: { session: child },
        doc: { title: 'Fix labels' },
      }]
      : sessions
    let ui = await mount(
      () =>
        h(p.Render, {
          ...context(() => Promise.resolve([]), child),
          rows,
          sessions,
        }),
      80,
      10,
    )
    try {
      let shown = ui.text()
      assert(shown.includes('abcdef01'), shown)
      assert(!shown.includes('child:'), shown)
      assert(!/\b(settled|running|wip)\b/.test(shown), shown)
      if (title == 'Tasks') {
        assert(shown.includes('◐ 42 Fix labels [abcdef01]'), shown)
      } else {
        assert(shown.includes('● abcdef01'), shown)
        assert(shown.includes('Meaningful name'), shown)
        if (title == 'Sessions') assert(shown.includes('>   ● abcdef01'), shown)
      }
    } finally {
      ui.free()
    }
  }
})
