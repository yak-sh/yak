import { test } from '@yaks/testing'
import type { Comp } from '@yaks/graph'
// The runner's step over a fake model, on @yaks/ram: an input is asked, a tool
// call is run, the transcript settles; a stop is obeyed; a fork continues from
// its anchor with only what followed; failed provider asks stop;
// and the same steps run themselves as `session_run`.

import { assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { graph, identityEid } from '@yaks/graph'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { effects } from '@yaks/effects'
import {
  type Item,
  type Model,
  modelDoc,
  ModelError,
  type Reply,
  type Request,
} from '@yaks/model'
import { toolsDoc } from '@yaks/tools/vocab'
import { toolEid } from '@yaks/tools'
import { sessionDoc } from './comp.ts'
import { contextDoc } from '@yaks/context'
import { taskDoc } from '@yaks/task/vocab'
import { docDoc } from '@yaks/doc/vocab'
import { kindOf, statusOf, textOf } from './status.ts'
import { appendEntry } from './append.ts'
import { sessions } from './plugin.ts'
import { type Deps, react, recent, transcript } from './react.ts'
import { running, settle } from './run.ts'
import { took } from './timing.ts'
import { GAP } from './compact.ts'

// What the fake provider keeps about an ask: its own comp, the way @yaks/openai
// keeps `openai{response_id}`.
let fakeDoc: VocabDoc = {
  $defs: {
    fake: {
      component: true,
      type: 'object',
      properties: { reply: { type: 'string' } },
    },
  },
}
let vocab = loadVocab([
  sessionDoc,
  toolsDoc,
  modelDoc,
  fakeDoc,
  contextDoc,
  taskDoc,
  docDoc,
])

let ids = {
  s: 'sess',
  m: identityEid('model', ['fake-1']),
  p: identityEid('provider', ['fake']),
  t: toolEid('echo'),
  f: 'fork',
}

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
    { entity: { eid: ids.m }, model: { name: 'fake-1' } },
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

// The fake model's context window, in tokens, on its row.
let windowed = (g: Graph, context: number) =>
  g.apply([{ entity: { eid: ids.m }, model: { context } }])

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

// Run the transcript to rest and answer its status: what the runner leaves it
// at, read back off its entries.
let rest = async (g: Graph, s: string, deps: Deps) => {
  await settle(g, s, { ...deps, holder: 'runner' })
  return statusOf(await transcript(g, s))
}

test('an input is asked, a tool call is run, the transcript settles', async () => {
  let g = world()
  let { model, asked } = scripted([calls(['c1', 'hi']), says('r2', 'done')])
  let deps = { model, tools: [echo], mint }
  let status = await rest(g, ids.s, deps)
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
  assertEquals(output.content, { body: 'done' })
  assertEquals(output.output, { source: entries[4].entity.eid })
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

test('a turn whose using names tools is offered those alone, the runner’s by name too', async () => {
  let g = world()
  let shout = {
    ...echo,
    name: 'shout',
    run: (args: Record<string, unknown>) => String(args.text).toUpperCase(),
  }
  await g.apply([
    { entity: { eid: toolEid('shout') }, tool: { name: 'shout' } },
    { entity: { eid: 'e1' }, using: { tools: ['shout', 'nothing'] } },
  ])
  let { model, asked } = scripted([{
    id: 'r1',
    model: 'fake-1',
    items: [{ kind: 'call', id: 'c1', name: 'shout', args: '{"text":"hi"}' }],
  }, says('r2', 'done')])
  let deps = { model, tools: [echo], named: () => [shout], mint }
  assertEquals(await rest(g, ids.s, deps), 'settled')
  assertEquals(asked.map((a) => a.tools?.map((t) => t.name)), [
    ['shout'],
    ['shout'],
  ])
  assertEquals(textOf((await transcript(g, ids.s))[3]), 'HI')
})

test('an anchored ask can include a late result from an earlier call', async () => {
  let g = world()
  await g.apply([{
    entity: { eid: 'old-ask' },
    entry: { session: ids.s },
    ask: { to: ids.m, through: 'e1' },
    fake: { reply: 'old' },
  }, {
    entity: { eid: 'old-call' },
    entry: { session: ids.s },
    call: { to: ids.t, id: 'c1', args: { text: 'hi' }, source: 'old-ask' },
  }, {
    entity: { eid: 'anchor' },
    entry: { session: ids.s },
    ask: { to: ids.m, through: 'old-call' },
    using: { provider: ids.p, model: ids.m },
    fake: { reply: 'anchor' },
  }, {
    entity: { eid: 'late-result' },
    entry: { session: ids.s },
    result: { call: 'old-call' },
    content: { body: 'echo: hi' },
  }, {
    entity: { eid: 'follow-up' },
    entry: { session: ids.s },
    content: { body: 'Continue.' },
  }], { trusted: true })
  let { model, asked } = scripted([says('done', 'Done.')])
  assertEquals(await rest(g, ids.s, { model, tools: [echo] }), 'settled')
  assertEquals(asked[0].anchor, 'anchor')
  assertEquals(asked[0].items, [
    { kind: 'result', id: 'c1', output: 'echo: hi' },
    { kind: 'user', text: 'Continue.' },
  ])
})

test('an interrupted tool call gets a result and the model continues without replay', async () => {
  let g = world()
  await g.apply([{
    entity: { eid: 'old-ask' },
    entry: { session: ids.s },
    ask: { to: ids.m, through: 'e1' },
  }, {
    entity: { eid: 'old-call' },
    entry: { session: ids.s },
    call: { to: ids.t, id: 'tool-1', args: { text: 'hi' }, source: 'old-ask' },
    execution: { state: 'running' },
  }], { trusted: true })
  let runs = 0
  let { model, asked } = scripted([says('next', 'done')])
  let status = await rest(g, ids.s, {
    model,
    tools: [{
      ...echo,
      run: () => {
        runs++
        return 'repeated'
      },
    }],
    mint,
  })
  let entries = await transcript(g, ids.s)
  assertEquals(status, 'settled')
  assertEquals(runs, 0)
  assertEquals(entries.filter((b) => b.result).length, 1)
  assertEquals(
    (entries.find((b) => b.entity.eid == 'old-call')!.execution as Comp).state,
    'failed',
  )
  assertEquals(asked.length, 1)
  assertEquals(
    asked[0].items.some((i) =>
      i.kind == 'result' && i.output.includes('may have completed')
    ),
    true,
  )
})

test('a legacy unfinished-call exception recovers without replay', async () => {
  let g = world()
  await g.apply([{
    entity: { eid: 'old-ask' },
    entry: { session: ids.s },
    ask: { to: ids.m, through: 'e1' },
  }, {
    entity: { eid: 'old-call' },
    entry: { session: ids.s },
    call: { to: ids.t, id: 'tool-1', args: { text: 'hi' }, source: 'old-ask' },
    execution: { state: 'running' },
  }, {
    entity: { eid: 'old-exception' },
    entry: { session: ids.s },
    content: {
      body: 'Unfinished tool execution; inspect before retrying: old-call',
    },
    exception: {},
  }], { trusted: true })
  let runs = 0
  let recovers = 0
  let { model, asked } = scripted([says('next', 'done')])
  let status = await rest(g, ids.s, {
    model,
    tools: [{
      ...echo,
      run: () => {
        runs++
        return 'repeated'
      },
      recover: () => {
        recovers++
        return 'Shell execution has no process receipt; inspect before retrying.'
      },
    }],
    mint,
  })
  let entries = await transcript(g, ids.s)
  assertEquals(status, 'settled')
  assertEquals({ runs, recovers }, { runs: 0, recovers: 1 })
  assertEquals(entries.filter((b) => b.result).length, 1)
  assertEquals(
    (entries.find((b) => b.entity.eid == 'old-call')!.execution as Comp).state,
    'done',
  )
  assertEquals(asked.length, 1)
  assertEquals(
    asked[0].items.some((i) =>
      i.kind == 'result' && i.output.includes('no process receipt')
    ),
    true,
  )
})

test('a stop is obeyed: nothing is asked or run after it', async () => {
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

test('a fork continues from its anchor with only what followed', async () => {
  let g = world()
  let { model, asked } = scripted([says('r1', 'done'), says('r2', 'again')])
  let deps = { model, tools: [echo], mint }
  await rest(g, ids.s, deps)
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
  assertEquals(await rest(g, ids.f, deps), 'settled')
  assertEquals(asked[1].anchor, 'r1')
  assertEquals(asked[1].items, [{ kind: 'user', text: 'and once more' }])
  // the parent is untouched
  assertEquals(statusOf(await transcript(g, ids.s)), 'settled')
})

test('a provider that keeps nothing replays the whole transcript', async () => {
  let g = world()
  let { model, asked } = scripted(
    [calls(['c1', 'hi']), says('r2', 'done')],
    false,
  )
  await rest(g, ids.s, { model, tools: [echo], mint })
  assertEquals(asked[1].anchor, undefined)
  assertEquals(asked[1].items.map((i) => i.kind), ['user', 'call', 'result'])
  let ask = (await transcript(g, ids.s)).find((b) => kindOf(b) == 'ask')!
  assertEquals(ask.fake, undefined)
})

test('an imported compaction resumes from its summary and later entries', async () => {
  let g = world()
  await g.apply([
    {
      entity: { eid: 'old' },
      entry: { session: ids.s },
      content: { body: 'obsolete detail' },
    },
    {
      entity: { eid: 'summary' },
      entry: { session: ids.s },
      content: { body: 'The plan is to keep the bridge.' },
      checkpoint: {},
    },
    {
      entity: { eid: 'after' },
      entry: { session: ids.s },
      content: { body: 'The bridge must be blue.' },
    },
    {
      entity: { eid: 'continue' },
      entry: { session: ids.s },
      content: { body: 'What is the plan and color?' },
      using: { provider: ids.p, model: ids.m },
    },
  ])
  let { model, asked } = scripted([says('r1', 'Keep the blue bridge.')])
  assertEquals(await rest(g, ids.s, { model, tools: [] }), 'settled')
  assertEquals(asked[0].items, [
    { kind: 'instruction', text: 'The plan is to keep the bridge.' },
    { kind: 'user', text: 'The bridge must be blue.' },
    { kind: 'user', text: 'What is the plan and color?' },
  ])
})

test('a checkpoint keeps a call whose result followed an input', async () => {
  let g = world()
  await g.apply([
    {
      entity: { eid: 'old-ask' },
      entry: { session: ids.s, seq: 2 },
      ask: { to: ids.m, through: 'e1' },
    },
    {
      entity: { eid: 'old-call' },
      entry: { session: ids.s, seq: 3 },
      call: { to: ids.t, id: 'c1', args: { text: 'hi' }, source: 'old-ask' },
    },
    {
      entity: { eid: 'between' },
      entry: { session: ids.s, seq: 4 },
      content: { body: 'One more thing.' },
    },
    {
      entity: { eid: 'old-result' },
      entry: { session: ids.s, seq: 5 },
      result: { call: 'old-call' },
      content: { body: 'echo: hi' },
    },
    {
      entity: { eid: 'summary' },
      entry: { session: ids.s, seq: 6 },
      checkpoint: { through: 'old-call', seq: 3 },
      content: { body: 'The user asked to echo hi.' },
    },
  ], { trusted: true })
  let runs = 0
  let { model, asked } = scripted([says('next', 'Done.')], false)
  assertEquals(
    await rest(g, ids.s, {
      model,
      tools: [{ ...echo, run: () => String(runs++) }],
      mint,
    }),
    'settled',
  )
  assertEquals(runs, 0)
  assertEquals(asked[0].items, [
    { kind: 'instruction', text: 'The user asked to echo hi.' },
    { kind: 'call', id: 'c1', name: 'echo', args: '{"text":"hi"}' },
    { kind: 'user', text: 'One more thing.' },
    { kind: 'result', id: 'c1', output: 'echo: hi' },
  ])
})

test('a long native transcript writes a checkpoint before continuing', async () => {
  let g = world()
  await windowed(g, 20)
  await g.apply([{
    entity: { eid: 'later' },
    entry: { session: ids.s },
    content: { body: 'Remember the blue bridge.' },
  }])
  let { model, asked } = scripted([
    says('summary', 'Keep the blue bridge.'),
    says('reply', 'Remembered.'),
  ], false)
  assertEquals(
    await rest(g, ids.s, {
      model,
      tools: [],
      compactModel: { model, name: 'fake-1' },
    }),
    'settled',
  )
  let entries = await transcript(g, ids.s)
  let mark = entries.find((b) => b.checkpoint)!
  assertEquals((mark.checkpoint as Comp).through, 'later')
  assertEquals((mark.checkpoint as Comp).seq, 2)
  assertEquals(asked.length, 2)
  assertEquals(asked[1].items, [{
    kind: 'instruction',
    text: 'Keep the blue bridge.',
  }])
  await g.apply([
    { entity: { eid: 'later' }, $delete: true },
    {
      entity: { eid: 'again' },
      entry: { session: ids.s },
      content: { body: 'Say it again.' },
      using: { provider: ids.p, model: ids.m },
    },
  ])
  let resumed = scripted([says('next', 'Remembered.')], false)
  assertEquals(
    await rest(g, ids.s, {
      model: resumed.model,
      tools: [],
    }),
    'settled',
  )
  assertEquals(resumed.asked[0].items[0], {
    kind: 'instruction',
    text: 'Keep the blue bridge.',
  })
})

// A provider that counts what it was sent, about four characters a token,
// the way a provider reports `usage.input_tokens`.
let counting = (reply: (req: Request) => Reply) => {
  let asked: Request[] = []
  let model: Model = (req: Request) => {
    asked.push(req)
    let sent = JSON.stringify([req.instructions, req.tools, req.items])
    return Promise.resolve({
      ...reply(req),
      usage: { input_tokens: Math.ceil(sent.length / 4) },
    })
  }
  return { model, asked }
}

test('a transcript compacts at half its model’s window, not before', async () => {
  let g = world()
  await windowed(g, 100_000)
  let summarizer = counting(() => says('sum', 'The story so far.'))
  let deps = {
    model: counting(() => says('r', 'ok')).model,
    tools: [],
    mint,
    compactModel: { model: summarizer.model, name: 'fake-1' },
  }
  // About 40k tokens: under half the window.
  await appendEntry(g, ids.s, 'x'.repeat(160_000))
  assertEquals(await rest(g, ids.s, deps), 'settled')
  assertEquals(summarizer.asked.length, 0)
  // About 60k: over it.
  await appendEntry(g, ids.s, 'y'.repeat(80_000))
  assertEquals(await rest(g, ids.s, deps), 'settled')
  assertEquals(summarizer.asked.length, 1)
})

test('a transcript of huge tool results is not compacted again on the next steps', async () => {
  let g = world()
  let window = 40_000
  await windowed(g, window)
  await g.apply([{
    entity: { eid: toolEid('dump') },
    tool: { name: 'dump', description: 'a lot' },
  }])
  let dump = {
    name: 'dump',
    description: 'a lot',
    parameters: { type: 'object', properties: {} },
    run: () => 'z'.repeat(28_000),
  }
  let n = 0
  let worker = counting(() =>
    ++n > 16 ? says('done', 'done') : {
      id: `r${n}`,
      model: 'fake-1',
      items: [{ kind: 'call', id: `c${n}`, name: 'dump', args: '{}' }],
    }
  )
  let summarizer = counting(() => says('sum', 'Dumped a lot.'))
  assertEquals(
    await rest(g, ids.s, {
      model: worker.model,
      tools: [dump],
      mint,
      compactModel: { model: summarizer.model, name: 'fake-1' },
    }),
    'settled',
  )
  // The asks between one checkpoint and the next.
  let gaps: number[] = [], asks = -1
  for (let b of await transcript(g, ids.s)) {
    if (b.checkpoint) {
      if (asks >= 0) gaps.push(asks)
      asks = 0
    } else if (kindOf(b) == 'ask' && asks >= 0) asks++
  }
  assertEquals(gaps.length > 0, true)
  assertEquals(gaps.filter((n) => n < GAP), [])
  assertEquals(summarizer.asked.length > 1, true)
  assertEquals(new Set(summarizer.asked.map((r) => r.conversation)).size, 1)
  let sent = worker.asked.map((req) =>
    JSON.stringify([req.instructions, req.tools, req.items]).length / 4
  )
  assertEquals(sent.filter((n) => n > window), [])
})

// A hand-set window above a provider's enforced ceiling. The existing
// checkpoint is younger than GAP: a length refusal must bypass that guard.
let overflowing = async () => {
  let g = world()
  await windowed(g, 1_000_000)
  await g.apply([{
    entity: { eid: 'old-summary' },
    entry: { session: ids.s },
    checkpoint: { through: 'e1', seq: 1 },
    notice: {},
    content: { body: 'Old summary.' },
  }])
  await appendEntry(g, ids.s, 'x'.repeat(60_000))
  return g
}
let lengthError = () =>
  new ModelError(
    'context_length_exceeded',
    "This model's maximum context length is 10,000 tokens. " +
      'Your request contains 15,000 tokens.',
    undefined,
    { body: '{"error":{"code":"context_length_exceeded"}}' },
  )

test('a length refusal bypasses GAP, compacts deeply and retries once', async () => {
  let g = await overflowing()
  let asked: Request[] = []
  let model: Model = (req) => {
    asked.push(req)
    if (JSON.stringify(req.items).length / 4 > 10_000) throw lengthError()
    return Promise.resolve(says('ok', 'It fits.'))
  }
  let summarizer = scripted([says('sum', 'Short summary.')], false)
  let deps = {
    model,
    tools: [echo],
    mint,
    instructions: 'The stable persona.',
    compactModel: { model: summarizer.model, name: 'fake-1' },
  }
  assertEquals(await rest(g, ids.s, deps), 'settled')
  assertEquals(asked.length, 2)
  assertEquals(summarizer.asked.length, 1)
  assertEquals(asked[1].items, [{
    kind: 'instruction',
    text: 'Short summary.',
  }])
  assertEquals(asked[1].instructions, asked[0].instructions)
  assertEquals(asked[1].tools, asked[0].tools)
  assertEquals(asked[1].conversation, asked[0].conversation)
  let row = (await g.get([ids.m]))[0].model as Comp
  assertEquals(row.context, 1_000_000)
  assertEquals(row.enforced, 10_000)
  // The enforced ceiling is used on later turns, not only on this retry.
  for (let i = 0; i < GAP; i++) {
    await appendEntry(g, ids.s, 'small')
    assertEquals(await rest(g, ids.s, deps), 'settled')
  }
  summarizer.model = scripted([says('sum2', 'Later summary.')], false).model
  deps.compactModel.model = summarizer.model
  await appendEntry(g, ids.s, 'y'.repeat(24_000))
  assertEquals(await rest(g, ids.s, deps), 'settled')
  assertEquals(asked.length, 2 + GAP + 1)
  assertEquals(asked.at(-1)!.items, [{
    kind: 'instruction',
    text: 'Later summary.',
  }])
})

test('a second length refusal fails visibly in the provider’s words', async () => {
  let g = await overflowing()
  let calls = 0
  let model: Model = () => {
    calls++
    throw lengthError()
  }
  let summarizer = scripted([says('sum', 'Short summary.')], false)
  let deps = {
    model,
    tools: [],
    mint,
    compactModel: { model: summarizer.model, name: 'fake-1' },
  }
  assertEquals(await rest(g, ids.s, deps), 'failed')
  assertEquals(calls, 2)
  assertEquals(summarizer.asked.length, 1)
  let entries = await transcript(g, ids.s)
  assertEquals(textOf(entries.at(-1)!), lengthError().message)
  assertEquals((entries.at(-1)!.error as Comp).code, 'context_length_exceeded')
  assertEquals(
    (entries.at(-1)!.response as Comp).body,
    lengthError().response!.body,
  )
  await react(g, ids.s, deps)
  assertEquals(calls, 2)
})

test('a provider’s equivalent length message with no ceiling also recovers', async () => {
  let g = await overflowing()
  let asks = 0
  let model: Model = () => {
    if (++asks == 1) {
      throw new ModelError('invalid_request_error', 'Prompt is too long')
    }
    return Promise.resolve(says('ok', 'Recovered.'))
  }
  assertEquals(
    await rest(g, ids.s, {
      model,
      tools: [],
      mint,
      compactModel: {
        model: scripted([says('sum', 'Short summary.')], false).model,
        name: 'fake-1',
      },
    }),
    'settled',
  )
  assertEquals(asks, 2)
  assertEquals(((await g.get([ids.m]))[0].model as Comp).enforced, undefined)
})

test('compaction restores admitted persona, skills and claimed tasks verbatim', async () => {
  let g = world()
  await windowed(g, 30_000)
  let persona = 'Persona: build small composable parts.'
  let skill = 'Skill: use graph patches, never driver SQL.'
  let title = 'Keep the owner’s draft'
  let body = 'Never lose it, even across interfaces.'
  await g.apply([
    {
      entity: { eid: 'persona' },
      entry: { session: ids.s },
      prompt: { source: 'persona:common', scope: 'shared' },
      content: { body: persona },
    },
    {
      entity: { eid: 'skill' },
      entry: { session: ids.s },
      prompt: { source: 'skill:effects-and-rules', scope: 'local' },
      content: { body: skill },
    },
    {
      entity: { eid: 'held-task' },
      task: {},
      doc: { title, body },
      claim: { session: ids.s },
    },
    {
      entity: { eid: 'other-task' },
      task: {},
      doc: { title: 'Somebody else’s work', body: 'Not this session.' },
      claim: { session: ids.f },
    },
    { entity: { eid: ids.f }, session: { id: 'other' } },
  ])
  await appendEntry(g, ids.s, title + '\n\n' + body)
  await appendEntry(
    g,
    ids.s,
    'Progress: the draft is synced. ' + 'x'.repeat(100_000),
  )
  let summary = 'The draft is synced; check offline recovery next.'
  let summarizer = scripted([says('sum', summary)], false)
  let worker = scripted([says('ok', 'Ready.')], false)
  let deps = {
    model: worker.model,
    tools: [],
    mint,
    compactModel: { model: summarizer.model, name: 'fake-1' },
  }
  assertEquals(await rest(g, ids.s, deps), 'settled')
  let compacted = JSON.stringify(summarizer.asked[0].items)
  assertEquals(compacted.includes(persona), false)
  assertEquals(compacted.includes(skill), false)
  assertEquals(compacted.includes(body), false)
  assertEquals(compacted.includes('Progress: the draft is synced.'), true)
  assertEquals(worker.asked[0].items, [
    { kind: 'instruction', text: persona },
    { kind: 'instruction', text: skill },
    {
      kind: 'instruction',
      text: 'Claimed task held-task\n' + title + '\n\n' + body,
    },
    { kind: 'instruction', text: summary },
  ])
  // Two cuts still keep the original instruction text, not its summary.
  for (let i = 0; i < GAP; i++) {
    worker = scripted([says('r' + i, 'Ready.')], false)
    deps.model = worker.model
    await appendEntry(g, ids.s, 'Continue.')
    assertEquals(await rest(g, ids.s, deps), 'settled')
  }
  await g.apply([{
    entity: { eid: 'held-task' },
    doc: { body: 'Updated task: preserve edits while offline.' },
  }])
  let second = scripted([says('sum2', 'Offline recovery remains.')], false)
  deps.compactModel.model = second.model
  let next = scripted([says('next', 'Ready.')], false)
  deps.model = next.model
  await appendEntry(g, ids.s, 'y'.repeat(100_000))
  assertEquals(await rest(g, ids.s, deps), 'settled')
  assertEquals(JSON.stringify(second.asked[0].items).includes(persona), false)
  assertEquals(JSON.stringify(second.asked[0].items).includes(skill), false)
  assertEquals(JSON.stringify(second.asked[0].items).includes(body), false)
  assertEquals(next.asked[0].items.slice(0, 4), [
    { kind: 'instruction', text: persona },
    { kind: 'instruction', text: skill },
    {
      kind: 'instruction',
      text: 'Claimed task held-task\n' + title +
        '\n\nUpdated task: preserve edits while offline.',
    },
    { kind: 'instruction', text: 'Offline recovery remains.' },
  ])
  // A release appends a correction without changing the frozen prefix.
  await g.apply([{ entity: { eid: 'held-task' }, claim: null }])
  let released = scripted([says('released', 'Ready.')], false)
  deps.model = released.model
  await appendEntry(g, ids.s, 'Continue without that task.')
  assertEquals(await rest(g, ids.s, deps), 'settled')
  assertEquals(
    JSON.stringify(released.asked[0].items).includes('Released task held-task'),
    true,
  )
})

test('task edits and claim changes append context without rewriting the checkpoint prefix', async () => {
  for (let kept of [false, true]) {
    let g = world()
    await windowed(g, 100_000)
    await g.apply([
      {
        entity: { eid: 'held' },
        task: {},
        doc: { title: 'Draft', body: 'Old spec.' },
        claim: { session: ids.s },
      },
      {
        entity: { eid: 'summary' },
        entry: { session: ids.s },
        notice: {},
        checkpoint: {
          through: 'e1',
          seq: 1,
          tasks: { held: { title: 'Draft', body: 'Old spec.' } },
        },
        content: { body: 'History summary.' },
      },
    ])
    await appendEntry(g, ids.s, 'Continue.')
    let worker = scripted([
      says('one', 'Ready.'),
      says('two', 'Ready.'),
      says('three', 'Ready.'),
      says('four', 'Ready.'),
    ], kept)
    let summarizer = scripted([], false)
    let deps = {
      model: worker.model,
      tools: [],
      mint,
      compactModel: { model: summarizer.model, name: 'fake-1' },
    }
    assertEquals(await rest(g, ids.s, deps), 'settled')
    let first = JSON.stringify(worker.asked[0].items)
    await g.apply([{ entity: { eid: 'held' }, doc: { body: 'New spec.' } }])
    await appendEntry(g, ids.s, 'Apply my changes.')
    assertEquals(await rest(g, ids.s, deps), 'settled')
    assertEquals(
      JSON.stringify(worker.asked[1].items).includes('New spec.'),
      true,
    )
    if (kept) {
      assertEquals(worker.asked[1].anchor, 'one')
      assertEquals(
        JSON.stringify(worker.asked[1].items).includes('Old spec.'),
        false,
      )
    } else {
      assertEquals(JSON.stringify(worker.asked[1].items.slice(0, 3)), first)
    }
    await g.apply([
      { entity: { eid: 'held' }, claim: null },
      {
        entity: { eid: 'new-held' },
        task: {},
        doc: { body: 'New claim.' },
        claim: { session: ids.s },
      },
    ])
    await appendEntry(g, ids.s, 'Move on.')
    assertEquals(await rest(g, ids.s, deps), 'settled')
    let sent = JSON.stringify(worker.asked[2].items)
    assertEquals(sent.includes('Released task held'), true)
    assertEquals(sent.includes('New claim.'), true)
    if (!kept) {
      assertEquals(JSON.stringify(worker.asked[2].items.slice(0, 3)), first)
    }
    let entries = await transcript(g, ids.s)
    let mark = entries.find((b) => b.entity.eid == 'summary')!
    assertEquals((mark.checkpoint as Comp).tasks, {
      held: { title: 'Draft', body: 'Old spec.' },
    })
    assertEquals(entries.filter((b) => b.task_context).length, 2)
    // Restarting the runner/another ordinary turn doesn't append duplicate notices.
    await appendEntry(g, ids.s, 'Continue again.')
    assertEquals(await rest(g, ids.s, { ...deps }), 'settled')
    assertEquals(
      (await transcript(g, ids.s)).filter((b) => b.task_context).length,
      2,
    )
    assertEquals(summarizer.asked.length, 0)
  }
})

test('ordinary turns keep the admitted prefix byte-stable without a summary call', async () => {
  let g = world()
  await windowed(g, 100_000)
  await g.apply([{
    entity: { eid: 'persona' },
    entry: { session: ids.s },
    prompt: { source: 'persona:common' },
    content: { body: 'Verbatim persona.' },
  }])
  let worker = scripted([says('one', 'Ready.'), says('two', 'Ready.')], false)
  let summarizer = scripted([], false)
  let deps = {
    model: worker.model,
    tools: [],
    mint,
    compactModel: { model: summarizer.model, name: 'fake-1' },
  }
  assertEquals(await rest(g, ids.s, deps), 'settled')
  let prefix = JSON.stringify(worker.asked[0].items)
  await appendEntry(g, ids.s, 'Continue.')
  assertEquals(await rest(g, ids.s, deps), 'settled')
  assertEquals(JSON.stringify(worker.asked[1].items.slice(0, 2)), prefix)
  assertEquals(summarizer.asked.length, 0)
})

test('a forced overflow cut also restores admitted context above the summary', async () => {
  let g = await overflowing()
  await g.apply([{
    entity: { eid: 'persona' },
    entry: { session: ids.s },
    prompt: { source: 'persona:common' },
    content: { body: 'Keep me verbatim.' },
  }])
  let requests: Request[] = []
  let model: Model = (req) => {
    requests.push(req)
    if (requests.length == 1) throw lengthError()
    return Promise.resolve(says('ok', 'Ready.'))
  }
  let summarizer = scripted([says('sum', 'Short summary.')], false)
  assertEquals(
    await rest(g, ids.s, {
      model,
      tools: [],
      mint,
      compactModel: { model: summarizer.model, name: 'fake-1' },
    }),
    'settled',
  )
  assertEquals(
    JSON.stringify(summarizer.asked[0].items).includes('Keep me verbatim.'),
    false,
  )
  assertEquals(requests[1].items, [
    { kind: 'instruction', text: 'Keep me verbatim.' },
    { kind: 'instruction', text: 'Short summary.' },
  ])
})

test('media transcripts compact only through a text model without persona instructions', async () => {
  let g = world()
  await windowed(g, 40)
  let media = scripted([says('media', 'Audio ready.')], false)
  let text = scripted([says('summary', 'Remember the blue bridge.')], false)
  let persona = 'PRIVATE PERSONA: never forward this'
  await g.apply([
    {
      entity: { eid: 'later' },
      entry: { session: ids.s },
      content: { body: 'Remember the blue bridge. '.repeat(20) },
    },
    { entity: { eid: 'e1' }, using: { instructions: persona } },
  ])
  assertEquals(
    await rest(g, ids.s, {
      model: media.model,
      tools: [],
      compactModel: { model: text.model, name: 'text-only' },
    }),
    'settled',
  )
  assertEquals(text.asked.length, 1)
  assertEquals(text.asked[0].model, 'text-only')
  assertEquals(text.asked[0].instructions?.includes(persona), false)
  assertEquals(text.asked[0].tools, [])
  assertEquals(media.asked.length, 1)
  assertEquals(media.asked[0].instructions?.includes(persona), true)
  assertEquals((await transcript(g, ids.s)).some((b) => !!b.checkpoint), true)
})

test('an over-budget media transcript without a summarizer never asks for a summary', async () => {
  let g = world()
  await windowed(g, 40)
  let media = scripted([says('media', 'Audio ready.')], false)
  await g.apply([{
    entity: { eid: 'later' },
    entry: { session: ids.s },
    content: { body: 'Remember the blue bridge. '.repeat(20) },
  }])
  assertEquals(
    await rest(g, ids.s, {
      model: media.model,
      tools: [],
    }),
    'settled',
  )
  assertEquals(media.asked.length, 1)
  assertEquals(
    media.asked[0].instructions?.includes('Summarize this transcript') ?? false,
    false,
  )
  assertEquals((await transcript(g, ids.s)).some((b) => !!b.checkpoint), false)
})

test('a refused model ask ends without another provider call', async () => {
  let g = world()
  let { model, asked } = scripted([])
  let deps = { model, tools: [echo], mint }
  assertEquals(await rest(g, ids.s, deps), 'failed')
  assertEquals(asked.length, 1)
  assertEquals(await kinds(g, ids.s), [
    'input',
    'ask',
    'error',
  ])
})

test('an audio provider refusal keeps its cause and makes one ask', async () => {
  let g = world(), calls = 0
  await g.apply([{
    entity: { eid: ids.m },
    model: { modalities: ['audio'] },
  }])
  let model: Model = () => {
    calls++
    throw new ModelError('http_400', 'OpenRouter speech request failed (400)')
  }
  assertEquals(await rest(g, ids.s, { model, tools: [], mint }), 'failed')
  let entries = await transcript(g, ids.s)
  assertEquals(calls, 1)
  assertEquals(entries.map(kindOf), ['input', 'ask', 'error'])
  assertEquals((entries.at(-1)?.error as Comp).code, 'http_400')
  assertEquals(
    textOf(entries.at(-1)!),
    'OpenRouter speech request failed (400)',
  )
})

test('a retryable audio failure never resends an ambiguous request', async () => {
  let g = world(), calls = 0
  await g.apply([{
    entity: { eid: ids.m },
    model: { modalities: ['audio'] },
  }])
  let model: Model = () => {
    calls++
    throw new ModelError('http_503', 'provider unavailable', { after: 0 })
  }
  assertEquals(await rest(g, ids.s, { model, tools: [], mint }), 'failed')
  assertEquals(calls, 1)
  assertEquals(await kinds(g, ids.s), ['input', 'ask', 'error'])
})

// A failing model, counting its calls.
let failing = (error: () => ModelError) => {
  let seen = { calls: 0 }
  let model: Model = () => {
    seen.calls++
    return Promise.reject(error())
  }
  return { model, seen }
}

// The ask and the error line a failed turn leaves: its attempt state, and the
// error's code and prose.
let outcome = async (g: Graph) => {
  let [ask, error] = (await transcript(g, ids.s)).slice(-2)
  return [
    (ask.attempt as Comp | undefined)?.state,
    (error.error as Comp).code,
    textOf(error),
  ]
}

test('outside the pool, a failure that may pass stands at once as an interruption, in the provider’s words', async () => {
  let response = { body: '{"type":"response.failed"}' }
  for (
    let error of [
      () => new ModelError('transport', 'connection reset'),
      () => new ModelError('http_503', 'provider unavailable', { after: 0 }),
      () =>
        new ModelError('unknown', 'responses: failed — unknown', {}, response),
    ]
  ) {
    for (let streaming of [false, true]) {
      let g = world()
      let { model, seen } = failing(error)
      let deps = { model, tools: [], streaming, mint }
      // Nobody here would ask again: the request stands interrupted, for a
      // person to continue from.
      assertEquals(await rest(g, ids.s, deps), 'failed')
      assertEquals(seen.calls, 1)
      assertEquals(await outcome(g), [
        'interrupted',
        'interrupted',
        'Response interrupted: ' + String(error()),
      ])
      let line = (await transcript(g, ids.s)).at(-1)!
      assertEquals(line.response, error().response)
    }
  }
})

test('a provider’s refusal is final and keeps its own code, streamed or not', async () => {
  for (
    let [code, said] of [
      ['http_400', 'invalid request'],
      ['usage_limit_reached', 'The usage limit has been reached'],
    ]
  ) {
    for (let streaming of [false, true]) {
      let g = world()
      let { model, seen } = failing(() => new ModelError(code, said))
      let deps = { model, tools: [], streaming, mint }
      assertEquals(await rest(g, ids.s, deps), 'failed')
      assertEquals(seen.calls, 1)
      assertEquals(await kinds(g, ids.s), ['input', 'ask', 'error'])
      assertEquals(await outcome(g), ['completed', code, said])
    }
  }
})

test('a summary the provider keeps failing ends the transcript, never loops', async () => {
  for (
    let error of [
      () => new ModelError('http_429', 'Rate limit exceeded', { after: 0 }),
      () => new ModelError('usage_limit_reached', 'The usage limit is reached'),
    ]
  ) {
    let g = world()
    await windowed(g, 20)
    await rest(g, ids.s, {
      model: scripted([says('r1', 'hi')]).model,
      tools: [],
    })
    await appendEntry(g, ids.s, 'Remember the blue bridge. '.repeat(4))
    // A summarizer that would answer on its tenth call, if it got one.
    let { model, seen } = failing(error)
    let summarizer: Model = (req) =>
      seen.calls == 9 ? Promise.resolve(says('sum', 'Blue.')) : model(req)
    let deps = {
      model: scripted([says('r2', 'ok')], false).model,
      tools: [],
      mint,
      compactModel: { model: summarizer, name: 'fake-1' },
    }
    assertEquals(await rest(g, ids.s, deps), 'failed')
    // Three runner steps, one ask each: outside the pool nothing asks again
    // sooner, whether the failure may pass or is the provider's no.
    assertEquals(seen.calls, 3)
    assertEquals(
      (await kinds(g, ids.s)).slice(-4),
      ['input', 'error', 'error', 'error'],
    )
    assertEquals((await outcome(g))[1], error().code)
  }
})

test('two tool calls in one reply are both answered before the next ask', async () => {
  let g = world()
  let { model, asked } = scripted([
    calls(['c1', 'a'], ['c2', 'b']),
    says('r2', 'done'),
  ])
  assertEquals(
    await rest(g, ids.s, { model, tools: [echo], mint }),
    'settled',
  )
  assertEquals(
    asked[1].items.filter((i) => i.kind == 'result').map((i) => i.id),
    ['c1', 'c2'],
  )
})

test('a call for a tool this session does not serve is refused, not left open', async () => {
  let g = world()
  let { model } = scripted([calls(['c1', 'hi']), says('r2', 'done')])
  // The tool row is in the graph and the session serves no function for it.
  assertEquals(await rest(g, ids.s, { model, tools: [], mint }), 'settled')
  let entries = await transcript(g, ids.s)
  // The refusal is an error beside the result, which is what any expected
  // failure lands — the model hears it and the transcript goes on.
  assertEquals(entries.map(kindOf), [
    'input',
    'ask',
    'call',
    'error',
    'result',
    'ask',
    'output',
  ])
  let refused = entries.find((b) => kindOf(b) == 'result')!
  assertEquals(
    String((refused.content as Comp).body).includes('no such tool'),
    true,
  )
})

test('a fork must name an entry, a using a model', () => {
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

test('as `session_run`, the steps run themselves until the transcript settles', async () => {
  let fx = effects(vocab)
  let g = graph({ storage: ram(vocab), vocab, plugins: [sessions(), fx] })
  let { model, asked } = scripted([calls(['c1', 'hi']), says('r2', 'done')])
  let steps: string[] = []
  fx.handle(running(g, {
    holder: 'here',
    model,
    tools: [echo],
    mint,
    each: (s) => steps.push(s.did),
  }))
  await seed(g) // the input entry owes the run
  await fx.idle()
  assertEquals(statusOf(await transcript(g, ids.s)), 'settled')
  assertEquals(asked.length, 2)
  assertEquals(steps.filter((s) => s != 'nothing'), ['asked', 'ran', 'asked'])
})

test('usage is persisted once on its ask, not on output entries', async () => {
  let g = world()
  let usage = {
    input_tokens: 1000,
    cached_tokens: 800,
    output_tokens: 20,
    total_tokens: 1020,
  }
  let { model } = scripted([{ ...says('r1', 'done'), usage }])
  await rest(g, ids.s, { model, tools: [echo], mint })
  let entries = await transcript(g, ids.s)
  assertEquals(entries.filter((b) => b.usage).length, 1)
  assertEquals(entries[1].usage, usage)
  assertEquals(kindOf(entries[1]), 'ask')
})

test('unexpected model failures reach diagnostics, expected model errors do not', async () => {
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

test('provider completion allocates positions after concurrently admitted notices', async () => {
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
  assertEquals(all[2].entity.eid, 'during')
  assertEquals((all[1].ask as Comp).through, 'e1')
})

test('recovery excludes a stale streamed provider reply', async () => {
  let g = world()
  let releaseOld!: () => void, startedOld!: () => void
  let oldGate = new Promise<void>((done) => releaseOld = done)
  let oldStarted = new Promise<void>((done) => startedOld = done)
  let old = react(g, ids.s, {
    tools: [echo],
    streaming: true,
    mint,
    model: async () => {
      startedOld()
      await oldGate
      return {
        id: 'late',
        model: 'fake-1',
        items: [
          { kind: 'assistant', text: 'late reply' },
          {
            kind: 'call',
            id: 'late-call',
            name: 'echo',
            args: '{"text":"late"}',
          },
        ],
      }
    },
  })
  await oldStarted
  await react(g, ids.s, {
    tools: [],
    streaming: true,
    mint,
    model: () => Promise.reject(new Error('not dispatched')),
  })

  let releaseNew!: () => void, startedNew!: () => void
  let newGate = new Promise<void>((done) => releaseNew = done)
  let newStarted = new Promise<void>((done) => startedNew = done)
  let fresh = react(g, ids.s, {
    tools: [],
    streaming: true,
    mint,
    model: async () => {
      startedNew()
      await newGate
      return says('fresh', 'fresh reply')
    },
  })
  await newStarted
  releaseOld()
  assertEquals((await old).did, 'nothing')
  let midway = await transcript(g, ids.s)
  assertEquals(midway.filter((b) => b.output).length, 0)
  assertEquals(midway.filter((b) => b.call).length, 0)
  assertEquals(midway.filter((b) => b.exception).length, 0)
  assertEquals(
    (midway.filter((b) => b.ask)[0].attempt as Comp).state,
    'interrupted',
  )
  assertEquals(
    (midway.filter((b) => b.ask)[1].attempt as Comp).state,
    'inflight',
  )

  releaseNew()
  await fresh
  let done = await transcript(g, ids.s)
  assertEquals(done.filter((b) => b.output).map(textOf), ['fresh reply'])
  assertEquals(done.filter((b) => b.call).length, 0)
  assertEquals(done.filter((b) => b.exception).length, 0)
})

test('recovery leaves an interrupted nonstream request for inspection', async () => {
  let g = world(), calls = 0
  let release!: () => void, started!: () => void
  let gate = new Promise<void>((done) => release = done)
  let entered = new Promise<void>((done) => started = done)
  let model: Model = async () => {
    calls++
    started()
    await gate
    return says('late', 'late reply')
  }
  let old = react(g, ids.s, { model, tools: [] })
  await entered
  let [ask] = (await transcript(g, ids.s)).filter((b) => b.ask)
  assertEquals((ask.attempt as Comp).state, 'inflight')
  await react(g, ids.s, { model, tools: [] })
  release()
  await old
  let entries = await transcript(g, ids.s)
  assertEquals(calls, 1)
  assertEquals(statusOf(entries), 'failed')
  assertEquals(entries.filter((b) => b.output).length, 0)
  assertEquals((entries.at(-1)?.error as Comp).code, 'interrupted')
})

test('unstarted older calls get results without replay or provider dispatch', async () => {
  let g = world()
  let { model, asked } = scripted([
    calls(['old-one', 'hi'], ['old-two', 'bye']),
    says('next', 'done'),
  ])
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
  assertEquals(step.did, 'ran')
  assertEquals(step.added.filter((b) => b.result).length, 2)
  assertEquals(step.added.filter((b) => b.error).length, 2)
  assertEquals(runs, 0)
  assertEquals(asked.length, 1)
  let entries = await transcript(g, ids.s)
  assertEquals(entries.filter((b) => b.result).length, 2)
  assertEquals(
    entries.filter((b) => b.call).map((b) => (b.execution as Comp).state),
    ['failed', 'failed'],
  )
  let resumed = await react(g, ids.s, deps)
  assertEquals(resumed.did, 'asked')
  assertEquals(asked.length, 2)
  assertEquals(
    asked[1].items.filter((i) => i.kind == 'result').length,
    2,
  )
  assertEquals(runs, 0)
})

test('a claimed older call still fails for manual inspection', async () => {
  let g = world()
  let { model, asked } = scripted([
    calls(['unstarted', 'hi'], ['claimed', 'bye']),
  ])
  await react(g, ids.s, { model, tools: [echo] })
  let call = (await transcript(g, ids.s)).find((b) =>
    (b.call as Comp | undefined)?.id == 'claimed'
  )!
  await g.apply([
    { entity: call.entity, execution: { state: 'running', by: ids.s } },
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
  let safe = await react(g, ids.s, { model, tools: [echo] })
  assertEquals(safe.did, 'ran')
  assertEquals(safe.added.filter((b) => b.result).length, 1)
  let step = await react(g, ids.s, { model, tools: [echo] })
  assertEquals(step.status, 'failed')
  assertEquals(step.added.some((b) => !!b.exception), true)
  assertEquals((await transcript(g, ids.s)).filter((b) => b.result).length, 1)
  assertEquals(asked.length, 1)
})

test('typed questions are asked once and answered one entry each', async () => {
  let g = world()
  let questions = {
    plan: { type: 'choice' as const, instructions: 'Where next?' },
    greet: { type: 'noul' as const, instructions: 'Greet them?' },
  }
  await g.apply([{
    entity: { eid: 'e2' },
    entry: { session: ids.s, seq: 2 },
    content: { body: 'a stranger arrives' },
    questions: { asked: questions },
  }])
  let answered: Reply = {
    id: 'r1',
    model: 'fake-1',
    items: [],
    answers: {
      plan: { type: 'choice', choice: 'forge', confidence: 0.8249 },
      greet: { type: 'noul', noul: 0.81 },
    },
  }
  let { model, asked } = scripted([answered, says('r2', 'hello')])
  assertEquals(await rest(g, ids.s, { model, tools: [], mint }), 'settled')
  assertEquals(asked[0].questions, questions)
  let said = (await transcript(g, ids.s)).filter((b) => b.answer)
  assertEquals(said.map((b) => [b.answer, textOf(b)]), [
    [
      { question: 'plan', choice: 'forge', confidence: 0.8249 },
      'plan: forge, 0.82',
    ],
    [{ question: 'greet', noul: 0.81 }, 'greet: 0.81'],
  ])
  // the next turn is a chat, which reads the conversation and not the
  // answers kept beside it
  await appendEntry(g, ids.s, 'what did you decide?')
  await rest(g, ids.s, { model, tools: [], mint })
  assertEquals(asked[1].questions, undefined)
  assertEquals(asked[1].items, [{ kind: 'user', text: 'what did you decide?' }])
})

test('questions are not asked of a model a later line chose', async () => {
  let g = world()
  await g.apply([{
    entity: { eid: 'e2' },
    entry: { session: ids.s, seq: 2 },
    content: { body: 'the smith hears a knock' },
    using: { provider: ids.p, model: ids.m },
    questions: { asked: { open: { type: 'noul', instructions: 'Open up?' } } },
  }, {
    entity: { eid: 'e3' },
    entry: { session: ids.s, seq: 3 },
    content: { body: 'Bramble: anyone home?' },
    using: { provider: ids.p, model: ids.m },
  }])
  let { model, asked } = scripted([says('r1', 'coming')])
  assertEquals(await rest(g, ids.s, { model, tools: [], mint }), 'settled')
  assertEquals(asked[0].questions, undefined)
})

test('a request refused at its limit is not retried', async () => {
  let g = world()
  let asked = 0
  let model: Model = () => {
    asked++
    return Promise.reject(new ModelError('limit', 'This space is at its limit'))
  }
  assertEquals(await rest(g, ids.s, { model, tools: [], mint }), 'failed')
  assertEquals([asked, await kinds(g, ids.s)], [1, ['input', 'ask', 'error']])
  await appendEntry(g, ids.s, 'and now?')
  assertEquals(statusOf(await transcript(g, ids.s)), 'pending')
})

test('a window sends the newest entries, from the input that began their turn', async () => {
  let g = world()
  let { model, asked } = scripted([
    says('r1', 'one'),
    calls(['c1', 'hi']),
    says('r3', 'two'),
    says('r4', 'three'),
    says('r5', 'four'),
  ], false)
  let deps = { model, tools: [echo], mint }
  let say = async (eid: string, body: string, window?: number) => {
    g.apply([{
      entity: { eid },
      entry: { session: ids.s },
      content: { body },
      using: { provider: ids.p, model: ids.m, window },
    }])
    await rest(g, ids.s, deps)
    return asked.at(-1)!.items.map((i) => i.kind)
  }
  await rest(g, ids.s, deps)
  await say('e2', 'echo hi')
  // the newest four begin at the result: the turn it answers is sent whole
  assertEquals(await say('e3', 'and?', 4), [
    'user',
    'call',
    'result',
    'assistant',
    'user',
  ])
  assertEquals(await say('e4', 'last', 1), ['user'])
})

test('a window keeps a call whose result followed an input', () => {
  let entries = [
    { entity: { eid: 'call' }, call: { to: ids.t, id: 'c1' } },
    { entity: { eid: 'input' }, content: { body: 'while it runs' } },
    { entity: { eid: 'result' }, result: { call: 'call' } },
  ]
  assertEquals(recent(entries, 2), entries)
})

test("a window counts the conversation, never a wake's typed questions", async () => {
  let g = world()
  let decided: Reply = {
    id: 'q',
    model: 'fake-1',
    items: [],
    answers: { go: { type: 'choice', choice: 'home', confidence: 0.6 } },
  }
  let { model, asked } = scripted(
    [says('r1', 'hello'), decided, decided, decided, says('r2', 'well')],
    false,
  )
  let deps = { model, tools: [], mint }
  await rest(g, ids.s, deps)
  let say = async (eid: string, body: string, more: object = {}) => {
    await g.apply([{
      entity: { eid },
      entry: { session: ids.s },
      content: { body },
      using: { provider: ids.p, model: ids.m, window: 3 },
      ...more,
    }])
    await rest(g, ids.s, deps)
    return asked.at(-1)!.items
  }
  let go = { asked: { go: { type: 'choice', instructions: 'Where?' } } }
  for (let eid of ['w1', 'w2']) {
    await say(eid, 'A while passes.', { questions: go })
  }
  let conversation: Item[] = [
    { kind: 'user', text: 'echo hi, then say done' },
    { kind: 'assistant', text: 'hello' },
  ]
  assertEquals(await say('w3', 'A while passes.', { questions: go }), [
    ...conversation,
    { kind: 'user', text: 'A while passes.' },
  ])
  assertEquals(await say('e2', 'and now?'), [
    ...conversation,
    { kind: 'user', text: 'and now?' },
  ])
})

test('compaction asks keep their own usage and provenance outside parent history', async () => {
  let g = world()
  await windowed(g, 100_000)
  await appendEntry(g, ids.s, 'x'.repeat(240_000))
  let requests: Request[] = []
  let usage = {
    input_tokens: 60_010,
    cached_tokens: 10_000,
    output_tokens: 12,
    total_tokens: 60_022,
  }
  let summarizer: Model = (req) => {
    requests.push(req)
    return Promise.resolve({ ...says('sum', 'The story.'), usage, cost: 0.03 })
  }
  summarizer.mark = () => ({ fake: { reply: 'sum' } })
  let deps = {
    model: scripted([says('r', 'ok')], false).model,
    tools: [],
    mint,
    compactModel: { model: summarizer, name: 'fake-1', provider: ids.p },
  }
  await rest(g, ids.s, deps)
  let [session] = await g.get([requests[0].conversation!])
  let [source] = await g.get([String((session.session as Comp).source)])
  let [tool] = await g.get([String((source.call as Comp).to)])
  assertEquals((tool.tool as Comp).name, 'session_compact')
  assertEquals(typeof (source.call as Comp).source, 'string')
  let own = await transcript(g, session.entity.eid)
  let ask = own.find((b) => b.ask)!
  assertEquals(ask.usage, usage)
  assertEquals(ask.cost, { dollars: 0.03, reported: true })
  assertEquals(ask.fake, { reply: 'sum' })
  assertEquals((ask.using as Comp).provider, ids.p)
  assertEquals((ask.attempt as Comp).state, 'completed')
  assertEquals(
    (await transcript(g, ids.s)).some((b) => b.usage == usage),
    false,
  )
  assertEquals(own.filter((b) => b.output).every((b) => !b.usage), true)
})

test('a failed compaction records reported failure usage and never invents counts', async () => {
  for (let reported of [true, false]) {
    let g = world()
    await windowed(g, 100_000)
    await appendEntry(g, ids.s, 'x'.repeat(240_000))
    let conversation = ''
    let model: Model = (req) => {
      conversation = req.conversation!
      throw new ModelError('refused', 'No summary', undefined, {
        body: JSON.stringify({
          response: {
            usage: reported
              ? {
                input_tokens: 1234,
                input_tokens_details: { cached_tokens: 1024 },
                output_tokens: 1,
              }
              : {},
          },
        }),
      })
    }
    await rest(g, ids.s, {
      model: scripted([], false).model,
      tools: [],
      mint,
      compactModel: { model, name: 'fake-1' },
    })
    let own = await transcript(g, conversation)
    let ask = own.find((b) => b.ask)!
    assertEquals(
      ask.usage,
      reported
        ? { input_tokens: 1234, cached_tokens: 1024, output_tokens: 1 }
        : undefined,
    )
    assertEquals((ask.attempt as Comp).state, 'completed')
    assertEquals((ask.error as Comp).code, 'refused')
  }
})

test('empty compaction replies retain billed usage without runnable orphan sessions', async () => {
  let g = world()
  await windowed(g, 100_000)
  await appendEntry(g, ids.s, 'x'.repeat(240_000))
  let conversation = ''
  let model: Model = (req) => {
    conversation = req.conversation!
    return Promise.resolve({
      id: 'empty',
      model: 'fake-1',
      items: [],
      usage: { input_tokens: 1234, output_tokens: 0 },
    })
  }
  assertEquals(
    await rest(g, ids.s, {
      model: scripted([], false).model,
      tools: [],
      mint,
      compactModel: { model, name: 'fake-1' },
    }),
    'failed',
  )
  let own = await transcript(g, conversation)
  assertEquals(statusOf(own), 'settled')
  let ask = own.find((b) => b.ask)!
  assertEquals((ask.error as Comp).code, 'compaction')
  assertEquals(ask.usage, { input_tokens: 1234, output_tokens: 0 })
  assertEquals((ask.attempt as Comp).state, 'completed')
  assertEquals(own.some((b) => b.output && textOf(b) == 'Empty summary'), true)
})
