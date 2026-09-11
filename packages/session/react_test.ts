import type { Comp } from '@yaks/graph'
// The daemon's step over a fake model, on @yaks/ram: an input is asked, a tool
// call is run, the transcript settles; a stop is obeyed; a fork continues from
// its anchor with only what followed; errors retry to the bound and then stop;
// and the same steps run themselves as a `created(entry)` effect.

import { assertEquals } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
import { graph } from '@yaks/graph'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'
import {
  type Model,
  modelDoc,
  ModelError,
  type Reply,
  type Request,
} from '@yaks/model'
import { sessionDoc } from './comp.ts'
import { kindOf, statusOf } from './status.ts'
import { sessions } from './plugin.ts'
import { react, settle, transcript } from './react.ts'
import { daemon } from './daemon.ts'
import { took } from './timing.ts'

// What the fake provider keeps about an ask: its own comp, the way @yaks/openai
// keeps `openai{response_id}`.
let fakeDoc: VocabDoc = {
  $defs: {
    fake: { type: 'object', properties: { reply: { type: 'string' } } },
  },
}
let vocab = loadVocab([sessionDoc, modelDoc, fakeDoc])

let ids = { s: 'sess', m: 'model', p: 'prov', t: 'tool', f: 'fork' }

// A scripted model: each ask pops the next reply; the requests are kept for the
// assertions about what travelled. `kept` makes it a provider that keeps
// replies, so an ask can anchor on the newest one.
let scripted = (replies: Reply[], kept = true) => {
  let asked: Request[] = []
  let model: Model = (req: Request) => {
    asked.push(req)
    let next = replies.shift()
    if (!next) throw new ModelError('exhausted', 'no more replies')
    return Promise.resolve(next)
  }
  if (kept) {
    model.mark = (reply) => ({ fake: { reply: reply.id } })
    model.anchor = (comps) => {
      let id = (comps.fake as Record<string, unknown> | undefined)?.reply
      return id == null ? undefined : String(id)
    }
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

let seed = (g: Graph) =>
  g.apply([
    { entity: { eid: ids.p }, provider: { name: 'fake' } },
    { entity: { eid: ids.m }, model: { name: 'fake-1', provider: ids.p } },
    {
      entity: { eid: ids.t },
      tool: { name: 'echo', description: 'say it back' },
    },
    { entity: { eid: ids.s }, session: { id: 'one' } },
    {
      entity: { eid: 'e1' },
      entry: { session: ids.s, seq: 1 },
      content: { body: 'echo hi, then say done' },
      using: { provider: ids.p, model: ids.m, effort: 'low' },
    },
  ])

let world = (): Graph => {
  let g = graph({ storage: ram(vocab), vocab, plugins: [sessions()] })
  seed(g)
  return g
}

let kinds = async (g: Graph, s: string) =>
  (await transcript(g, s)).map((b) => kindOf(b))

let calls = (...calls: [string, string][]): Reply => ({
  id: 'r1',
  model: 'fake-1',
  items: calls.map(([id, text]) => ({
    kind: 'call',
    id,
    name: 'echo',
    args: JSON.stringify({ text }),
  })),
})
let says = (id: string, text: string): Reply => ({
  id,
  model: 'fake-1',
  items: [{ kind: 'assistant', text }],
})

Deno.test('an input is asked, a tool call is run, the transcript settles', async () => {
  let g = world()
  let { model, asked } = scripted([calls(['c1', 'hi']), says('r2', 'done')])
  let deps = { model, tools: [echo], mint }
  let status = await settle(g, ids.s, deps)
  assertEquals(status, 'settled')
  let entries = await transcript(g, ids.s)
  assertEquals(entries.map(kindOf), [
    'input',
    'ask',
    'call',
    'result',
    'ask',
    'output',
  ])
  // the ask carries the provider's own comp; the output names its ask
  let [, ask, call, , , output] = entries
  assertEquals(ask.fake, { reply: 'r1' })
  assertEquals((call.call as Record<string, unknown>).source, ask.entity.eid)
  assertEquals(output.content, { body: 'done', source: entries[4].entity.eid })
  // the first ask replayed the whole transcript; the second anchored on r1
  assertEquals(asked[0].anchor, undefined)
  assertEquals(asked[0].model, 'fake-1')
  assertEquals(asked[0].effort, 'low')
  assertEquals(asked[1].anchor, 'r1')
  assertEquals(asked[1].items, [{
    kind: 'result',
    id: 'c1',
    output: took('echo: hi', Number((entries[3].result as Comp).ms)),
  }])
})

Deno.test('a stop is obeyed: nothing is asked or run after it', async () => {
  let g = world()
  let { model, asked } = scripted([calls(['c1', 'hi'])])
  let deps = { model, tools: [echo], mint }
  await react(g, ids.s, deps) // asked: the tool call is now open
  g.apply([{
    entity: { eid: 'stop1' },
    entry: { session: ids.s, seq: 99 },
    stop: {},
  }])
  let step = await react(g, ids.s, deps)
  assertEquals([step.did, step.status], ['nothing', 'stopped'])
  assertEquals(asked.length, 1)
})

Deno.test('a fork continues from its anchor with only what followed', async () => {
  let g = world()
  let { model, asked } = scripted([says('r1', 'done'), says('r2', 'again')])
  let deps = { model, tools: [echo], mint }
  await settle(g, ids.s, deps)
  let entries = await transcript(g, ids.s)
  let ask = entries.find((b) => kindOf(b) == 'ask')!
  g.apply([
    {
      entity: { eid: ids.f },
      session: { id: 'two' },
      fork: { from: ask.entity.eid },
    },
    {
      entity: { eid: 'f1' },
      entry: { session: ids.f, seq: 3 },
      content: { body: 'and once more' },
    },
  ])
  // the fork's transcript is the parent's prefix through the anchor, then its own
  assertEquals(await kinds(g, ids.f), ['input', 'ask', 'input'])
  assertEquals(await settle(g, ids.f, deps), 'settled')
  assertEquals(asked[1].anchor, 'r1')
  assertEquals(asked[1].items, [{ kind: 'user', text: 'and once more' }])
  // the parent is untouched
  assertEquals(statusOf(await transcript(g, ids.s)), 'settled')
})

Deno.test('a provider that keeps nothing replays the whole transcript', async () => {
  let g = world()
  let { model, asked } = scripted(
    [calls(['c1', 'hi']), says('r2', 'done')],
    false,
  )
  await settle(g, ids.s, { model, tools: [echo], mint })
  assertEquals(asked[1].anchor, undefined)
  assertEquals(asked[1].items.map((i) => i.kind), ['user', 'call', 'result'])
  let ask = (await transcript(g, ids.s)).find((b) => kindOf(b) == 'ask')!
  assertEquals(ask.fake, undefined)
})

Deno.test('errors retry to the bound, then the transcript is failed', async () => {
  let g = world()
  let { model, asked } = scripted([])
  let deps = { model, tools: [echo], mint }
  assertEquals(await settle(g, ids.s, deps), 'failed')
  assertEquals(asked.length, 3)
  assertEquals(await kinds(g, ids.s), ['input', 'error', 'error', 'error'])
})

Deno.test('two tool calls in one reply are both answered before the next ask', async () => {
  let g = world()
  let { model, asked } = scripted([
    calls(['c1', 'a'], ['c2', 'b']),
    says('r2', 'done'),
  ])
  assertEquals(
    await settle(g, ids.s, { model, tools: [echo], mint }),
    'settled',
  )
  assertEquals(
    asked[1].items.filter((i) => i.kind == 'result').map((i) => i.id),
    ['c1', 'c2'],
  )
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
      content: { body: 'x' },
      using: { model: ids.t },
    }),
    true,
  )
  assertEquals(
    bad({
      entity: { eid: 'z3' },
      entry: { session: ids.s, seq: 5 },
      content: { body: 'x' },
      using: { model: ids.m },
    }),
    false,
  )
})

