import type { Comp } from '@yaks/graph'
// The runner's step over a fake model, on @yaks/ram: an input is asked, a tool
// call is run, the transcript settles; a stop is obeyed; a fork continues from
// its anchor with only what followed; errors retry to the bound and then stop;
// and the same steps run themselves as `session_run`.

import { assertEquals } from '@std/assert'
import type { Bundle, Graph } from '@yaks/graph'
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
import { kindOf, statusOf, textOf } from './status.ts'
import { appendEntry } from './append.ts'
import { sessions } from './plugin.ts'
import { type Deps, react, recent, transcript } from './react.ts'
import { running, settle } from './run.ts'
import { took } from './timing.ts'

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
let vocab = loadVocab([sessionDoc, toolsDoc, modelDoc, fakeDoc])

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

Deno.test('an input is asked, a tool call is run, the transcript settles', async () => {
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

Deno.test('an anchored ask can include a late result from an earlier call', async () => {
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

Deno.test('an interrupted tool call gets a result and the model continues without replay', async () => {
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

Deno.test('a legacy unfinished-call exception recovers without replay', async () => {
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

Deno.test('a provider that keeps nothing replays the whole transcript', async () => {
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

Deno.test('an imported compaction resumes from its summary and later entries', async () => {
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

Deno.test('a checkpoint keeps a call whose result followed an input', async () => {
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

Deno.test('a long native transcript writes a checkpoint before continuing', async () => {
  let g = world()
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
      contextTokens: 20,
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

Deno.test('media transcripts compact only through a text model without persona instructions', async () => {
  let g = world()
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
      contextTokens: 40,
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

Deno.test('an over-budget media transcript without a summarizer never asks for a summary', async () => {
  let g = world()
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
      contextTokens: 40,
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

Deno.test('errors retry to the bound, then the transcript is failed', async () => {
  let g = world()
  let { model, asked } = scripted([])
  let deps = { model, tools: [echo], mint }
  assertEquals(await rest(g, ids.s, deps), 'failed')
  assertEquals(asked.length, 3)
  assertEquals(await kinds(g, ids.s), [
    'input',
    'ask',
    'error',
    'ask',
    'error',
    'ask',
    'error',
  ])
})

Deno.test('a transient model failure retries before a streaming reply is visible', async () => {
  let g = world(), calls = 0, pauses: number[] = []
  let model: Model = () => {
    calls++
    return calls < 3
      ? Promise.reject(
        new ModelError('transport', 'connection reset', {
          after: 0,
        }),
      )
      : Promise.resolve(says('r1', 'done'))
  }
  assertEquals(
    await rest(g, ids.s, {
      model,
      tools: [],
      streaming: true,
      mint,
      pause: (ms) => {
        pauses.push(ms)
      },
    }),
    'settled',
  )
  assertEquals(calls, 3)
  assertEquals(pauses, [1000, 4000])
  assertEquals(await kinds(g, ids.s), ['input', 'ask', 'output'])
})

Deno.test('exhausted transient failures explain the terminal outcome', async () => {
  let g = world(), calls = 0
  let model: Model = () => {
    calls++
    return Promise.reject(
      new ModelError('http_503', 'provider unavailable', { after: 0 }),
    )
  }
  assertEquals(
    await rest(g, ids.s, {
      model,
      tools: [],
      streaming: true,
      mint,
      pause: () => {},
    }),
    'failed',
  )
  assertEquals(calls, 3)
  assertEquals(await kinds(g, ids.s), ['input', 'ask', 'error'])
  let error = (await transcript(g, ids.s)).at(-1)!
  assertEquals(
    (error.content as Comp).body,
    'Response interrupted: ModelError: Model request failed after 3 attempts (http_503): provider unavailable',
  )
})

Deno.test('an exhausted nonstream request does not start another transcript ask', async () => {
  let g = world(), calls = 0
  let model: Model = () => {
    calls++
    return Promise.reject(
      new ModelError('http_503', 'provider unavailable', { after: 0 }),
    )
  }
  assertEquals(
    await rest(g, ids.s, {
      model,
      tools: [],
      mint,
      pause: () => {},
    }),
    'failed',
  )
  assertEquals(calls, 3)
  assertEquals(await kinds(g, ids.s), ['input', 'ask', 'error'])
})

Deno.test('stopping during model backoff starts no further attempt', async () => {
  let g = world(), calls = 0, stop = new AbortController()
  let model: Model = () => {
    calls++
    return Promise.reject(
      new ModelError('transport', 'connection lost', { after: 0 }),
    )
  }
  assertEquals(
    await rest(g, ids.s, {
      model,
      tools: [],
      streaming: true,
      mint,
      stopping: stop.signal,
      pause: () => stop.abort(),
    }),
    'failed',
  )
  assertEquals(calls, 1)
})

Deno.test('a permanent model refusal is not retried', async () => {
  let g = world(), calls = 0
  let model: Model = () => {
    calls++
    return Promise.reject(new ModelError('http_400', 'invalid request'))
  }
  assertEquals(
    await rest(g, ids.s, {
      model,
      tools: [],
      streaming: true,
      mint,
    }),
    'failed',
  )
  assertEquals(calls, 1)
  assertEquals(
    ((await transcript(g, ids.s)).at(-1)!.content as Comp).body,
    'Response interrupted: ModelError: invalid request',
  )
})

Deno.test('two tool calls in one reply are both answered before the next ask', async () => {
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

Deno.test('a call for a tool this session does not serve is refused, not left open', async () => {
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

Deno.test('as `session_run`, the steps run themselves until the transcript settles', async () => {
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

Deno.test('usage is persisted once on its ask, not on output entries', async () => {
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
  assertEquals(all[2].entity.eid, 'during')
  assertEquals((all[1].ask as Comp).through, 'e1')
})

Deno.test('recovery excludes a stale streamed provider reply', async () => {
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

Deno.test('recovery leaves an interrupted nonstream request for inspection', async () => {
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

Deno.test('unstarted older calls get results without replay or provider dispatch', async () => {
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

Deno.test('a claimed older call still fails for manual inspection', async () => {
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

Deno.test('typed questions are asked once and answered one entry each', async () => {
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

Deno.test('questions are not asked of a model a later line chose', async () => {
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

Deno.test('a request refused at its limit is not retried', async () => {
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

Deno.test('a window sends the newest entries, from the input that began their turn', async () => {
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

Deno.test('a window keeps a call whose result followed an input', () => {
  let entries = [
    { entity: { eid: 'call' }, call: { to: ids.t, id: 'c1' } },
    { entity: { eid: 'input' }, content: { body: 'while it runs' } },
    { entity: { eid: 'result' }, result: { call: 'call' } },
  ]
  assertEquals(recent(entries, 2), entries)
})

Deno.test("a window counts the conversation, never a wake's typed questions", async () => {
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
