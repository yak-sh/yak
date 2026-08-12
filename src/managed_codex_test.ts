// The graph-native managed lifecycle against an in-memory graph and injected
// provider/tools. No process, credential, or owner graph participates.
import { assert, assertEquals, assertMatch } from '@std/assert'
import { apply, journalOf, open } from './db.ts'
import {
  append,
  expiredLeases,
  readEntries,
  readyEntries,
  settleGeneration,
  takeEntry,
} from './entries.ts'
import { graphLog } from './entry_log.ts'
import { managedCodex, type ManagedCodexOptions } from './managed_codex.ts'
import { type Observation } from './observations.ts'
import {
  type ResponseEvent,
  type ResponseResult,
  responses,
} from './responses.ts'
import { writeSession } from './session_store.ts'
import { type ToolHost } from './harness_tools.ts'
import { type Change, uuid } from './types.ts'
import { slow } from './testing.ts'

Deno.env.set('DB_PATH', ':memory:')

let result = (
  items: ResponseResult['items'],
  model = 'gpt-serving',
): ResponseResult => ({
  model,
  items,
  unknown: [],
  unknownItems: [],
  usage: {
    input: 8,
    cached: 3,
    output: 5,
    reasoning: 2,
    raw: {},
  },
  response: {},
  limits: {},
})

let tools = (seen: string[]): ToolHost => ({
  tools: [
    {
      type: 'function',
      name: 'shell',
      description: 'test shell',
      parameters: { type: 'object' },
      strict: true,
    },
    {
      type: 'function',
      name: 'task_context',
      description: 'test context',
      parameters: { type: 'object' },
      strict: true,
    },
  ],
  call: (name) => {
    seen.push(name)
    let facets: Record<string, Record<string, unknown>> = name == 'shell'
      ? { exit: { code: 0 } }
      : {}
    return Promise.resolve({
      output: name == 'task_context' ? 'one pending message' : 'worked',
      facets,
    })
  },
})

let session = (db: ReturnType<typeof open>, cwd?: string) => {
  let eid = uuid()
  apply(db, [{
    eid,
    name: 'session',
    comp: {
      id: uuid(),
      provider: 'codex',
      model: 'gpt-requested',
      ...cwd ? { cwd } : {},
    },
  }])
  db.prepare("update session set origin = 'managed' where eid = ?").run(eid)
  return eid
}

let job = (tree: string) => ({
  instruction: 'Do the task.',
  session_id: uuid(),
  repo: { path: tree, base_branch: 'main' },
  tree,
  branch: 'session/test',
  model: 'gpt-requested',
  effort: 'high',
})

let noCodeJob = () => ({
  instruction: 'Triage the graph.',
  session_id: uuid(),
  model: 'gpt-requested',
  effort: 'high',
})

let delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

let leaseUntil = (db: ReturnType<typeof open>, eid: string) =>
  (db.prepare('select until from lease where eid = ?').get(eid) as
    | { until: string }
    | undefined)?.until

let shellCall = (command: string) => ({
  type: 'function_call' as const,
  id: 'item-1',
  call_id: 'call-1',
  name: 'shell',
  arguments: JSON.stringify({ command, cwd: null, timeout_ms: 1000 }),
})

Deno.test('managed Codex starts, runs tools, and settles in ordered entries', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync(), sid = session(db, tree)
  let heard: Change[] = [], called: string[] = []
  let queue = [
    result([{
      type: 'function_call',
      id: 'item-1',
      call_id: 'call-1',
      name: 'shell',
      arguments: JSON.stringify({
        command: 'printf worked',
        cwd: null,
        timeout_ms: 1000,
      }),
    }]),
    result([{
      type: 'message',
      id: 'item-2',
      content: [{ type: 'output_text', text: 'done' }],
    }]),
  ]
  let requests: Record<string, unknown>[] = []
  let service = managedCodex({
    db,
    cast: (changes) => heard.push(...changes),
    transport: {
      run: (request) => {
        requests.push(request)
        return Promise.resolve(queue.shift()!)
      },
    },
    tools: () => Promise.resolve(tools(called)),
    prepare: () => Promise.resolve(),
  })

  await service.start(sid, job(tree))
  let rows = readEntries(db, sid)
  assertEquals(rows.map((row) => row.seq), [1, 2, 3, 4, 5, 6])
  assertEquals(rows[0].comps.content.body, 'Do the task.')
  assertEquals(rows[2].comps.call.key, 'call-1')
  assertEquals(rows[3].comps.result.call, rows[2].eid)
  assertEquals(rows[3].comps.exit.code, 0)
  assertEquals(rows[5].comps.content.body, 'done')
  assertEquals(rows[4].comps.generation.serving_model, 'gpt-serving')
  assertEquals(rows[4].comps.usage.reasoning, 2)
  assertEquals(called, ['shell'])
  assertEquals(requests.length, 2)
  let batches = db.prepare('select via, batch from journal order by rowid')
    .all() as { via: string | null; batch: string }[]
  let birth = batches.find((batch) => {
    let changes = JSON.parse(batch.batch) as Change[]
    return changes.some((change) => change.eid == rows[0].eid) &&
      changes.some((change) => change.eid == rows[1].eid)
  })
  assertEquals(birth?.via, service.runner)
  for (let row of rows) {
    assertEquals(journalOf(db, row.eid)[0].via, service.runner)
  }
  assertEquals(
    db.prepare('select status from session where eid = ?').get(sid),
    { status: null },
  )
  assert(heard.some((change) => change.name == 'result'))
  db.close()
})