Deno.test('as an effect, the steps run themselves until the transcript settles', async () => {
  let fx = effects(vocab)
  let g = graph({ storage: ram(vocab), vocab, plugins: [sessions(), fx] })
  let { model, asked } = scripted([calls(['c1', 'hi']), says('r2', 'done')])
  let steps: string[] = []
  let d = daemon(
    g,
    fx,
    { model, tools: [echo], mint },
    (s) => steps.push(s.did),
  )
  seed(g) // the input entry wakes the first step
  await d.idle(ids.s)
  assertEquals(statusOf(await transcript(g, ids.s)), 'settled')
  assertEquals(asked.length, 2)
  assertEquals(steps.filter((s) => s != 'nothing'), ['asked', 'ran', 'asked'])
})

Deno.test('usage is persisted once on its ask, not on output entries', async () => {
  let g = world()
  let usage = {
    input_tokens: 1000,
    cached_tokens: 800,
    output_tokens: 20,
    total_tokens: 1020,
  }
  let { model } = scripted([{ ...says('r1', 'done'), usage }])
  await settle(g, ids.s, { model, tools: [echo], mint })
  let entries = await transcript(g, ids.s)
  assertEquals(entries.filter((b) => b.usage).length, 1)
  assertEquals(entries[1].usage, usage)
  assertEquals(kindOf(entries[1]), 'ask')
})

