// The graph-native managed lifecycle against an in-memory graph and injected
// provider/tools. No process, credential, or owner graph participates.
import { assert, assertEquals, assertMatch } from '@std/assert'
import { apply, journalOf, open } from './db.ts'
import { append, readEntries, settleGeneration, takeEntry } from './entries.ts'
import { managedCodex } from './managed_codex.ts'
import { type ResponseResult } from './responses.ts'
import { type ToolHost } from './harness_tools.ts'
import { type Change, uuid } from './types.ts'

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
      db.prepare('update session set base_revision = ? where eid = ?')
        .run('base', eid)
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
  db.prepare('update session set base_revision = ? where eid = ?')
    .run('base', sid)
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

Deno.test('restart leaves an uncertain side-effecting call ambiguous', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync()
  let sid = session(db, tree), old = uuid(), calls = 0
  db.prepare('update session set base_revision = ? where eid = ?')
    .run('base', sid)
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

Deno.test('restart settles durable generation and call evidence', async () => {
  let db = open(':memory:')
  let tree = Deno.makeTempDirSync(), sid = session(db, tree)
  let old = uuid(), calls = 0
  db.prepare('update session set base_revision = ? where eid = ?')
    .run('base', sid)
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