Deno.test('managed Codex relays typed progress until durable settlement', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync(), sid = session(db, tree)
  let timeline: string[] = []
  let observed: unknown[] = []
  let service = managedCodex({
    db,
    cast: (changes) => {
      if (changes.some((change) => change.name == 'output')) {
        timeline.push('durable')
      }
    },
    transport: {
      run: (_request, options) => {
        options?.event?.({
          type: 'response.reasoning_summary_text.delta',
          delta: 'checking',
          hidden: 'provider detail',
        })
        options?.event?.({
          type: 'response.output_item.added',
          item: {
            type: 'function_call',
            name: 'shell',
            arguments: 'not relayed',
          },
        })
        options?.event?.({
          type: 'response.output_text.delta',
          delta: 'almost done',
        })
        return Promise.resolve(result([{
          type: 'message',
          content: [{ type: 'output_text', text: 'done' }],
        }]))
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
    observe: (value) => {
      observed.push(value)
      timeline.push(value.kind)
    },
  })

  await service.start(sid, job(tree))
  assertEquals(observed, [{
    session: sid,
    generation: readEntries(db, sid)[1].eid,
    kind: 'reasoning',
    text: 'checking',
  }, {
    session: sid,
    generation: readEntries(db, sid)[1].eid,
    kind: 'tool',
    name: 'shell',
  }, {
    session: sid,
    generation: readEntries(db, sid)[1].eid,
    kind: 'model',
    text: 'almost done',
  }, {
    session: sid,
    generation: readEntries(db, sid)[1].eid,
    kind: 'clear',
  }])
  assertEquals(timeline, ['reasoning', 'tool', 'model', 'durable', 'clear'])
  assertEquals(JSON.stringify(observed).includes('provider detail'), false)
  assertEquals(JSON.stringify(observed).includes('not relayed'), false)
  db.close()
})

Deno.test('a reclaimed generation rejects its former lease observations', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync(), sid = session(db, tree)
  writeSession(db, sid, { base_revision: 'base' })
  let oldResult = Promise.withResolvers<ResponseResult>()
  let newResult = Promise.withResolvers<ResponseResult>()
  let oldStarted = Promise.withResolvers<void>()
  let newStarted = Promise.withResolvers<void>()
  let stale: ((event: ResponseEvent) => void) | undefined
  let observed: ({ source: string } & Observation)[] = []
  let old = managedCodex({
    db,
    cast: () => {},
    clock: () => new Date('2026-08-10T12:00:00Z'),
    leaseMs: 100,
    transport: {
      run: (_request, options) => {
        stale = options?.event
        oldStarted.resolve()
        return oldResult.promise
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
    observe: (value) => observed.push({ source: 'old', ...value }),
  })
  let first = old.start(sid, job(tree))
  await oldStarted.promise

  let replacement = managedCodex({
    db,
    cast: () => {},
    clock: () => new Date('2026-08-10T12:00:01Z'),
    leaseMs: 100,
    transport: {
      run: (_request, options) => {
        options?.event?.({
          type: 'response.output_text.delta',
          delta: 'winner progress',
        })
        newStarted.resolve()
        return newResult.promise
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
    observe: (value) => observed.push({ source: 'new', ...value }),
  })
  let second = replacement.sweep()
  await newStarted.promise
  stale?.({ type: 'response.output_text.delta', delta: 'stale progress' })
  oldResult.resolve(result([{
    type: 'message',
    content: [{ type: 'output_text', text: 'stale result' }],
  }]))
  await first
  assertEquals(observed, [{
    source: 'new',
    session: sid,
    generation: readEntries(db, sid)[1].eid,
    kind: 'model',
    text: 'winner progress',
  }])

  newResult.resolve(result([{
    type: 'message',
    content: [{ type: 'output_text', text: 'winner result' }],
  }]))
  await second
  assertEquals(observed.at(-1), {
    source: 'new',
    session: sid,
    generation: readEntries(db, sid)[1].eid,
    kind: 'clear',
  })
  assertEquals(
    readEntries(db, sid).at(-1)?.comps.content?.body,
    'winner result',
  )
  db.close()
})

Deno.test('replayed starts finish preparation without duplicating input', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync(), sid = session(db, tree)
  let prepares = 0, requests = 0
  let options = () => ({
    db,
    cast: () => {},
    transport: {
      run: () => {
        requests++
        return Promise.resolve(result([{
          type: 'message',
          content: [{ type: 'output_text', text: 'settled' }],
        }]))
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: (eid: string) => {
      prepares++
      writeSession(db, eid, { base_revision: 'base' })
      return Promise.resolve()
    },
  })
  let first = managedCodex(options())
  await Promise.all([first.start(sid, job(tree)), first.start(sid, job(tree))])
  let rows = readEntries(db, sid)
  assertEquals(
    rows.filter((row) => row.comps.message?.role == 'user').length,
    1,
  )
  assertEquals(rows.filter((row) => row.comps.generation).length, 1)
  assertEquals(prepares, 1)
  assertEquals(requests, 1)

  let restarted = managedCodex(options())
  await restarted.start(sid, job(tree))
  assertEquals(readEntries(db, sid).length, rows.length)
  assertEquals(prepares, 1)
  assertEquals(requests, 1)

  let stranded = session(db, tree), input = uuid(), generation = uuid()
  append(
    db,
    stranded,
    [{
      message: { role: 'user' },
      content: { body: 'already committed' },
    }, {
      generation: {
        through: input,
        provider: 'codex',
        model: 'gpt-requested',
      },
    }],
    restarted.runner,
    [input, generation],
  )
  await restarted.start(stranded, job(tree))
  rows = readEntries(db, stranded)
  assertEquals(
    rows.filter((row) => row.comps.message?.role == 'user').length,
    1,
  )
  assertEquals(rows.filter((row) => row.comps.generation).length, 1)
  assertEquals(prepares, 2)
  assertEquals(requests, 2)
  db.close()
})

Deno.test('projectless starts use Tasks tools without preparing a worktree', async () => {
  let db = open(':memory:')
  let sid = session(db), prepares = 0, requests = 0
  let trees: (string | undefined)[] = []
  let options = () => ({
    db,
    cast: () => {},
    transport: {
      run: () => {
        requests++
        return Promise.resolve(result([{
          type: 'message',
          content: [{ type: 'output_text', text: 'triaged' }],
        }]))
      },
    },
    tools: (tree: string | undefined) => {
      trees.push(tree)
      return Promise.resolve({
        tools: [{
          type: 'function' as const,
          name: 'task_context',
          description: 'test context',
          parameters: { type: 'object' },
          strict: true,
        }],
        call: () => Promise.resolve({ output: 'context' }),
      })
    },
    prepare: () => {
      prepares++
      return Promise.resolve()
    },
  })

  let first = managedCodex(options())
  await first.start(sid, noCodeJob())
  let entries = readEntries(db, sid)
  assertEquals(prepares, 0)
  assertEquals(requests, 1)
  assertEquals(trees, [undefined])
  assertEquals(entries.at(-1)?.comps.content.body, 'triaged')

  let restarted = managedCodex(options())
  await restarted.start(sid, noCodeJob())
  assertEquals(readEntries(db, sid).length, entries.length)
  assertEquals(prepares, 0)
  assertEquals(requests, 1)
  db.close()
})

Deno.test('a comment continues through one content-free attention entry', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync(),
    sid = session(db, tree),
    called: string[] = []
  let requests: Record<string, unknown>[] = []
  let queue = [
    result([{
      type: 'message',
      content: [{ type: 'output_text', text: 'idle' }],
    }]),
    result([{
      type: 'function_call',
      call_id: 'context-1',
      name: 'task_context',
      arguments: '{}',
    }]),
    result([{
      type: 'message',
      content: [{ type: 'output_text', text: 'heard' }],
    }]),
  ]
  let service = managedCodex({
    db,
    cast: () => {},
    transport: {
      run: (request) => {
        requests.push(request)
        return Promise.resolve(queue.shift()!)
      },
    },
    tools: () => Promise.resolve(tools(called)),
    prepare: () => Promise.resolve(),
  })
  await service.start(sid, job(tree))
  let comment = uuid()
  apply(db, [
    { eid: comment, name: 'doc', comp: { title: '', body: 'secret words' } },
    { eid: comment, name: 'comment', comp: { target: sid } },
  ])
  service.comment(sid, comment)
  await service.sweep()

  let rows = readEntries(db, sid)
  assertEquals(rows.filter((row) => row.comps.attention).length, 1)
  assertEquals(
    rows.some((row) => row.comps.content?.body == 'secret words'),
    false,
  )
  assertEquals(called, ['task_context'])
  let replay = JSON.stringify(requests[1].input)
  assertMatch(replay, /Task Graph has pending messages/)
  assertEquals(replay.includes('secret words'), false)
  db.close()
})

Deno.test('an appended user message continues in the ordered log', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync(), sid = session(db, tree)
  let requests: Record<string, unknown>[] = []
  let queue = [
    result([{
      type: 'message',
      content: [{ type: 'output_text', text: 'idle' }],
    }]),
    result([{
      type: 'message',
      content: [{ type: 'output_text', text: 'continued' }],
    }]),
  ]
  let service = managedCodex({
    db,
    cast: () => {},
    transport: {
      run: (request) => {
        requests.push(request)
        return Promise.resolve(queue.shift()!)
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
  })
  await service.start(sid, job(tree))
  let input = uuid()
  apply(db, [
    { eid: input, name: 'entry', comp: { session: sid } },
    { eid: input, name: 'message', comp: { role: 'user' } },
    { eid: input, name: 'content', comp: { body: 'keep going directly' } },
  ])
  await service.sweep()

  let rows = readEntries(db, sid)
  assertEquals(rows.filter((row) => row.comps.attention).length, 0)
  assertEquals(
    rows.find((row) => row.eid == input)?.comps.content?.body,
    'keep going directly',
  )
  assertMatch(JSON.stringify(requests[1].input), /keep going directly/)
  assertEquals(rows.at(-1)?.comps.content?.body, 'continued')
  db.close()
})

Deno.test('attention during a generation waits for its next boundary', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync(), sid = session(db, tree)
  let started = Promise.withResolvers<void>()
  let first = Promise.withResolvers<ResponseResult>()
  let requests: Record<string, unknown>[] = []
  let calls = 0
  let service = managedCodex({
    db,
    cast: () => {},
    transport: {
      run: (request) => {
        requests.push(request)
        if (!calls++) {
          started.resolve()
          return first.promise
        }
        return Promise.resolve(result([{
          type: 'message',
          content: [{ type: 'output_text', text: 'steered' }],
        }]))
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
  })
  let running = service.start(sid, job(tree))
  await started.promise
  let comment = uuid()
  apply(db, [
    { eid: comment, name: 'doc', comp: { title: '', body: 'late secret' } },
    { eid: comment, name: 'comment', comp: { target: sid } },
  ])
  service.comment(sid, comment)
  first.resolve(result([{
    type: 'message',
    content: [{ type: 'output_text', text: 'first boundary' }],
  }]))
  await running

  let rows = readEntries(db, sid)
  assertEquals(rows.filter((row) => row.comps.generation).length, 2)
  assertEquals(rows.filter((row) => row.comps.attention).length, 1)
  assertEquals(rows.at(-1)?.comps.content?.body, 'steered')
  let replay = JSON.stringify(requests[1].input)
  assertMatch(replay, /Task Graph has pending messages/)
  assertEquals(replay.includes('late secret'), false)
  db.close()
})

Deno.test('comments on claimed work wake its graph-native holder', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync(), sid = session(db, tree)
  let called: string[] = [], requests: Record<string, unknown>[] = []
  let queue = [
    result([{
      type: 'message',
      content: [{ type: 'output_text', text: 'idle' }],
    }]),
    result([{
      type: 'function_call',
      call_id: 'claimed-context',
      name: 'task_context',
      arguments: '{}',
    }]),
    result([{
      type: 'message',
      content: [{ type: 'output_text', text: 'heard claimed work' }],
    }]),
  ]
  let service = managedCodex({
    db,
    cast: () => {},
    transport: {
      run: (request) => {
        requests.push(request)
        return Promise.resolve(queue.shift()!)
      },
    },
    tools: () => Promise.resolve(tools(called)),
    prepare: () => Promise.resolve(),
  })
  await service.start(sid, job(tree))
  let task = uuid(), comment = uuid()
  apply(db, [{
    eid: task,
    name: 'task',
    comp: { status: 'wip' },
  }, {
    eid: task,
    name: 'claim',
    comp: { session: sid },
  }, {
    eid: comment,
    name: 'doc',
    comp: { title: '', body: 'claimed task words' },
  }, {
    eid: comment,
    name: 'comment',
    comp: { target: task },
  }])
  service.comment(task, comment)
  await service.sweep()

  let rows = readEntries(db, sid)
  assertEquals(rows.filter((row) => row.comps.attention).length, 1)
  assertEquals(called, ['task_context'])
  let replay = JSON.stringify(requests[1].input)
  assertMatch(replay, /Task Graph has pending messages/)
  assertEquals(replay.includes('claimed task words'), false)

  let own = uuid()
  apply(
    db,
    [{
      eid: own,
      name: 'doc',
      comp: { title: '', body: 'my own update' },
    }, {
      eid: own,
      name: 'comment',
      comp: { target: task },
    }],
    undefined,
    sid,
  )
  service.comment(task, own)
  await service.sweep()
  assertEquals(
    readEntries(db, sid).filter((row) => row.comps.attention).length,
    1,
  )
  db.close()
})

Deno.test('a failed generation consumes its wake and accepts the next', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync(), sid = session(db, tree), calls = 0
  let service = managedCodex({
    db,
    cast: () => {},
    transport: {
      run: () => {
        if (calls++ == 1) return Promise.reject(new Error('provider down'))
        return Promise.resolve(result([{
          type: 'message',
          content: [{
            type: 'output_text',
            text: calls == 1 ? 'idle' : 'recovered',
          }],
        }]))
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
  })
  await service.start(sid, job(tree))
  for (let body of ['first wake', 'second wake']) {
    let comment = uuid()
    apply(db, [
      { eid: comment, name: 'doc', comp: { title: '', body } },
      { eid: comment, name: 'comment', comp: { target: sid } },
    ])
    service.comment(sid, comment)
    await service.sweep()
  }

  let rows = readEntries(db, sid)
  assertEquals(rows.filter((row) => row.comps.attention).length, 2)
  assertEquals(rows.filter((row) => row.comps.generation).length, 3)
  assertEquals(rows.at(-1)?.comps.content?.body, 'recovered')
  assertEquals(
    db.prepare('select 1 from error where eid = ?').get(sid),
    undefined,
  )
  db.close()
})

Deno.test('a failed generation persists the provider reason, not the bare status', async () => {
  // End to end through the real Responses transport: a 400 whose complaint
  // lives only in the body `message` must reach the session error, or a
  // graph-native failure reads as the useless `responses: HTTP 400` (T-16887).
  let db = open(':memory:')
  let sid = session(db)
  let transport = responses({
    credentials: { get: () => Promise.resolve({ token: 'secret-token' }) },
    fetch: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              message: 'No tool output found for function call call_7.',
              type: 'invalid_request_error',
              code: null,
            },
          }),
          { status: 400 },
        ),
      ),
  })
  let service = managedCodex({
    db,
    cast: () => {},
    transport,
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
  })
  await service.start(sid, noCodeJob())
  let error = db.prepare('select message from error where eid = ?').get(sid) as
    | { message: string }
    | undefined
  assertEquals(
    error?.message,
    'responses: HTTP 400 — No tool output found for function call call_7.',
  )
  db.close()
})

Deno.test('stop aborts the leased generation and refuses its late output', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync(),
    sid = session(db, tree),
    started = Promise.withResolvers<void>(),
    calls = 0
  let service = managedCodex({
    db,
    cast: () => {},
    transport: {
      run: (_request, options) => {
        if (!calls++) {
          started.resolve()
          return new Promise((_resolve, reject) =>
            options?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('stopped', 'AbortError')),
              { once: true },
            )
          )
        }
        return Promise.resolve(result([{
          type: 'message',
          content: [{ type: 'output_text', text: 'resumed after stop' }],
        }]))
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
  })
  let running = service.start(sid, job(tree))
  await started.promise
  let request = uuid()
  apply(db, [{ eid: request, name: 'stop_request', comp: { target: sid } }])
  assertEquals(await service.stop(request, sid), true)
  await running

  let rows = readEntries(db, sid)
  assertEquals(rows.filter((row) => row.comps.cancel).length, 1)
  assertEquals(rows.some((row) => row.comps.output), false)
  assertEquals(
    !!db.prepare('select 1 from delivered where eid = ?').get(request),
    true,
  )
  let comment = uuid()
  apply(db, [
    { eid: comment, name: 'doc', comp: { title: '', body: 'resume' } },
    { eid: comment, name: 'comment', comp: { target: sid } },
  ])
  service.comment(sid, comment)
  await service.sweep()
  rows = readEntries(db, sid)
  assertEquals(rows.filter((row) => row.comps.generation).length, 2)
  assertEquals(rows.at(-1)?.comps.content?.body, 'resumed after stop')
  db.close()
})

