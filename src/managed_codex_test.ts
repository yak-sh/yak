// The graph-native managed lifecycle against an in-memory graph and injected
// provider/tools. No process, credential, or owner graph participates.
import { assert, assertEquals, assertMatch, assertThrows } from '@std/assert'
import { apply, cursorOf, journalOf, journalSince, readComp } from './db.ts'
import {
  append,
  expiredLeases,
  failEntry,
  readEntries,
  readyEntries,
  settleGeneration,
  takeEntry,
} from './entries.ts'
import { graphLog, sessionStateOf } from './entry_log.ts'
import {
  advanceable,
  attention,
  graphSession,
  managedCodex,
  type ManagedCodexOptions,
  retryCredential,
  runnerSessions,
} from './managed_codex.ts'
import { CODEX_REAUTH } from './codex_auth.ts'
import { type Observation } from './observations.ts'
import {
  CREDENTIAL_FAULT,
  type ResponseEvent,
  type ResponseResult,
  responses,
} from './responses.ts'
import { writeSession } from './session_store.ts'
import { type ToolHost } from './harness_tools.ts'
import { type Change, uuid } from './types.ts'
import { slow, until } from './testing.ts'
import { bareDb, freshDb, rejectJournal } from './testdb.ts'
import { open } from './store/sqlite.ts'

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
  db.prepare(
    "update session set origin = 'managed' where entity = (select id from entity where eid = ?)",
  ).run(eid)
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
  (db.prepare(
    'select until from lease where entity = (select id from entity where eid = ?)',
  ).get(eid) as
    | { until: string }
    | undefined)?.until

let shellCall = (command: string) => ({
  type: 'function_call' as const,
  id: 'item-1',
  call_id: 'call-1',
  name: 'shell',
  arguments: JSON.stringify({ command, cwd: null, timeout_ms: 1000 }),
})

slow('the runner ignores imported-only session partitions', () => {
  let db = freshDb()
  let history = session(db)
  let old = uuid()
  append(
    db,
    history,
    [{ message: { role: 'user' } }, {
      generation: { through: old, provider: 'codex', model: 'old' },
    }],
    null,
    [old, uuid()],
    { source: 'managed', line: 1 },
  )
  append(db, history, [{
    content: { body: 'M-1 · related thought' },
    recalled: { source: old },
  }])
  let managed = session(db)
  let input = uuid()
  append(
    db,
    managed,
    [{ message: { role: 'user' } }, {
      generation: { through: input, provider: 'codex', model: 'current' },
    }],
    null,
    [input, uuid()],
  )

  assertEquals(runnerSessions(db), [managed])
  assertEquals(graphSession(db, history), false)
  assertEquals(graphSession(db, managed), true)
  db.close()
})

slow(
  'retired operators stay idle through starts, boot recovery, and comments',
  async () => {
    let db = freshDb()
    let role = uuid(), old = uuid(), calls = 0
    apply(db, [
      { eid: role, name: 'role', comp: { state: 'running' } },
      { eid: old, name: 'runner', comp: { name: 'old' } },
    ])
    let clock = () => new Date('2026-09-09T12:00:00Z')
    let service = managedCodex({
      db,
      cast: () => {},
      clock,
      transport: {
        run: () => {
          calls++
          return Promise.resolve(result([{
            type: 'message',
            content: [{ type: 'output_text', text: 'done' }],
          }]))
        },
      },
      tools: () => Promise.resolve(tools([])),
      prepare: () => Promise.resolve(),
    })
    try {
      for (let binding of [{ role }, { operator: true }]) {
        for (let state of ['fresh', 'ready', 'expired', 'leased', 'settled']) {
          let sid = session(db)
          apply(db, [{ eid: sid, name: 'session', comp: binding }])
          if (state != 'fresh') {
            let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
            let generation = append(db, sid, [{
              generation: { through: input, provider: 'codex', model: 'test' },
            }]).eids[0]
            if (state != 'ready') {
              let time = state == 'expired'
                ? new Date(clock().getTime() - 1_000)
                : clock()
              let lease = takeEntry(db, generation, old, 100, () => time)!
              if (state == 'settled') {
                settleGeneration(db, lease.token)
                append(db, sid, [{ attention: {} }])
              }
            }
          }
          let before = readEntries(db, sid)
          await service.start(sid, noCodeJob())
          await service.sweep()
          if (state != 'fresh') {
            let task = uuid(), comment = uuid()
            apply(db, [
              { eid: task, name: 'task', comp: {} },
              { eid: task, name: 'claim', comp: { session: sid } },
              { eid: comment, name: 'comment', comp: { target: task } },
            ])
            service.comment(task, comment)
            service.comment(sid, comment)
            await service.sweep()
          }
          assertEquals(readEntries(db, sid), before, state)
          assertEquals(calls, 0, state)
        }
      }
      await service.start(session(db), noCodeJob())
      assertEquals(calls, 1, 'ordinary headless sessions still run')
    } finally {
      await service.settle()
      db.close()
    }
  },
)