Deno.test('unexpected model failures reach diagnostics, expected model errors do not', async () => {
  let reported: unknown[] = []
  for (
    let error of [
      new Error('defect', { cause: new Error('root') }),
      new ModelError('busy', 'retry'),
    ]
  ) {
    let g = world()
    await react(g, ids.s, {
      model: () => Promise.reject(error),
      tools: [],
      mint,
      report: (e, session, phase) => {
        assertEquals(session, ids.s)
        assertEquals(phase, 'model')
        reported.push(e)
      },
    })
  }
  assertEquals(reported.length, 1)
  assertEquals((reported[0] as Error).message, 'defect')
})

Deno.test('provider completion allocates positions after concurrently admitted notices', async () => {
  let g = world()
  let release!: (reply: Reply) => void
  let entered!: () => void
  let started = new Promise<void>((r) => entered = r)
  let pending = react(g, ids.s, {
    tools: [],
    model: () => {
      entered()
      return new Promise<Reply>((r) => release = r)
    },
  })
  await started
  await g.apply([{
    entity: { eid: 'during' },
    entry: { session: ids.s },
    notice: {},
    content: { body: 'followup' },
  }])
  release({
    id: 'response',
    model: 'fake-1',
    items: [{ kind: 'assistant', text: 'done' }],
  })
  await pending
  let all = await transcript(g, ids.s)
  assertEquals(all.map((b) => (b.entry as Comp).seq), [1, 2, 3, 4])
  assertEquals(all[1].entity.eid, 'during')
  assertEquals((all[2].ask as Comp).through, 'e1')
})

Deno.test('an unanswered older call fails without replay or provider dispatch', async () => {
  let g = world()
  let { model, asked } = scripted([calls(['old-call', 'hi'])])
  let runs = 0
  let deps = {
    model,
    tools: [{
      ...echo,
      run: () => {
        runs++
        return 'ok'
      },
    }],
  }
  await react(g, ids.s, deps)
  await g.apply([
    {
      entity: { eid: 'new-ask' },
      entry: { session: ids.s },
      ask: { to: ids.m, through: 'e1' },
    },
    {
      entity: { eid: 'new-input' },
      entry: { session: ids.s },
      content: { body: 'continue' },
    },
  ])
  let step = await react(g, ids.s, deps)
  assertEquals(step.status, 'failed')
  assertEquals(step.added.some((b) => !!b.exception), true)
  assertEquals(runs, 0)
  assertEquals(asked.length, 1)
  let orphan = (await transcript(g, ids.s)).find((b) => b.call)!
  await g.apply([
    {
      entity: { eid: 'repaired-result' },
      entry: { session: ids.s },
      result: { call: orphan.entity.eid },
      content: { body: 'Verified not executed; skipped superseded call.' },
    },
  ])
  let recovery = scripted(
    [{ id: 'recovered', model: 'fake-1', items: [] }],
    false,
  )
  let resumed = await react(g, ids.s, { ...deps, model: recovery.model })
  assertEquals(resumed.did, 'asked')
  assertEquals(recovery.asked.length, 1)
  assertEquals(runs, 0)
})