Deno.test('deleting a Session aborts its flight after entry cascades', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync(), sid = session(db, tree)
  let started = Promise.withResolvers<void>(), aborted = false
  let service = managedCodex({
    db,
    cast: () => {},
    transport: {
      run: (_request, options) => {
        started.resolve()
        return new Promise((_resolve, reject) =>
          options?.signal?.addEventListener('abort', () => {
            aborted = true
            reject(new DOMException('deleted', 'AbortError'))
          }, { once: true })
        )
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
  })
  let running = service.start(sid, job(tree))
  await started.promise
  apply(db, [{ eid: sid, name: 'entity', comp: null }])
  service.remove(sid)
  await running

  assertEquals(aborted, true)
  assertEquals(readEntries(db, sid), [])
  db.close()
})

Deno.test('restart reclaims a lost generation without minting another', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync()
  let sid = session(db, tree), old = uuid(), calls = 0
  writeSession(db, sid, { base_revision: 'base' })
  apply(db, [{ eid: old, name: 'runner', comp: { name: 'old' } }])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: {
      through: input,
      provider: 'codex',
      model: 'gpt-requested',
    },
  }]).eids[0]
  takeEntry(
    db,
    generation,
    old,
    100,
    () => new Date('2026-08-10T12:00:00Z'),
  )
  let service = managedCodex({
    db,
    cast: () => {},
    clock: () => new Date('2026-08-10T12:00:01Z'),
    transport: {
      run: () => {
        calls++
        return Promise.resolve(result([{
          type: 'message',
          content: [{ type: 'output_text', text: 'recovered deliberately' }],
        }]))
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
  })
  await service.sweep()
  let rows = readEntries(db, sid)
  assertEquals(calls, 1)
  assertEquals(rows.filter((row) => row.comps.generation).length, 1)
  assertEquals(
    rows.find((row) => row.eid == generation)?.comps.error,
    undefined,
  )
  assertEquals(
    rows.find((row) => row.eid == generation)?.comps.delivered?.via,
    'runner:tasksd',
  )
  assertEquals(rows.at(-1)?.comps.content?.body, 'recovered deliberately')
  db.close()
})