slow(
  'managed Codex starts, runs tools, and settles in ordered entries',
  async () => {
    let db = freshDb()
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
    assert(rows[0].comps.prompt)
    assertEquals(rows[0].comps.content.body, 'Do the task.')
    assertEquals(rows[2].comps.call.key, 'call-1')
    assertEquals(rows[3].comps.result.call, rows[2].eid)
    assertEquals(rows[3].comps.exit.code, 0)
    assertEquals(rows[5].comps.content.body, 'done')
    assertEquals(rows[4].comps.generation.serving_model, 'gpt-serving')
    assertEquals(rows[4].comps.usage.reasoning, 2)
    assertEquals(called, ['shell'])
    assertEquals(requests.length, 2)
    let batches = journalSince(db, 0)
    let birth = batches.find((batch) => {
      let changes: Change[] = batch.batch
      return changes.some((change) => change.eid == rows[0].eid) &&
        changes.some((change) => change.eid == rows[1].eid)
    })
    assertEquals(birth?.via, service.runner)
    for (let row of rows) {
      assertEquals(journalOf(db, row.eid)[0].via, service.runner)
    }
    assertEquals(
      db.prepare(
        'select status from session where entity = (select id from entity where eid = ?)',
      ).get(sid),
      { status: null },
    )
    assert(heard.some((change) => change.name == 'result'))
    db.close()
  },
)

slow(
  'graph-native seeds persona and prompt as two ordered entries, persona collapsed',
  async () => {
    let db = freshDb()
    let sid = session(db)
    let service = managedCodex({
      db,
      cast: () => {},
      transport: {
        run: () =>
          Promise.resolve(result([{
            type: 'message',
            content: [{ type: 'output_text', text: 'ok' }],
          }])),
      },
      tools: () => Promise.resolve(tools([])),
      prepare: () => Promise.resolve(),
    })
    await service.start(sid, {
      persona: 'You are the voice.',
      prompt: 'T-1: do the thing',
      instruction: 'You are the voice.\n\ndo the thing',
      session_id: uuid(),
      model: 'gpt-requested',
      effort: 'high',
    })

    let rows = readEntries(db, sid)
    let users = rows.filter((row) => row.comps.message?.role == 'user')
    // Two ordered user entries: persona first, prompt second.
    assertEquals(users.length, 2)
    assertEquals(users[0].comps.content.body, 'You are the voice.')
    assertEquals(users[1].comps.content.body, 'T-1: do the thing')
    // Only the persona wears the `prompt` facet, so only it collapses.
    assert(users[0].comps.prompt)
    assertEquals(users[1].comps.prompt, undefined)
    assert(users[0].seq < users[1].seq)
    // The generation reads `through` the prompt, so its window spans both.
    let generation = rows.find((row) => row.comps.generation)
    assertEquals(generation!.comps.generation.through, users[1].eid)
    db.close()
  },
)

