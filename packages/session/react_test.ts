// The daemon's step over a fake model, on @yaks/ram: an input is asked, a tool
// call is run, the transcript settles; a stop is obeyed; a fork continues from
// its anchor with `previous_response_id` and only what followed; errors retry
// to the bound and then stop.

import { assertEquals } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { sessionDoc } from './comp.ts'
import { nativeDoc } from './native.ts'
import { kindOf, statusOf } from './status.ts'
import { native } from './plugin.ts'
import {
  ModelError,
  type ModelReply,
  type ModelRequest,
  react,
  settle,
  transcript,
} from './react.ts'

let vocab = loadVocab([sessionDoc, nativeDoc])

let ids = { s: 'sess', m: 'model', p: 'prov', t: 'tool', f: 'fork' }

// A scripted model: each call pops the next reply; the requests are kept for
// the assertions about what travelled.
let scripted = (replies: ModelReply[]) => {
  let asked: ModelRequest[] = []
  let model = (req: ModelRequest) => {
    asked.push(req)
    let next = replies.shift()
    if (!next) throw new ModelError('exhausted', 'no more replies')
    return Promise.resolve(next)
  }
  return { model, asked }
}

let echo = {
  name: 'echo',
  description: 'say it back',
  parameters: { type: 'object', properties: { text: { type: 'string' } } },
  run: (args: Record<string, unknown>) => `echo: ${String(args.text)}`,
}

let n = 0
let mint = () => `x${++n}`

let world = (): Graph => {
  let g = graph({ storage: ram(vocab), vocab, plugins: [native()] })
  g.apply([
    { entity: { eid: ids.p }, provider: { name: 'fake' } },
    { entity: { eid: ids.m }, model: { name: 'fake-1', provider: ids.p } },
    {
      entity: { eid: ids.t },
      tool: { name: 'echo', description: 'say it back' },
    },
    { entity: { eid: ids.s }, session: { id: 'one' }, transcript: {} },
    {
      entity: { eid: 'e1' },
      entry: { session: ids.s, seq: 1, text: 'echo hi, then say done' },
      input: {},
      using: { provider: ids.p, model: ids.m, effort: 'low' },
    },
  ])
  return g
}

let kinds = async (g: Graph, s: string) =>
  (await transcript(g, s)).map((b) => kindOf(b))

Deno.test('an input is asked, a tool call is run, the transcript settles', async () => {
  let g = world()
  let { model, asked } = scripted([
    {
      id: 'r1',
      model: 'fake-1',
      items: [
        {
          type: 'function_call',
          id: 'c1',
          name: 'echo',
          arguments: '{"text":"hi"}',
        },
      ],
    },
    { id: 'r2', model: 'fake-1', items: [{ type: 'message', text: 'done' }] },
  ])
  let deps = { model, tools: [echo], mint, anchors: true }
  let status = await settle(g, ids.s, deps)
  assertEquals(status, 'settled')
  assertEquals(await kinds(g, ids.s), [
    'input',
    'call',
    'call',
    'result',
    'call',
    'output',
  ])
  // the first call replayed the whole transcript; the second anchored on r1
  assertEquals(asked[0].previous_response_id, undefined)
  assertEquals(asked[0].model, 'fake-1')
  assertEquals(asked[0].effort, 'low')
  assertEquals(asked[1].previous_response_id, 'r1')
  assertEquals(asked[1].input, [{
    type: 'function_call_output',
    call_id: 'c1',
    output: 'echo: hi',
  }])
})

Deno.test('a stop is obeyed: nothing is asked or run after it', async () => {
  let g = world()
  let { model, asked } = scripted([
    {
      id: 'r1',
      model: 'fake-1',
      items: [
        {
          type: 'function_call',
          id: 'c1',
          name: 'echo',
          arguments: '{"text":"hi"}',
        },
      ],
    },
  ])
  let deps = { model, tools: [echo], mint, anchors: true }
  await react(g, ids.s, deps) // asked: the tool call is now open
  g.apply([{
    entity: { eid: 'stop1' },
    entry: { session: ids.s, seq: 99, text: '' },
    stop: {},
  }])
  let step = await react(g, ids.s, deps)
  assertEquals([step.did, step.status], ['nothing', 'stopped'])
  assertEquals(asked.length, 1)
})

Deno.test('a fork continues from its anchor with only what followed', async () => {
  let g = world()
  let { model, asked } = scripted([
    { id: 'r1', model: 'fake-1', items: [{ type: 'message', text: 'done' }] },
    { id: 'r2', model: 'fake-1', items: [{ type: 'message', text: 'again' }] },
  ])
  let deps = { model, tools: [echo], mint, anchors: true }
  await settle(g, ids.s, deps)
  let entries = await transcript(g, ids.s)
  let call = entries.find((b) => kindOf(b) == 'call')!
  g.apply([
    {
      entity: { eid: ids.f },
      session: { id: 'two' },
      transcript: {},
      fork: { from: call.entity.eid },
    },
    {
      entity: { eid: 'f1' },
      entry: { session: ids.f, seq: 3, text: 'and once more' },
      input: {},
    },
  ])
  // the fork's transcript is the parent's prefix through the anchor, then its own
  assertEquals(await kinds(g, ids.f), ['input', 'call', 'input'])
  assertEquals(await settle(g, ids.f, deps), 'settled')
  assertEquals(asked[1].previous_response_id, 'r1')
  assertEquals(asked[1].input, [{
    role: 'user',
    content: [{ type: 'input_text', text: 'and once more' }],
  }])
  // the parent is untouched
  assertEquals(statusOf(await transcript(g, ids.s)), 'settled')
})

Deno.test('errors retry to the bound, then the transcript is failed', async () => {
  let g = world()
  let { model, asked } = scripted([])
  let deps = { model, tools: [echo], mint, anchors: true }
  assertEquals(await settle(g, ids.s, deps), 'failed')
  assertEquals(asked.length, 3)
  assertEquals(await kinds(g, ids.s), ['input', 'error', 'error', 'error'])
})

Deno.test('a fork must name an entry, a using a model', () => {
  let g = world()
  let bad = (b: Bundle) => {
    try {
      g.apply([b])
      return false
    } catch {
      return true
    }
  }
  assertEquals(
    bad({ entity: { eid: 'z' }, session: { id: 'z' }, fork: { from: ids.m } }),
    true,
  )
  assertEquals(
    bad({
      entity: { eid: 'z2' },
      entry: { session: ids.s, seq: 5 },
      input: {},
      using: { model: ids.t },
    }),
    true,
  )
  assertEquals(
    bad({
      entity: { eid: 'z3' },
      entry: { session: ids.s, seq: 5 },
      input: {},
      using: { model: ids.m },
    }),
    false,
  )
})