Deno.test('restart reclaims graph_query on the same call entry', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync()
  let sid = session(db, tree), old = uuid(), calls = 0
  writeSession(db, sid, { base_revision: 'base' })
  apply(db, [{ eid: old, name: 'runner', comp: { name: 'old' } }])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-requested' },
  }]).eids[0]
  let generationLease = takeEntry(db, generation, old)!
  let query = append(db, sid, [{
    output: { source: generation },
    call: { key: 'recovered-query' },
    graph_query: { query: '.task.status=open' },
  }], old).eids[0]
  settleGeneration(db, generationLease.token)
  takeEntry(
    db,
    query,
    old,
    100,
    () => new Date('2026-08-10T12:00:00Z'),
  )
  let service = managedCodex({
    db,
    cast: () => {},
    clock: () => new Date('2026-08-10T12:00:01Z'),
    transport: {
      run: () =>
        Promise.resolve(result([{
          type: 'message',
          content: [{ type: 'output_text', text: 'continued after query' }],
        }])),
    },
    tools: () =>
      Promise.resolve({
        tools: [],
        call: (name) => {
          calls++
          assertEquals(name, 'graph_query')
          return Promise.resolve({ output: 'one graph result' })
        },
      }),
    prepare: () => Promise.resolve(),
  })
  await service.sweep()

  let rows = readEntries(db, sid)
  assertEquals(calls, 1)
  assertEquals(rows.filter((row) => row.eid == query).length, 1)
  assertEquals(
    rows.filter((row) => row.comps.result?.call == query).length,
    1,
  )
  assertEquals(
    rows.find((row) => row.comps.result?.call == query)?.comps.content.body,
    'one graph result',
  )
  db.close()
})