slow('the generation dispatcher routes by provider to its runner', async () => {
  let db = freshDb()
  // A codex generation reaches the Responses transport and settles clean.
  let sid = session(db)
  let ran = 0
  let codex = managedCodex({
    db,
    cast: () => {},
    transport: {
      run: () => {
        ran++
        return Promise.resolve(result([{
          type: 'message',
          id: 'm',
          content: [{ type: 'output_text', text: 'ok' }],
        }]))
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
  })
  await codex.start(sid, noCodeJob())
  assertEquals(ran, 1)
  assert(!readEntries(db, sid).some((row) => row.comps.error))

  // A provider with no registered runner never reaches the transport; the
  // dispatch miss becomes a clear failed entry instead of a silent no-op.
  let cid = uuid()
  apply(db, [{
    eid: cid,
    name: 'session',
    comp: { id: uuid(), provider: 'gemini', model: 'flash' },
  }])
  db.prepare(
    "update session set origin = 'managed' where entity = (select id from entity where eid = ?)",
  ).run(cid)
  let reached = 0
  let scheduler = managedCodex({
    db,
    cast: () => {},
    transport: {
      run: () => {
        reached++
        return Promise.resolve(result([]))
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
  })
  await scheduler.start(cid, { ...noCodeJob(), model: 'flash' })
  assertEquals(reached, 0)
  let generation = readEntries(db, cid).find((row) => row.comps.generation)!
  let error = db.prepare(
    'select message from error where entity = (select id from entity where eid = ?)',
  ).get(
    generation.eid,
  ) as { message: string } | undefined
  assertMatch(String(error?.message), /no managed runner for provider 'gemini'/)

  // A claude generation routes to the claude runner (its bounded `claude -p`
  // transport, injected here as a spy so no subprocess launches). It never
  // reaches the Responses transport.
  let clid = uuid()
  apply(db, [{
    eid: clid,
    name: 'session',
    comp: { id: uuid(), provider: 'claude', model: 'sonnet' },
  }])
  db.prepare(
    "update session set origin = 'managed' where entity = (select id from entity where eid = ?)",
  ).run(clid)
  let claudeSaw: string[] = []
  let claude = managedCodex({
    db,
    cast: () => {},
    transport: {
      run: () => {
        reached++
        return Promise.resolve(result([]))
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
    generators: {
      claude: (ctx) => {
        claudeSaw.push(ctx.generation)
        return Promise.resolve({
          specs: [{
            output: { source: ctx.generation },
            message: { role: 'agent' },
            content: { body: 'from claude' },
          }],
          calls: [],
          usage: { input: 1, cached: 0, output: 1, reasoning: 0 },
          model: 'claude-sonnet-5',
          finalText: 'from claude',
        })
      },
    },
  })
  await claude.start(clid, { ...noCodeJob(), model: 'sonnet' })
  assertEquals(reached, 0) // the Responses transport is never touched
  assertEquals(claudeSaw.length, 1)
  let claudeGen = readEntries(db, clid).find((row) => row.comps.generation)!
  assertEquals(claudeSaw[0], claudeGen.eid)
  assert(!readEntries(db, clid).some((row) => row.comps.error))
  assert(
    readEntries(db, clid).some((row) =>
      row.comps.content?.body == 'from claude'
    ),
  )
  db.close()
})

slow('a Session past one entry page still runs its next turn', async () => {
  let db = freshDb()
  let sid = session(db)
  // 501 turns of prior transcript push the new turn's generation past one
  // entriesOf page. The runner must read the WHOLE partition or the fresh
  // generation reads back as "no generation entry" (T-16793): before the fix
  // readEntries capped at 500 and the runner never saw the entry it minted.
  append(
    db,
    sid,
    Array.from({ length: 501 }, (_, i) => ({
      message: { role: 'agent' as const },
      content: { body: `turn ${i}` },
    })),
  )
  let heard: Change[] = []
  let service = managedCodex({
    db,
    cast: (changes) => heard.push(...changes),
    transport: {
      run: () =>
        Promise.resolve(result([{
          type: 'message',
          id: 'm',
          content: [{ type: 'output_text', text: 'fresh answer' }],
        }])),
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
  })

  await service.start(sid, noCodeJob())
  let rows = readEntries(db, sid)
  assertEquals(rows.at(-1)!.comps.content?.body, 'fresh answer')
  assert(!rows.some((row) => row.comps.error))
  assertEquals(
    db.prepare(
      'select message from error where entity = (select id from entity where eid = ?)',
    ).get(sid),
    undefined,
  )
  db.close()
})

slow(
  'managed Codex relays typed progress until durable settlement',
  async () => {
    let db = freshDb()
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
  },
)

slow(
  'a reclaimed generation rejects its former lease observations',
  async () => {
    let db = freshDb()
    let tree = Deno.makeTempDirSync(), sid = session(db, tree)
    writeSession(db, sid, { base_revision: 'base' })
    let oldResult = Promise.withResolvers<ResponseResult>()
    let newResult = Promise.withResolvers<ResponseResult>()
    let oldStarted = Promise.withResolvers<void>()
    let newStarted = Promise.withResolvers<void>()
    let stale: ((event: ResponseEvent) => void) | undefined
    let observed: ({ source: string } & Observation)[] = []
    let requests: unknown[] = []
    let cast = () =>
      assert(sessionStateOf(readEntries(db, sid)).end != 'failed')
    let old = managedCodex({
      db,
      cast,
      clock: () => new Date('2026-08-10T12:00:00Z'),
      leaseMs: 100,
      transport: {
        run: (request, options) => {
          requests.push(request)
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
      cast,
      clock: () => new Date('2026-08-10T12:00:01Z'),
      leaseMs: 100,
      transport: {
        run: (request, options) => {
          requests.push(request)
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
    await replacement.sweep()
    assertEquals(requests.length, 2)
    assertEquals(requests[1], requests[0])
    assertEquals(
      readEntries(db, sid).filter((row) => row.comps.generation).length,
      1,
    )
    assertEquals(
      readEntries(db, sid).filter((row) => row.comps.output).length,
      1,
    )
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
  },
)

slow(
  'replayed starts finish preparation without duplicating input',
  async () => {
    let db = freshDb()
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
    await Promise.all([
      first.start(sid, job(tree)),
      first.start(sid, job(tree)),
    ])
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
  },
)

slow(
  'projectless starts use Tasks tools without preparing a worktree',
  async () => {
    let db = freshDb()
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
    let input = append(db, sid, [{
      message: { role: 'user' },
      content: { body: 'continue after restart' },
    }]).eids[0]
    await restarted.sweep()
    let resumed = readEntries(db, sid)
    assertEquals(
      resumed.filter((row) => row.comps.generation).length,
      2,
    )
    assertEquals(
      resumed.find((row) => row.eid == input)?.comps.content?.body,
      'continue after restart',
    )
    assertEquals(prepares, 0)
    assertEquals(requests, 2)
    assertEquals(trees, [undefined, undefined])
    db.close()
  },
)

slow(
  'a comment continues through one content-free attention entry',
  async () => {
    let db = freshDb()
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
  },
)

slow('an appended user message continues in the ordered log', async () => {
  let db = freshDb()
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

slow('attention during a generation waits for its next boundary', async () => {
  let db = freshDb()
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

slow('comments on claimed work wake its graph-native holder', async () => {
  let db = freshDb()
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
    comp: {},
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

slow('a failed generation consumes its wake and accepts the next', async () => {
  let db = freshDb()
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
  // The break stamped an `exception` (T-17081); recovering the next turn shed
  // it, so a healed Session carries neither health facet.
  assertEquals(
    db.prepare(
      'select 1 from error where entity = (select id from entity where eid = ?)',
    ).get(sid),
    undefined,
  )
  assertEquals(
    db.prepare(
      'select 1 from exception where entity = (select id from entity where eid = ?)',
    ).get(sid),
    undefined,
  )
  db.close()
})

slow(
  'a failed generation persists the provider reason, not the bare status',
  async () => {
    // End to end through the real Responses transport: a 400 whose complaint
    // lives only in the body `message` must reach the session as a BREAK, or a
    // graph-native failure reads as the useless `responses: HTTP 400` (T-16887).
    // The fault is our own malformed request → the `exception` facet (T-17081).
    let db = freshDb()
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
    let broke = db.prepare(
      'select message from exception where entity = (select id from entity where eid = ?)',
    ).get(
      sid,
    ) as { message: string } | undefined
    assertEquals(
      broke?.message,
      'responses: HTTP 400 — No tool output found for function call call_7.',
    )
    // A break, not a known error: it wears `exception`, not `error`.
    assertEquals(
      db.prepare(
        'select 1 from error where entity = (select id from entity where eid = ?)',
      ).get(sid),
      undefined,
    )
    db.close()
  },
)

// Seed a turn at a scheduler boundary without running a provider. Settled
// calls reproduce the gap where no ready entry or lease represents the turn.
let stoppingTurn = (
  state: 'ready' | 'leased' | 'settled',
  requested = true,
) => {
  let db = freshDb(), sid = session(db), runner = uuid()
  apply(db, [{ eid: runner, name: 'runner', comp: { name: 'stop-test' } }])
  let input = append(db, sid, [{
    message: { role: 'user' },
    content: { body: 'keep this instruction' },
  }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'test' },
  }]).eids[0]
  let won = takeEntry(db, generation, runner, 60_000)!
  let call = append(db, sid, [{
    output: { source: generation },
    call: { key: 'stop-call' },
    bash: { command: 'echo ignored' },
  }]).eids[0]
  settleGeneration(db, won.token)
  if (state == 'leased') takeEntry(db, call, runner, 60_000)
  if (state == 'settled') {
    append(db, sid, [{ result: { call }, content: { body: 'tool finished' } }])
  }
  let request = uuid()
  if (requested) {
    apply(db, [{ eid: request, name: 'stop_request', comp: { target: sid } }])
  }
  return { db, sid, runner, input, generation, call, request }
}

for (let state of ['ready', 'leased', 'settled'] as const) {
  for (let queued of ['none', 'attention', 'message'] as const) {
    Deno.test(`stop holds a ${state} tool turn with ${queued} queued until new input`, async () => {
      let { db, sid, runner, generation, call, request } = stoppingTurn(state)
      let calls = 0, called: string[] = []
      if (queued != 'none') {
        append(db, sid, [
          queued == 'attention' ? { attention: {} } : {
            message: { role: 'user' },
            content: { body: 'keep this queued instruction' },
          },
        ])
      }
      let history = readEntries(db, sid)
      for (let row of history) {
        delete row.comps.lease
        // Releasing a lease changes the physical archetype, not transcript content.
        delete row.comps.entity.archetype
      }
      let service = managedCodex({
        db,
        runner,
        cast: () => {},
        transport: {
          run: () => {
            calls++
            return Promise.resolve(result([{
              type: 'message',
              content: [{ type: 'output_text', text: 'resumed' }],
            }]))
          },
        },
        tools: () => Promise.resolve(tools(called)),
        prepare: () => Promise.resolve(),
      })
      try {
        assertEquals(service.stop(request, sid), true)
        let stopped = readEntries(db, sid)
        assertEquals(
          stopped.filter((r) => r.comps.cancel).map((r) =>
            r.comps.cancel.target
          ).sort(),
          (state == 'settled' ? [generation] : [generation, call]).sort(),
        )
        assertEquals(readComp(db, request, 'delivered')?.via, 'cancelled')
        assertEquals(advanceable(db, sid), [])
        assertEquals(sessionStateOf(stopped), {
          standing: 'terminal',
          end: 'interrupted',
        })
        assertEquals(
          stopped.filter((r) => !r.comps.cancel).map((r) => ({
            ...r,
            comps: {
              ...r.comps,
              entity: Object.fromEntries(
                Object.entries(r.comps.entity).filter(([k]) =>
                  k != 'archetype'
                ),
              ),
            },
          })),
          history,
        )
        await service.sweep()
        assertEquals(calls, 0)
        assertEquals(called, [])
        assertEquals(readEntries(db, sid), stopped)

        // A fresh notice must not deduplicate against an older stopped notice.
        assert(attention(db, sid, () => {}, runner).length)
        let resumed = readEntries(db, sid)
        assertEquals(
          service.stop(request, sid),
          true,
          'delivered replay is inert',
        )
        assertEquals(readEntries(db, sid), resumed)
        await service.sweep()
        assertEquals(calls, 1)
        assertEquals(called, [])
        assertEquals(
          readEntries(db, sid).at(-1)?.comps.content?.body,
          'resumed',
        )
      } finally {
        await service.settle()
        db.close()
      }
    })
  }
}

Deno.test('stop aborts a running tool and refuses its late result or another generation', async () => {
  let { db, sid, runner, request } = stoppingTurn('ready', false)
  let started = Promise.withResolvers<void>(), aborted = false
  let service = managedCodex({
    db,
    runner,
    cast: () => {},
    transport: {
      run: () => {
        throw new Error('provider must stay idle')
      },
    },
    tools: () =>
      Promise.resolve({
        ...tools([]),
        call: (_name, _args, context) => {
          started.resolve()
          return new Promise((resolve) => {
            context?.signal?.addEventListener('abort', () => {
              aborted = true
              resolve({ output: 'late tool result' })
            }, { once: true })
          })
        },
      }),
    prepare: () => {
      throw new Error('prepare must stay idle')
    },
  })
  let running = service.sweep()
  try {
    await started.promise
    apply(db, [{ eid: request, name: 'stop_request', comp: { target: sid } }])
    service.stop(request, sid)
    await running
    assert(aborted)
    assertEquals(readEntries(db, sid).filter((r) => r.comps.result), [])
    assertEquals(
      readEntries(db, sid).filter((r) => r.comps.generation).length,
      1,
    )
    assertEquals(readComp(db, sid, 'exception'), undefined)
    assertEquals(advanceable(db, sid), [])
  } finally {
    await service.settle()
    db.close()
  }
})

for (let state of ['ready', 'leased', 'settled'] as const) {
  Deno.test(`boot consumes a pending stop before ${state} work can run`, async () => {
    let { db, sid, runner, request } = stoppingTurn(state)
    let service = managedCodex({
      db,
      runner,
      clock: () => new Date('2100-01-01T00:00:00Z'),
      cast: () => {},
      transport: {
        run: () => {
          throw new Error('provider must stay idle')
        },
      },
      tools: () => {
        throw new Error('tools must stay idle')
      },
      prepare: () => {
        throw new Error('prepare must stay idle')
      },
    })
    try {
      await service.sweep()
      assertEquals(readComp(db, request, 'delivered')?.via, 'cancelled')
      assertEquals(advanceable(db, sid), [])
      assertEquals(readyEntries(db, sid), [])
      assertEquals(
        readEntries(db, sid).filter((r) => r.comps.generation).length,
        1,
      )
      assertEquals(readComp(db, sid, 'exception'), undefined)
    } finally {
      await service.settle()
      db.close()
    }
  })
}

Deno.test('another stop closes fresh input even before a new generation exists', async () => {
  let { db, sid, runner, request } = stoppingTurn('settled')
  let service = managedCodex({
    db,
    runner,
    cast: () => {},
    transport: {
      run: () => {
        throw new Error('provider must stay idle')
      },
    },
    tools: () => {
      throw new Error('tools must stay idle')
    },
    prepare: () => {
      throw new Error('prepare must stay idle')
    },
  })
  try {
    service.stop(request, sid)
    attention(db, sid, () => {}, runner)
    let second = uuid()
    apply(db, [{ eid: second, name: 'stop_request', comp: { target: sid } }])
    service.stop(second, sid)
    await service.sweep()
    assertEquals(advanceable(db, sid), [])
    assertEquals(sessionStateOf(readEntries(db, sid)), {
      standing: 'terminal',
      end: 'interrupted',
    })
  } finally {
    await service.settle()
    db.close()
  }
})

Deno.test('stop gate still refuses external and imported-only session turns', () => {
  let { db, sid } = stoppingTurn('settled')
  try {
    writeSession(db, sid, { origin: 'external' })
    assertThrows(
      () =>
        apply(db, [{
          eid: uuid(),
          name: 'stop_request',
          comp: { target: sid },
        }]),
      Error,
      'stop_request refused',
    )
    let imported = session(db),
      input = uuid(),
      generation = uuid(),
      call = uuid()
    append(
      db,
      imported,
      [
        { message: { role: 'user' } },
        {
          generation: { through: input, provider: 'codex', model: 'test' },
          delivered: {},
        },
        { call: { key: 'imported-call' }, output: { source: generation } },
        { result: { call }, content: { body: 'imported result' } },
      ],
      null,
      [input, generation, call, uuid()],
      { source: 'managed', line: 1 },
    )
    assertEquals(advanceable(db, imported), [])
    assertThrows(
      () =>
        apply(db, [{
          eid: uuid(),
          name: 'stop_request',
          comp: { target: imported },
        }]),
      Error,
      'stop_request refused',
    )
  } finally {
    db.close()
  }
})

Deno.test('a stop overtaken by completion only delivers its receipt', () => {
  let { db, sid, runner, request } = stoppingTurn('settled')
  let through = readEntries(db, sid).at(-1)!.eid
  let generation = append(db, sid, [{
    generation: { through, provider: 'codex', model: 'test' },
  }]).eids[0]
  let lease = takeEntry(db, generation, runner, 60_000)!
  append(db, sid, [{
    output: { source: generation, phase: 'final_answer' },
    message: { role: 'agent' },
    content: { body: 'completed before stop was handled' },
  }])
  settleGeneration(db, lease.token)
  let history = readEntries(db, sid)
  let service = managedCodex({
    db,
    runner,
    cast: () => {},
    transport: {
      run: () => {
        throw new Error('provider must stay idle')
      },
    },
    tools: () => {
      throw new Error('tools must stay idle')
    },
    prepare: () => {
      throw new Error('prepare must stay idle')
    },
  })
  try {
    assertEquals(service.stop(request, sid), true)
    assertEquals(readEntries(db, sid), history)
    assertEquals(readComp(db, request, 'delivered')?.via, 'cancelled')
    assertEquals(sessionStateOf(history), {
      standing: 'terminal',
      end: 'completed',
    })
  } finally {
    db.close()
  }
})

Deno.test('stop rolls back cancellation and delivery together on journal failure', () => {
  let { db, sid, runner, request } = stoppingTurn('leased')
  let heard: Change[] = []
  let service = managedCodex({
    db,
    runner,
    cast: (changes) => heard.push(...changes),
    transport: {
      run: () => {
        throw new Error('provider must stay idle')
      },
    },
    tools: () => {
      throw new Error('tools must stay idle')
    },
    prepare: () => {
      throw new Error('prepare must stay idle')
    },
  })
  let history = readEntries(db, sid), cursor = cursorOf(db)
  // Fail only the final receipt, after cancellation and lease release ran.
  db.exec(`create temp trigger reject_stop before insert on journal_field
    when exists (select 1 from journal_change jc join stop_request r on r.entity = jc.entity
                 where jc.id = new.change and jc.component = 'delivered')
    begin select raise(abort, 'stop journal unavailable'); end`)
  try {
    assertThrows(
      () => service.stop(request, sid),
      Error,
      'stop journal unavailable',
    )
    assertEquals(readEntries(db, sid), history)
    assertEquals(cursorOf(db), cursor)
    assertEquals(readComp(db, request, 'delivered'), undefined)
    assertEquals(heard, [])
  } finally {
    db.close()
  }
})

slow(
  'stop aborts the leased generation and refuses its late output',
  async () => {
    let db = freshDb()
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
    // A stop is normal machinery, NEVER a break (T-17081): the aborted generation
    // is screened by valid() before sessionFault, so neither the Session nor its
    // cancelled entry wears an `exception` — nothing for self-healing to fix.
    assertEquals(
      db.prepare(
        'select 1 from exception where entity = (select id from entity where eid = ?)',
      ).get(sid),
      undefined,
    )
    assertEquals(rows.some((row) => row.comps.exception), false)
    assertEquals(
      !!db.prepare(
        'select 1 from delivered where entity = (select id from entity where eid = ?)',
      ).get(request),
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
  },
)

slow('deleting a Session aborts its flight after entry cascades', async () => {
  let db = freshDb()
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
  let db = freshDb()
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

slow('restart reclaims graph_query on the same call entry', async () => {
  let db = freshDb()
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

slow('restart reclaims task_context on the same call entry', async () => {
  let db = freshDb()
  let tree = Deno.makeTempDirSync()
  let sid = session(db, tree), old = uuid(), calls = 0
  writeSession(db, sid, { base_revision: 'base' })
  apply(db, [{ eid: old, name: 'runner', comp: { name: 'old' } }])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-requested' },
  }]).eids[0]
  let generationLease = takeEntry(db, generation, old)!
  let context = append(db, sid, [{
    output: { source: generation },
    call: { key: 'recovered-context' },
    task_context: {},
  }], old).eids[0]
  settleGeneration(db, generationLease.token)
  takeEntry(
    db,
    context,
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
          content: [{ type: 'output_text', text: 'continued after context' }],
        }])),
    },
    tools: () =>
      Promise.resolve({
        tools: [],
        call: (name) => {
          calls++
          assertEquals(name, 'task_context')
          return Promise.resolve({ output: 'current task context' })
        },
      }),
    prepare: () => Promise.resolve(),
  })
  await service.sweep()

  let rows = readEntries(db, sid)
  assertEquals(calls, 1)
  assertEquals(rows.filter((row) => row.eid == context).length, 1)
  assertEquals(
    rows.find((row) => row.comps.result?.call == context)?.comps.content.body,
    'current task context',
  )
  assertEquals(rows.find((row) => row.eid == context)?.comps.error, undefined)
  db.close()
})

Deno.test('restart leaves an uncertain side-effecting call recoverable', async () => {
  let db = freshDb()
  let tree = Deno.makeTempDirSync()
  let sid = session(db, tree), old = uuid(), calls = 0
  let casts: Change[] = []
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
    cast: (changes) => {
      casts.push(...changes)
      assert(sessionStateOf(readEntries(db, sid)).end != 'failed')
    },
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
  let rows = readEntries(db, sid)
  let row = rows.find((row) => row.eid == call)!
  // The ambiguity is the call's RESULT, not an error on the entry: an error
  // there would end the Session, and the model never gets to recover.
  assertEquals(row.comps.error, undefined)
  assertEquals(row.comps.lease, undefined)
  let answer = rows.find((row) => row.comps.result?.call == call)!
  assertMatch(String(answer.comps.content.body), /restarted mid-call/)
  assertEquals(calls, 0)
  // Ambiguity is a known state on the interrupted call. It must not flash a
  // Session exception on the live change stream: self-healing and settlement
  // react before the successful recovery generation can clear that facet.
  assertEquals(
    casts.some((change) => change.eid == sid && change.name == 'exception'),
    false,
  )
  db.close()
})

Deno.test('restart reattaches a shell on its original call and feeds its exit to the next turn', async () => {
  let db = freshDb()
  let tree = Deno.makeTempDirSync()
  let sid = session(db, tree), old = uuid(), calls = 0
  let casts: Change[] = []
  let resumed: string[] = []
  let inputs: unknown[] = []
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
    cast: (changes) => {
      casts.push(...changes)
      assert(sessionStateOf(readEntries(db, sid)).end != 'failed')
    },
    clock: () => new Date('2026-08-10T12:00:01Z'),
    transport: {
      run: (request) => {
        inputs.push(request.input)
        return Promise.resolve(result([{
          type: 'message',
          content: [{ type: 'output_text', text: 'continued safely' }],
        }]))
      },
    },
    tools: () =>
      Promise.resolve({
        ...tools([]),
        resume: (_name, _args, context) => {
          resumed.push(context.entry!)
          return Promise.resolve({
            output: 'kept shell stdout',
            facets: { exit: { code: 7 }, stderr: { text: 'kept stderr' } },
          })
        },
        call: () => {
          calls++
          return Promise.resolve({ output: 'repeated' })
        },
      }),
    prepare: () => Promise.resolve(),
  })
  await service.sweep()
  let rows = readEntries(db, sid)
  let row = rows.find((row) => row.eid == call)!
  assertEquals(row.comps.error, undefined)
  assertEquals(resumed, [call])
  let results = rows.filter((row) => row.comps.result?.call == call)
  assertEquals(results.length, 1)
  assertEquals(results[0].comps.exit.code, 7)
  assertMatch(JSON.stringify(inputs), /kept shell stdout/)
  assertMatch(JSON.stringify(inputs), /kept stderr/)
  assertEquals(rows.at(-1)?.comps.content?.body, 'continued safely')
  await service.sweep()
  assertEquals(resumed, [call])
  assertEquals(rows.find((row) => row.eid == call)?.comps.lease, undefined)
  assertEquals(calls, 0)
  // Ambiguity is a known state on the interrupted call. It must not flash a
  // Session exception on the live change stream: self-healing and settlement
  // react before the successful recovery generation can clear that facet.
  assertEquals(
    casts.some((change) => change.eid == sid && change.name == 'exception'),
    false,
  )
  db.close()
})

slow('an abandoned lease wakes the runner at its deadline', async () => {
  let db = freshDb()
  let sid = session(db), old = uuid(), calls = 0
  writeSession(db, sid, { base_revision: 'base' })
  apply(db, [{ eid: old, name: 'runner', comp: { name: 'old' } }])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-requested' },
  }]).eids[0]
  takeEntry(db, generation, old, 100)
  let service = managedCodex({
    db,
    cast: () => {},
    leaseMs: 100,
    transport: {
      run: () => {
        calls++
        return Promise.resolve(result([{
          type: 'message',
          content: [{ type: 'output_text', text: 'recovered on time' }],
        }]))
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
  })

  await service.sweep()
  assertEquals(calls, 0)
  await until(() => calls, { label: 'the lease deadline' })
  await service.sweep()
  assertEquals(
    readEntries(db, sid).at(-1)?.comps.content?.body,
    'recovered on time',
  )
  db.close()
})

slow(
  'a killed in-flight call recovers: replay pairs the orphaned call with an output',
  async () => {
    // The real poison (S-16840/S-16872): a hosted shell call in flight when the
    // runner died, reconciled to an error with no result. Before the fix the next
    // generation's Responses input carried an orphaned function_call and every
    // resume returned HTTP 400. Drive the whole path — reconciliation, advance,
    // project, transport — and assert the input the provider sees is valid and the
    // session recovers.
    let db = freshDb()
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
    // Reconciliation happened: an interrupted result closes the orphaned call.
    let callRow = rows.find((row) => row.eid == call)!
    assertEquals(callRow.comps.error, undefined)
    let answers = rows.filter((row) => row.comps.result?.call == call)
    assertEquals(answers.length, 1)
    assertMatch(String(answers[0].comps.content.body), /restarted mid-call/)
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
      db.prepare(
        'select 1 from error where entity = (select id from entity where eid = ?)',
      ).get(sid),
      undefined,
    )
    db.close()
  },
)

slow('restart settles durable generation and call evidence', async () => {
  let db = freshDb()
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
    !!db.prepare(
      'select 1 from delivered where entity = (select id from entity where eid = ?)',
    ).get(generation),
    true,
  )
  assertEquals(
    db.prepare(
      'select 1 from error where entity = (select id from entity where eid = ?)',
    ).get(generation),
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

slow(
  'drain settles the in-flight generation and leaves new work ready',
  async () => {
    let db = freshDb()
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
  },
)

slow(
  'the heartbeat keeps a generation outliving its lease TTL fresh',
  async () => {
    let db = freshDb()
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

slow(
  'graph-native compaction bounds replay across a restart and a later turn',
  async () => {
    let db = freshDb()
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
  },
)

slow(
  'provider execution reads only a checkpoint tail after a long prefix',
  async () => {
    let db = freshDb()
    let sid = session(db)
    writeSession(db, sid, { base_revision: 'base' })
    let begin = uuid(), source = uuid()
    append(
      db,
      sid,
      [
        { message: { role: 'user' }, content: { body: 'old prefix' } },
        {
          generation: { through: begin, provider: 'codex', model: 'old' },
        },
      ],
      undefined,
      [begin, source],
    )
    append(db, sid, Array.from({ length: 5_001 }, () => ({ attention: {} })))
    let checkpoint = append(db, sid, [{
      output: { source },
      checkpoint: { through: source },
      opaque: {
        format: 'openai:compaction',
        data: JSON.stringify({ type: 'compaction', encrypted_content: 'cut' }),
      },
    }]).eids[0]
    let tail = append(db, sid, [{
      message: { role: 'user' },
      content: { body: 'small tail' },
    }]).eids[0]
    let current = append(db, sid, [{
      generation: { through: tail, provider: 'codex', model: 'new' },
    }]).eids[0]
    let consumed: string[] = []
    let service = managedCodex({
      db,
      cast: () => {},
      transport: { run: () => Promise.resolve(result([])) },
      tools: () => Promise.resolve(tools([])),
      prepare: () => Promise.resolve(),
      generators: {
        codex: (ctx) => {
          consumed = ctx.entries.map((row) => row.eid)
          return Promise.resolve({
            specs: [{
              output: { source: ctx.generation },
              message: { role: 'agent' },
              content: { body: 'done' },
            }],
            calls: [],
            usage: { input: 1, cached: 0, output: 1, reasoning: 0 },
            model: 'new',
            finalText: 'done',
          })
        },
      },
    })

    await service.sweep()
    assertEquals(
      new Set(consumed),
      new Set([source, checkpoint, tail, current]),
    )
    assertEquals(readEntries(db, sid).length, 5_007)
    db.close()
  },
)

// The credential outage (T-33916, T-35017): a generation that died because
// nobody could sign in is work that ran during an outage, and it stayed failed
// long after the re-auth. A credential minted AFTER the failure puts it back.
let failedAt = () => new Date(Date.parse('2026-09-05T06:07:59.000Z'))
let failed = (db: ReturnType<typeof open>, sid: string, message: string) => {
  let holder = uuid()
  apply(db, [{ eid: holder, name: 'runner', comp: { name: 'tasksd' } }])
  let input = uuid()
  let eid = append(
    db,
    sid,
    [{ message: { role: 'user' } }, {
      generation: { through: input, provider: 'codex', model: 'gpt-requested' },
    }],
    null,
    [input, uuid()],
  ).eids[1]
  failEntry(db, takeEntry(db, eid, holder)!.token, message, failedAt)
  return eid
}

Deno.test('a credential minted after the failure retries it, once', () => {
  // bareDb: this test writes every row it reads, so the demo seed is cost
  // with no subject (testing.ts).
  let db = bareDb()
  let sid = session(db)
  let eid = failed(db, sid, `${CREDENTIAL_FAULT} — ${CODEX_REAUTH}`)
  let other = failed(db, sid, 'responses: HTTP 400 — malformed request')
  assertEquals(readyEntries(db, sid).map((row) => row.eid), [])

  // The credential on disk predates the failure — it is the SAME dead one.
  let before = Date.parse('2026-09-04T00:00:00Z')
  assertEquals(retryCredential(db, () => {}, before), [])
  assertEquals(readyEntries(db, sid).map((row) => row.eid), [])

  // Signed in again: the credential-failed generation is ready work again,
  // and nothing else is touched — a malformed request is still our own bug.
  let after = Date.parse('2026-09-08T20:08:16Z')
  let heard: Change[] = []
  assertEquals(retryCredential(db, (c) => heard.push(...c), after), [eid])
  assertEquals(readyEntries(db, sid).map((row) => row.eid), [eid])
  assertEquals(heard.some((c) => c.eid == eid && c.comp == null), true)
  assertEquals(
    !!db.prepare(
      'select 1 from error where entity = (select id from entity where eid = ?)',
    ).get(other),
    true,
  )

  // Once per sign-in: the same credential buys no second retry, so a session
  // wedged for another reason cannot loop on this sweep.
  assertEquals(retryCredential(db, () => {}, after), [])
  db.close()
})

Deno.test('credential retry keeps the failure when journaling is unavailable', () => {
  let db = bareDb()
  let sid = session(db)
  let eid = failed(db, sid, CREDENTIAL_FAULT)
  let before = readComp(db, eid, 'error')
  let cursor = cursorOf(db)
  let heard: Change[] = []
  let restore = rejectJournal(db)
  try {
    assertThrows(
      () =>
        retryCredential(
          db,
          (cs) => heard.push(...cs),
          Date.parse('2026-09-09'),
        ),
      Error,
      'journal unavailable',
    )
    assertEquals(readComp(db, eid, 'error'), before)
    assertEquals(readyEntries(db, sid), [])
    assertEquals(cursorOf(db), cursor)
    assertEquals(heard, [])
  } finally {
    restore()
  }
})

slow(
  'a spawn that failed on the credential says the step, and runs when it returns',
  async () => {
    let db = freshDb()
    let sid = session(db)
    // The outage, end to end: the account service cannot hand out a
    // credential, so the transport faults before any HTTP.
    let service = managedCodex({
      db,
      cast: () => {},
      transport: responses({
        credentials: {
          get: () => Promise.reject(new Error('Codex is not signed in.')),
          hint: CODEX_REAUTH,
        },
        fetch: () => {
          throw new Error('a missing credential reached HTTP')
        },
      }),
      tools: () => Promise.resolve(tools([])),
      prepare: () => Promise.resolve(),
    })
    await service.start(sid, noCodeJob())
    // One line naming the step, and no stack — this is what the board shows.
    let broke = db.prepare(
      'select message, stack from exception where entity = (select id from entity where eid = ?)',
    ).get(sid) as { message: string; stack: string | null } | undefined
    assertEquals(broke?.message, `${CREDENTIAL_FAULT} — ${CODEX_REAUTH}`)
    assertEquals(broke?.stack, null)
    assertEquals(readyEntries(db, sid).length, 0)

    // The re-auth: a credential issued now, and the runner picks the session
    // back up on its next pass with no new spawn and no human replay.
    assertEquals(retryCredential(db, () => {}, Date.now()).length, 1)
    assertEquals(
      db.prepare(
        'select 1 from exception where entity = (select id from entity where eid = ?)',
      ).get(sid),
      undefined,
    )
    let back = managedCodex({
      db,
      cast: () => {},
      transport: {
        run: () =>
          Promise.resolve(result([{
            type: 'message',
            content: [{ type: 'output_text', text: 'signed in again' }],
          }])),
      },
      tools: () => Promise.resolve(tools([])),
      prepare: () => Promise.resolve(),
    })
    await back.sweep()
    assertEquals(
      readEntries(db, sid).at(-1)?.comps.content?.body,
      'signed in again',
    )
    db.close()
  },
)

Deno.test('restart of an old error-bearing call never exposes a terminal recovery gap (T-37196)', async () => {
  let db = freshDb(), sid = session(db), old = uuid()
  apply(db, [{ eid: old, name: 'runner', comp: { name: 'old' } }])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let gen = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-requested' },
  }])
    .eids[0]
  let lease = takeEntry(db, gen, old)!
  let call =
    append(db, sid, [{ output: { source: gen }, call: { key: 'old-call' } }])
      .eids[0]
  settleGeneration(db, lease.token)
  takeEntry(db, call, old, 100, () => new Date('2026-08-10T12:00:00Z'))
  // Historical runners left this error on a call that is still owed a result.
  apply(db, [{
    eid: call,
    name: 'error',
    comp: { message: 'ambiguous restart' },
  }])
  let observed: string[] = []
  let turns = 0
  let service = managedCodex({
    db,
    clock: () => new Date('2026-08-10T12:00:01Z'),
    cast: () => {
      let state = sessionStateOf(readEntries(db, sid))
      observed.push(state.end ?? state.standing)
    },
    transport: {
      run: () => {
        turns++
        return Promise.resolve(result([{
          type: 'message',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: 'recovered' }],
        }]))
      },
    },
    tools: () => Promise.resolve(tools([])),
    prepare: () => Promise.resolve(),
  })
  try {
    await service.sweep()
    assertEquals(turns, 1)
    assertEquals(observed.includes('failed'), false)
    assertEquals(observed.includes('interrupted'), false)
    assertEquals(observed.includes('idle'), true)
    assertEquals(observed.at(-1), 'completed')
  } finally {
    db.close()
  }
})