Deno.test('restart leaves an uncertain side-effecting call ambiguous', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync()
  let sid = session(db, tree), old = uuid(), calls = 0
  writeSession(db, sid, { base_revision: 'base' })
  apply(db, [{ eid: old, name: 'runner', comp: { name: 'old' } }])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-requested' },
  }]).eids[0]
  let lease = takeEntry(db, generation, old)!
  append(db, sid, [{
    output: { source: generation },
    call: { key: 'uncertain-shell' },
    bash: { command: 'do-not-repeat' },
  }], old)
  settleGeneration(db, lease.token)
  let call = readEntries(db, sid).at(-1)!.eid
  takeEntry(
    db,
    call,
    old,
    100,
    () => new Date('2026-08-10T12:00:00Z'),
  )
  let service = managedCodex({
    db,
    cast: () => {},
    clock: () => new Date('2026-08-10T12:00:01Z'),
    transport: {
      run: () =>
        Promise.resolve(result([{
          type: 'message',
          content: [{ type: 'output_text', text: 'continued safely' }],
        }])),
    },
    tools: () =>
      Promise.resolve({
        ...tools([]),
        call: () => {
          calls++
          return Promise.resolve({ output: 'repeated' })
        },
      }),
    prepare: () => Promise.resolve(),
  })
  await service.sweep()
  let row = readEntries(db, sid).find((row) => row.eid == call)!
  assertMatch(String(row.comps.error.message), /outcome is ambiguous/)
  assertEquals(row.comps.lease, undefined)
  assertEquals(calls, 0)
  db.close()
})

Deno.test('a killed in-flight call recovers: replay pairs the orphaned call with an output', async () => {
  // The real poison (S-16840/S-16872): a hosted shell call in flight when the
  // runner died, reconciled to an error with no result. Before the fix the next
  // generation's Responses input carried an orphaned function_call and every
  // resume returned HTTP 400. Drive the whole path — reconciliation, advance,
  // project, transport — and assert the input the provider sees is valid and the
  // session recovers.
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync()
  let sid = session(db, tree), old = uuid()
  writeSession(db, sid, { base_revision: 'base' })
  apply(db, [{ eid: old, name: 'runner', comp: { name: 'old' } }])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-requested' },
  }]).eids[0]
  let lease = takeEntry(db, generation, old)!
  append(db, sid, [{
    output: { source: generation },
    call: { key: 'call_orphan' },
    bash: { command: 'git commit -m rescue-me' },
  }], old)
  settleGeneration(db, lease.token)
  let call = readEntries(db, sid).at(-1)!.eid
  // The call is leased by the dead runner and its lease has already expired.
  takeEntry(db, call, old, 100, () => new Date('2026-08-10T12:00:00Z'))

  let inputs: unknown[][] = []
  let service = managedCodex({
    db,
    cast: () => {},
    clock: () => new Date('2026-08-10T12:00:01Z'),
    transport: {
      run: (request) => {
        let items = request.input as { type?: string; call_id?: string }[]
        inputs.push(items)
        let calls = items.filter((item) => item.type == 'function_call')
        let outputs = new Set(
          items.filter((item) => item.type == 'function_call_output')
            .map((item) => item.call_id),
        )
        let orphan = calls.find((item) => !outputs.has(item.call_id))
        if (orphan) {
          throw new Error(`orphaned function_call ${orphan.call_id} in input`)
        }
        return Promise.resolve(result([{
          type: 'message',
          content: [{ type: 'output_text', text: 'recovered and landed' }],
        }]))
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
  })
  await service.sweep()

  let rows = readEntries(db, sid)
  // Reconciliation happened: the orphaned call is errored, no fabricated result.
  let callRow = rows.find((row) => row.eid == call)!
  assertMatch(String(callRow.comps.error.message), /outcome is ambiguous/)
  assertEquals(rows.some((row) => row.comps.result?.call == call), false)
  // The provider saw a valid input: the orphaned call paired with an output.
  let replay = inputs.at(-1)! as { type?: string; call_id?: string }[]
  assertEquals(replay.some((item) => item.type == 'function_call'), true)
  assertEquals(
    replay.some((item) =>
      item.type == 'function_call_output' && item.call_id == 'call_orphan'
    ),
    true,
  )
  // The session recovered end to end, with no lingering error.
  assertEquals(rows.at(-1)?.comps.content?.body, 'recovered and landed')
  assertEquals(
    db.prepare('select 1 from error where eid = ?').get(sid),
    undefined,
  )
  db.close()
})

Deno.test('restart settles durable generation and call evidence', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync(), sid = session(db, tree)
  let old = uuid(), calls = 0
  writeSession(db, sid, { base_revision: 'base' })
  apply(db, [{ eid: old, name: 'runner', comp: { name: 'old' } }])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-requested' },
  }]).eids[0]
  let generationLease = takeEntry(
    db,
    generation,
    old,
    100,
    () => new Date('2026-08-10T12:00:00Z'),
  )!
  append(db, sid, [{
    output: { source: generation },
    call: { key: 'durable-call' },
    task_context: {},
  }], old)
  let call = readEntries(db, sid).at(-1)!.eid
  let callLease = takeEntry(
    db,
    call,
    old,
    100,
    () => new Date('2026-08-10T12:00:00Z'),
  )!
  append(db, sid, [{
    result: { call },
    content: { body: 'durable result' },
  }], old)
  let service = managedCodex({
    db,
    cast: () => {},
    clock: () => new Date('2026-08-10T12:00:01Z'),
    transport: {
      run: () => {
        calls++
        return Promise.resolve(result([{
          type: 'message',
          content: [{ type: 'output_text', text: 'after recovered call' }],
        }]))
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
  })
  await service.sweep()
  assertEquals(
    !!db.prepare('select 1 from delivered where eid = ?').get(generation),
    true,
  )
  assertEquals(
    db.prepare('select 1 from error where eid = ?').get(generation),
    undefined,
  )
  assertEquals(generationLease.token.eid, generation)
  let rows = readEntries(db, sid)
  assertEquals(callLease.token.eid, call)
  assertEquals(rows.find((row) => row.eid == call)?.comps.lease, undefined)
  assertEquals(rows.find((row) => row.eid == call)?.comps.error, undefined)
  assertEquals(rows.at(-1)?.comps.content?.body, 'after recovered call')
  assertEquals(calls, 1)
  db.close()
})

Deno.test('drain settles the in-flight generation and leaves new work ready', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync(), sid = session(db, tree)
  writeSession(db, sid, { base_revision: 'base' })
  let started = Promise.withResolvers<void>()
  let gate = Promise.withResolvers<ResponseResult>()
  let calls = 0
  let service = managedCodex({
    db,
    cast: () => {},
    transport: {
      run: () => {
        if (!calls++) {
          started.resolve()
          return gate.promise
        }
        return Promise.resolve(result([{
          type: 'message',
          content: [{ type: 'output_text', text: 'unreached' }],
        }]))
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
  })
  let running = service.start(sid, job(tree))
  await started.promise
  // Drain, then let the held generation complete with a follow-on tool call.
  let drained = service.settle(5000)
  gate.resolve(result([shellCall('printf hi')]))
  await drained
  await running

  let rows = readEntries(db, sid)
  let generation = rows.find((row) => row.comps.generation)!
  // The in-flight generation reached a settled boundary.
  assert(generation.comps.delivered)
  assertEquals(generation.comps.lease, undefined)
  assertEquals(generation.comps.error, undefined)
  // Its follow-on tool call was never started: it sits ready for the successor.
  let call = rows.find((row) => row.comps.call)!
  assertEquals(call.comps.lease, undefined)
  assertEquals(call.comps.result, undefined)
  assertEquals(call.comps.error, undefined)
  assertEquals(readyEntries(db, sid).map((e) => e.eid), [call.eid])
  assertEquals(calls, 1)
  db.close()
})

slow(
  'the heartbeat keeps a generation outliving its lease TTL fresh',
  async () => {
    let db = open(':memory:')
    let tree = Deno.makeTempDirSync(), sid = session(db, tree)
    writeSession(db, sid, { base_revision: 'base' })
    let started = Promise.withResolvers<void>()
    let gate = Promise.withResolvers<ResponseResult>()
    let service = managedCodex({
      db,
      cast: () => {},
      leaseMs: 200,
      transport: {
        run: () => {
          started.resolve()
          return gate.promise
        },
      },
      tools: () => Promise.resolve(tools([])),
      prepare: () => Promise.resolve(),
    })
    let running = service.start(sid, job(tree))
    await started.promise
    let generation =
      readEntries(db, sid).find((row) => row.comps.generation)!.eid
    let until0 = leaseUntil(db, generation)!
    // Hold the turn well past the 200ms TTL; the heartbeat renews it.
    await delay(500)
    assertEquals(expiredLeases(db, new Date().toISOString()).length, 0)
    assert(leaseUntil(db, generation)! > until0)
    gate.resolve(result([{
      type: 'message',
      content: [{ type: 'output_text', text: 'done' }],
    }]))
    await running
    assertEquals(leaseUntil(db, generation), undefined)
    db.close()
  },
)

slow(
  'a restart mid-generation: predecessor drains, successor resumes clean',
  async () => {
    let dir = Deno.makeTempDirSync(), path = `${dir}/graph.db`
    let db1 = open(path), db2 = open(path)
    let tree = Deno.makeTempDirSync(), sid = session(db1, tree)
    writeSession(db1, sid, { base_revision: 'base' })

    let started = Promise.withResolvers<void>()
    let gate = Promise.withResolvers<ResponseResult>()
    // Predecessor holds one generation in flight, blocked on the gate.
    let pre = managedCodex({
      db: db1,
      cast: () => {},
      leaseMs: 200,
      transport: {
        run: () => {
          started.resolve()
          return gate.promise
        },
      },
      tools: () => Promise.resolve(tools([])),
      prepare: () => Promise.resolve(),
    })
    let running = pre.start(sid, job(tree))
    await started.promise
    let generation =
      readEntries(db1, sid).find((row) => row.comps.generation)!.eid

    // Successor boots on the same graph and sweeps across a window longer than
    // the 200ms TTL. The heartbeated lease must keep it from reclaiming or
    // failing the predecessor's live turn.
    let sucCalls = 0
    let suc = managedCodex({
      db: db2,
      cast: () => {},
      leaseMs: 200,
      transport: {
        run: () => {
          sucCalls++
          return Promise.resolve(result([{
            type: 'message',
            content: [{ type: 'output_text', text: 'resumed and finished' }],
          }]))
        },
      },
      tools: () => Promise.resolve(tools([])),
      prepare: () => Promise.resolve(),
    })
    for (let i = 0; i < 4; i++) {
      await suc.sweep()
      await delay(100)
    }
    assertEquals(sucCalls, 0)
    let held = readEntries(db2, sid).find((row) => row.eid == generation)!
    assert(held.comps.lease)
    assertEquals(held.comps.error, undefined)

    // The predecessor drains: the in-flight generation completes and settles.
    let drained = pre.settle(5000)
    gate.resolve(result([shellCall('printf hi')]))
    await drained
    await running
    let after = readEntries(db1, sid).find((row) => row.eid == generation)!
    assert(after.comps.delivered)
    assertEquals(after.comps.error, undefined)

    // The successor resumes from the settled boundary and finishes the session.
    await suc.sweep()
    let rows = readEntries(db2, sid)
    assertEquals(rows.at(-1)?.comps.content?.body, 'resumed and finished')
    assertEquals(rows.some((row) => row.comps.error), false)
    assertEquals(rows.some((row) => row.comps.result), true)
    assert(sucCalls >= 1)
    db1.close()
    db2.close()
  },
)

Deno.test('graph-native compaction bounds replay across a restart and a later turn', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync(), sid = session(db, tree)
  // A preset base_revision makes the Session runnable for any daemon instance,
  // so the restart picks up pending work straight from the graph.
  writeSession(db, sid, { base_revision: 'base' })
  let instructionMark = `ORIGINAL_INSTRUCTION_${uuid()}`
  let compactionMark = `COMPACTION_BLOB_${uuid()}`

  // One provider result carrying explicit usage, so context telemetry is
  // traceable per turn.
  let reply = (
    items: ResponseResult['items'],
    input: number,
  ): ResponseResult => ({
    model: 'gpt-serving',
    items,
    unknown: [],
    unknownItems: [],
    usage: { input, cached: 0, output: 5, reasoning: 2, raw: {} },
    response: {},
    limits: {},
  })
  let shell = (id: string, command: string) => ({
    type: 'function_call',
    id,
    call_id: id,
    name: 'shell',
    arguments: JSON.stringify({ command, cwd: null, timeout_ms: 1000 }),
  })
  let compaction = {
    type: 'compaction',
    id: 'compact-1',
    summary: [{ type: 'summary_text', text: 'portable running summary' }],
    encrypted_content: compactionMark,
  }

  // Requests and replies are shared closures, so the second daemon instance
  // continues the same provider conversation a restart would.
  let requests: Record<string, unknown>[] = []
  let replies = [
    reply([shell('call-1', 'printf one')], 250_000), // pre-compaction, large
    reply([compaction, shell('call-2', 'printf two')], 260_000), // compacts
    reply([{
      type: 'message',
      id: 'phase-one',
      content: [{ type: 'output_text', text: 'phase one done' }],
    }], 42_000), // post-compaction, bounded
  ]
  let options = (): ManagedCodexOptions => ({
    db,
    cast: () => {},
    transport: {
      run: (request) => {
        requests.push(request)
        return Promise.resolve(replies.shift()!)
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
  })

  let service = managedCodex(options())
  await service.start(sid, {
    ...job(tree),
    instruction: `${instructionMark} run the long chain`,
  })
  assertEquals(
    readEntries(db, sid).filter((row) => row.comps.message?.role == 'agent')
      .at(-1)?.comps.content.body,
    'phase one done',
  )
  // A checkpoint entry was retained from the compaction item, its immutable
  // audit prefix untouched.
  let checkpoint = readEntries(db, sid).find((row) => row.comps.checkpoint)!
  assertEquals(checkpoint.comps.opaque.format, 'openai:compaction')

  // The request that ran the generation AFTER the compaction is bounded: it
  // carries the compaction item, not the original instruction.
  let bounded = requests.at(-1)!
  let boundedInput = JSON.stringify(bounded.input)
  assertEquals(boundedInput.includes(compactionMark), true)
  assertEquals(boundedInput.includes(instructionMark), false)
  // The first request, before any checkpoint existed, did carry the original.
  assertEquals(
    JSON.stringify(requests[0].input).includes(instructionMark),
    true,
  )

  // A DIFFERENT daemon instance (restart) with no shared in-memory state, plus
  // a later user turn, still replays a bounded request derived from entries.
  replies.push(reply([{
    type: 'message',
    id: 'phase-two',
    content: [{ type: 'output_text', text: 'phase two done' }],
  }], 44_000))
  let restarted = managedCodex(options())
  append(db, sid, [{
    message: { role: 'user' },
    content: { body: 'now do phase two' },
  }], restarted.runner)
  await restarted.sweep()

  let afterRestart = requests.at(-1)!
  let restartInput = JSON.stringify(afterRestart.input)
  assertEquals(restartInput.includes(compactionMark), true)
  assertEquals(restartInput.includes(instructionMark), false)
  assertEquals(restartInput.includes('now do phase two'), true)
  assertEquals(
    readEntries(db, sid).filter((row) => row.comps.message?.role == 'agent')
      .at(-1)?.comps.content.body,
    'phase two done',
  )

  // The full transcript still renders from entries: the original instruction,
  // both tool calls, and the checkpoint are all present.
  let log = graphLog(readEntries(db, sid))
  let rendered = JSON.stringify(log.entries)
  assertEquals(rendered.includes(instructionMark), true)
  assertEquals(
    log.entries.some((entry) =>
      entry.row?.kind == 'sys' &&
      entry.row.tag == 'checkpoint'
    ),
    true,
  )
  assertEquals(
    log.entries.filter((entry) => entry.row?.kind == 'exec').length,
    2,
  )
  // Context telemetry reflects the post-compaction request, not the pre.
  assertEquals(log.context, 44_000)

  // Every provider request kept store:false is not the concern here; every
  // usage the graph recorded came from its own bounded turn.
  assertEquals(
    readEntries(db, sid).filter((row) => row.comps.usage)
      .map((row) => Number(row.comps.usage.input)),
    [250_000, 260_000, 42_000, 44_000],
  )
  db.close()
})
